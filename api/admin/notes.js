const {
  getAdminClient,
  handleApiError,
  normalizeField,
  requireAdminUser,
  sendJson,
} = require("../_utils/supabase");
const { parseMultipartForm } = require("../_utils/forms");

async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  try {
    const supabase = getAdminClient();
    const admin = await requireAdminUser(req, supabase);
    const { fields } = await parseMultipartForm(req);
    const payload = {
      dog_id: normalizeField(fields.dogId),
      related_dog_id: normalizeField(fields.relatedDogId) || null,
      note_text: normalizeField(fields.noteText),
      category: normalizeField(fields.category),
      author: admin.email,
    };

    if (!payload.dog_id || !payload.note_text) {
      sendJson(res, 400, { ok: false, error: "Dog and note text are required." });
      return;
    }

    const { data, error } = await supabase.from("dog_notes").insert(payload).select().single();
    if (error) throw error;

    sendJson(res, 200, { ok: true, note: data });
  } catch (error) {
    handleApiError(res, error);
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
