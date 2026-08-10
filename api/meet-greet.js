const { getAdminClient, handleApiError, normalizeField, sendJson } = require("./_utils/supabase");
const { parseMultipartForm } = require("./_utils/forms");

async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  try {
    const supabase = getAdminClient();
    const { fields } = await parseMultipartForm(req);
    const payload = {
      owner_name: normalizeField(fields.ownerName),
      phone: normalizeField(fields.phone),
      email: normalizeField(fields.email).toLowerCase(),
      dog_name: normalizeField(fields.dogName),
      preferred_day: normalizeField(fields.preferredDay) || null,
      preferred_time: normalizeField(fields.preferredTime) || null,
      message: normalizeField(fields.message),
      status: "new_request",
    };

    if (!payload.owner_name || !payload.phone || !payload.email || !payload.dog_name) {
      sendJson(res, 400, { ok: false, error: "Please complete the required Meet & Greet fields." });
      return;
    }

    const { data, error } = await supabase
      .from("meet_greet_requests")
      .insert(payload)
      .select()
      .single();
    if (error) throw error;

    sendJson(res, 200, {
      ok: true,
      message: "Thank you! We have received your Meet & Greet request and will contact you shortly.",
      requestId: data.id,
    });
  } catch (error) {
    handleApiError(res, error);
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
