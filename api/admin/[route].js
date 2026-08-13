const handlers = {
  compatibility: require("../../lib/api-routes/admin/compatibility"),
  config: require("../../lib/api-routes/admin/config"),
  dogs: require("../../lib/api-routes/admin/dogs"),
  "meet-greets": require("../../lib/api-routes/admin/meet-greets"),
  notes: require("../../lib/api-routes/admin/notes"),
  "vaccination-records": require("../../lib/api-routes/admin/vaccination-records"),
};

const { sendJson } = require("../../lib/api-utils/supabase");

module.exports = function handler(req, res) {
  const route = Array.isArray(req.query.route) ? req.query.route.join("/") : req.query.route;
  const selected = handlers[route];

  if (!selected) {
    sendJson(res, 404, { ok: false, error: "Admin endpoint not found." });
    return;
  }

  return selected(req, res);
};

module.exports.config = { api: { bodyParser: false } };
