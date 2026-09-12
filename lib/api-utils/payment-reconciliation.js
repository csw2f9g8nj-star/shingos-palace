const {
  buildBalancePaidEmail,
  buildDepositConfirmationEmail,
  getBookingPetDisplay,
  sendResendEmail,
  serviceLabel,
} = require("./booking-emails");
const { amountToCents, centsToCurrency } = require("./payments");
const { publicApiError } = require("./supabase");

const BOOKING_SELECT = `
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
  stripe_payment_intent_id,
  payment_status,
  deposit_due_today,
  deposit_paid_amount,
  deposit_paid_at,
  stripe_balance_checkout_session_id,
  stripe_balance_payment_intent_id,
  balance_payment_status,
  balance_paid_amount,
  balance_paid_at,
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

function paymentIntentId(session) {
  return typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id || "";
}

function isAlreadyReconciled(booking, session, paymentType) {
  if (paymentType === "balance") {
    return booking.stripe_balance_checkout_session_id === session.id && booking.balance_payment_status === "paid";
  }
  return booking.stripe_checkout_session_id === session.id && ["deposit_paid", "paid_in_full"].includes(booking.payment_status);
}

async function reconcileCheckoutSession({ supabase, session, origin }) {
  const bookingId = session.metadata?.booking_id;
  if (!bookingId) {
    throw publicApiError("This Stripe payment is missing booking information.", 400, "missing_booking_id");
  }

  const paymentType = session.metadata?.payment_type === "balance" ? "balance" : "deposit";
  const isBalancePayment = paymentType === "balance";
  const { data: booking, error } = await supabase.from("bookings").select(BOOKING_SELECT).eq("id", bookingId).single();
  if (error || !booking) {
    throw publicApiError("We could not find this booking request.", 404, "booking_not_found");
  }

  const storedSessionId = isBalancePayment
    ? booking.stripe_balance_checkout_session_id
    : booking.stripe_checkout_session_id;
  if (storedSessionId && storedSessionId !== session.id) {
    throw publicApiError("This payment session does not match the booking.", 400, "payment_session_mismatch");
  }
  if (session.payment_status !== "paid") {
    throw publicApiError(
      isBalancePayment ? "The remaining balance payment was not completed." : "The deposit payment was not completed.",
      402,
      "payment_not_paid",
    );
  }

  const alreadyReconciled = isAlreadyReconciled(booking, session, paymentType);
  const amountPaid = centsToCurrency(session.amount_total || 0);
  if (!alreadyReconciled) {
    const expectedAmount = isBalancePayment ? booking.remaining_balance : booking.deposit_due_today;
    if (amountToCents(expectedAmount) !== Number(session.amount_total || 0)) {
      throw publicApiError("The Stripe payment amount does not match this booking.", 409, "payment_amount_mismatch");
    }

    const now = new Date().toISOString();
    const updatePayload = isBalancePayment
      ? {
          stripe_balance_checkout_session_id: session.id,
          stripe_balance_payment_intent_id: paymentIntentId(session),
          balance_payment_status: "paid",
          balance_paid_at: now,
          balance_paid_amount: amountPaid,
          remaining_balance: "$0",
          payment_status: "paid_in_full",
          status: "paid_in_full",
        }
      : {
          stripe_checkout_session_id: session.id,
          stripe_payment_intent_id: paymentIntentId(session),
          payment_status: "deposit_paid",
          deposit_paid_at: now,
          deposit_paid_amount: amountPaid,
          status: "deposit_paid",
        };

    const { error: updateError } = await supabase
      .from("bookings")
      .update(updatePayload)
      .eq("id", booking.id)
      .eq(isBalancePayment ? "stripe_balance_checkout_session_id" : "stripe_checkout_session_id", session.id);
    if (updateError) {
      throw publicApiError(
        "The payment succeeded, but the booking payment status could not be updated.",
        500,
        isBalancePayment ? "balance_payment_update_failed" : "payment_update_failed",
      );
    }
    Object.assign(booking, updatePayload);
  }

  if (booking.owner?.email) {
    try {
      await sendPaymentEmailIfNeeded({ supabase, booking, paymentType, amountPaid, origin });
    } catch (emailError) {
      console.error("Payment confirmation email failed after successful Stripe payment.", {
        bookingId: booking.id,
        paymentType,
        error: emailError?.message || emailError,
      });
    }
  }

  return { booking, paymentType, amountPaid, alreadyReconciled };
}

async function expireDepositCheckoutSession({ supabase, session }) {
  const bookingId = session.metadata?.booking_id;
  const paymentType = session.metadata?.payment_type === "balance" ? "balance" : "deposit";
  if (!bookingId || paymentType !== "deposit") return { expired: false };

  const { data, error } = await supabase
    .from("bookings")
    .update({ status: "expired", payment_status: "expired" })
    .eq("id", bookingId)
    .eq("stripe_checkout_session_id", session.id)
    .eq("status", "deposit_pending")
    .select("id")
    .maybeSingle();

  if (error) {
    throw Object.assign(
      publicApiError("The expired payment session could not be reconciled.", 500, "payment_expiration_update_failed"),
      {
        supabaseCode: error.code,
        supabaseMessage: error.message,
        details: error.details,
        hint: error.hint,
      },
    );
  }

  return { expired: Boolean(data) };
}

function paymentConfirmationPayload({ booking, paymentType, amountPaid, session }) {
  const petData = getBookingPetDisplay(booking);
  const isBalancePayment = paymentType === "balance";
  return {
    ok: true,
    message: isBalancePayment ? "Remaining balance received. Thank you." : "Deposit received. Thank you.",
    paymentType,
    bookingId: booking.id,
    ownerId: booking.owner_id,
    dogId: booking.dog_id,
    ownerEmail: booking.owner?.email || "",
    sessionId: session.id,
    paymentIntentId: paymentIntentId(session),
    service: booking.service,
    serviceLabel: serviceLabel(booking.service),
    petType: booking.pet_type || "dog",
    pets: petData.pets,
    petName: petData.namesDisplay,
    petNames: petData.names,
    petLabel: petData.pets.length > 1 ? "Pets" : "Pet",
    bookingPetSummary: booking.booking_pet_summary || "",
    dogName: petData.namesDisplay,
    dates: `${booking.dropoff_date || ""} → ${booking.pickup_date || ""}`,
    depositPaid: isBalancePayment ? booking.deposit_paid_amount || booking.deposit_due_today || "-" : amountPaid,
    balancePaid: isBalancePayment ? amountPaid : "",
    remainingBalance: isBalancePayment ? "PAID ✓" : booking.remaining_balance,
    balancePaymentStatus: isBalancePayment ? "paid" : booking.balance_payment_status || "",
  };
}

module.exports = {
  expireDepositCheckoutSession,
  paymentConfirmationPayload,
  reconcileCheckoutSession,
};
