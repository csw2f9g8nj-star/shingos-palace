const { getSupabaseConfig, sendJson } = require("../_utils/supabase");

module.exports = function handler(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  const config = getSupabaseConfig();
  sendJson(res, 200, {
    ok: true,
    supabaseUrl: config.url,
    supabasePublishableKey: config.publishableKey,
    adminEmail: config.adminEmail,
  });
};
