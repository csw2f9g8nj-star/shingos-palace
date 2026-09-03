const {
  buildBalancePaidEmail,
  buildDepositConfirmationEmail,
  getBookingPetDisplay,
  sendResendEmail,
  serviceLabel,
} = require("../lib/api-utils/booking-emails");
const { centsToCurrency, getStripeClient } = require("../lib/api-utils/payments");
const { getAdminClient, handleApiError, publicApiError, sendJson } = require("../lib/api-utils/supabase");

function getOrigin(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const protocol = req.headers["x-forwarded-proto"] || "https";
  return `${protocol}://${host}`;
}

async function claimEmailSend(supabase, bookingId, column) {
  const timestamp = new Date().toISOString();
  const { data, error } = await supabase
    .from("bookings")
    .update({ [column]: timestamp })
    .eq("id", bookingId)
    .is(column, null)
    .select(`id, ${column}`)
    .maybeSingle();

  if (error) {
    throw Object.assign(publicApiError("Payment saved, but email status could not be updated.", 500, "email_claim_failed"), {
      supabaseCode: error.code,
      supabaseMessage: error.message,
      details: error.details,
      hint: error.hint,
    });
  }

  return data ? timestamp : "";
}

async function releaseEmailClaim(supabase, bookingId, column, timestamp) {
  if (!timestamp) return;
  await supabase.from("bookings").update({ [column]: null }).eq("id", bookingId).eq(column, timestamp);
}

async function sendPaymentEmailIfNeeded({ supabase, booking, paymentType, amountPaid, origin }) {
  const column = paymentType === "balance" ? "balance_receipt_sent_at" : "deposit_confirmation_sent_at";
  const claimTimestamp = await claimEmailSend(supabase, booking.id, column);
  if (!claimTimestamp) return;

  try {
    const email = paymentType === "balance"
      ? buildBalancePaidEmail({ booking, amountPaid, origin })
      : buildDepositConfirmationEmail({ booking, amountPaid, origin });

    await sendResendEmail({
      to: booking.owner?.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
  } catch (error) {
    await releaseEmailClaim(supabase, booking.id, column, claimTimestamp);
    throw error;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  try {
    const { bookingId, sessionId } = req.body || {};
    if (!sessionId) {
      throw publicApiError("Missing payment session.", 400, "missing_payment_session");
    }

    const supabase = getAdminClient();
    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent"],
    });

    const resolvedBookingId = bookingId || session.metadata?.booking_id;
    if (!resolvedBookingId) {
      throw publicApiError("This Stripe payment is missing booking information.", 400, "missing_booking_id");
    }

    const paymentType = session.metadata?.payment_type === "balance" ? "balance" : "deposit";
    const isBalancePayment = paymentType === "balance";
    const bookingSelect = isBalancePayment
      ? `
        id,
        owner_id,
        dog_id,
        service,
        pet_type,
        booking_pet_summary,
        dropoff_date,
        pickup_date,
        estimated_total,
        stripe_balance_checkout_session_id,
        deposit_due_today,
        deposit_paid_amount,
        remaining_balance,
        deposit_confirmation_sent_at,
        balance_receipt_sent_at,
        balance_payment_status,
        owner:owners(first_name,last_name,email),
        dog:dogs(id,name,pet_type),
        booking_pets(
          dog_id,
          pet_type,
          dog:dogs(id,name,pet_type)
        )
      `
      : `
        id,
        owner_id,
        dog_id,
        service,
        pet_type,
        booking_pet_summary,
        dropoff_date,
        pickup_date,
        estimated_total,
        stripe_checkout_session_id,
        deposit_due_today,
        remaining_balance,
        deposit_confirmation_sent_at,
        balance_receipt_sent_at,
        owner:owners(first_name,last_name,email),
        dog:dogs(id,name,pet_type),
        booking_pets(
          dog_id,
          pet_type,
          dog:dogs(id,name,pet_type)
        )
      `;

    const { data: booking, error } = await supabase.from("bookings").select(bookingSelect).eq("id", resolvedBookingId).single();

    if (error || !booking) {
      throw publicApiError("We could not find this booking request.", 404, "booking_not_found");
    }

    const storedSessionId = isBalancePayment ? booking.stripe_balance_checkout_session_id : booking.stripe_checkout_session_id;
    if (storedSessionId && storedSessionId !== sessionId) {
      throw publicApiError("This payment session does not match the booking.", 400, "payment_session_mismatch");
    }

    if (session.metadata?.booking_id && session.metadata.booking_id !== booking.id) {
      throw publicApiError("This Stripe payment belongs to a different booking.", 400, "payment_booking_mismatch");
    }

    if (session.payment_status !== "paid") {
      throw publicApiError(
        isBalancePayment ? "The remaining balance payment was not completed." : "The deposit payment was not completed.",
        402,
        "payment_not_paid",
      );
    }

    const paymentIntentId =
      typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || "";

    const amountPaid = centsToCurrency(session.amount_total || 0);
    const updatePayload = isBalancePayment
      ? {
          stripe_balance_checkout_session_id: session.id,
          stripe_balance_payment_intent_id: paymentIntentId,
          balance_payment_status: "paid",
          balance_paid_at: new Date().toISOString(),
          balance_paid_amount: amountPaid,
          payment_status: "paid_in_full",
          status: "paid_in_full",
        }
      : {
          stripe_checkout_session_id: session.id,
          stripe_payment_intent_id: paymentIntentId,
          payment_status: "deposit_paid",
          deposit_paid_at: new Date().toISOString(),
          deposit_paid_amount: amountPaid,
          status: "deposit_paid",
        };

    const { error: updateError } = await supabase.from("bookings").update(updatePayload).eq("id", booking.id);

    if (updateError) {
      throw publicApiError(
        isBalancePayment
          ? "The payment succeeded, but we could not update the remaining balance status. Please run the remaining balance migration in Supabase."
          : "The payment succeeded, but we could not update the booking payment status. Please check the bookings payment columns.",
        500,
        isBalancePayment ? "balance_payment_update_failed" : "payment_update_failed",
      );
    }

    const origin = getOrigin(req);
    const petData = getBookingPetDisplay(booking);
    const pets = petData.pets;
    const petName = petData.namesDisplay;

    if (booking.owner?.email) {
      try {
        await sendPaymentEmailIfNeeded({
          supabase,
          booking,
          paymentType,
          amountPaid,
          origin,
        });
      } catch (emailError) {
        console.error("Payment confirmation email failed after successful Stripe payment.", {
          bookingId: booking.id,
          paymentType,
          ownerEmail: booking.owner?.email || "",
          error: emailError?.message || emailError,
        });
      }
    }

    sendJson(res, 200, {
      ok: true,
      message: isBalancePayment ? "Remaining balance received. Thank you." : "Deposit received. Thank you.",
      paymentType,
      bookingId: booking.id,
      ownerId: booking.owner_id,
      dogId: booking.dog_id,
      ownerEmail: booking.owner?.email || "",
      sessionId: session.id,
      paymentIntentId,
      service: booking.service,
      serviceLabel: serviceLabel(booking.service),
      petType: booking.pet_type || "dog",
      pets,
      petName,
      petNames: petData.names,
      petLabel: pets.length > 1 ? "Pets" : "Pet",
      bookingPetSummary: booking.booking_pet_summary || "",
      dogName: petName,
      dates: `${booking.dropoff_date || ""} → ${booking.pickup_date || ""}`,
      depositPaid: isBalancePayment ? booking.deposit_paid_amount || booking.deposit_due_today || "-" : amountPaid,
      balancePaid: isBalancePayment ? amountPaid : "",
      remainingBalance: isBalancePayment ? "PAID ✓" : booking.remaining_balance,
      balancePaymentStatus: isBalancePayment ? "paid" : booking.balance_payment_status || "",
    });
  } catch (error) {
    handleApiError(res, error);
  }
};
