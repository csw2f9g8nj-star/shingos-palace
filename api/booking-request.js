const fs = require("fs/promises");
const { findOwnerForUser, findOwnersByEmail, normalizeEmail } = require("../lib/api-utils/account");
const {
  getAdminClient,
  getSupabaseConfig,
  getUploadContentType,
  handleApiError,
  normalizeField,
  publicApiError,
  requireCustomerUser,
  sanitizePathPart,
  sendJson,
  validateUploadFile,
} = require("../lib/api-utils/supabase");
const { parseMultipartForm, toFileArray } = require("../lib/api-utils/forms");

function getInsertErrorMessage(table, error, fallbackMessage) {
  const source = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();

  if (error?.code === "42501" || source.includes("row-level security") || source.includes("permission denied")) {
    return `Supabase rejected the ${table} save because the server key does not have permission. In Vercel, make sure SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is the private service_role/secret key, not the anon or publishable key.`;
  }

  if (
    error?.code === "PGRST204" ||
    error?.code === "42703" ||
    source.includes("column") ||
    source.includes("schema cache")
  ) {
    return `The ${table} table schema does not match the booking form. Please verify the ${table} columns in Supabase.`;
  }

  if (error?.code === "42P01" || source.includes("does not exist")) {
    return `The ${table} table was not found in Supabase. Please confirm the schema was run in the same Supabase project connected to Vercel.`;
  }

  return fallbackMessage;
}

function isLatePickup(timeValue) {
  const [hourValue, minuteValue = "0"] = String(timeValue || "").split(":");
  const minutes = Number(hourValue) * 60 + Number(minuteValue);
  return !Number.isNaN(minutes) && minutes > 12 * 60;
}

function requiresPickupTime(service) {
  return service !== "walking";
}

function normalizePetType(value) {
  return normalizeField(value).toLowerCase() === "cat" ? "cat" : "dog";
}

const serviceRates = {
  boarding: 50,
  daycare: 35,
  walking: 18,
  grooming: 30,
};
const additionalDogRate = 35;
const catBoardingRate = 30;
const additionalCatRate = 20;

function parseBookingPets(fields) {
  let pets = [];
  try {
    pets = JSON.parse(normalizeField(fields.petsJson) || "[]");
  } catch (error) {
    pets = [];
  }

  if (!Array.isArray(pets) || !pets.length) {
    pets = [
      {
        dogId: normalizeField(fields.dogId),
        petType: normalizePetType(fields.petType),
        name: normalizeField(fields.dogName),
        breed: normalizeField(fields.breed),
        spayedNeutered: normalizeField(fields.spayedNeutered),
        rabiesVaccinationUpToDate: normalizeField(fields.rabiesVaccinationUpToDate),
      },
    ];
  }

  return pets.slice(0, 6).map((pet) => ({
    dogId: normalizeField(pet.dogId),
    petType: normalizePetType(pet.petType),
    name: normalizeField(pet.name),
    breed: normalizeField(pet.breed),
    spayedNeutered: normalizeField(pet.spayedNeutered),
    rabiesVaccinationUpToDate: normalizeField(pet.rabiesVaccinationUpToDate),
  }));
}

function petCountLabel(count, petType) {
  if (!count) return "";
  const label = petType === "cat" ? (count === 1 ? "cat" : "cats") : count === 1 ? "dog" : "dogs";
  return `${count} ${label}`;
}

function petSummary(pets) {
  const counts = pets.reduce(
    (result, pet) => {
      result[pet.petType] += 1;
      return result;
    },
    { dog: 0, cat: 0 },
  );

  return [petCountLabel(counts.dog, "dog"), petCountLabel(counts.cat, "cat")].filter(Boolean).join(" + ");
}

function bookingRateForPet(petType, role, service) {
  if (service === "boarding") {
    if (petType === "cat") return role === "additional" ? additionalCatRate : catBoardingRate;
    return role === "additional" ? additionalDogRate : serviceRates.boarding;
  }

  return serviceRates[service] || serviceRates.boarding;
}

function pricingBreakdownForPets(pets, service, units) {
  const seen = { dog: 0, cat: 0 };
  return pets.map((pet) => {
    seen[pet.petType] += 1;
    const role = seen[pet.petType] === 1 ? "primary" : "additional";
    const rate = bookingRateForPet(pet.petType, role, service);
    return {
      petName: pet.name,
      petType: pet.petType,
      role,
      units,
      rate,
      subtotal: rate * units,
    };
  });
}

async function insertSingle(supabase, table, payload, message) {
  const { data, error } = await supabase.from(table).insert(payload).select().single();
  if (error) {
    const insertError = publicApiError(getInsertErrorMessage(table, error, message), 500, `${table}_insert_failed`);
    insertError.details = error.details;
    insertError.hint = error.hint;
    insertError.supabaseCode = error.code;
    insertError.supabaseMessage = error.message;
    throw insertError;
  }

  return data;
}

async function removeCreatedRecords(supabase, created) {
  const cleanupTasks = [];
  if (created.storagePaths?.length) {
    cleanupTasks.push(supabase.storage.from(created.bucket).remove(created.storagePaths));
  }
  if (created.bookingId) cleanupTasks.push(supabase.from("bookings").delete().eq("id", created.bookingId));
  if (created.dogIds?.length) cleanupTasks.push(supabase.from("dogs").delete().in("id", created.dogIds));
  if (created.ownerId) cleanupTasks.push(supabase.from("owners").delete().eq("id", created.ownerId));

  await Promise.allSettled(cleanupTasks);
}

async function getLinkedBookingAccount(supabase, req, fields) {
  const ownerId = normalizeField(fields.ownerId);
  const dogId = normalizeField(fields.dogId);
  if (!ownerId && !dogId) return null;

  if (!ownerId && dogId) {
    throw publicApiError("Please select a saved dog or enter a new dog.", 400, "missing_account_booking_reference");
  }

  const user = await requireCustomerUser(req, supabase);
  const linkedOwner = await findOwnerForUser(supabase, user);
  if (!linkedOwner || linkedOwner.id !== ownerId) {
    throw publicApiError("This saved dog does not belong to your account.", 403, "account_owner_forbidden");
  }

  if (!dogId) {
    return { owner: linkedOwner, dog: null };
  }

  const { data: dog, error: dogError } = await supabase
    .from("dogs")
    .select("*")
    .eq("id", dogId)
    .eq("owner_id", linkedOwner.id)
    .single();

  if (dogError || !dog) {
    throw publicApiError("We could not find the saved dog in your account.", 404, "account_dog_not_found");
  }

  return { owner: linkedOwner, dog };
}

async function getCustomerUserIfPresent(supabase, req) {
  const authorization = req.headers.authorization || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  return requireCustomerUser(req, supabase);
}

async function findReusableOwnerForBooking(supabase, req, ownerPayload) {
  const email = normalizeEmail(ownerPayload.email);
  if (!email) return null;

  const user = await getCustomerUserIfPresent(supabase, req);
  if (user) {
    const userEmail = normalizeEmail(user.email);
    if (userEmail && userEmail !== email) {
      throw publicApiError("The booking email must match the signed-in account email.", 403, "booking_email_account_mismatch");
    }

    const linkedOwner = await findOwnerForUser(supabase, user);
    if (linkedOwner) return linkedOwner;
  }

  const owners = await findOwnersByEmail(supabase, email);
  return owners[0] || null;
}

async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  try {
    const supabase = getAdminClient();
    const config = getSupabaseConfig();
    const { fields, files } = await parseMultipartForm(req);
    const records = toFileArray(files.vaccinationRecords);
    const linkedAccount = await getLinkedBookingAccount(supabase, req, fields);
    const created = {
      bucket: config.bucket,
      ownerId: "",
      dogIds: [],
      bookingId: "",
      storagePaths: [],
    };

    const fileErrors = records.map(validateUploadFile).filter(Boolean);
    if (fileErrors.length) {
      sendJson(res, 400, { ok: false, error: fileErrors[0] });
      return;
    }

    const ownerPayload = {
      first_name: normalizeField(fields.firstName),
      last_name: normalizeField(fields.lastName),
      email: normalizeEmail(fields.email),
      phone: normalizeField(fields.phone),
      emergency_contact: normalizeField(fields.emergencyContact),
    };

    const pets = parseBookingPets(fields);
    const primaryPet = pets[0] || {};
    const petType = normalizePetType(primaryPet.petType || fields.petType);
    const dogPayload = {
      name: normalizeField(primaryPet.name || fields.dogName),
      pet_type: petType,
      breed: normalizeField(primaryPet.breed || fields.breed),
      age: normalizeField(fields.age),
      weight: normalizeField(fields.weight),
      sex: normalizeField(fields.sex),
      spayed_neutered: normalizeField(primaryPet.spayedNeutered || fields.spayedNeutered),
      vaccinations_up_to_date: normalizeField(fields.vaccinationsUpToDate),
      rabies_vaccination_up_to_date: normalizeField(primaryPet.rabiesVaccinationUpToDate || fields.rabiesVaccinationUpToDate),
      good_with_cats: normalizeField(fields.goodWithCats),
      good_with_small_dogs: normalizeField(fields.goodWithSmallDogs),
      can_swim: normalizeField(fields.canSwim),
      veterinary_clinic: normalizeField(fields.veterinaryClinic),
      veterinarian_name: normalizeField(fields.veterinarianName),
      clinic_phone: normalizeField(fields.clinicPhone),
      clinic_address: normalizeField(fields.clinicAddress),
      medications: normalizeField(fields.medications),
      allergies: normalizeField(fields.allergies),
      behavioral_concerns: normalizeField(fields.behavioralConcerns),
      favorite_activities: normalizeField(fields.favoriteActivities),
      feeding_instructions: normalizeField(fields.feedingInstructions),
      sleeping_routine: normalizeField(fields.sleepingRoutine),
    };

    const service = normalizeField(fields.service);
    const preferredWalkingTime = normalizeField(fields.preferredWalkingTime);
    const units = Number(normalizeField(fields.units)) || 1;
    const pricingBreakdown = pricingBreakdownForPets(pets, service, units);
    const petCounts = pets.reduce(
      (counts, pet) => {
        counts[pet.petType] += 1;
        return counts;
      },
      { dog: 0, cat: 0 },
    );
    const bookingPayload = {
      service,
      pet_type: petType,
      dropoff_date: normalizeField(fields.dropoffDate) || null,
      pickup_date: normalizeField(fields.pickupDate) || null,
      arrival_time: service === "walking" ? (preferredWalkingTime || null) : normalizeField(fields.arrivalTime) || null,
      departure_time: service === "walking" ? null : normalizeField(fields.departureTime) || null,
      area: normalizeField(fields.area) || "Margate",
      units,
      additional_dogs: Math.max(0, petCounts.dog - 1),
      additional_cats: service === "walking" ? 0 : Math.max(0, petCounts.cat - 1),
      pet_count: pets.length,
      booking_pet_summary: petSummary(pets),
      pricing_breakdown: pricingBreakdown,
      after_hours: service === "walking" ? false : isLatePickup(fields.departureTime),
      long_stay: service === "walking" ? false : normalizeField(fields.longStay) === "on",
      notes: normalizeField(fields.notes),
      emergency_authorization: normalizeField(fields.emergencyAuthorization) === "on",
      estimated_total: normalizeField(fields.estimatedTotal),
      deposit_due_today: normalizeField(fields.depositDueToday),
      remaining_balance: normalizeField(fields.remainingBalance),
      payment_status: "not_started",
      status: "deposit_pending",
    };

    if (
      !ownerPayload.first_name ||
      !ownerPayload.last_name ||
      !ownerPayload.email ||
      !ownerPayload.phone ||
      !pets.length ||
      pets.some(
        (pet) =>
          !pet.name ||
          !pet.breed ||
          !pet.spayedNeutered ||
          !pet.rabiesVaccinationUpToDate ||
          (bookingPayload.service === "walking" && pet.petType !== "dog"),
      ) ||
      !bookingPayload.service ||
      !bookingPayload.dropoff_date ||
      !bookingPayload.pickup_date ||
      (requiresPickupTime(bookingPayload.service) && !bookingPayload.departure_time) ||
      (bookingPayload.service === "walking" && !bookingPayload.arrival_time) ||
      !bookingPayload.emergency_authorization
    ) {
      sendJson(res, 400, { ok: false, error: "Please complete all required booking fields." });
      return;
    }

    try {
      let owner = linkedAccount?.owner || (await findReusableOwnerForBooking(supabase, req, ownerPayload));

      if (owner) {
        const ownerUpdatePayload = {
          first_name: ownerPayload.first_name,
          last_name: ownerPayload.last_name,
          email: ownerPayload.email,
          phone: ownerPayload.phone,
        };

        const signedInUser = await getCustomerUserIfPresent(supabase, req);
        if (signedInUser && normalizeEmail(signedInUser.email) === ownerPayload.email && !owner.auth_user_id) {
          ownerUpdatePayload.auth_user_id = signedInUser.id;
        }

        const { data: updatedOwner, error: ownerUpdateError } = await supabase
          .from("owners")
          .update(ownerUpdatePayload)
          .eq("id", owner.id)
          .select()
          .single();

        if (ownerUpdateError) {
          throw publicApiError("We could not update the owner information for this account.", 500, "owner_update_failed");
        }
        owner = updatedOwner;
      } else {
        owner = await insertSingle(
          supabase,
          "owners",
          ownerPayload,
          "We could not save the owner information. Please check the Supabase service key and owners table.",
        );
        created.ownerId = owner.id;
      }

      const savedPets = [];
      for (const [index, pet] of pets.entries()) {
        const payload = {
          name: pet.name,
          pet_type: pet.petType,
          breed: pet.breed,
          spayed_neutered: pet.spayedNeutered,
          rabies_vaccination_up_to_date: pet.rabiesVaccinationUpToDate,
        };

        if (index === 0) {
          Object.assign(payload, {
            age: dogPayload.age,
            weight: dogPayload.weight,
            sex: dogPayload.sex,
            vaccinations_up_to_date: dogPayload.vaccinations_up_to_date,
            good_with_cats: dogPayload.good_with_cats,
            good_with_small_dogs: dogPayload.good_with_small_dogs,
            can_swim: dogPayload.can_swim,
            veterinary_clinic: dogPayload.veterinary_clinic,
            veterinarian_name: dogPayload.veterinarian_name,
            clinic_phone: dogPayload.clinic_phone,
            clinic_address: dogPayload.clinic_address,
            medications: dogPayload.medications,
            allergies: dogPayload.allergies,
            behavioral_concerns: dogPayload.behavioral_concerns,
            favorite_activities: dogPayload.favorite_activities,
            feeding_instructions: dogPayload.feeding_instructions,
            sleeping_routine: dogPayload.sleeping_routine,
          });
        }

        let savedPet = null;
        if (pet.dogId) {
          const { data: existingPet, error: existingPetError } = await supabase
            .from("dogs")
            .select("*")
            .eq("id", pet.dogId)
            .eq("owner_id", owner.id)
            .single();

          if (existingPetError || !existingPet) {
            throw publicApiError("One of the selected saved pets does not belong to your account.", 403, "saved_pet_forbidden");
          }

          const { data: updatedPet, error: petUpdateError } = await supabase
            .from("dogs")
            .update(payload)
            .eq("id", existingPet.id)
            .eq("owner_id", owner.id)
            .select()
            .single();

          if (petUpdateError) {
            throw publicApiError("We could not update one of the saved pet profiles.", 500, "pet_update_failed");
          }
          savedPet = updatedPet;
        } else {
          savedPet = await insertSingle(
            supabase,
            "dogs",
            { ...payload, owner_id: owner.id },
            "We could not save one of the pet profiles. Please check the dogs table in Supabase.",
          );
          created.dogIds.push(savedPet.id);
        }

        savedPets.push(savedPet);
      }

      const dog = savedPets[0];

      const booking = await insertSingle(
        supabase,
        "bookings",
        { ...bookingPayload, owner_id: owner.id, dog_id: dog.id },
        "We could not save the booking request. Please check the bookings table in Supabase.",
      );
      created.bookingId = booking.id;

      const bookingPetRows = savedPets.map((pet, index) => {
        const breakdown = pricingBreakdown[index] || {};
        return {
          booking_id: booking.id,
          dog_id: pet.id,
          owner_id: owner.id,
          pet_type: pet.pet_type || "dog",
          role: breakdown.role || (index === 0 ? "primary" : "guest"),
          nightly_rate: breakdown.rate || null,
        };
      });

      const { error: bookingPetsError } = await supabase.from("booking_pets").insert(bookingPetRows);
      if (bookingPetsError) {
        throw publicApiError(
          "We saved the reservation, but could not link every pet to it. Please run the multi-pet booking migration in Supabase.",
          500,
          "booking_pets_insert_failed",
        );
      }

      const uploadedRecords = [];
      for (const [index, file] of records.entries()) {
        const extension = (file.originalFilename || "").split(".").pop()?.toLowerCase() || "upload";
        const path = [
          sanitizePathPart(owner.email),
          sanitizePathPart(dog.name),
          booking.id,
          `${Date.now()}-${index + 1}.${extension}`,
        ].join("/");
        const buffer = await fs.readFile(file.filepath);
        const contentType = getUploadContentType(file);

        const { error: storageError } = await supabase.storage
          .from(config.bucket)
          .upload(path, buffer, {
            contentType,
            upsert: false,
          });
        if (storageError) {
          throw publicApiError(
            "We could not upload the vaccination record. Please confirm the private vaccination-records bucket exists in Supabase.",
            500,
            "vaccination_upload_failed",
          );
        }
        created.storagePaths.push(path);

        const record = await insertSingle(
          supabase,
          "vaccination_records",
          {
            owner_id: owner.id,
            dog_id: dog.id,
            booking_id: booking.id,
            storage_bucket: config.bucket,
            storage_path: path,
            original_filename: file.originalFilename,
            mime_type: contentType,
            file_size: file.size,
            document_status: "submitted",
            version: 1,
          },
          "We uploaded the vaccination file, but could not save its private record. Please check the vaccination_records table.",
        );
        uploadedRecords.push(record);
      }

      sendJson(res, 200, {
        ok: true,
        message: "Thank you! We have received your request and will contact you shortly.",
        bookingId: booking.id,
        ownerId: owner.id,
        dogId: dog.id,
        petIds: savedPets.map((pet) => pet.id),
        petSummary: bookingPayload.booking_pet_summary,
        recordsUploaded: uploadedRecords.length,
      });
    } catch (error) {
      await removeCreatedRecords(supabase, created);
      throw error;
    }
  } catch (error) {
    handleApiError(res, error);
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
