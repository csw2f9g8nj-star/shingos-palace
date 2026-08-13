const VERIFY_ENDPOINT = "/api/verify-checkout-session";
const PROFILE_ENDPOINT = "/api/dog-profile-update";
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
