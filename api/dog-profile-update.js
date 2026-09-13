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
  validateUploadFileContent,
} = require("../lib/api-utils/supabase");
const { parseMultipartForm, toFileArray } = require("../lib/api-utils/forms");
const { authorizeBookingAction, enforceRateLimit } = require("../lib/api-utils/request-security");

async function updateSingle(supabase, table, payload, filters, message) {
  if (!Object.keys(payload).length) return null;

  let query = supabase.from(table).update(payload);
  filters.forEach(([column, value]) => {
    query = query.eq(column, value);
  });

  const { data, error } = await query.select().single();
  if (error) {
    const updateError = publicApiError(message, 500, `${table}_update_failed`);
    updateError.details = error.details;
    updateError.hint = error.hint;
    updateError.supabaseCode = error.code;
    updateError.supabaseMessage = error.message;
    throw updateError;
  }

  return data;
}

function compactPayload(payload) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== ""));
}

function normalizePetType(value) {
  return normalizeField(value).toLowerCase() === "cat" ? "cat" : "dog";
}

function assertFieldLength(value, maxLength, message) {
  if (String(value || "").length > maxLength) {
    throw publicApiError(message, 400, "field_too_long");
  }
}

async function insertVaccinationRecord(supabase, config, owner, dog, bookingId, file, index) {
  const extension = (file.originalFilename || "").split(".").pop()?.toLowerCase() || "upload";
  const path = [
    sanitizePathPart(owner.email),
    sanitizePathPart(dog.name),
    bookingId || dog.id,
    `${Date.now()}-${index + 1}.${extension}`,
  ].join("/");
  const buffer = await fs.readFile(file.filepath);
  const contentType = getUploadContentType(file);

  const { error: storageError } = await supabase.storage.from(config.bucket).upload(path, buffer, {
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

  const { data, error } = await supabase
    .from("vaccination_records")
    .insert({
      owner_id: owner.id,
      dog_id: dog.id,
      booking_id: bookingId || null,
      storage_bucket: config.bucket,
      storage_path: path,
      original_filename: file.originalFilename,
      mime_type: contentType,
      file_size: file.size,
      document_status: "submitted",
      version: 1,
    })
    .select()
    .single();

  if (error) {
    await supabase.storage.from(config.bucket).remove([path]);
    const recordError = publicApiError(
      "We uploaded the vaccination file, but could not save its private record. Please check the vaccination_records table.",
      500,
      "vaccination_record_insert_failed",
    );
    recordError.details = error.details;
    recordError.hint = error.hint;
    recordError.supabaseCode = error.code;
    recordError.supabaseMessage = error.message;
    throw recordError;
  }

  return data;
}

async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }
  if (!enforceRateLimit(req, res, { key: "dog-profile-update", limit: 20, windowMs: 60 * 60 * 1000 })) return;

  try {
    const supabase = getAdminClient();
    const config = getSupabaseConfig();
    const { fields, files } = await parseMultipartForm(req);
    const ownerId = normalizeField(fields.ownerId);
    const dogId = normalizeField(fields.dogId);
    const bookingId = normalizeField(fields.bookingId);
    const actionToken = normalizeField(fields.actionToken);
    const records = toFileArray(files.vaccinationRecords);

    if (!ownerId || !dogId || !bookingId) {
      sendJson(res, 400, { ok: false, error: "Missing pet profile reference. Please submit the booking request first." });
      return;
    }

    const { data: linkedBooking, error: linkedBookingError } = await supabase
      .from("bookings")
      .select("id,owner_id,dog_id,booking_pets(dog_id)")
      .eq("id", bookingId)
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (linkedBookingError || !linkedBooking) {
      throw publicApiError("We could not find the booking to update.", 404, "booking_not_found");
    }

    const access = await authorizeBookingAction({ req, supabase, booking: linkedBooking, scope: "profile", token: actionToken });
    const linkedPetIds = (linkedBooking.booking_pets || []).map((pet) => pet.dog_id).filter(Boolean);
    const allowedPetIds = linkedPetIds.length ? linkedPetIds : [linkedBooking.dog_id].filter(Boolean);
    if (!allowedPetIds.includes(dogId) || (access.type === "signed_link" && !access.claims.petIds.includes(dogId))) {
      throw publicApiError("This pet is not linked to the booking.", 403, "booking_pet_forbidden");
    }

    const fileErrors = (await Promise.all(records.map(validateUploadFileContent))).filter(Boolean);
    if (fileErrors.length) {
      sendJson(res, 400, { ok: false, error: fileErrors[0] });
      return;
    }

    const [{ data: existingOwner, error: ownerReadError }, { data: existingDog, error: dogReadError }] = await Promise.all([
      supabase.from("owners").select("*").eq("id", ownerId).single(),
      supabase.from("dogs").select("*").eq("id", dogId).eq("owner_id", ownerId).single(),
    ]);
    if (ownerReadError || !existingOwner) {
      throw publicApiError("We could not find the owner record to update.", 404, "owner_not_found");
    }
    if (dogReadError || !existingDog) {
      throw publicApiError("We could not find the pet profile to update.", 404, "dog_not_found");
    }

    const lengthRules = [
      [fields.emergencyContact, 200, "Emergency contact is too long."],
      [fields.age, 40, "Age is too long."],
      [fields.weight, 40, "Weight is too long."],
      [fields.sex, 40, "Sex is too long."],
      [fields.veterinaryClinic, 160, "Veterinary clinic is too long."],
      [fields.veterinarianName, 160, "Veterinarian name is too long."],
      [fields.clinicPhone, 40, "Clinic phone is too long."],
      [fields.clinicAddress, 300, "Clinic address is too long."],
      [fields.medications, 3000, "Medication details are too long."],
      [fields.allergies, 3000, "Allergy details are too long."],
      [fields.behavioralConcerns, 3000, "Behavior details are too long."],
      [fields.favoriteActivities, 1000, "Favorite activities are too long."],
      [fields.feedingInstructions, 3000, "Feeding instructions are too long."],
      [fields.notes, 5000, "Notes are too long."],
    ];
    lengthRules.forEach(([value, maxLength, message]) => assertFieldLength(normalizeField(value), maxLength, message));

    const ownerPayload = compactPayload({
      emergency_contact: normalizeField(fields.emergencyContact),
    });

    const dogPayload = compactPayload({
      pet_type: normalizePetType(fields.petType),
      age: normalizeField(fields.age),
      weight: normalizeField(fields.weight),
      sex: normalizeField(fields.sex),
      vaccinations_up_to_date: normalizeField(fields.vaccinationsUpToDate),
      rabies_vaccination_up_to_date: normalizeField(fields.rabiesVaccinationUpToDate),
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
    });

    const owner =
      (await updateSingle(
        supabase,
        "owners",
        ownerPayload,
        [["id", ownerId]],
        "We could not update the owner profile. Please check the owners table in Supabase.",
      )) || existingOwner;

    const dog =
      (await updateSingle(
        supabase,
        "dogs",
        dogPayload,
        [
          ["id", dogId],
          ["owner_id", ownerId],
        ],
        "We could not update the pet profile. Please check the dogs table in Supabase.",
      )) || existingDog;

    const notes = normalizeField(fields.notes);
    if (bookingId && notes) {
      await updateSingle(
        supabase,
        "bookings",
        { notes },
        [
          ["id", bookingId],
          ["owner_id", ownerId],
        ],
        "We could not update the booking notes. Please check the bookings table in Supabase.",
      );
    }

    const uploadedRecords = [];
    for (const [index, file] of records.entries()) {
      const record = await insertVaccinationRecord(supabase, config, owner, dog, bookingId, file, index);
      uploadedRecords.push(record);
    }

    sendJson(res, 200, {
      ok: true,
      message: "Thank you. Your pet's profile has been updated.",
      dogId,
      ownerId,
      bookingId,
      recordsUploaded: uploadedRecords.length,
    });
  } catch (error) {
    handleApiError(res, error);
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
