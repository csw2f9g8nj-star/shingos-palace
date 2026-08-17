const STRIPE_SESSION_ENDPOINT = "/api/create-checkout-session";
const PUBLIC_CONFIG_ENDPOINT = "/api/public-config";

const params = new URLSearchParams(window.location.search);
const bookingId = params.get("booking_id") || params.get("bookingId") || "";
const intro = document.querySelector("#balancePaymentIntro");
const statusLine = document.querySelector("#balancePaymentStatus");
const checkoutShell = document.querySelector("#balanceStripeCheckout");

let stripeInstance = null;
let stripeCheckout = null;

async function getStripePublishableKey() {
  const response = await fetch(PUBLIC_CONFIG_ENDPOINT);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.ok === false || !payload.stripePublishableKey) {
    throw new Error("Stripe is not available right now. Please contact info@shingospalace.com.");
  }

  return payload.stripePublishableKey;
}

async function startBalancePayment() {
  if (!bookingId) {
    throw new Error("This balance payment link is missing the booking information.");
  }

  const publishableKey = await getStripePublishableKey();
  const sessionResponse = await fetch(STRIPE_SESSION_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      bookingId,
      paymentType: "balance",
    }),
  });
  const sessionPayload = await sessionResponse.json().catch(() => ({}));

  if (!sessionResponse.ok || sessionPayload.ok === false || !sessionPayload.clientSecret) {
    throw new Error(sessionPayload.error || "We could not create the remaining balance payment link.");
  }

  if (!window.Stripe) {
    throw new Error("Stripe is not available right now. Please refresh and try again.");
  }

  if (intro) intro.textContent = "Enter your card details below to securely pay the remaining balance for this reservation.";
  stripeInstance = window.Stripe(publishableKey);
  stripeCheckout = await stripeInstance.initEmbeddedCheckout({
    clientSecret: sessionPayload.clientSecret,
  });

  if (checkoutShell) {
    checkoutShell.innerHTML = "";
    stripeCheckout.mount("#balanceStripeCheckout");
  }
}

startBalancePayment().catch((error) => {
  if (stripeCheckout) stripeCheckout.destroy();
  if (checkoutShell) checkoutShell.hidden = true;
  if (intro) intro.textContent = "We could not load this payment link.";
  if (statusLine) statusLine.textContent = error.message || "Please contact info@shingospalace.com.";
});
