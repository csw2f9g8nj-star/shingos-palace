const { compactPayload, getOrCreateOwnerForUser, publicDog } = require("../_utils/account");
const { getAdminClient, handleApiError, normalizeField, requireCustomerUser, sendJson } = require("../_utils/supabase");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  try {
    const supabase = getAdminClient();
    const user = await requireCustomerUser(req, supabase);
    const owner = await getOrCreateOwnerForUser(supabase, user);
    const body = req.body || {};

    const dogPayload = compactPayload({
      owner_id: owner.id,
      name: normalizeField(body.name),
      breed: normalizeField(body.breed),
      spayed_neutered: normalizeField(body.spayedNeutered),
      size: normalizeField(body.size),
      age: normalizeField(body.age),
      weight: normalizeField(body.weight),
    });

    if (!dogPayload.name || !dogPayload.breed) {
      sendJson(res, 400, { ok: false, error: "Please add your dog's name and breed." });
      return;
    }

    const { data, error } = await supabase.from("dogs").insert(dogPayload).select().single();

    if (error) {
      throw Object.assign(new Error("We could not add this dog."), {
        statusCode: 500,
        publicMessage: "We could not add this dog to your account.",
        code: "account_dog_create_failed",
        details: error.details,
        hint: error.hint,
        supabaseCode: error.code,
        supabaseMessage: error.message,
      });
    }

    sendJson(res, 200, {
      ok: true,
      message: "Dog added to your account.",
      dog: publicDog({ ...data, bookings: [], vaccination_records: [] }),
    });
  } catch (error) {
    handleApiError(res, error);
  }
};
