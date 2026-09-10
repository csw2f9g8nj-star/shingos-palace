const {
  getAdminClient,
  handleApiError,
  normalizeField,
  publicApiError,
  requireAdminUser,
  sendJson,
} = require("../../api-utils/supabase");
const { parseMultipartForm } = require("../../api-utils/forms");

function normalizeEmail(value) {
  return normalizeField(value).trim().toLowerCase();
}

function normalizeComparable(value) {
  return normalizeField(value).trim().toLowerCase().replace(/\s+/g, " ");
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function publicPet(pet) {
  return {
    id: pet.id,
    owner_id: pet.owner_id,
    name: pet.name || "",
    pet_type: pet.pet_type || "dog",
    breed: pet.breed || "",
    age: pet.age || "",
    weight: pet.weight || "",
    size: pet.size || "",
    sex: pet.sex || "",
    spayed_neutered: pet.spayed_neutered || "",
    rabies_vaccination_up_to_date: pet.rabies_vaccination_up_to_date || "",
    created_at: pet.created_at,
  };
}

function publicOwner(owner) {
  return {
    id: owner.id,
    first_name: owner.first_name || "",
    last_name: owner.last_name || "",
    email: owner.email || "",
    phone: owner.phone || "",
    auth_user_id: owner.auth_user_id || null,
    created_at: owner.created_at,
    pets: (owner.dogs || []).map(publicPet),
  };
}

async function findOwnersByNormalizedEmail(supabase, email) {
  const { data, error } = await supabase
    .from("owners")
    .select("id,first_name,last_name,email,phone,auth_user_id,created_at,dogs(*)")
    .ilike("email", `%${email}%`)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data || []).filter((owner) => normalizeEmail(owner.email) === email);
}

async function requireOwner(supabase, ownerId) {
  const { data, error } = await supabase
    .from("owners")
    .select("id,first_name,last_name,email,phone,auth_user_id,created_at,dogs(*)")
    .eq("id", ownerId)
    .single();

  if (error || !data) {
    throw publicApiError("We could not find that owner.", 404, "admin_owner_not_found");
  }
  return data;
}

function possiblePetDuplicates(existingPets, fields) {
  const name = normalizeComparable(fields.name);
  const petType = normalizeComparable(fields.petType) === "cat" ? "cat" : "dog";
  const breed = normalizeComparable(fields.breed);

  return existingPets.filter((pet) => {
    if (normalizeComparable(pet.name) !== name || normalizeComparable(pet.pet_type) !== petType) return false;
    const existingBreed = normalizeComparable(pet.breed);
    return !breed || !existingBreed || existingBreed === breed;
  });
}

async function createOwner(supabase, fields, res) {
  const firstName = normalizeField(fields.firstName).trim();
  const lastName = normalizeField(fields.lastName).trim();
  const email = normalizeEmail(fields.email);
  const phone = normalizeField(fields.phone).trim();

  if (!firstName || !lastName || !email) {
    throw publicApiError("First name, last name, and a real email are required.", 400, "missing_owner_fields");
  }
  if (!validEmail(email)) {
    throw publicApiError("Please enter a valid owner email.", 400, "invalid_owner_email");
  }

  const existingOwners = await findOwnersByNormalizedEmail(supabase, email);
  if (existingOwners.length) {
    sendJson(res, 409, {
      ok: false,
      code: "owner_already_exists",
      error: "An owner with this email already exists. Please select the correct owner instead.",
      owners: existingOwners.map(publicOwner),
    });
    return null;
  }

  const { data, error } = await supabase
    .from("owners")
    .insert({ first_name: firstName, last_name: lastName, email, phone: phone || null })
    .select("id,first_name,last_name,email,phone,auth_user_id,created_at")
    .single();

  if (error) throw error;
  return publicOwner({ ...data, dogs: [] });
}

async function createPet(supabase, fields, res) {
  const ownerId = normalizeField(fields.ownerId).trim();
  const name = normalizeField(fields.name).trim();
  const petType = normalizeComparable(fields.petType) === "cat" ? "cat" : "dog";
  const forceCreate = normalizeComparable(fields.forceCreate) === "true";

  if (!ownerId || !name) {
    throw publicApiError("Please select an owner and enter the pet's name.", 400, "missing_pet_fields");
  }

  const owner = await requireOwner(supabase, ownerId);
  const duplicates = possiblePetDuplicates(owner.dogs || [], fields);
  if (duplicates.length && !forceCreate) {
    sendJson(res, 409, {
      ok: false,
      code: "possible_duplicate_pet",
      error: "A possible matching pet already belongs to this owner.",
      pets: duplicates.map(publicPet),
    });
    return null;
  }

  const payload = {
    owner_id: owner.id,
    name,
    pet_type: petType,
    breed: normalizeField(fields.breed).trim() || null,
    age: normalizeField(fields.age).trim() || null,
    weight: normalizeField(fields.weight).trim() || null,
    size: normalizeField(fields.size).trim() || null,
    sex: normalizeField(fields.sex).trim() || null,
    spayed_neutered: normalizeField(fields.spayedNeutered).trim() || null,
    rabies_vaccination_up_to_date: normalizeField(fields.rabiesVaccinationUpToDate).trim() || null,
  };

  const { data, error } = await supabase.from("dogs").insert(payload).select().single();
  if (error) throw error;
  return publicPet(data);
}

module.exports = async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  try {
    const supabase = getAdminClient();
    await requireAdminUser(req, supabase);

    if (req.method === "GET") {
      const email = normalizeEmail(req.query.email);
      if (!email || !validEmail(email)) {
        throw publicApiError("Enter the owner's complete email address.", 400, "invalid_owner_search_email");
      }

      const owners = await findOwnersByNormalizedEmail(supabase, email);
      sendJson(res, 200, { ok: true, owners: owners.map(publicOwner) });
      return;
    }

    const { fields } = await parseMultipartForm(req);
    const action = normalizeField(fields.action);

    if (action === "create-owner") {
      const owner = await createOwner(supabase, fields, res);
      if (owner) sendJson(res, 201, { ok: true, owner });
      return;
    }

    if (action === "create-pet") {
      const pet = await createPet(supabase, fields, res);
      if (pet) sendJson(res, 201, { ok: true, pet });
      return;
    }

    throw publicApiError("Admin owner/pet action not found.", 400, "invalid_admin_pet_action");
  } catch (error) {
    handleApiError(res, error);
  }
};

module.exports.config = { api: { bodyParser: false } };
