const { initDB, logFeedback } = require("./_db");

let dbReady = false;
let _dbInitPromise = null;

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

// Rate limit: 30 feedbacks per session per minute
var _feedbackBuckets = {};
function checkRate(sid) {
  var now = Date.now();
  if (!_feedbackBuckets[sid] || now - _feedbackBuckets[sid].start > 60000) {
    _feedbackBuckets[sid] = { start: now, count: 1 };
    return true;
  }
  _feedbackBuckets[sid].count++;
  return _feedbackBuckets[sid].count <= 30;
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

  var { chatId, sessionId, vote } = req.body;
  if (!sessionId || typeof sessionId !== "string" || sessionId.length > 60) {
    return res.status(400).json({ error: "Invalid sessionId" });
  }
  if (!chatId || typeof chatId !== "string") {
    return res.status(400).json({ error: "Invalid chatId" });
  }
  if (vote !== "up" && vote !== "down") {
    return res.status(400).json({ error: "vote must be 'up' or 'down'" });
  }

  if (!checkRate(sessionId)) {
    return res.status(429).json({ error: "Too many requests" });
  }

  await logFeedback(chatId, sessionId, vote);
  return res.status(200).json({ ok: true });
};
