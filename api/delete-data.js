const { initDB, getSQLInstance } = require("./_db");
const { validateDashKey, verifySessionToken } = require("./_auth");
const { checkRate } = require("./_ratelimit");

let dbReady = false;
let _dbInitPromise = null;

// CORS: same as chat.js
var ALLOWED_ORIGINS = [
  "https://burgerjazz.com", "https://www.burgerjazz.com",
  "https://bot.burgerjazz.com",
  "https://burgerjazz-chatbot.vercel.app",
  "http://localhost:3000", "http://localhost:5500",
];
function getCorsOrigin(req) {
  var origin = req.headers.origin || req.headers.referer || "";
  if (origin.includes("/", 8)) origin = origin.slice(0, origin.indexOf("/", 8));
  for (var i = 0; i < ALLOWED_ORIGINS.length; i++) { if (origin === ALLOWED_ORIGINS[i]) return origin; }
  if (/^https:\/\/burgerjazz-chatbot[a-z0-9-]*\.vercel\.app$/.test(origin)) return origin;
  return ALLOWED_ORIGINS[0];
}

// Rate limit: max 3 delete requests per IP per hour (cross-instance via DB).

module.exports = async function handler(req, res) {
  var corsOrigin = getCorsOrigin(req);
  res.setHeader("Access-Control-Allow-Origin", corsOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-dashboard-key");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!dbReady) {
    if (!_dbInitPromise) _dbInitPromise = initDB();
    await _dbInitPromise;
    dbReady = true;
  }

  var sessionId = req.body?.sessionId;
  var deleteToken = req.body?.deleteToken;
  if (!sessionId || typeof sessionId !== "string" || sessionId.length > 60) {
    return res.status(400).json({ error: "Invalid sessionId" });
  }

  // Authorization (NOT based on Origin, which is trivially spoofable):
  //  - admin dashboard key  → may delete any session, OR
  //  - valid session token  → user deleting their OWN session (self-service RGPD)
  // verifySessionToken returns null when SESSION_SECRET is not configured yet;
  // in that legacy mode we fall back to allowing self-service by sessionId so
  // the live widget keeps working until the secret is set + widget redeployed.
  var dashKey = req.body?.key || req.headers["x-dashboard-key"];
  var tokenOk = verifySessionToken(sessionId, deleteToken);
  var authorized = validateDashKey(dashKey) || tokenOk === true || tokenOk === null;
  if (!authorized) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Rate limit (cross-instance, fail-open)
  var ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
  if (!(await checkRate("delete:" + ip, 3, 3600)).allowed) {
    return res.status(429).json({ error: "Too many requests" });
  }

  try {
    var sql = getSQLInstance();
    // Delete conversation data for this session
    await sql`DELETE FROM chats WHERE session = ${sessionId}`;
    await sql`DELETE FROM ratings WHERE session = ${sessionId}`;
    // Keep incidents (legal obligation to retain complaints) but anonymize
    await sql`UPDATE incidents SET name = 'ELIMINADO', email = 'ELIMINADO', description = 'Datos eliminados por solicitud del usuario' WHERE session = ${sessionId}`;

    return res.status(200).json({ ok: true, message: "Datos eliminados" });
  } catch (err) {
    console.error("Delete data error:", err);
    return res.status(500).json({ error: "Error eliminando datos" });
  }
};
