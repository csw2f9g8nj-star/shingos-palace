const { findOwnerForUser, publicDog, publicOwner } = require("../../api-utils/account");
const { getAdminClient, getSupabaseConfig, handleApiError, requireCustomerUser, sendJson } = require("../../api-utils/supabase");

async function addSignedRecordUrls(supabase, bucket, dogs) {
  return Promise.all(
    dogs.map(async (dog) => {
      const records = await Promise.all(
        (dog.vaccination_records || []).map(async (record) => {
          if (!record.storage_path) return record;
          const { data } = await supabase.storage.from(bucket).createSignedUrl(record.storage_path, 60 * 10);
          return { ...record, signedUrl: data?.signedUrl || "" };
        }),
      );
      return { ...dog, vaccination_records: records };
    }),
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  try {
    const supabase = getAdminClient();
    const config = getSupabaseConfig();
    const user = await requireCustomerUser(req, supabase);
    const owner = await findOwnerForUser(supabase, user);

    if (!owner) {
      sendJson(res, 200, {
        ok: true,
        user: { id: user.id, email: user.email || "" },
        owner: null,
        dogs: [],
      });
      return;
    }

    const { data: dogs, error } = await supabase
      .from("dogs")
      .select(
        `
        id,
        owner_id,
        name,
        pet_type,
        breed,
        age,
        weight,
        size,
        sex,
        spayed_neutered,
        vaccinations_up_to_date,
        rabies_vaccination_up_to_date,
        good_with_cats,
        good_with_small_dogs,
        can_swim,
        medications,
        allergies,
        behavioral_concerns,
        favorite_activities,
        feeding_instructions,
        veterinary_clinic,
        veterinarian_name,
        clinic_phone,
        clinic_address,
        bookings(
          id,
          service,
          pet_type,
          dropoff_date,
          pickup_date,
          arrival_time,
          departure_time,
          units,
          estimated_total,
          deposit_due_today,
          remaining_balance,
          status,
          payment_status,
          deposit_paid_amount,
          balance_payment_status,
          balance_paid_amount,
          balance_paid_at,
          created_at,
          reviews(
            id,
            status,
            rating,
            review_text,
            created_at
          )
        ),
        vaccination_records(
          id,
          storage_path,
          original_filename,
          document_status,
          upload_date,
          expiration_date,
          version
        )
      `,
      )
      .eq("owner_id", owner.id)
      .order("created_at", { ascending: false });

    if (error) {
      throw Object.assign(new Error("We could not load your pet profiles."), {
        statusCode: 500,
        publicMessage: "We could not load your account details.",
        code: "account_dogs_failed",
        details: error.details,
        hint: error.hint,
        supabaseCode: error.code,
        supabaseMessage: error.message,
      });
    }

    const dogsWithUrls = await addSignedRecordUrls(supabase, config.bucket, dogs || []);
    const { data: ownerBookings, error: bookingsError } = await supabase
      .from("bookings")
      .select(
        `
        id,
        dog_id,
        service,
        pet_type,
        booking_pet_summary,
        dropoff_date,
        pickup_date,
        arrival_time,
        departure_time,
        units,
        estimated_total,
        deposit_due_today,
        remaining_balance,
        status,
        payment_status,
        deposit_paid_amount,
        balance_payment_status,
        balance_paid_amount,
        balance_paid_at,
        created_at,
        reviews(
          id,
          status,
          rating,
          review_text,
          created_at
        ),
        booking_pets(
          dog_id,
          pet_type,
          dog:dogs(id,name,pet_type,breed)
        )
      `,
      )
      .eq("owner_id", owner.id)
      .order("created_at", { ascending: false });

    if (bookingsError) {
      throw Object.assign(new Error("We could not load your reservations."), {
        statusCode: 500,
        publicMessage: "We could not load your account reservations.",
        code: "account_bookings_failed",
        details: bookingsError.details,
        hint: bookingsError.hint,
        supabaseCode: bookingsError.code,
        supabaseMessage: bookingsError.message,
      });
    }

    const bookingsByDogId = new Map();
    (ownerBookings || []).forEach((booking) => {
      const linkedPetIds = (booking.booking_pets || []).map((item) => item.dog_id).filter(Boolean);
      const dogIds = linkedPetIds.length ? linkedPetIds : [booking.dog_id].filter(Boolean);
      dogIds.forEach((dogId) => {
        if (!bookingsByDogId.has(dogId)) bookingsByDogId.set(dogId, []);
        bookingsByDogId.get(dogId).push(booking);
      });
    });

    const dogsWithBookings = dogsWithUrls.map((dog) => ({
      ...dog,
      bookings: bookingsByDogId.get(dog.id) || [],
    }));

    sendJson(res, 200, {
      ok: true,
      user: { id: user.id, email: user.email || "" },
      owner: publicOwner(owner),
      dogs: dogsWithBookings.map(publicDog),
    });
  } catch (error) {
    handleApiError(res, error);
  }
};
