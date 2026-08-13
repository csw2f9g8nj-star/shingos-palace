const VERIFY_ENDPOINT = "/api/verify-checkout-session";
const PROFILE_ENDPOINT = "/api/dog-profile-update";
const PUBLIC_CONFIG_ENDPOINT = "/api/public-config";
const maxVaccinationFileSize = 10 * 1024 * 1024;
const allowedVaccinationExtensions = new Set(["pdf", "jpg", "jpeg", "png", "heic", "heif"]);
const allowedVaccinationTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "application/octet-stream",
  "",
]);

const params = new URLSearchParams(window.location.search);
const sessionId = params.get("session_id") || params.get("stripe_session_id") || "";

const loadingState = document.querySelector("#paymentLoadingState");
const paidState = document.querySelector("#paymentPaidState");
const errorState = document.querySelector("#paymentErrorState");
const errorText = document.querySelector("#paymentErrorText");
const successService = document.querySelector("#successService");
const successDogName = document.querySelector("#successDogName");
const successDates = document.querySelector("#successDates");
const successDeposit = document.querySelector("#successDeposit");
const successRemaining = document.querySelector("#successRemaining");
const successOwnerId = document.querySelector("#successOwnerId");
const successDogId = document.querySelector("#successDogId");
const successBookingId = document.querySelector("#successBookingId");
const successDogProfileCta = document.querySelector("#successDogProfileCta");
const successProfileButton = document.querySelector("#successProfileButton");
const successDogProfileForm = document.querySelector("#successDogProfileForm");
const successProfileSubmit = document.querySelector("#successProfileSubmit");
const successProfileStatus = document.querySelector("#successProfileStatus");
const successVaccinationRecords = document.querySelector("#successVaccinationRecords");
const successUploadProgress = document.querySelector("#successUploadProgress");
const successUploadBar = document.querySelector("#successUploadBar");
const successUploadStatus = document.querySelector("#successUploadStatus");
const successAccountCta = document.querySelector("#successAccountCta");
const successAccountButton = document.querySelector("#successAccountButton");
const successAccountStatus = document.querySelector("#successAccountStatus");
const successAccountEmail = document.querySelector("#successAccountEmail");

let verifiedOwnerEmail = "";
let customerSupabase = null;

function showState(state) {
  if (loadingState) loadingState.hidden = state !== "loading";
  if (paidState) paidState.hidden = state !== "paid";
  if (errorState) errorState.hidden = state !== "error";
}

function serviceLabel(service) {
  const labels = {
    boarding: "Boarding",
    daycare: "Daycare",
    walking: "Dog Walking",
    grooming: "Grooming",
  };
  return labels[service] || service || "-";
}

function validateVaccinationFiles() {
  if (!successVaccinationRecords) return true;
  const files = [...successVaccinationRecords.files];
  successVaccinationRecords.setCustomValidity("");

  if (!files.length) return true;

  const invalidType = files.find((file) => {
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    return !allowedVaccinationExtensions.has(extension) || !allowedVaccinationTypes.has(file.type || "");
  });

  if (invalidType) {
    successVaccinationRecords.setCustomValidity("Only PDF, JPG, JPEG, PNG, HEIC, or HEIF files are accepted.");
    if (successUploadStatus) successUploadStatus.textContent = successVaccinationRecords.validationMessage;
    return false;
  }

  const oversized = files.find((file) => file.size > maxVaccinationFileSize);
  if (oversized) {
    successVaccinationRecords.setCustomValidity("Each vaccination record must be 10MB or smaller.");
    if (successUploadStatus) successUploadStatus.textContent = successVaccinationRecords.validationMessage;
    return false;
  }

  if (successUploadStatus) {
    successUploadStatus.textContent =
      files.length === 1 ? "Vaccination record ready to upload." : `${files.length} vaccination records ready to upload.`;
  }

  return true;
}

async function getCustomerSupabaseClient() {
  if (customerSupabase) return customerSupabase;

  if (!window.supabase?.createClient) {
    throw new Error("Customer login is unavailable right now. Please try again shortly.");
  }

  const response = await fetch(PUBLIC_CONFIG_ENDPOINT);
  if (!response.ok) {
    throw new Error("Customer login is unavailable right now. Please try again shortly.");
  }

  const payload = await response.json().catch(() => ({}));
  if (!payload.supabaseUrl || !payload.supabasePublishableKey) {
    throw new Error("Customer login is unavailable right now. Please try again shortly.");
  }

  customerSupabase = window.supabase.createClient(payload.supabaseUrl, payload.supabasePublishableKey);
  return customerSupabase;
}

function submitProfileWithProgress() {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", PROFILE_ENDPOINT);
    request.setRequestHeader("Accept", "application/json");

    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable || !successUploadProgress || !successUploadBar) return;
      successUploadProgress.hidden = false;
      const percent = Math.round((event.loaded / event.total) * 100);
      successUploadBar.style.width = `${percent}%`;
      if (successUploadStatus) successUploadStatus.textContent = "Uploading vaccination records...";
    });

    request.addEventListener("load", () => {
      let payload = {};
      try {
        payload = JSON.parse(request.responseText || "{}");
      } catch (error) {
        payload = {};
      }

      if (request.status >= 200 && request.status < 300 && payload.ok !== false) {
        resolve(payload);
        return;
      }

      reject(new Error(payload.error || "Something went wrong. Please try again."));
    });

    request.addEventListener("error", () => reject(new Error("Something went wrong. Please try again.")));
    request.send(new FormData(successDogProfileForm));
  });
}

async function verifyPayment() {
  if (!sessionId) {
    if (errorText) errorText.textContent = "This confirmation link is missing the Stripe session ID.";
    showState("error");
    return;
  }

  try {
    const response = await fetch(VERIFY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ sessionId }),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || "The payment could not be confirmed.");
    }

    if (successService) successService.textContent = serviceLabel(payload.service);
    if (successDogName) successDogName.textContent = payload.dogName || "-";
    if (successDates) successDates.textContent = payload.dates || "-";
    if (successDeposit) successDeposit.textContent = payload.depositPaid || "-";
    if (successRemaining) successRemaining.textContent = payload.remainingBalance || "-";
    if (successOwnerId) successOwnerId.value = payload.ownerId || "";
    if (successDogId) successDogId.value = payload.dogId || "";
    if (successBookingId) successBookingId.value = payload.bookingId || "";
    verifiedOwnerEmail = payload.ownerEmail || "";
    if (successAccountEmail) {
      successAccountEmail.textContent = verifiedOwnerEmail ? `We'll send the secure link to ${verifiedOwnerEmail}.` : "";
    }
    if (successAccountCta) successAccountCta.hidden = !verifiedOwnerEmail;

    showState("paid");
  } catch (error) {
    if (errorText) errorText.textContent = error.message || errorText.textContent;
    showState("error");
  }
}

successProfileButton?.addEventListener("click", () => {
  if (successDogProfileCta) successDogProfileCta.hidden = true;
  if (successDogProfileForm) successDogProfileForm.hidden = false;
  successDogProfileForm?.scrollIntoView({ behavior: "smooth", block: "start" });
});

successAccountButton?.addEventListener("click", async () => {
  if (!successAccountStatus) return;
  successAccountStatus.textContent = "";

  if (!verifiedOwnerEmail) {
    successAccountStatus.textContent = "We could not find the reservation email for this payment.";
    return;
  }

  if (successAccountButton) {
    successAccountButton.disabled = true;
    successAccountButton.textContent = "Sending secure link...";
  }

  try {
    const client = await getCustomerSupabaseClient();
    const { error } = await client.auth.signInWithOtp({
      email: verifiedOwnerEmail,
      options: {
        emailRedirectTo: `${window.location.origin}/index.html`,
      },
    });

    if (error) throw error;
    successAccountStatus.textContent = "Check your email for the secure sign-in link.";
  } catch (error) {
    successAccountStatus.textContent = error.message || "Customer login is unavailable right now. Please try again shortly.";
  } finally {
    if (successAccountButton) {
      successAccountButton.disabled = false;
      successAccountButton.textContent = "Create / access My Account";
    }
  }
});

successVaccinationRecords?.addEventListener("change", validateVaccinationFiles);

successDogProfileForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (successProfileStatus) successProfileStatus.textContent = "";

  if (!validateVaccinationFiles()) {
    successVaccinationRecords?.reportValidity();
    return;
  }

  if (successProfileSubmit) {
    successProfileSubmit.disabled = true;
    successProfileSubmit.textContent = "Saving profile...";
  }

  try {
    const payload = await submitProfileWithProgress();
    if (successProfileStatus) successProfileStatus.textContent = payload.message || "Thank you. Your dog's profile has been updated.";
    successDogProfileForm.reset();
    if (successUploadProgress) successUploadProgress.hidden = true;
    if (successUploadBar) successUploadBar.style.width = "0%";
  } catch (error) {
    if (successProfileStatus) successProfileStatus.textContent = error.message || "Something went wrong. Please try again.";
  } finally {
    if (successProfileSubmit) {
      successProfileSubmit.disabled = false;
      successProfileSubmit.textContent = "Save dog profile";
    }
  }
});

verifyPayment();
