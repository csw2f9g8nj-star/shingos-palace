const fs = require("fs/promises");
const {
  getAdminClient,
  getSupabaseConfig,
  handleApiError,
  normalizeField,
  sanitizePathPart,
  sendJson,
  validateUploadFile,
} = require("./_utils/supabase");
const { parseMultipartForm, toFileArray } = require("./_utils/forms");

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

    if (!records.length) {
      sendJson(res, 400, {
        ok: false,
        error: "A current vaccination record is required before a reservation can be confirmed.",
      });
      return;
    }

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

    if (!ownerPayload.email || !dogPayload.name || !bookingPayload.emergency_authorization) {
      sendJson(res, 400, { ok: false, error: "Please complete all required booking fields." });
      return;
    }

    const { data: owner, error: ownerError } = await supabase
      .from("owners")
      .insert(ownerPayload)
      .select()
      .single();
    if (ownerError) throw ownerError;

    const { data: dog, error: dogError } = await supabase
      .from("dogs")
      .insert({ ...dogPayload, owner_id: owner.id })
      .select()
      .single();
    if (dogError) throw dogError;

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .insert({ ...bookingPayload, owner_id: owner.id, dog_id: dog.id })
      .select()
      .single();
    if (bookingError) throw bookingError;

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

      const { error: storageError } = await supabase.storage
        .from(config.bucket)
        .upload(path, buffer, {
          contentType: file.mimetype,
          upsert: false,
        });
      if (storageError) throw storageError;

      const { data: record, error: recordError } = await supabase
        .from("vaccination_records")
        .insert({
          owner_id: owner.id,
          dog_id: dog.id,
          booking_id: booking.id,
          storage_bucket: config.bucket,
          storage_path: path,
          original_filename: file.originalFilename,
          mime_type: file.mimetype,
          file_size: file.size,
          document_status: "submitted",
          version: 1,
        })
        .select()
        .single();
      if (recordError) throw recordError;
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
    handleApiError(res, error);
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
