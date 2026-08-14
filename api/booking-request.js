const fs = require("fs/promises");
const { findOwnerForUser } = require("../lib/api-utils/account");
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
  if (created.dogId) cleanupTasks.push(supabase.from("dogs").delete().eq("id", created.dogId));
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
      dogId: "",
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
      email: normalizeField(fields.email).toLowerCase(),
      phone: normalizeField(fields.phone),
      emergency_contact: normalizeField(fields.emergencyContact),
    };

    const dogPayload = {
      name: normalizeField(fields.dogName),
      breed: normalizeField(fields.breed),
      age: normalizeField(fields.age),
      weight: normalizeField(fields.weight),
      sex: normalizeField(fields.sex),
      spayed_neutered: normalizeField(fields.spayedNeutered),
      vaccinations_up_to_date: normalizeField(fields.vaccinationsUpToDate),
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
    const bookingPayload = {
      service,
      dropoff_date: normalizeField(fields.dropoffDate) || null,
      pickup_date: normalizeField(fields.pickupDate) || null,
      arrival_time: service === "walking" ? (preferredWalkingTime || null) : normalizeField(fields.arrivalTime) || null,
      departure_time: service === "walking" ? null : normalizeField(fields.departureTime) || null,
      area: normalizeField(fields.area) || "Margate",
      units: Number(normalizeField(fields.units)) || 1,
      additional_dogs: Number(normalizeField(fields.additionalDogs)) || 0,
      additional_cats: service === "walking" ? 0 : Number(normalizeField(fields.additionalCats)) || 0,
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
      !dogPayload.name ||
      !dogPayload.breed ||
      !dogPayload.spayed_neutered ||
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
      let owner = linkedAccount?.owner || null;
      let dog = linkedAccount?.dog || null;

      if (owner) {
        const { data: updatedOwner, error: ownerUpdateError } = await supabase
          .from("owners")
          .update({
            first_name: ownerPayload.first_name,
            last_name: ownerPayload.last_name,
            email: ownerPayload.email,
            phone: ownerPayload.phone,
          })
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

      if (dog) {
        const { data: updatedDog, error: dogUpdateError } = await supabase
          .from("dogs")
          .update({
            name: dogPayload.name,
            breed: dogPayload.breed,
            spayed_neutered: dogPayload.spayed_neutered,
          })
          .eq("id", dog.id)
          .eq("owner_id", owner.id)
          .select()
          .single();

        if (dogUpdateError) {
          throw publicApiError("We could not update the dog profile for this account.", 500, "dog_update_failed");
        }
        dog = updatedDog;
      } else {
        dog = await insertSingle(
          supabase,
          "dogs",
          { ...dogPayload, owner_id: owner.id },
          "We could not save the dog profile. Please check the dogs table in Supabase.",
        );
        created.dogId = dog.id;
      }

      const booking = await insertSingle(
        supabase,
        "bookings",
        { ...bookingPayload, owner_id: owner.id, dog_id: dog.id },
        "We could not save the booking request. Please check the bookings table in Supabase.",
      );
      created.bookingId = booking.id;

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
