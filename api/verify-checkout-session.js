const { centsToCurrency, getStripeClient } = require("../lib/api-utils/payments");
const { getAdminClient, handleApiError, publicApiError, sendJson } = require("../lib/api-utils/supabase");

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

    const { data: booking, error } = await supabase
      .from("bookings")
      .select(
        `
        id,
        owner_id,
        dog_id,
        service,
        dropoff_date,
        pickup_date,
        stripe_checkout_session_id,
        deposit_due_today,
        remaining_balance,
        owner:owners(first_name,last_name,email),
        dog:dogs(name)
      `,
      )
      .eq("id", resolvedBookingId)
      .single();

    if (error || !booking) {
      throw publicApiError("We could not find this booking request.", 404, "booking_not_found");
    }

    if (booking.stripe_checkout_session_id && booking.stripe_checkout_session_id !== sessionId) {
      throw publicApiError("This payment session does not match the booking.", 400, "payment_session_mismatch");
    }

    if (session.metadata?.booking_id && session.metadata.booking_id !== booking.id) {
      throw publicApiError("This Stripe payment belongs to a different booking.", 400, "payment_booking_mismatch");
    }

    if (session.payment_status !== "paid") {
      throw publicApiError("The deposit payment was not completed.", 402, "payment_not_paid");
    }

    const paymentIntentId =
      typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || "";

    const depositPaid = centsToCurrency(session.amount_total || 0);
    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id: paymentIntentId,
        payment_status: "deposit_paid",
        deposit_paid_at: new Date().toISOString(),
        deposit_paid_amount: depositPaid,
        status: "deposit_paid",
      })
      .eq("id", booking.id);

    if (updateError) {
      throw publicApiError(
        "The payment succeeded, but we could not update the booking payment status. Please check the bookings payment columns.",
        500,
        "payment_update_failed",
      );
    }

    sendJson(res, 200, {
      ok: true,
      message: "Deposit received. Thank you.",
      bookingId: booking.id,
      ownerId: booking.owner_id,
      dogId: booking.dog_id,
      ownerEmail: booking.owner?.email || "",
      sessionId: session.id,
      paymentIntentId,
      service: booking.service,
      dogName: booking.dog?.name || "Guest dog",
      dates: `${booking.dropoff_date || ""} → ${booking.pickup_date || ""}`,
      depositPaid,
      remainingBalance: booking.remaining_balance,
    });
  } catch (error) {
    handleApiError(res, error);
  }
};
