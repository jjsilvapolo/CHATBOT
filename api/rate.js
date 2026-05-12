const { initDB, saveRating } = require("./_db");

let dbReady = false;
let _dbInitPromise = null;

// Simple rate limit: max 5 ratings per session per minute
const _rateBuckets = {};
function checkRate(sid) {
  var now = Date.now();
  if (!_rateBuckets[sid] || now - _rateBuckets[sid].start > 60000) {
    _rateBuckets[sid] = { start: now, count: 1 };
    return true;
  }
  _rateBuckets[sid].count++;
  return _rateBuckets[sid].count <= 5;
}

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

  const { sessionId, rating } = req.body;
  if (!sessionId || typeof sessionId !== "string" || sessionId.length > 60) {
    return res.status(400).json({ error: "Invalid sessionId" });
  }
  var r = parseInt(rating);
  if (isNaN(r) || r < 1 || r > 5) {
    return res.status(400).json({ error: "rating (1-5) required" });
  }

  if (!checkRate(sessionId)) {
    return res.status(429).json({ error: "Too many requests" });
  }

  await saveRating(sessionId, r);
  return res.status(200).json({ ok: true });
};
