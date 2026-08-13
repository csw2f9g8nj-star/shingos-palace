const Stripe = require("stripe");
const { publicApiError } = require("./supabase");

function getStripeConfig() {
  return {
    secretKey: process.env.STRIPE_SECRET_KEY || "",
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "",
  };
}

function getStripeClient() {
  const config = getStripeConfig();
  if (!config.secretKey) {
    throw publicApiError(
      "Stripe is not connected yet. Please add STRIPE_SECRET_KEY in Vercel.",
      500,
      "missing_stripe_secret",
    );
  }

  return new Stripe(config.secretKey, {
    apiVersion: "2024-06-20",
  });
}

function amountToCents(value) {
  const numeric = Number(String(value || "").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.round(numeric * 100);
}

function centsToCurrency(cents) {
  return `$${(Number(cents) / 100).toFixed(2).replace(/\.00$/, "")}`;
}

module.exports = {
  amountToCents,
  centsToCurrency,
  getStripeClient,
  getStripeConfig,
};
