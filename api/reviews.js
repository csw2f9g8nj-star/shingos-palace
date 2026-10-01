const { findOwnerForUser } = require("../lib/api-utils/account");
const {
  getAdminClient,
  handleApiError,
  publicApiError,
  requireAdminUser,
  requireCustomerUser,
  sendJson,
} = require("../lib/api-utils/supabase");
const { enforceRateLimit } = require("../lib/api-utils/request-security");

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

const DIRECT_REVIEW_SERVICES = new Set(["boarding", "daycare", "walking", "cat_care", "other"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanText(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function publicDisplayName(value) {
  const name = cleanText(value, 120);
  return name ? name.split(/\s+/)[0] : "Pet parent";
}

function publicReview(row) {
  return {
    id: row.id,
    ownerFirstName: row.owner?.first_name || publicDisplayName(row.reviewer_name),
    petName: row.pet?.name || row.pet_name || "",
    rating: Number(row.rating) || 5,
    reviewText: row.review_text || "",
    createdAt: row.created_at || "",
    source: row.source || "booking",
    service: row.booking?.service || row.service_used || "",
    verifiedCustomer: Boolean(row.verified_customer),
  };
}

function adminReview(row) {
  return {
    id: row.id,
    rating: Number(row.rating) || 5,
    reviewText: row.review_text || "",
    status: row.status || "pending",
    createdAt: row.created_at || "",
    source: row.source || "booking",
    verifiedCustomer: Boolean(row.verified_customer),
    verifiedAt: row.verified_at || "",
    owner: {
      firstName: row.owner?.first_name || row.reviewer_name || "",
      lastName: row.owner?.last_name || "",
      email: row.owner?.email || row.reviewer_email || "",
    },
    pet: {
      id: row.pet?.id || "",
      name: row.pet?.name || row.pet_name || "",
    },
    booking: {
      id: row.booking?.id || row.booking_id || "",
      service: row.booking?.service || row.service_used || "",
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
      source,
      service_used,
      reviewer_name,
      pet_name,
      verified_customer,
      owner:owners(first_name),
      pet:dogs(id,name),
      booking:bookings(service)
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
      source,
      reviewer_name,
      reviewer_email,
      pet_name,
      service_used,
      verified_customer,
      verified_at,
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
  if (reviewText.length > 3000) {
    throw publicApiError("Please keep your review under 3,000 characters.", 400, "review_too_long");
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
      source: "booking",
      verified_customer: true,
      verified_at: new Date().toISOString(),
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

async function createDirectReview(req, supabase, res) {
  const body = parseBody(req);
  const reviewerName = cleanText(body.customerName, 120);
  const reviewerEmail = cleanText(body.email, 254).toLowerCase();
  const petName = cleanText(body.petName, 120);
  const serviceUsed = cleanText(body.serviceUsed, 40).toLowerCase();
  const rating = Number(body.rating);
  const reviewText = String(body.reviewText || "").trim();
  const clientSubmissionId = cleanText(body.clientSubmissionId, 36);
  const website = cleanText(body.website, 200);

  if (website) {
    sendJson(res, 201, { ok: true, message: "Thank you. Your review was received and will appear after approval." });
    return;
  }

  if (!reviewerName || !reviewerEmail || !petName || !DIRECT_REVIEW_SERVICES.has(serviceUsed)) {
    throw publicApiError("Please complete your name, email, pet name, and service used.", 400, "direct_review_details_invalid");
  }
  if (!EMAIL_PATTERN.test(reviewerEmail)) {
    throw publicApiError("Please enter a valid email address.", 400, "direct_review_email_invalid");
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || !reviewText) {
    throw publicApiError("Please choose a rating and write a short review.", 400, "review_invalid");
  }
  if (reviewText.length > 3000) {
    throw publicApiError("Please keep your review under 3,000 characters.", 400, "review_too_long");
  }
  if (!UUID_PATTERN.test(clientSubmissionId)) {
    throw publicApiError("Please refresh the page and try submitting your review again.", 400, "review_submission_id_invalid");
  }

  const { data: review, error: insertError } = await supabase
    .from("reviews")
    .insert({
      owner_id: null,
      booking_id: null,
      pet_id: null,
      rating,
      review_text: reviewText,
      status: "pending",
      source: "direct",
      reviewer_name: reviewerName,
      reviewer_email: reviewerEmail,
      pet_name: petName,
      service_used: serviceUsed,
      verified_customer: false,
      client_submission_id: clientSubmissionId,
    })
    .select("id,status,rating,created_at,source")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      sendJson(res, 200, {
        ok: true,
        message: "Thank you! Your review was received and will appear after approval.",
      });
      return;
    }
    throw Object.assign(publicApiError("We could not save your review.", 500, "review_insert_failed"), {
      supabaseCode: insertError.code,
      supabaseMessage: insertError.message,
      details: insertError.details,
      hint: insertError.hint,
    });
  }

  sendJson(res, 201, {
    ok: true,
    review,
    message: "Thank you! Your review was received and will appear after approval.",
  });
}

async function updateAdminReview(req, supabase, res) {
  const adminUser = await requireAdminUser(req, supabase);

  const body = parseBody(req);
  const reviewId = String(body.reviewId || "").trim();
  const status = String(body.status || "").trim().toLowerCase();
  const hasVerifiedCustomer = typeof body.verifiedCustomer === "boolean";

  if (!reviewId || (!status && !hasVerifiedCustomer)) {
    throw publicApiError("Choose a review action.", 400, "review_update_invalid");
  }
  if (status && !["approved", "rejected", "archived"].includes(status)) {
    throw publicApiError("Choose approve, reject, or archive.", 400, "review_status_invalid");
  }

  const updates = { updated_at: new Date().toISOString() };
  if (status) {
    updates.status = status;
    updates.archived_at = status === "archived" ? new Date().toISOString() : null;
  }
  if (hasVerifiedCustomer) {
    updates.verified_customer = body.verifiedCustomer;
    updates.verified_at = body.verifiedCustomer ? new Date().toISOString() : null;
    updates.verified_by = body.verifiedCustomer ? adminUser.id : null;
  }

  const { data, error } = await supabase
    .from("reviews")
    .update(updates)
    .eq("id", reviewId)
    .select("id,status,verified_customer,verified_at")
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

async function deleteAdminReview(req, supabase, res) {
  await requireAdminUser(req, supabase);
  const reviewId = cleanText(req.query?.reviewId, 36);
  if (!UUID_PATTERN.test(reviewId)) {
    throw publicApiError("Choose a valid review to delete.", 400, "review_id_invalid");
  }

  const { error } = await supabase.from("reviews").delete().eq("id", reviewId);
  if (error) {
    throw Object.assign(publicApiError("We could not delete this review.", 500, "review_delete_failed"), {
      supabaseCode: error.code,
      supabaseMessage: error.message,
      details: error.details,
      hint: error.hint,
    });
  }
  sendJson(res, 200, { ok: true });
}

module.exports = async function handler(req, res) {
  try {
    const supabase = getAdminClient();

    if (req.method === "GET") {
      if (!enforceRateLimit(req, res, { key: "reviews-read", limit: 120, windowMs: 10 * 60 * 1000 })) return;
      if (req.query?.scope === "admin") {
        await listAdminReviews(req, supabase, res);
        return;
      }
      await listPublicReviews(supabase, res);
      return;
    }

    if (req.method === "POST") {
      if (!enforceRateLimit(req, res, { key: "reviews-create", limit: 10, windowMs: 60 * 60 * 1000 })) return;
      const body = parseBody(req);
      if (String(body.source || "").toLowerCase() === "direct") {
        await createDirectReview(req, supabase, res);
      } else {
        await createCustomerReview(req, supabase, res);
      }
      return;
    }

    if (req.method === "PATCH") {
      await updateAdminReview(req, supabase, res);
      return;
    }

    if (req.method === "DELETE") {
      await deleteAdminReview(req, supabase, res);
      return;
    }

    sendJson(res, 405, { ok: false, error: "Method not allowed." });
  } catch (error) {
    handleApiError(res, error);
  }
};
