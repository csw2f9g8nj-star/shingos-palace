const { getAdminClient, handleApiError, requireAdminUser, sendJson } = require("../../api-utils/supabase");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  try {
    const supabase = getAdminClient();
    await requireAdminUser(req, supabase);

    const { data, error } = await supabase
      .from("meet_greet_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;

    sendJson(res, 200, { ok: true, requests: data || [] });
  } catch (error) {
    handleApiError(res, error);
  }
};
