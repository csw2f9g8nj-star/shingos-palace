const { compactPayload, getOrCreateOwnerForUser, publicDog } = require("../../api-utils/account");
const { getAdminClient, handleApiError, normalizeField, requireCustomerUser, sendJson } = require("../../api-utils/supabase");

function normalizePetType(value) {
  return normalizeField(value).toLowerCase() === "cat" ? "cat" : "dog";
}

module.exports = async function handler(req, res) {
  if (!["POST", "PUT", "PATCH"].includes(req.method)) {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  try {
    const supabase = getAdminClient();
    const user = await requireCustomerUser(req, supabase);
    const owner = await getOrCreateOwnerForUser(supabase, user);
    const body = req.body || {};
    const dogId = normalizeField(body.dogId);

    const dogPayload = compactPayload({
      owner_id: owner.id,
      name: normalizeField(body.name),
      pet_type: normalizePetType(body.petType),
      breed: normalizeField(body.breed),
      spayed_neutered: normalizeField(body.spayedNeutered),
      rabies_vaccination_up_to_date: normalizeField(body.rabiesVaccinationUpToDate),
      size: normalizeField(body.size),
      age: normalizeField(body.age),
      weight: normalizeField(body.weight),
    });

    if (!dogPayload.name || !dogPayload.breed) {
      sendJson(res, 400, { ok: false, error: "Please add your pet's name and breed." });
      return;
    }

    let query = supabase.from("dogs");
    if (dogId && req.method !== "POST") {
      query = query.update(dogPayload).eq("id", dogId).eq("owner_id", owner.id);
    } else {
      query = query.insert(dogPayload);
    }

    const { data, error } = await query.select().single();

    if (error) {
      throw Object.assign(new Error(dogId ? "We could not update this pet." : "We could not add this pet."), {
        statusCode: 500,
        publicMessage: dogId ? "We could not update this pet in your account." : "We could not add this pet to your account.",
        code: dogId ? "account_dog_update_failed" : "account_dog_create_failed",
        details: error.details,
        hint: error.hint,
        supabaseCode: error.code,
        supabaseMessage: error.message,
      });
    }

    sendJson(res, 200, {
      ok: true,
      message: dogId ? "Pet updated in your account." : "Pet added to your account.",
      dog: publicDog({ ...data, bookings: [], vaccination_records: [] }),
    });
  } catch (error) {
    handleApiError(res, error);
  }
};
