const { checkServiceAvailability } = require("../lib/api-utils/availability");
const { getAdminClient, handleApiError, sendJson } = require("../lib/api-utils/supabase");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  try {
    const supabase = getAdminClient();
    const result = await checkServiceAvailability(supabase, req.body || {});
    sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    handleApiError(res, error);
  }
};
