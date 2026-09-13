const crypto = require("crypto");

function configurationError() {
  const error = new Error("This secure booking action is not configured.");
  error.statusCode = 503;
  error.publicMessage = error.message;
  error.code = "booking_action_secret_missing";
  return error;
}

function getSigningSecret() {
  const secret = String(process.env.BOOKING_ACTION_SECRET || "").trim();
  if (!secret || secret.length < 32) {
    throw configurationError();
  }
  return secret;
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signature(payload) {
  return crypto.createHmac("sha256", getSigningSecret()).update(payload).digest("base64url");
}

function createBookingActionToken({ scope, bookingId, ownerId, petIds = [], expiresAt, lifetimeSeconds = 48 * 60 * 60 }) {
  const expiration = expiresAt
    ? Math.floor(new Date(expiresAt).getTime() / 1000)
    : Math.floor(Date.now() / 1000) + lifetimeSeconds;
  const payload = encode({ scope, bookingId, ownerId, petIds, exp: expiration });
  return `${payload}.${signature(payload)}`;
}

function verifyBookingActionToken(token, { scope, bookingId, ownerId = "", petId = "" }) {
  const [payload, providedSignature] = String(token || "").split(".");
  if (!payload || !providedSignature) return null;

  const expectedSignature = signature(payload);
  const left = Buffer.from(providedSignature);
  const right = Buffer.from(expectedSignature);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;

  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch (error) {
    return null;
  }

  if (!claims || !Number.isFinite(claims.exp) || claims.exp < Math.floor(Date.now() / 1000)) return null;
  if (!Array.isArray(claims.petIds)) return null;
  if (claims.scope !== scope || claims.bookingId !== bookingId) return null;
  if (ownerId && claims.ownerId !== ownerId) return null;
  if (petId && (!Array.isArray(claims.petIds) || !claims.petIds.includes(petId))) return null;
  return claims;
}

module.exports = { createBookingActionToken, verifyBookingActionToken };
