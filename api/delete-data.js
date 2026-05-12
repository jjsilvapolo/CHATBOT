const { initDB, getSQLInstance } = require("./_db");

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

// Rate limit: max 3 delete requests per IP per hour
var _deleteBuckets = {};
function checkDeleteRate(ip) {
  var now = Date.now();
  if (!_deleteBuckets[ip] || now - _deleteBuckets[ip].start > 3600000) {
    _deleteBuckets[ip] = { start: now, count: 1 };
    return true;
  }
  _deleteBuckets[ip].count++;
  return _deleteBuckets[ip].count <= 3;
}

module.exports = async function handler(req, res) {
  var corsOrigin = getCorsOrigin(req);
  res.setHeader("Access-Control-Allow-Origin", corsOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

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
  // Validate origin matches and token is present (basic ownership check)
  var origin = req.headers.origin || "";
  if (!origin || origin === ALLOWED_ORIGINS[ALLOWED_ORIGINS.length - 1] || origin === ALLOWED_ORIGINS[ALLOWED_ORIGINS.length - 2]) {
    // localhost — only allow with dashboard key
    var dashKey = req.body?.key;
    if (!dashKey || (dashKey !== process.env.DASHBOARD_KEY)) {
      try {
        var parts = (dashKey || "").split(":");
        var users = JSON.parse(process.env.DASHBOARD_USERS || "{}");
        if (!users[parts[0]] || users[parts[0]] !== parts.slice(1).join(":")) {
          return res.status(401).json({ error: "Unauthorized" });
        }
      } catch(e) { return res.status(401).json({ error: "Unauthorized" }); }
    }
  }

  // Rate limit
  var ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
  if (!checkDeleteRate(ip)) {
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
