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
const zelleAmount = document.querySelector("#balanceZelleAmount");
const zelleRecipient = document.querySelector("#balanceZelleRecipient");
const zelleStepThree = document.querySelector("#balanceZelleStepThree");
const copyZelleAmount = document.querySelector("#copyBalanceZelleAmount");
const copyZelleRecipient = document.querySelector("#copyBalanceZelleRecipient");
const zelleCopyStatus = document.querySelector("#balanceZelleCopyStatus");
const manualConfirmation = document.querySelector("#balanceManualConfirmation");
const manualConfirmationText = document.querySelector("#balanceManualConfirmationText");

let stripeInstance = null;
let stripeCheckout = null;
let paymentDetails = null;
let publicConfig = null;

async function copyTextValue(value) {
  if (!value) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    if (zelleCopyStatus) zelleCopyStatus.textContent = "Copied.";
  } catch (error) {
    if (zelleCopyStatus) zelleCopyStatus.textContent = "Could not copy. Please select and copy the value.";
  }
}

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
  if (continueButton && continueButton.dataset.saved !== "true") {
    continueButton.textContent = isZelle ? "Save Zelle payment choice" : "Continue to secure card payment";
  }
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

  if (checkoutShell) checkoutShell.hidden = true;
  if (manualConfirmation) manualConfirmation.hidden = false;
  if (manualConfirmationText) {
    manualConfirmationText.textContent = "Your payment choice was saved. Send the exact amount using the instructions above. No payment has been marked as received. Your balance will remain pending until Shingo's Palace verifies receipt.";
  }
  if (intro) intro.textContent = "Your reservation is saved. Use your bank's app to send the payment off-site with Zelle.";
  continueButton.dataset.saved = "true";
  continueButton.textContent = "Zelle payment choice saved";
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
    continueButton.disabled = continueButton.dataset.saved === "true";
  }
});

document.querySelectorAll('input[name="balancePaymentMethod"]').forEach((input) => {
  input.addEventListener("change", () => {
    delete continueButton.dataset.saved;
    continueButton.disabled = false;
    if (manualConfirmation) manualConfirmation.hidden = true;
    updateZelleDisplay();
  });
});

copyZelleAmount?.addEventListener("click", () => copyTextValue(paymentDetails?.amount || ""));
copyZelleRecipient?.addEventListener("click", () => copyTextValue(publicConfig?.zellePaymentRecipient || ""));

Promise.all([getPublicConfig(), getBalanceDetails()]).then(([config, details]) => {
  publicConfig = config;
  paymentDetails = details;
  if (amountDue) amountDue.textContent = details.amount;
  if (intro) intro.textContent = `Choose how you would like to pay the ${details.amount} remaining balance.`;
  const zelleAvailable = config.zelleAvailable === true && Boolean(config.zellePaymentRecipient);
  if (zelleInput) zelleInput.disabled = !zelleAvailable;
  zelleOption?.classList.toggle("is-disabled", !zelleAvailable);
  if (zelleAmount) zelleAmount.textContent = details.amount;
  if (zelleRecipient) zelleRecipient.textContent = config.zellePaymentRecipient || "";
  if (zelleStepThree) zelleStepThree.textContent = `Send exactly ${details.amount} to the recipient shown above.`;
  if (zelleInstructionsText) {
    zelleInstructionsText.textContent = config.zellePaymentInstructions || "";
    zelleInstructionsText.hidden = !config.zellePaymentInstructions;
  }
  if (methodPanel) methodPanel.hidden = false;
  updateZelleDisplay();
}).catch((error) => {
  if (stripeCheckout) stripeCheckout.destroy();
  if (checkoutShell) checkoutShell.hidden = true;
  if (intro) intro.textContent = "We could not load this payment link.";
  if (statusLine) statusLine.textContent = error.message || "Please contact info@shingospalace.com.";
});
