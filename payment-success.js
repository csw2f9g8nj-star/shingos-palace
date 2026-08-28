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
const successPetNameLabel = document.querySelector("#successPetNameLabel");
const successDates = document.querySelector("#successDates");
const successDeposit = document.querySelector("#successDeposit");
const paymentSuccessKicker = document.querySelector("#paymentSuccessKicker");
const paymentSuccessHeading = document.querySelector("#paymentSuccessHeading");
const paymentSuccessIntro = document.querySelector("#paymentSuccessIntro");
const successDepositLabel = document.querySelector("#successDepositLabel");
const successRemainingLabel = document.querySelector("#successRemainingLabel");
const successRemaining = document.querySelector("#successRemaining");
const successOwnerId = document.querySelector("#successOwnerId");
const successDogId = document.querySelector("#successDogId");
const successBookingId = document.querySelector("#successBookingId");
const successPetType = document.querySelector("#successPetType");
const successProfilePetSelectorField = document.querySelector("#successProfilePetSelectorField");
const successProfilePetSelect = document.querySelector("#successProfilePetSelect");
const successDogProfileCta = document.querySelector("#successDogProfileCta");
const successProfileCtaTitle = document.querySelector("#successProfileCtaTitle");
const successProfileCtaText = document.querySelector("#successProfileCtaText");
const successProfileButton = document.querySelector("#successProfileButton");
const successDogProfileForm = document.querySelector("#successDogProfileForm");
const successProfileFormTitle = document.querySelector("#successProfileFormTitle");
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
let verifiedPets = [];

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

function normalizePetType(value) {
  return String(value || "").toLowerCase() === "cat" ? "cat" : "dog";
}

function updatePetWording(petType) {
  const normalizedPetType = normalizePetType(petType);
  const petLabel = normalizedPetType === "cat" ? "cat" : "pet";
  const profileLabel = normalizedPetType === "cat" ? "Cat Profile" : "Pet Profile";

  if (successPetNameLabel) successPetNameLabel.textContent = "Pet name";
  if (successProfileCtaTitle) successProfileCtaTitle.textContent = `Tell us more about your ${petLabel} 🐾`;
  if (successProfileCtaText) {
    successProfileCtaText.textContent = `Help us get to know your ${petLabel} so we can make their stay safe, comfortable and personalized.`;
  }
  if (successProfileButton) successProfileButton.textContent = `Complete ${profileLabel}`;
  if (successProfileFormTitle) successProfileFormTitle.textContent = `Tell us more about your ${petLabel}`;
  if (successProfileSubmit) successProfileSubmit.textContent = `Save ${profileLabel.toLowerCase()}`;
}

function setActiveSuccessPet(petId) {
  const selectedPet = verifiedPets.find((pet) => pet.id === petId) || verifiedPets[0] || null;
  if (!selectedPet) return;

  if (successDogId) successDogId.value = selectedPet.id || "";
  if (successPetType) successPetType.value = normalizePetType(selectedPet.petType);
  updatePetWording(selectedPet.petType);
}

function populateSuccessPets(payload) {
  verifiedPets = Array.isArray(payload.pets)
    ? payload.pets
        .map((pet) => ({
          id: String(pet.id || "").trim(),
          name: String(pet.name || "Guest pet").trim(),
          petType: normalizePetType(pet.petType),
        }))
        .filter((pet) => pet.id)
    : [];

  if (!verifiedPets.length && payload.dogId) {
    verifiedPets = [
      {
        id: payload.dogId,
        name: payload.dogName || payload.petName || "Guest pet",
        petType: normalizePetType(payload.petType),
      },
    ];
  }

  if (successProfilePetSelectorField) successProfilePetSelectorField.hidden = verifiedPets.length <= 1;
  if (successProfilePetSelect) {
    successProfilePetSelect.innerHTML = "";
    verifiedPets.forEach((pet) => {
      const option = document.createElement("option");
      option.value = pet.id;
      option.textContent = pet.name;
      successProfilePetSelect.append(option);
    });
  }

  setActiveSuccessPet(verifiedPets[0]?.id || payload.dogId || "");
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

    const isBalancePayment = payload.paymentType === "balance";
    populateSuccessPets(payload);

    if (paymentSuccessKicker) paymentSuccessKicker.textContent = isBalancePayment ? "Balance paid" : "Deposit received";
    if (paymentSuccessHeading) {
      paymentSuccessHeading.textContent = isBalancePayment
        ? "Thank you! Your remaining balance has been paid. 🐾"
        : "Thank you! Your deposit has been received. 🐾";
    }
    if (paymentSuccessIntro) {
      paymentSuccessIntro.textContent = isBalancePayment
        ? "Your reservation is now marked as fully paid. We look forward to welcoming your pet soon."
        : "Your booking request has been saved and your spot is now being held. We'll contact you shortly to confirm the reservation details.";
    }
    if (successDepositLabel) successDepositLabel.textContent = isBalancePayment ? "Balance paid" : "Deposit paid";
    if (successRemainingLabel) successRemainingLabel.textContent = isBalancePayment ? "Remaining balance" : "Remaining balance";
    if (successService) successService.textContent = serviceLabel(payload.service);
    if (successDogName) successDogName.textContent = payload.petName || payload.dogName || "-";
    if (successDates) successDates.textContent = payload.dates || "-";
    if (successDeposit) successDeposit.textContent = isBalancePayment ? payload.balancePaid || "-" : payload.depositPaid || "-";
    if (successRemaining) successRemaining.textContent = payload.remainingBalance || "-";
    if (successOwnerId) successOwnerId.value = payload.ownerId || "";
    if (successBookingId) successBookingId.value = payload.bookingId || "";
    verifiedOwnerEmail = payload.ownerEmail || "";
    if (successAccountEmail) {
      successAccountEmail.textContent = verifiedOwnerEmail ? `We'll send the secure link to ${verifiedOwnerEmail}.` : "";
    }
    if (successDogProfileCta) successDogProfileCta.hidden = isBalancePayment;
    if (successDogProfileForm) successDogProfileForm.hidden = true;
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

successProfilePetSelect?.addEventListener("change", () => {
  setActiveSuccessPet(successProfilePetSelect.value);
});

successAccountButton?.addEventListener("click", async () => {
  if (!successAccountStatus) return;
  successAccountStatus.textContent = "";

  if (!verifiedOwnerEmail) {
    successAccountStatus.textContent = "We could not find the reservation email for this payment.";
    return;
  }

  const accountUrl = new URL("index.html", window.location.origin);
  accountUrl.searchParams.set("account", "1");
  accountUrl.searchParams.set("email", verifiedOwnerEmail);
  window.location.href = accountUrl.toString();
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
    if (successProfileStatus) successProfileStatus.textContent = payload.message || "Thank you. Your pet's profile has been updated.";
    successDogProfileForm.reset();
    if (successUploadProgress) successUploadProgress.hidden = true;
    if (successUploadBar) successUploadBar.style.width = "0%";
  } catch (error) {
    if (successProfileStatus) successProfileStatus.textContent = error.message || "Something went wrong. Please try again.";
  } finally {
    if (successProfileSubmit) {
      successProfileSubmit.disabled = false;
      updatePetWording(successPetType?.value);
    }
  }
});

verifyPayment();
