const { initDB, getStats, getSession, getRatings, getIncidents, resolveIncident, updateIncidentNotes, getKnowledgeSections, upsertKnowledgeSection, getKnowledgeHistory } = require("./_db");

let dbReady = false;
let _dbInitPromise = null;

// Multi-user auth: DASHBOARD_USERS env var is JSON like {"Marta":"pass1","Nacho":"pass2","Manuel":"pass3"}
// Falls back to DASHBOARD_KEY for backwards compatibility
function validateDashKey(rawKey) {
  if (!rawKey) return false;
  // New format: "user:password"
  var parts = rawKey.split(":");
  if (parts.length >= 2) {
    var user = parts[0];
    var pass = parts.slice(1).join(":");
    try {
      var users = JSON.parse(process.env.DASHBOARD_USERS || "{}");
      if (users[user] && users[user] === pass) return true;
    } catch(e) {}
  }
  // Fallback: single shared key
  if (rawKey === process.env.DASHBOARD_KEY) return true;
  return false;
}

// Credit status: inferred from recent chat errors instead of wasting tokens
function checkCredit() {
  return { status: process.env.ANTHROPIC_API_KEY ? "ok" : "AUTH_ERROR" };
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
  if (origin === "https://bot.burgerjazz.com") return origin;
  if (/^https:\/\/burgerjazz-chatbot[a-z0-9-]*\.vercel\.app$/.test(origin)) return origin;
  if (origin === "http://localhost:3000" || origin === "http://localhost:5500") return origin;
  return "https://bot.burgerjazz.com";
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
    if (!validateDashKey(postAuthKey)) { recordFailedAttempt(clientIPP); return res.status(401).json({ error: "Unauthorized" }); }
    clearAttempts(clientIPP);

    if (req.body?.action === "resolve_incident" && req.body?.incidentId) {
      if (!dbReady) { if (!_dbInitPromise) _dbInitPromise = initDB(); await _dbInitPromise; dbReady = true; }
      await resolveIncident(parseInt(req.body.incidentId), req.body.resolvedBy || null);
      return res.status(200).json({ ok: true });
    }
    if (req.body?.action === "update_notes" && req.body?.incidentId) {
      if (!dbReady) { if (!_dbInitPromise) _dbInitPromise = initDB(); await _dbInitPromise; dbReady = true; }
      await updateIncidentNotes(parseInt(req.body.incidentId), req.body.notes || "");
      return res.status(200).json({ ok: true });
    }
    if (req.body?.action === "admin_reply" && req.body?.session && req.body?.message) {
      if (!dbReady) { if (!_dbInitPromise) _dbInitPromise = initDB(); await _dbInitPromise; dbReady = true; }
      const { logChat } = require("./_db");
      await logChat(req.body.session, "[ADMIN]", req.body.message, "admin_reply", { input: 0, output: 0 }, "ADMIN");
      return res.status(200).json({ ok: true });
    }
    // Admin takeover: mark session as escalated so bot stops responding
    if (req.body?.action === "takeover" && req.body?.session) {
      if (!dbReady) { if (!_dbInitPromise) _dbInitPromise = initDB(); await _dbInitPromise; dbReady = true; }
      const { logChat } = require("./_db");
      await logChat(req.body.session, "[ADMIN]", "Un momento, le paso con un agente para atenderle personalmente.", "admin_reply", { input: 0, output: 0 }, "ADMIN");
      // Mark in chat.js escalated sessions via a flag in DB
      const { neon } = require("@neondatabase/serverless");
      const sql = neon(process.env.DATABASE_URL);
      try {
        await sql`CREATE TABLE IF NOT EXISTS escalated_sessions (session_id TEXT PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT NOW())`;
        await sql`INSERT INTO escalated_sessions (session_id) VALUES (${req.body.session}) ON CONFLICT DO NOTHING`;
      } catch(e) {
        console.error("Takeover DB error:", e);
        return res.status(500).json({ error: "Error al tomar control: " + e.message });
      }
      return res.status(200).json({ ok: true });
    }
    // Release session: return control to bot
    if (req.body?.action === "release_session" && req.body?.session) {
      const { neon } = require("@neondatabase/serverless");
      const sql = neon(process.env.DATABASE_URL);
      try {
        await sql`DELETE FROM escalated_sessions WHERE session_id = ${req.body.session}`;
      } catch(e) {}
      if (!dbReady) { if (!_dbInitPromise) _dbInitPromise = initDB(); await _dbInitPromise; dbReady = true; }
      const { logChat } = require("./_db");
      await logChat(req.body.session, "[ADMIN]", "El agente ha finalizado la asistencia. El bot vuelve a estar disponible para ayudarte.", "admin_reply", { input: 0, output: 0 }, "ADMIN");
      return res.status(200).json({ ok: true });
    }
    // Knowledge base CRUD
    if (req.body?.action === "get_knowledge") {
      if (!dbReady) { if (!_dbInitPromise) _dbInitPromise = initDB(); await _dbInitPromise; dbReady = true; }
      var sections = await getKnowledgeSections();
      return res.status(200).json({ sections: sections });
    }
    if (req.body?.action === "update_knowledge" && req.body?.section_key && req.body?.content) {
      if (!dbReady) { if (!_dbInitPromise) _dbInitPromise = initDB(); await _dbInitPromise; dbReady = true; }
      var userName = (req.body.key || "").split(":")[0] || "admin";
      await upsertKnowledgeSection(req.body.section_key, req.body.title || req.body.section_key, req.body.content, userName);
      return res.status(200).json({ ok: true });
    }
    if (req.body?.action === "get_knowledge_history" && req.body?.section_key) {
      if (!dbReady) { if (!_dbInitPromise) _dbInitPromise = initDB(); await _dbInitPromise; dbReady = true; }
      var history = await getKnowledgeHistory(req.body.section_key, 10);
      return res.status(200).json({ history: history });
    }
    return res.status(400).json({ error: "Unknown action" });
  }

  var clientIP = getClientIP(req);
  if (!checkBruteForce(clientIP)) {
    return res.status(429).json({ error: "Too many failed attempts. Try again in 15 minutes." });
  }

  const authKey = req.query.key || req.headers.authorization?.replace("Bearer ", "") || req.headers["x-dashboard-key"];
  if (!validateDashKey(authKey)) {
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
      // Check if session is currently escalated (agent has control)
      var isEscalated = false;
      try {
        const { neon } = require("@neondatabase/serverless");
        const sql = neon(process.env.DATABASE_URL);
        var escRows = await sql`SELECT 1 FROM escalated_sessions WHERE session_id = ${sessionParam} AND created_at > NOW() - INTERVAL '24 hours' LIMIT 1`;
        isEscalated = escRows.length > 0;
      } catch(e) { console.error("Escalation check error:", e); }
      return res.status(200).json({ is_escalated: isEscalated, messages: msgs.map(function(m) {
        return { ts: m.ts, user: m.user_msg, bot: m.bot_msg, category: m.category, prompt_version: m.prompt_version };
      })});
    }

    const stats = await getStats();
    stats.ratings = await getRatings();
    stats.incidents_list = await getIncidents(50);

    // Estimate cost (Haiku 4.5: $0.80/M input, $4/M output)
    stats.estimatedCost =
      "$" +
      (
        (stats.totalTokens.input / 1000000) * 0.8 +
        (stats.totalTokens.output / 1000000) * 4
      ).toFixed(4);

    var credit = checkCredit();
    stats.creditStatus = credit.status;

    return res.status(200).json(stats);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
