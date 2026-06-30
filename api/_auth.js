// Shared auth helpers: timing-safe comparison, dashboard keys,
// cron authorization (CRON_SECRET) and stateless session tokens (HMAC).
const crypto = require("crypto");

// Constant-time string compare (avoids length/timing leaks).
function timingSafeEqualStr(a, b) {
  a = String(a || "");
  b = String(b || "");
  var ba = Buffer.from(a, "utf8");
  var bb = Buffer.from(b, "utf8");
  // Always hash to a fixed length so we never short-circuit on length.
  var ha = crypto.createHash("sha256").update(ba).digest();
  var hb = crypto.createHash("sha256").update(bb).digest();
  return crypto.timingSafeEqual(ha, hb) && ba.length === bb.length;
}

// Verify a provided password against a stored value. The stored value may be
// either plaintext (legacy) or a scrypt hash "scrypt$<saltHex>$<hashHex>".
// Both paths are constant-time. This lets us migrate DASHBOARD_USERS to hashes
// without breaking logins (code accepts both formats).
function verifyPassword(stored, provided) {
  stored = String(stored || "");
  provided = String(provided || "");
  if (stored.indexOf("scrypt$") === 0) {
    var parts = stored.split("$"); // ["scrypt", salt, hash]
    if (parts.length !== 3) return false;
    var salt, expected;
    try {
      salt = Buffer.from(parts[1], "hex");
      expected = Buffer.from(parts[2], "hex");
      var derived = crypto.scryptSync(provided, salt, expected.length);
      return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
    } catch (e) { return false; }
  }
  return timingSafeEqualStr(stored, provided);
}

// Validate a dashboard credential of the form "user:password" against
// DASHBOARD_USERS (JSON map) or a single shared DASHBOARD_KEY. Constant-time.
function validateDashKey(rawKey) {
  if (!rawKey) return false;
  var parts = String(rawKey).split(":");
  if (parts.length >= 2) {
    var user = parts[0];
    var pass = parts.slice(1).join(":");
    try {
      var users = JSON.parse(process.env.DASHBOARD_USERS || "{}");
      if (Object.prototype.hasOwnProperty.call(users, user) &&
          verifyPassword(users[user], pass)) return true;
    } catch (e) {}
  }
  if (process.env.DASHBOARD_KEY && verifyPassword(process.env.DASHBOARD_KEY, rawKey)) return true;
  return false;
}

// Read the dashboard credential from a request without ever using the URL
// query string (which leaks into logs/Referer). Header first, then POST body.
function readDashKey(req) {
  var h = req.headers["x-dashboard-key"];
  if (h) return h;
  var auth = req.headers.authorization;
  if (auth && auth.indexOf("Bearer ") === 0) return auth.slice(7);
  if (req.body && req.body.key) return req.body.key;
  return "";
}

// Authorize a cron endpoint. Once CRON_SECRET is configured, Vercel injects
// `Authorization: Bearer <CRON_SECRET>` on scheduled invocations and the
// spoofable `x-vercel-cron` header is no longer trusted. A manual admin
// trigger with LEARN_KEY is always allowed.
function isAuthorizedCron(req) {
  var secret = process.env.CRON_SECRET;
  if (secret) {
    var auth = req.headers.authorization || "";
    if (auth.indexOf("Bearer ") === 0 && timingSafeEqualStr(auth.slice(7), secret)) return true;
  }
  var learnKey = process.env.LEARN_KEY;
  var provided = (req.query && req.query.key) || req.headers["x-learn-key"];
  if (learnKey && provided && timingSafeEqualStr(provided, learnKey)) return true;
  // Legacy fallback ONLY while CRON_SECRET is not yet configured, so existing
  // crons keep working until the secret is set.
  if (!secret && req.headers["x-vercel-cron"] === "true") return true;
  return false;
}

// Stateless per-session token = HMAC(SESSION_SECRET, sessionId). Returns null
// if SESSION_SECRET is not configured (callers then fall back to legacy mode).
function sessionToken(sessionId) {
  var secret = process.env.SESSION_SECRET;
  if (!secret || !sessionId) return null;
  return crypto.createHmac("sha256", secret).update(String(sessionId)).digest("hex");
}

// True if `token` is the valid token for `sessionId`. When SESSION_SECRET is
// not configured this returns null (meaning: "tokens not enforced yet").
function verifySessionToken(sessionId, token) {
  var expected = sessionToken(sessionId);
  if (expected === null) return null; // not enforced
  if (!token) return false;
  return timingSafeEqualStr(token, expected);
}

module.exports = {
  timingSafeEqualStr,
  validateDashKey,
  readDashKey,
  isAuthorizedCron,
  sessionToken,
  verifySessionToken,
};
