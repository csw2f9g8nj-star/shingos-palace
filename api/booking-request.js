const fs = require("fs/promises");
const {
  getAdminClient,
  getSupabaseConfig,
  getUploadContentType,
  handleApiError,
  normalizeField,
  publicApiError,
  sanitizePathPart,
  sendJson,
  validateUploadFile,
} = require("./_utils/supabase");
const { parseMultipartForm, toFileArray } = require("./_utils/forms");

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

    const bookingPayload = {
      service: normalizeField(fields.service),
      dropoff_date: normalizeField(fields.dropoffDate) || null,
      pickup_date: normalizeField(fields.pickupDate) || null,
      arrival_time: normalizeField(fields.arrivalTime) || null,
      departure_time: normalizeField(fields.departureTime) || null,
      area: normalizeField(fields.area),
      units: Number(normalizeField(fields.units)) || 1,
      additional_dogs: Number(normalizeField(fields.additionalDogs)) || 0,
      additional_cats: Number(normalizeField(fields.additionalCats)) || 0,
      after_hours: normalizeField(fields.afterHours) === "on",
      long_stay: normalizeField(fields.longStay) === "on",
      notes: normalizeField(fields.notes),
      emergency_authorization: normalizeField(fields.emergencyAuthorization) === "on",
      estimated_total: normalizeField(fields.estimatedTotal),
      deposit_due_today: normalizeField(fields.depositDueToday),
      remaining_balance: normalizeField(fields.remainingBalance),
      status: "new_request",
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
      !bookingPayload.emergency_authorization
    ) {
      sendJson(res, 400, { ok: false, error: "Please complete all required booking fields." });
      return;
    }

    try {
      const owner = await insertSingle(
        supabase,
        "owners",
        ownerPayload,
        "We could not save the owner information. Please check the Supabase service key and owners table.",
      );
      created.ownerId = owner.id;

      const dog = await insertSingle(
        supabase,
        "dogs",
        { ...dogPayload, owner_id: owner.id },
        "We could not save the dog profile. Please check the dogs table in Supabase.",
      );
      created.dogId = dog.id;

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
