const Anthropic = require("@anthropic-ai/sdk");
const { initDB, getStats, getSession, getRatings, getFeedbackStats, getIncidents, getABStats, resolveIncident, updateIncidentNotes, getRatingsTrend, getSessionResolutionStats } = require("./_db");

let dbReady = false;
let _dbInitPromise = null;

// Cache credit check for 1 hour to avoid wasting tokens on every dashboard load
let _creditCache = null;
let _creditCacheTs = 0;
const CREDIT_CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function checkCredit() {
  var now = Date.now();
  if (_creditCache !== null && now - _creditCacheTs < CREDIT_CACHE_TTL) {
    return _creditCache;
  }
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 5,
      messages: [{ role: "user", content: "ok" }],
    });
    _creditCache = { status: "ok" };
  } catch (err) {
    if (err.message && err.message.includes("credit")) {
      _creditCache = { status: "NO_CREDIT" };
    } else if (err.message && err.message.includes("auth")) {
      _creditCache = { status: "AUTH_ERROR" };
    } else {
      _creditCache = { status: "error", error: err.message };
    }
  }
  _creditCacheTs = now;
  return _creditCache;
}

// Brute force protection: block IP after 5 failed attempts for 15 min
const _loginAttempts = {};
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function getClientIP(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.headers["x-real-ip"] || "unknown";
}

function checkBruteForce(ip) {
  var now = Date.now();
  var entry = _loginAttempts[ip];
  if (!entry) return true;
  if (now - entry.first > LOCKOUT_MS) { delete _loginAttempts[ip]; return true; }
  return entry.count < MAX_ATTEMPTS;
}

function recordFailedAttempt(ip) {
  var now = Date.now();
  if (!_loginAttempts[ip] || now - _loginAttempts[ip].first > LOCKOUT_MS) {
    _loginAttempts[ip] = { first: now, count: 1 };
  } else {
    _loginAttempts[ip].count++;
  }
}

function clearAttempts(ip) {
  delete _loginAttempts[ip];
}

function getDashboardCors(req) {
  var origin = req.headers.origin || "";
  if (origin === "https://burgerjazz-chatbot.vercel.app") return origin;
  if (/^https:\/\/burgerjazz-chatbot[a-z0-9-]*\.vercel\.app$/.test(origin)) return origin;
  if (origin === "http://localhost:3000" || origin === "http://localhost:5500") return origin;
  return "https://burgerjazz-chatbot.vercel.app";
}

module.exports = async function handler(req, res) {
  var corsOrigin = getDashboardCors(req);
  res.setHeader("Access-Control-Allow-Origin", corsOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  // POST: resolve incident
  if (req.method === "POST") {
    var clientIPP = getClientIP(req);
    if (!checkBruteForce(clientIPP)) return res.status(429).json({ error: "Too many attempts" });
    const postAuthKey = req.body?.key || req.headers.authorization?.replace("Bearer ", "");
    if (postAuthKey !== process.env.DASHBOARD_KEY) { recordFailedAttempt(clientIPP); return res.status(401).json({ error: "Unauthorized" }); }
    clearAttempts(clientIPP);

    if (req.body?.action === "resolve_incident" && req.body?.incidentId) {
      await resolveIncident(parseInt(req.body.incidentId), req.body.resolvedBy || null);
      return res.status(200).json({ ok: true });
    }
    if (req.body?.action === "update_notes" && req.body?.incidentId) {
      await updateIncidentNotes(parseInt(req.body.incidentId), req.body.notes || "");
      return res.status(200).json({ ok: true });
    }
    if (req.body?.action === "admin_reply" && req.body?.session && req.body?.message) {
      if (!dbReady) { if (!_dbInitPromise) _dbInitPromise = initDB(); await _dbInitPromise; dbReady = true; }
      const { logChat } = require("./_db");
      await logChat(req.body.session, "[ADMIN]", req.body.message, "admin_reply", { input: 0, output: 0 }, "ADMIN");
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: "Unknown action" });
  }

  var clientIP = getClientIP(req);
  if (!checkBruteForce(clientIP)) {
    return res.status(429).json({ error: "Too many failed attempts. Try again in 15 minutes." });
  }

  const authKey = req.query.key || req.headers.authorization?.replace("Bearer ", "") || req.headers["x-dashboard-key"];
  if (authKey !== process.env.DASHBOARD_KEY) {
    recordFailedAttempt(clientIP);
    return res.status(401).json({ error: "Unauthorized" });
  }
  clearAttempts(clientIP);

  try {
    if (!dbReady) {
      if (!_dbInitPromise) _dbInitPromise = initDB();
      await _dbInitPromise;
      dbReady = true;
    }

    // If session query param, return full session (validate format to prevent enumeration)
    if (req.query.session) {
      var sessionParam = req.query.session;
      if (!sessionParam || sessionParam.length > 100) {
        return res.status(400).json({ error: "Invalid session format" });
      }
      const msgs = await getSession(sessionParam);
      return res.status(200).json({ messages: msgs.map(function(m) {
        return { ts: m.ts, user: m.user_msg, bot: m.bot_msg, category: m.category, prompt_version: m.prompt_version };
      })});
    }

    const stats = await getStats();
    stats.ratings = await getRatings();
    stats.feedback = await getFeedbackStats();
    stats.incidents_list = await getIncidents(50);
    stats.abTest = await getABStats();
    stats.ratingsTrend = await getRatingsTrend();
    stats.sessionResolution = await getSessionResolutionStats();

    // Estimate cost (Haiku 4.5: $0.80/M input, $4/M output)
    stats.estimatedCost =
      "$" +
      (
        (stats.totalTokens.input / 1000000) * 0.8 +
        (stats.totalTokens.output / 1000000) * 4
      ).toFixed(4);

    // Check Anthropic credit status (cached 1h)
    var credit = await checkCredit();
    stats.creditStatus = credit.status;
    if (credit.error) stats.creditError = credit.error;

    return res.status(200).json(stats);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
