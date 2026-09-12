const { getStripeClient } = require("../lib/api-utils/payments");
const {
  expireDepositCheckoutSession,
  reconcileCheckoutSession,
} = require("../lib/api-utils/payment-reconciliation");
const { getAdminClient, handleApiError, publicApiError, sendJson } = require("../lib/api-utils/supabase");

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function getOrigin(req) {
  const configuredOrigin = String(process.env.SITE_URL || "").replace(/\/$/, "");
  if (configuredOrigin) return configuredOrigin;
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
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
    const signature = req.headers["stripe-signature"];
    if (!webhookSecret || !signature) {
      throw publicApiError("Stripe webhook is not configured.", 500, "missing_stripe_webhook_config");
    }

    const stripe = getStripeClient();
    let event;
    try {
      event = stripe.webhooks.constructEvent(await readRawBody(req), signature, webhookSecret);
    } catch (error) {
      throw publicApiError("Invalid Stripe webhook signature.", 400, "invalid_webhook_signature");
    }

    if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
      const session = await stripe.checkout.sessions.retrieve(event.data.object.id, { expand: ["payment_intent"] });
      await reconcileCheckoutSession({
        supabase: getAdminClient(),
        session,
        origin: getOrigin(req),
      });
    } else if (event.type === "checkout.session.expired") {
      await expireDepositCheckoutSession({
        supabase: getAdminClient(),
        session: event.data.object,
      });
    }

    sendJson(res, 200, { received: true });
  } catch (error) {
    handleApiError(res, error);
  }
};

module.exports.config = {
  api: { bodyParser: false },
};
