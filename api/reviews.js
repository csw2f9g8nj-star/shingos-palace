const { findOwnerForUser } = require("../lib/api-utils/account");
const {
  getAdminClient,
  handleApiError,
  publicApiError,
  requireAdminUser,
  requireCustomerUser,
  sendJson,
} = require("../lib/api-utils/supabase");

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch (error) {
      return {};
    }
  }
  return req.body;
}

function isCompletedBooking(booking) {
  if (!booking) return false;
  const normalizedStatus = String(booking.status || "").toLowerCase();
  if (["completed", "paid_in_full", "finished"].includes(normalizedStatus)) return true;
  if (!booking.pickup_date) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const pickup = new Date(`${booking.pickup_date}T00:00:00`);
  return pickup < today;
}

function publicReview(row) {
  return {
    id: row.id,
    ownerFirstName: row.owner?.first_name || "Pet parent",
    petName: row.pet?.name || "",
    rating: Number(row.rating) || 5,
    reviewText: row.review_text || "",
    createdAt: row.created_at || "",
  };
}

function adminReview(row) {
  return {
    id: row.id,
    rating: Number(row.rating) || 5,
    reviewText: row.review_text || "",
    status: row.status || "pending",
    createdAt: row.created_at || "",
    owner: {
      firstName: row.owner?.first_name || "",
      lastName: row.owner?.last_name || "",
      email: row.owner?.email || "",
    },
    pet: {
      id: row.pet?.id || "",
      name: row.pet?.name || "",
    },
    booking: {
      id: row.booking?.id || row.booking_id || "",
      service: row.booking?.service || "",
      dropoffDate: row.booking?.dropoff_date || "",
      pickupDate: row.booking?.pickup_date || "",
      status: row.booking?.status || "",
      paymentStatus: row.booking?.payment_status || "",
    },
  };
}

async function listPublicReviews(supabase, res) {
  const { data, error } = await supabase
    .from("reviews")
    .select(
      `
      id,
      rating,
      review_text,
      created_at,
      owner:owners(first_name),
      pet:dogs(id,name)
    `,
    )
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(12);

  if (error) {
    throw Object.assign(publicApiError("We could not load reviews right now.", 500, "reviews_public_failed"), {
      supabaseCode: error.code,
      supabaseMessage: error.message,
      details: error.details,
      hint: error.hint,
    });
  }

  sendJson(res, 200, { ok: true, reviews: (data || []).map(publicReview) });
}

async function listAdminReviews(req, supabase, res) {
  await requireAdminUser(req, supabase);

  const { data, error } = await supabase
    .from("reviews")
    .select(
      `
      id,
      owner_id,
      booking_id,
      pet_id,
      rating,
      review_text,
      status,
      created_at,
      owner:owners(first_name,last_name,email),
      pet:dogs(id,name),
      booking:bookings(id,service,dropoff_date,pickup_date,status,payment_status)
    `,
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    throw Object.assign(publicApiError("We could not load reviews.", 500, "reviews_admin_failed"), {
      supabaseCode: error.code,
      supabaseMessage: error.message,
      details: error.details,
      hint: error.hint,
    });
  }

  const reviews = (data || [])
    .map(adminReview)
    .sort((left, right) => {
      const leftPending = left.status === "pending" ? 1 : 0;
      const rightPending = right.status === "pending" ? 1 : 0;
      if (leftPending !== rightPending) return rightPending - leftPending;
      return new Date(right.createdAt || 0) - new Date(left.createdAt || 0);
    });

  sendJson(res, 200, { ok: true, reviews });
}

async function createCustomerReview(req, supabase, res) {
  const user = await requireCustomerUser(req, supabase);
  const owner = await findOwnerForUser(supabase, user);
  if (!owner) {
    throw publicApiError("Please complete a reservation before leaving a review.", 403, "owner_missing");
  }

  const body = parseBody(req);
  const bookingId = String(body.bookingId || "").trim();
  const rating = Number(body.rating);
  const reviewText = String(body.reviewText || "").trim();

  if (!bookingId || !Number.isInteger(rating) || rating < 1 || rating > 5 || !reviewText) {
    throw publicApiError("Please choose a rating and write a short review.", 400, "review_invalid");
  }

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select(
      `
      id,
      owner_id,
      dog_id,
      pickup_date,
      status,
      booking_pets(dog_id)
    `,
    )
    .eq("id", bookingId)
    .eq("owner_id", owner.id)
    .maybeSingle();

  if (bookingError) {
    throw Object.assign(publicApiError("We could not verify this reservation.", 500, "review_booking_lookup_failed"), {
      supabaseCode: bookingError.code,
      supabaseMessage: bookingError.message,
      details: bookingError.details,
      hint: bookingError.hint,
    });
  }

  if (!booking) {
    throw publicApiError("This reservation is not available in your account.", 403, "review_booking_forbidden");
  }

  if (!isCompletedBooking(booking)) {
    throw publicApiError("Reviews can be submitted after a completed reservation.", 403, "review_booking_not_completed");
  }

  const requestedPetId = String(body.petId || "").trim();
  const linkedPetIds = (booking.booking_pets || []).map((pet) => pet.dog_id).filter(Boolean);
  const allowedPetIds = linkedPetIds.length ? linkedPetIds : [booking.dog_id].filter(Boolean);
  const petId = requestedPetId || allowedPetIds[0] || null;
  if (petId && allowedPetIds.length && !allowedPetIds.includes(petId)) {
    throw publicApiError("This review must be linked to the pet from this reservation.", 403, "review_pet_forbidden");
  }

  const { data: review, error: insertError } = await supabase
    .from("reviews")
    .insert({
      owner_id: owner.id,
      booking_id: booking.id,
      pet_id: petId,
      rating,
      review_text: reviewText,
      status: "pending",
    })
    .select("id,status,rating,review_text,created_at")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      throw publicApiError("A review has already been submitted for this reservation.", 409, "review_duplicate");
    }

    throw Object.assign(publicApiError("We could not save your review.", 500, "review_insert_failed"), {
      supabaseCode: insertError.code,
      supabaseMessage: insertError.message,
      details: insertError.details,
      hint: insertError.hint,
    });
  }

  sendJson(res, 201, { ok: true, review, message: "Thank you. Your review is pending approval." });
}

async function updateAdminReview(req, supabase, res) {
  await requireAdminUser(req, supabase);

  const body = parseBody(req);
  const reviewId = String(body.reviewId || "").trim();
  const status = String(body.status || "").trim().toLowerCase();

  if (!reviewId || !["approved", "rejected"].includes(status)) {
    throw publicApiError("Choose a review and either approve or reject it.", 400, "review_status_invalid");
  }

  const { data, error } = await supabase
    .from("reviews")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", reviewId)
    .select("id,status")
    .single();

  if (error) {
    throw Object.assign(publicApiError("We could not update this review.", 500, "review_update_failed"), {
      supabaseCode: error.code,
      supabaseMessage: error.message,
      details: error.details,
      hint: error.hint,
    });
  }

  sendJson(res, 200, { ok: true, review: data });
}

module.exports = async function handler(req, res) {
  try {
    const supabase = getAdminClient();

    if (req.method === "GET") {
      if (req.query?.scope === "admin") {
        await listAdminReviews(req, supabase, res);
        return;
      }
      await listPublicReviews(supabase, res);
      return;
    }

    if (req.method === "POST") {
      await createCustomerReview(req, supabase, res);
      return;
    }

    if (req.method === "PATCH") {
      await updateAdminReview(req, supabase, res);
      return;
    }

    sendJson(res, 405, { ok: false, error: "Method not allowed." });
  } catch (error) {
    handleApiError(res, error);
  }
};
