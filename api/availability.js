const { checkServiceAvailability } = require("../lib/api-utils/availability");
const { getAdminClient, handleApiError, sendJson } = require("../lib/api-utils/supabase");
const { enforceRateLimit } = require("../lib/api-utils/request-security");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }
  if (!enforceRateLimit(req, res, { key: "availability", limit: 90, windowMs: 10 * 60 * 1000 })) return;

  try {
    const supabase = getAdminClient();
    const result = await checkServiceAvailability(supabase, req.body || {});
    sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    handleApiError(res, error);
  }
};
