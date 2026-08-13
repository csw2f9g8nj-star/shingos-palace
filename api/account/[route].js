const handlers = {
  dogs: require("../../lib/api-routes/account/dogs"),
  me: require("../../lib/api-routes/account/me"),
};

const { sendJson } = require("../../lib/api-utils/supabase");

module.exports = function handler(req, res) {
  const route = Array.isArray(req.query.route) ? req.query.route.join("/") : req.query.route;
  const selected = handlers[route];

  if (!selected) {
    sendJson(res, 404, { ok: false, error: "Account endpoint not found." });
    return;
  }

  return selected(req, res);
};
