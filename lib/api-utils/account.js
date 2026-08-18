const { publicApiError } = require("./supabase");

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function compactPayload(payload) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}

function ownerActivityCount(owner) {
  return (owner?.dogs?.length || 0) + (owner?.bookings?.length || 0);
}

function cleanOwner(owner) {
  if (!owner) return null;
  const { dogs, bookings, ...cleanedOwner } = owner;
  return cleanedOwner;
}

function sortOwnerCandidates(userId) {
  return (left, right) => {
    const rightActivity = ownerActivityCount(right);
    const leftActivity = ownerActivityCount(left);
    if (rightActivity !== leftActivity) return rightActivity - leftActivity;

    const rightLinked = right.auth_user_id === userId ? 1 : 0;
    const leftLinked = left.auth_user_id === userId ? 1 : 0;
    if (rightLinked !== leftLinked) return rightLinked - leftLinked;

    return new Date(left.created_at || 0) - new Date(right.created_at || 0);
  };
}

async function findOwnersByEmail(supabase, email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return [];

  const { data, error } = await supabase
    .from("owners")
    .select("*, dogs(id), bookings(id)")
    .ilike("email", `%${normalizedEmail}%`)
    .order("created_at", { ascending: true });

  if (error) {
    throw publicApiError("We could not load your account.", 500, "owner_email_lookup_failed");
  }

  return (data || []).filter((owner) => normalizeEmail(owner.email) === normalizedEmail);
}

async function linkOwnerToUser(supabase, owner, user, linkedOwner = null) {
  if (!owner) return null;
  if (owner.auth_user_id === user.id) return cleanOwner(owner);

  if (owner.auth_user_id && owner.auth_user_id !== user.id) {
    throw publicApiError("This owner profile is linked to a different account.", 403, "owner_link_conflict");
  }

  if (linkedOwner?.id && linkedOwner.id !== owner.id && linkedOwner.auth_user_id === user.id) {
    const { error: clearError } = await supabase.from("owners").update({ auth_user_id: null }).eq("id", linkedOwner.id);
    if (clearError) {
      throw publicApiError("We could not reconnect your account to the correct owner profile.", 500, "owner_relink_failed");
    }
  }

  const { data: updatedOwner, error: updateError } = await supabase
    .from("owners")
    .update({ auth_user_id: user.id })
    .eq("id", owner.id)
    .select()
    .single();

  if (updateError) {
    throw publicApiError("We could not link your existing owner profile.", 500, "owner_link_failed");
  }

  return updatedOwner;
}

async function findOwnerForUser(supabase, user) {
  const email = normalizeEmail(user.email);
  if (!email) {
    throw publicApiError("This account does not have an email address.", 400, "missing_customer_email");
  }

  const { data: linkedOwner, error: linkedError } = await supabase
    .from("owners")
    .select("*, dogs(id), bookings(id)")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (linkedError) {
    throw publicApiError("We could not load your account.", 500, "owner_lookup_failed");
  }

  const emailOwners = await findOwnersByEmail(supabase, email);
  const candidates = [...emailOwners];

  if (linkedOwner && !candidates.some((owner) => owner.id === linkedOwner.id)) {
    candidates.push(linkedOwner);
  }

  const owner = candidates.sort(sortOwnerCandidates(user.id))[0] || null;
  if (!owner) return null;

  return linkOwnerToUser(supabase, owner, user, linkedOwner);
}

async function getOrCreateOwnerForUser(supabase, user, profile = {}) {
  const existingOwner = await findOwnerForUser(supabase, user);
  if (existingOwner) return existingOwner;

  const email = normalizeEmail(user.email);
  const metadata = user.user_metadata || {};
  const fullName = String(metadata.full_name || metadata.name || "").trim();
  const [firstName = "", ...lastParts] = fullName.split(/\s+/);

  const { data, error } = await supabase
    .from("owners")
    .insert({
      auth_user_id: user.id,
      email,
      first_name: profile.first_name || firstName || "",
      last_name: profile.last_name || lastParts.join(" ") || "",
      phone: profile.phone || "",
      emergency_contact: profile.emergency_contact || "",
    })
    .select()
    .single();

  if (error) {
    throw publicApiError("We could not create your owner profile.", 500, "owner_create_failed");
  }

  return data;
}

function publicOwner(owner) {
  if (!owner) return null;
  return {
    id: owner.id,
    firstName: owner.first_name || "",
    lastName: owner.last_name || "",
    email: owner.email || "",
    phone: owner.phone || "",
    emergencyContact: owner.emergency_contact || "",
  };
}

function publicDog(dog) {
  const records = (dog.vaccination_records || []).map((record) => ({
    id: record.id,
    originalFilename: record.original_filename || "Vaccination record",
    documentStatus: record.document_status || "pending",
    uploadDate: record.upload_date || record.created_at || "",
    expirationDate: record.expiration_date || "",
    version: record.version || 1,
    signedUrl: record.signedUrl || "",
  }));

  const bookings = (dog.bookings || []).map((booking) => {
    const review = Array.isArray(booking.reviews) ? booking.reviews[0] : null;
    return {
      id: booking.id,
      service: booking.service || "",
      petType: booking.pet_type || dog.pet_type || "dog",
      dropoffDate: booking.dropoff_date || "",
      pickupDate: booking.pickup_date || "",
      arrivalTime: booking.arrival_time || "",
      departureTime: booking.departure_time || "",
      units: booking.units || 1,
      estimatedTotal: booking.estimated_total || "",
      depositDueToday: booking.deposit_due_today || "",
      remainingBalance: booking.remaining_balance || "",
      status: booking.status || "",
      paymentStatus: booking.payment_status || "",
      depositPaidAmount: booking.deposit_paid_amount || "",
      balancePaymentStatus: booking.balance_payment_status || "",
      balancePaidAmount: booking.balance_paid_amount || "",
      balancePaidAt: booking.balance_paid_at || "",
      createdAt: booking.created_at || "",
      review: review
        ? {
            id: review.id,
            status: review.status || "pending",
            rating: review.rating || "",
            reviewText: review.review_text || "",
            createdAt: review.created_at || "",
          }
        : null,
    };
  });

  return {
    id: dog.id,
    name: dog.name || "",
    petType: dog.pet_type || "dog",
    breed: dog.breed || "",
    age: dog.age || "",
    weight: dog.weight || "",
    size: dog.size || "",
    sex: dog.sex || "",
    spayedNeutered: dog.spayed_neutered || "",
    vaccinationsUpToDate: dog.vaccinations_up_to_date || "",
    rabiesVaccinationUpToDate: dog.rabies_vaccination_up_to_date || "",
    vaccinationStatus: records.length ? "Submitted" : "Pending",
    goodWithCats: dog.good_with_cats || "",
    goodWithSmallDogs: dog.good_with_small_dogs || "",
    canSwim: dog.can_swim || "",
    medications: dog.medications || "",
    allergies: dog.allergies || "",
    behavioralConcerns: dog.behavioral_concerns || "",
    favoriteActivities: dog.favorite_activities || "",
    feedingInstructions: dog.feeding_instructions || "",
    veterinaryClinic: dog.veterinary_clinic || "",
    veterinarianName: dog.veterinarian_name || "",
    clinicPhone: dog.clinic_phone || "",
    clinicAddress: dog.clinic_address || "",
    records,
    bookings,
  };
}

module.exports = {
  compactPayload,
  findOwnerForUser,
  findOwnersByEmail,
  getOrCreateOwnerForUser,
  normalizeEmail,
  publicDog,
  publicOwner,
};
