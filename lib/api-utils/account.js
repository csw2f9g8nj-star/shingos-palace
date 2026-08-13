const { publicApiError } = require("./supabase");

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function compactPayload(payload) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}

async function findOwnerForUser(supabase, user) {
  const email = normalizeEmail(user.email);
  if (!email) {
    throw publicApiError("This account does not have an email address.", 400, "missing_customer_email");
  }

  const { data: linkedOwner, error: linkedError } = await supabase
    .from("owners")
    .select("*")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (linkedError) {
    throw publicApiError("We could not load your account.", 500, "owner_lookup_failed");
  }

  if (linkedOwner) return linkedOwner;

  const { data: emailOwners, error: emailError } = await supabase
    .from("owners")
    .select("*")
    .ilike("email", email)
    .order("created_at", { ascending: true })
    .limit(1);

  if (emailError) {
    throw publicApiError("We could not load your account.", 500, "owner_email_lookup_failed");
  }

  const owner = emailOwners?.[0] || null;
  if (!owner) return null;

  if (!owner.auth_user_id) {
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

  if (owner.auth_user_id !== user.id) {
    throw publicApiError("This owner profile is linked to a different account.", 403, "owner_link_conflict");
  }

  return owner;
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

  const bookings = (dog.bookings || []).map((booking) => ({
    id: booking.id,
    service: booking.service || "",
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
    createdAt: booking.created_at || "",
  }));

  return {
    id: dog.id,
    name: dog.name || "",
    breed: dog.breed || "",
    age: dog.age || "",
    weight: dog.weight || "",
    size: dog.size || "",
    sex: dog.sex || "",
    spayedNeutered: dog.spayed_neutered || "",
    vaccinationsUpToDate: dog.vaccinations_up_to_date || "",
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
  getOrCreateOwnerForUser,
  normalizeEmail,
  publicDog,
  publicOwner,
};
