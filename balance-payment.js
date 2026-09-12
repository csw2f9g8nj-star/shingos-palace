const STRIPE_SESSION_ENDPOINT = "/api/create-checkout-session";
const PUBLIC_CONFIG_ENDPOINT = "/api/public-config";

const params = new URLSearchParams(window.location.search);
const bookingId = params.get("booking_id") || params.get("bookingId") || "";
const intro = document.querySelector("#balancePaymentIntro");
const statusLine = document.querySelector("#balancePaymentStatus");
const checkoutShell = document.querySelector("#balanceStripeCheckout");
const methodPanel = document.querySelector("#balanceMethodPanel");
const amountDue = document.querySelector("#balanceAmountDue");
const continueButton = document.querySelector("#balanceContinueButton");
const zelleOption = document.querySelector("#balanceZelleOption");
const zelleInput = document.querySelector('input[name="balancePaymentMethod"][value="zelle"]');
const zelleInstructions = document.querySelector("#balanceZelleInstructions");
const zelleInstructionsText = document.querySelector("#balanceZelleInstructionsText");
const manualConfirmation = document.querySelector("#balanceManualConfirmation");
const manualConfirmationText = document.querySelector("#balanceManualConfirmationText");

let stripeInstance = null;
let stripeCheckout = null;
let paymentDetails = null;
let publicConfig = null;

async function getPublicConfig() {
  const response = await fetch(PUBLIC_CONFIG_ENDPOINT);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.ok === false) {
    throw new Error("Payment options are not available right now. Please contact info@shingospalace.com.");
  }

  return payload;
}

async function getBalanceDetails() {
  if (!bookingId) {
    throw new Error("This balance payment link is missing the booking information.");
  }

  const response = await fetch(STRIPE_SESSION_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      bookingId,
      paymentType: "balance",
      action: "details",
    }),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || "We could not load this remaining balance.");
  }

  return payload;
}

function updateZelleDisplay() {
  const isZelle = document.querySelector('input[name="balancePaymentMethod"]:checked')?.value === "zelle";
  if (zelleInstructions) zelleInstructions.hidden = !isZelle;
}

async function startStripeBalancePayment() {
  if (!publicConfig?.stripePublishableKey) {
    throw new Error("Stripe is not available right now. Please choose Zelle or contact info@shingospalace.com.");
  }

  const sessionResponse = await fetch(STRIPE_SESSION_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ bookingId, paymentType: "balance", paymentMethod: "stripe" }),
  });
  const sessionPayload = await sessionResponse.json().catch(() => ({}));

  if (!sessionResponse.ok || sessionPayload.ok === false || !sessionPayload.clientSecret) {
    throw new Error(sessionPayload.error || "We could not create the remaining balance payment link.");
  }

  if (!window.Stripe) {
    throw new Error("Stripe is not available right now. Please refresh and try again.");
  }

  if (intro) intro.textContent = `Enter your card details below to securely pay ${paymentDetails.amount}.`;
  if (methodPanel) methodPanel.hidden = true;
  if (checkoutShell) checkoutShell.hidden = false;
  stripeInstance = window.Stripe(publicConfig.stripePublishableKey);
  stripeCheckout = await stripeInstance.initEmbeddedCheckout({
    clientSecret: sessionPayload.clientSecret,
  });

  if (checkoutShell) {
    checkoutShell.innerHTML = "";
    stripeCheckout.mount("#balanceStripeCheckout");
  }
}

async function requestZelleBalancePayment() {
  const response = await fetch(STRIPE_SESSION_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ bookingId, paymentType: "balance", paymentMethod: "zelle" }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false || !payload.manual) {
    throw new Error(payload.error || "We could not save the Zelle payment request.");
  }

  if (methodPanel) methodPanel.hidden = true;
  if (checkoutShell) checkoutShell.hidden = true;
  if (manualConfirmation) manualConfirmation.hidden = false;
  const recipient = publicConfig.zellePaymentRecipient;
  const message = publicConfig.zellePaymentInstructions
    || `Send ${payload.amount} by Zelle to ${recipient}. Include your pet's name in the memo.`;
  if (manualConfirmationText) {
    manualConfirmationText.textContent = `${message} Your balance will remain pending until the payment is received and verified.`;
  }
  if (intro) intro.textContent = "Your reservation is saved. Complete the Zelle payment using the instructions below.";
}

continueButton?.addEventListener("click", async () => {
  const method = document.querySelector('input[name="balancePaymentMethod"]:checked')?.value || "stripe";
  continueButton.disabled = true;
  if (statusLine) statusLine.textContent = "Preparing your payment...";
  try {
    if (method === "zelle") await requestZelleBalancePayment();
    else await startStripeBalancePayment();
    if (statusLine) statusLine.textContent = "";
  } catch (error) {
    if (statusLine) statusLine.textContent = error.message || "We could not start this payment.";
  } finally {
    continueButton.disabled = false;
  }
});

document.querySelectorAll('input[name="balancePaymentMethod"]').forEach((input) => {
  input.addEventListener("change", updateZelleDisplay);
});

Promise.all([getPublicConfig(), getBalanceDetails()]).then(([config, details]) => {
  publicConfig = config;
  paymentDetails = details;
  if (amountDue) amountDue.textContent = details.amount;
  if (intro) intro.textContent = `Choose how you would like to pay the ${details.amount} remaining balance.`;
  const zelleAvailable = config.zelleAvailable === true && Boolean(config.zellePaymentRecipient);
  if (zelleInput) zelleInput.disabled = !zelleAvailable;
  zelleOption?.classList.toggle("is-disabled", !zelleAvailable);
  if (zelleInstructionsText) {
    zelleInstructionsText.textContent = zelleAvailable
      ? (config.zellePaymentInstructions || `Send ${details.amount} by Zelle to ${config.zellePaymentRecipient}. Include your pet's name in the memo.`)
      : "Zelle is temporarily unavailable. Please choose card payment.";
  }
  if (methodPanel) methodPanel.hidden = false;
  updateZelleDisplay();
}).catch((error) => {
  if (stripeCheckout) stripeCheckout.destroy();
  if (checkoutShell) checkoutShell.hidden = true;
  if (intro) intro.textContent = "We could not load this payment link.";
  if (statusLine) statusLine.textContent = error.message || "Please contact info@shingospalace.com.";
});
