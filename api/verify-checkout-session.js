const { getStripeClient } = require("../lib/api-utils/payments");
const {
  paymentConfirmationPayload,
  reconcileCheckoutSession,
} = require("../lib/api-utils/payment-reconciliation");
const { getAdminClient, handleApiError, publicApiError, sendJson } = require("../lib/api-utils/supabase");
const { createBookingActionToken } = require("../lib/api-utils/action-tokens");
const { enforceRateLimit, trustedOrigin } = require("../lib/api-utils/request-security");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }
  if (!enforceRateLimit(req, res, { key: "verify-checkout", limit: 60, windowMs: 15 * 60 * 1000 })) return;

  try {
    const { bookingId, sessionId } = req.body || {};
    if (!sessionId) {
      throw publicApiError("Missing payment session.", 400, "missing_payment_session");
    }

    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
    if (bookingId && session.metadata?.booking_id && bookingId !== session.metadata.booking_id) {
      throw publicApiError("This Stripe payment belongs to a different booking.", 400, "payment_booking_mismatch");
    }

    const result = await reconcileCheckoutSession({
      supabase: getAdminClient(),
      session,
      origin: trustedOrigin(req),
    });
    const payload = paymentConfirmationPayload({ ...result, session });
    payload.profileActionToken = createBookingActionToken({
      scope: "profile",
      bookingId: result.booking.id,
      ownerId: result.booking.owner_id,
      petIds: payload.pets.map((pet) => pet.id).filter(Boolean),
      lifetimeSeconds: 7 * 24 * 60 * 60,
    });
    sendJson(res, 200, payload);
  } catch (error) {
    handleApiError(res, error);
  }
};
