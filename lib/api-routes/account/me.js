const { getOrCreateOwnerForUser, publicDog, publicOwner } = require("../../api-utils/account");
const { getAdminClient, getSupabaseConfig, handleApiError, requireCustomerUser, sendJson } = require("../../api-utils/supabase");

async function addSignedRecordUrl(supabase, bucket, record) {
  if (!record?.storage_path) return record;
  const { data } = await supabase.storage.from(bucket).createSignedUrl(record.storage_path, 60 * 10);
  return { ...record, signedUrl: data?.signedUrl || "" };
}

async function addSignedRecordUrls(supabase, bucket, dogs) {
  return Promise.all(
    dogs.map(async (dog) => {
      const records = await Promise.all(
        (dog.vaccination_records || []).map((record) => addSignedRecordUrl(supabase, bucket, record)),
      );
      return { ...dog, vaccination_records: records };
    }),
  );
}

function isSchemaMismatch(error) {
  const source = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return error?.code === "42703" || error?.code === "PGRST204" || source.includes("column") || source.includes("schema cache");
}

async function fetchOwnerBookings(supabase, ownerId) {
  const bookingSelects = [
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
      created_at
    `,
    `
      id,
      dog_id,
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
      created_at
    `,
    `
      id,
      dog_id,
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
      created_at
    `,
  ];

  for (const select of bookingSelects) {
    const { data, error } = await supabase
      .from("bookings")
      .select(select)
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false });

    if (!error) return { bookings: data || [], error: null };
    if (!isSchemaMismatch(error)) return { bookings: [], error };
  }

  return { bookings: [], error: null };
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
    const owner = await getOrCreateOwnerForUser(supabase, user);

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
        clinic_address
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

    const dogIds = (dogs || []).map((dog) => dog.id).filter(Boolean);

    let recordsByDogId = new Map();
    if (dogIds.length) {
      const { data: vaccinationRecords, error: vaccinationRecordsError } = await supabase
        .from("vaccination_records")
        .select(
          `
          id,
          dog_id,
          storage_path,
          original_filename,
          document_status,
          upload_date,
          expiration_date,
          version
        `,
        )
        .in("dog_id", dogIds)
        .is("archived_at", null)
        .order("upload_date", { ascending: false });

      if (!vaccinationRecordsError) {
        const recordsWithUrls = await Promise.all(
          (vaccinationRecords || []).map((record) => addSignedRecordUrl(supabase, config.bucket, record)),
        );

        recordsByDogId = recordsWithUrls.reduce((map, record) => {
          const current = map.get(record.dog_id) || [];
          current.push(record);
          map.set(record.dog_id, current);
          return map;
        }, new Map());
      }
    }

    const dogsWithUrls = await addSignedRecordUrls(
      supabase,
      config.bucket,
      (dogs || []).map((dog) => ({
        ...dog,
        vaccination_records: recordsByDogId.get(dog.id) || [],
      })),
    );

    const { bookings: ownerBookings, error: bookingsError } = await fetchOwnerBookings(supabase, owner.id);
    const safeOwnerBookings = ownerBookings || [];
    const bookingIds = safeOwnerBookings.map((booking) => booking.id).filter(Boolean);
    let bookingPetsByBookingId = new Map();
    if (bookingIds.length) {
      const { data: bookingPets, error: bookingPetsError } = await supabase
        .from("booking_pets")
        .select(
          `
          booking_id,
          dog_id,
          pet_type,
          dog:dogs(id,name,pet_type,breed)
        `,
        )
        .in("booking_id", bookingIds)
        .order("created_at", { ascending: true });

      if (!bookingPetsError) {
        bookingPetsByBookingId = (bookingPets || []).reduce((map, bookingPet) => {
          const current = map.get(bookingPet.booking_id) || [];
          current.push(bookingPet);
          map.set(bookingPet.booking_id, current);
          return map;
        }, new Map());
      }
    }

    if (bookingsError) {
      console.warn("[Shingo's Palace account/me] reservations fallback triggered", {
        ownerId: owner.id,
        code: bookingsError.code,
        message: bookingsError.message,
        details: bookingsError.details,
        hint: bookingsError.hint,
      });
    }

    let reviewsByBookingId = new Map();
    if (bookingIds.length) {
      const { data: reviews, error: reviewsError } = await supabase
        .from("reviews")
        .select(
          `
          id,
          booking_id,
          status,
          rating,
          review_text,
          created_at
        `,
        )
        .eq("owner_id", owner.id)
        .order("created_at", { ascending: false });

      if (!reviewsError) {
        reviewsByBookingId = new Map(
          (reviews || []).map((review) => [
            review.booking_id,
            {
              id: review.id,
              status: review.status || "pending",
              rating: review.rating || "",
              review_text: review.review_text || "",
              created_at: review.created_at || "",
            },
          ]),
        );
      }
    }

    const bookingsByDogId = new Map();
    safeOwnerBookings.forEach((booking) => {
      const review = reviewsByBookingId.get(booking.id);
      const bookingPets = bookingPetsByBookingId.get(booking.id) || [];
      const bookingWithReview = {
        ...booking,
        booking_pets: bookingPets,
        reviews: review ? [review] : [],
      };
      const linkedPetIds = bookingPets.map((item) => item.dog_id).filter(Boolean);
      const dogIds = linkedPetIds.length ? linkedPetIds : [booking.dog_id].filter(Boolean);
      dogIds.forEach((dogId) => {
        if (!bookingsByDogId.has(dogId)) bookingsByDogId.set(dogId, []);
        bookingsByDogId.get(dogId).push(bookingWithReview);
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
