const {
  getAdminClient,
  handleApiError,
  normalizeField,
  requireAdminUser,
  sendJson,
} = require("../_utils/supabase");
const { parseMultipartForm } = require("../_utils/forms");

function orderDogPair(firstDogId, secondDogId) {
  return [firstDogId, secondDogId].sort();
}

async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  try {
    const supabase = getAdminClient();
    const admin = await requireAdminUser(req, supabase);
    const { fields } = await parseMultipartForm(req);
    const firstDogId = normalizeField(fields.dogOneId);
    const secondDogId = normalizeField(fields.dogTwoId);
    const [dogOneId, dogTwoId] = orderDogPair(firstDogId, secondDogId);

    const payload = {
      dog_one_id: dogOneId,
      dog_two_id: dogTwoId,
      status: normalizeField(fields.status),
      notes: normalizeField(fields.notes),
      author: admin.email,
      updated_at: new Date().toISOString(),
    };

    if (!firstDogId || !secondDogId || firstDogId === secondDogId || !payload.status) {
      sendJson(res, 400, { ok: false, error: "Two different dogs and a status are required." });
      return;
    }

    const { data, error } = await supabase
      .from("dog_compatibility")
      .upsert(payload, { onConflict: "dog_one_id,dog_two_id" })
      .select()
      .single();
    if (error) throw error;

    sendJson(res, 200, { ok: true, compatibility: data });
  } catch (error) {
    handleApiError(res, error);
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
