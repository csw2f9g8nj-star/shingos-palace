const { createClient } = require("@supabase/supabase-js");
const fs = require("fs/promises");

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

function decodeJwtPayload(token) {
  try {
    const payload = String(token || "").split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(normalized, "base64").toString("utf8");
    return JSON.parse(decoded);
  } catch (error) {
    return null;
  }
}

function getUploadContentType(file) {
  const mimeType = file.mimetype || file.type || "";
  if (mimeType && mimeType !== "application/octet-stream") return mimeType;

  const extension = getFileExtension(file);
  const fallbackTypes = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    heic: "image/heic",
    heif: "image/heif",
  };

  return fallbackTypes[extension] || "application/octet-stream";
}

function publicApiError(message, statusCode = 500, code = "api_error") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  error.code = code;
  return error;
}

function isPublishableOrAnonKey(key) {
  const normalized = String(key || "").trim();
  if (normalized.startsWith("sb_publishable_")) return true;
  const payload = decodeJwtPayload(normalized);
  return payload?.role === "anon";
}

function requireServerConfig() {
  const config = getSupabaseConfig();
  const missing = [];
  if (!config.url) missing.push("SUPABASE_URL");
  if (!config.secretKey) missing.push("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY");
  if (!config.adminEmail) missing.push("ADMIN_EMAIL");

  if (missing.length) {
    throw publicApiError(
      `Booking connection is missing required Vercel environment variables: ${missing.join(", ")}.`,
      500,
      "missing_env",
    );
  }

  if (isPublishableOrAnonKey(config.secretKey)) {
    throw publicApiError(
      "Supabase server key is not configured correctly. In Vercel, SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY must use the private service_role/secret key, not the anon or publishable key.",
      500,
      "invalid_service_key",
    );
  }

  const secretPayload = decodeJwtPayload(config.secretKey);
  if (secretPayload?.role && secretPayload.role !== "service_role") {
    throw publicApiError(
      "Supabase server key is not configured correctly. Please use the service_role key for SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY.",
      500,
      "invalid_service_key",
    );
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

async function validateUploadFileContent(file) {
  const metadataError = validateUploadFile(file);
  if (metadataError) return metadataError;
  if (!file.filepath || Number(file.size) <= 0) return "The selected file is empty.";

  const handle = await fs.open(file.filepath, "r");
  const header = Buffer.alloc(16);
  try {
    await handle.read(header, 0, header.length, 0);
  } finally {
    await handle.close();
  }

  const extension = getFileExtension(file);
  const isPdf = header.subarray(0, 5).toString() === "%PDF-";
  const isJpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const isPng = header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const heifBrand = header.subarray(8, 12).toString("ascii");
  const isHeif = header.subarray(4, 8).toString("ascii") === "ftyp" && /^(heic|heix|hevc|hevx|mif1|msf1|heif)$/.test(heifBrand);
  const matches = extension === "pdf" ? isPdf : ["jpg", "jpeg"].includes(extension) ? isJpeg : extension === "png" ? isPng : isHeif;
  return matches ? "" : "The file contents do not match an accepted PDF or image format.";
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

async function requireCustomerUser(req, supabase) {
  const authorization = req.headers.authorization || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    const error = new Error("Missing customer session.");
    error.statusCode = 401;
    throw error;
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    const authError = new Error("Invalid customer session.");
    authError.statusCode = 401;
    throw authError;
  }

  return data.user;
}

function handleApiError(res, error) {
  const statusCode = error.statusCode || 500;
  const logEntry = {
    statusCode,
    code: error.code,
    supabaseCode: error.supabaseCode,
  };
  if (process.env.NODE_ENV === "development") {
    Object.assign(logEntry, {
      supabaseMessage: error.supabaseMessage,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
  }
  console.error("[Shingo's Palace API]", logEntry);

  const publicMessage = statusCode >= 500 && process.env.NODE_ENV !== "development"
    ? "Something went wrong. Please try again."
    : error.publicMessage || error.message;

  sendJson(res, statusCode, {
    ok: false,
    error: publicMessage,
    code: error.code,
    detail: process.env.NODE_ENV === "development" ? error.message : undefined,
  });
}

module.exports = {
  MAX_FILE_SIZE,
  ALLOWED_MIME_TYPES,
  ALLOWED_EXTENSIONS,
  getSupabaseConfig,
  getAdminClient,
  getUploadContentType,
  publicApiError,
  sendJson,
  normalizeField,
  sanitizePathPart,
  validateUploadFile,
  validateUploadFileContent,
  requireAdminUser,
  requireCustomerUser,
  handleApiError,
};
