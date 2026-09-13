const crypto = require("crypto");
const { findOwnerForUser } = require("./account");
const { publicApiError, requireCustomerUser, sendJson } = require("./supabase");
const { verifyBookingActionToken } = require("./action-tokens");

const buckets = new Map();
const MAX_RATE_LIMIT_BUCKETS = 5000;

function pruneRateLimitBuckets(now) {
  for (const [bucketKey, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(bucketKey);
  }
  if (buckets.size >= MAX_RATE_LIMIT_BUCKETS) {
    const oldestKey = buckets.keys().next().value;
    if (oldestKey) buckets.delete(oldestKey);
  }
}

function clientAddress(req) {
  return String(req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
}

function enforceRateLimit(req, res, { key, limit, windowMs }) {
  const now = Date.now();
  if (buckets.size >= MAX_RATE_LIMIT_BUCKETS) pruneRateLimitBuckets(now);
  const bucketKey = `${key}:${clientAddress(req)}`;
  const current = buckets.get(bucketKey);
  const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
  entry.count += 1;
  buckets.set(bucketKey, entry);

  if (entry.count <= limit) return true;
  res.setHeader("Retry-After", String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
  sendJson(res, 429, { ok: false, error: "Too many requests. Please wait a moment and try again.", code: "rate_limited" });
  return false;
}

function trustedOrigin(req) {
  const configured = String(process.env.SITE_URL || "").trim().replace(/\/$/, "");
  if (/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(configured)) return configured;
  const vercelHost = String(process.env.VERCEL_PROJECT_PRODUCTION_URL || "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (vercelHost) return `https://${vercelHost}`;

  if (process.env.NODE_ENV !== "production") {
    const host = String(req.headers.host || "localhost:3000");
    if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return `http://${host}`;
  }
  return "https://shingospalace.com";
}

function timingSafeSecretMatch(left, right) {
  const leftDigest = crypto.createHash("sha256").update(String(left || "")).digest();
  const rightDigest = crypto.createHash("sha256").update(String(right || "")).digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

async function authorizeBookingAction({ req, supabase, booking, scope, token }) {
  const authorization = String(req.headers.authorization || "");
  if (authorization) {
    const user = await requireCustomerUser(req, supabase);
    const owner = await findOwnerForUser(supabase, user);
    if (owner?.id === booking.owner_id) return { type: "customer", owner };
    throw publicApiError("This reservation is not available in your account.", 403, "booking_forbidden");
  }

  const claims = verifyBookingActionToken(token, {
    scope,
    bookingId: booking.id,
    ownerId: booking.owner_id,
  });
  if (!claims) throw publicApiError("This secure booking link is invalid or has expired.", 403, "booking_action_forbidden");
  return { type: "signed_link", claims };
}

module.exports = { authorizeBookingAction, enforceRateLimit, timingSafeSecretMatch, trustedOrigin };
