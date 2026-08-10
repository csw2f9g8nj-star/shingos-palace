const { createClient } = require("@supabase/supabase-js");

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "application/octet-stream",
  "",
]);

const ALLOWED_EXTENSIONS = new Set(["pdf", "jpg", "jpeg", "png", "heic", "heif"]);

function getEnv(name, fallbacks = []) {
  const keys = [name, ...fallbacks];
  for (const key of keys) {
    if (process.env[key]) return process.env[key];
  }
  return "";
}

function getSupabaseConfig() {
  return {
    url: getEnv("SUPABASE_URL"),
    publishableKey: getEnv("SUPABASE_PUBLISHABLE_KEY", ["SUPABASE_ANON_KEY"]),
    secretKey: getEnv("SUPABASE_SECRET_KEY", ["SUPABASE_SERVICE_ROLE_KEY"]),
    adminEmail: getEnv("ADMIN_EMAIL"),
    bucket: getEnv("SUPABASE_VACCINATION_BUCKET") || "vaccination-records",
  };
}

function requireServerConfig() {
  const config = getSupabaseConfig();
  const missing = [];
  if (!config.url) missing.push("SUPABASE_URL");
  if (!config.secretKey) missing.push("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY");
  if (!config.adminEmail) missing.push("ADMIN_EMAIL");

  if (missing.length) {
    const error = new Error(`Missing environment variables: ${missing.join(", ")}`);
    error.statusCode = 500;
    throw error;
  }

  return config;
}

function getAdminClient() {
  const config = requireServerConfig();
  return createClient(config.url, config.secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function normalizeField(value) {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

function sanitizePathPart(value) {
  return String(value || "unknown")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "unknown";
}

function getFileExtension(file) {
  const originalName = file.originalFilename || file.name || "";
  const match = originalName.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

function validateUploadFile(file) {
  const extension = getFileExtension(file);
  const mimeType = file.mimetype || file.type || "";

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return "Only PDF, JPG, JPEG, PNG, HEIC, or HEIF files are accepted.";
  }

  if (mimeType && !ALLOWED_MIME_TYPES.has(mimeType)) {
    return "Only PDF, JPG, JPEG, PNG, HEIC, or HEIF files are accepted.";
  }

  if (Number(file.size) > MAX_FILE_SIZE) {
    return "Each vaccination record must be 10MB or smaller.";
  }

  return "";
}

async function requireAdminUser(req, supabase) {
  const config = requireServerConfig();
  const authorization = req.headers.authorization || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    const error = new Error("Missing admin session.");
    error.statusCode = 401;
    throw error;
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    const authError = new Error("Invalid admin session.");
    authError.statusCode = 401;
    throw authError;
  }

  if (data.user.email?.toLowerCase() !== config.adminEmail.toLowerCase()) {
    const forbidden = new Error("This account is not authorized for Shingo's Palace admin.");
    forbidden.statusCode = 403;
    throw forbidden;
  }

  return data.user;
}

function handleApiError(res, error) {
  const statusCode = error.statusCode || 500;
  sendJson(res, statusCode, {
    ok: false,
    error: statusCode === 500 ? "Something went wrong. Please try again." : error.message,
    detail: process.env.NODE_ENV === "development" ? error.message : undefined,
  });
}

module.exports = {
  MAX_FILE_SIZE,
  ALLOWED_MIME_TYPES,
  ALLOWED_EXTENSIONS,
  getSupabaseConfig,
  getAdminClient,
  sendJson,
  normalizeField,
  sanitizePathPart,
  validateUploadFile,
  requireAdminUser,
  handleApiError,
};
