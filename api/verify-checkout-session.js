const { getStripeClient } = require("../lib/api-utils/payments");
const {
  paymentConfirmationPayload,
  reconcileCheckoutSession,
} = require("../lib/api-utils/payment-reconciliation");
const { getAdminClient, handleApiError, publicApiError, sendJson } = require("../lib/api-utils/supabase");

function getOrigin(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const protocol = req.headers["x-forwarded-proto"] || "https";
  return `${protocol}://${host}`;
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

    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] });
    if (bookingId && session.metadata?.booking_id && bookingId !== session.metadata.booking_id) {
      throw publicApiError("This Stripe payment belongs to a different booking.", 400, "payment_booking_mismatch");
    }

    const result = await reconcileCheckoutSession({
      supabase: getAdminClient(),
      session,
      origin: getOrigin(req),
    });
    sendJson(res, 200, paymentConfirmationPayload({ ...result, session }));
  } catch (error) {
    handleApiError(res, error);
  }
};
