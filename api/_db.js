const { neon } = require("@neondatabase/serverless");

let _sql;

function getSQL() {
  if (!_sql) {
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}

// Exported for reuse in other modules (report.js, etc.)
function getSQLInstance() {
  return getSQL();
}

async function initDB() {
  const sql = getSQL();
  await sql`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      session TEXT,
      ts TIMESTAMPTZ DEFAULT NOW(),
      user_msg TEXT,
      bot_msg TEXT,
      category TEXT DEFAULT 'general',
      tokens_input INTEGER DEFAULT 0,
      tokens_output INTEGER DEFAULT 0
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS ratings (
      id SERIAL PRIMARY KEY,
      session TEXT UNIQUE,
      rating INTEGER CHECK (rating BETWEEN 1 AND 5),
      ts TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS incidents (
      id SERIAL PRIMARY KEY,
      session TEXT,
      name TEXT,
      email TEXT,
      description TEXT,
      status TEXT DEFAULT 'pending',
      ts TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS insights (
      id SERIAL PRIMARY KEY,
      ts TIMESTAMPTZ DEFAULT NOW(),
      insight_type TEXT,
      content TEXT,
      source_sessions TEXT,
      active BOOLEAN DEFAULT true
    )
  `;
  // Add columns for new features (safe if already exist)
  try { await sql`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ`; } catch(e) {}
  try { await sql`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS notes TEXT`; } catch(e) {}
  try { await sql`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS resolved_by TEXT`; } catch(e) {}
  try { await sql`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS phone TEXT`; } catch(e) {}
  try { await sql`ALTER TABLE chats ADD COLUMN IF NOT EXISTS prompt_version TEXT DEFAULT 'A'`; } catch(e) {}

  // Inline feedback (thumbs up/down per message)
  await sql`
    CREATE TABLE IF NOT EXISTS feedback (
      id SERIAL PRIMARY KEY,
      chat_id TEXT,
      session TEXT,
      vote TEXT CHECK (vote IN ('up', 'down')),
      ts TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // Knowledge base (dynamic, editable from dashboard)
  await sql`
    CREATE TABLE IF NOT EXISTS knowledge_sections (
      id SERIAL PRIMARY KEY,
      section_key TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      updated_by TEXT DEFAULT 'system',
      version INTEGER DEFAULT 1
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS knowledge_history (
      id SERIAL PRIMARY KEY,
      section_key TEXT NOT NULL,
      content TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      updated_by TEXT,
      version INTEGER
    )
  `;

  // Indexes for performance
  await sql`CREATE INDEX IF NOT EXISTS idx_chats_session ON chats(session)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_chats_ts ON chats(ts)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_chats_category ON chats(category)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ratings_session ON ratings(session)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_incidents_ts ON incidents(ts)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_insights_active ON insights(active, insight_type)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_feedback_session ON feedback(session)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status)`;
}

// Mask personal data (emails) in stored messages for privacy
function maskPII(text) {
  if (!text) return text;
  // Mask emails: user@domain.com → u***@d***.com
  return text.replace(/[\w.+-]+@[\w.-]+\.\w{2,}/gi, function (email) {
    var parts = email.split("@");
    var local = parts[0].charAt(0) + "***";
    var domParts = parts[1].split(".");
    var domain = domParts[0].charAt(0) + "***." + domParts.slice(1).join(".");
    return local + "@" + domain;
  });
}

async function logChat(sessionId, userMsg, botReply, category, tokens, promptVersion) {
  const sql = getSQL();
  const id = "c_" + Date.now() + "_" + Math.random().toString(36).slice(2, 5);
  try {
    // Mask PII in stored messages
    var safeUserMsg = maskPII(userMsg);
    var safeBotReply = maskPII(botReply);
    await sql`
      INSERT INTO chats (id, session, user_msg, bot_msg, category, tokens_input, tokens_output, prompt_version)
      VALUES (${id}, ${sessionId}, ${safeUserMsg}, ${safeBotReply}, ${category},
              ${tokens?.input || 0}, ${tokens?.output || 0}, ${promptVersion || 'A'})
    `;
  } catch (e) {
    console.error("DB log error:", e);
  }
  return id;
}

async function getChats(limit) {
  const sql = getSQL();
  return await sql`
    SELECT id, session, ts, user_msg, bot_msg, category, tokens_input, tokens_output
    FROM chats ORDER BY ts DESC LIMIT ${limit || 200}
  `;
}

async function getStats() {
  const sql = getSQL();

  const totalResult = await sql`SELECT COUNT(*) as count FROM chats`;
  const totalChats = parseInt(totalResult[0]?.count || "0");

  const dailyResult = await sql`
    SELECT TO_CHAR(ts, 'YYYY-MM-DD') as day, COUNT(*) as count
    FROM chats GROUP BY day ORDER BY day
  `;

  const catResult = await sql`
    SELECT category, COUNT(*) as count FROM chats GROUP BY category
  `;

  const tokenResult = await sql`
    SELECT COALESCE(SUM(tokens_input),0) as input, COALESCE(SUM(tokens_output),0) as output
    FROM chats
  `;

  const dailyCounts = {};
  dailyResult.forEach(function (r) { dailyCounts[r.day] = parseInt(r.count); });

  const categories = {};
  catResult.forEach(function (r) { categories[r.category] = parseInt(r.count); });

  const totalTokens = {
    input: parseInt(tokenResult[0]?.input || "0"),
    output: parseInt(tokenResult[0]?.output || "0"),
  };

  // Horas punta
  const hourlyResult = await sql`
    SELECT EXTRACT(HOUR FROM ts)::int as hour, COUNT(*) as count
    FROM chats GROUP BY hour ORDER BY hour
  `;
  const hourlyCounts = {};
  hourlyResult.forEach(function (r) { hourlyCounts[r.hour] = parseInt(r.count); });

  // Mensajes por sesion (para detectar conversaciones largas)
  const sessionResult = await sql`
    SELECT session, COUNT(*) as msg_count, MIN(ts) as first_ts, MAX(ts) as last_ts,
           ARRAY_AGG(category ORDER BY ts) as cats
    FROM chats GROUP BY session ORDER BY msg_count DESC LIMIT 50
  `;
  const sessions = sessionResult.map(function (r) {
    return { session: r.session, msgCount: parseInt(r.msg_count), firstTs: r.first_ts, lastTs: r.last_ts, cats: r.cats };
  });

  // Escalaciones (bot menciona "registrado tu incidencia" o "info@burgerjazz")
  const escalatedResult = await sql`
    SELECT COUNT(DISTINCT session) as count FROM chats
    WHERE bot_msg ILIKE '%registrado tu incidencia%' OR bot_msg ILIKE '%info@burgerjazz%' OR bot_msg ILIKE '%escanea el codigo QR%'
  `;
  const escalatedCount = parseInt(escalatedResult[0]?.count || "0");

  // Sesiones unicas totales
  const uniqueSessionsResult = await sql`SELECT COUNT(DISTINCT session) as count FROM chats`;
  const uniqueSessions = parseInt(uniqueSessionsResult[0]?.count || "0");

  const chats = await getChats(200);
  const formattedChats = chats.map(function (c) {
    return {
      id: c.id,
      session: c.session,
      ts: c.ts,
      user: c.user_msg,
      bot: c.bot_msg,
      category: c.category,
      tokens: { input: c.tokens_input, output: c.tokens_output },
    };
  });

  return {
    chats: formattedChats, totalChats, dailyCounts, categories, totalTokens,
    hourlyCounts, sessions, escalatedCount, uniqueSessions
  };
}

async function getSession(sessionId) {
  const sql = getSQL();
  return await sql`
    SELECT id, session, ts, user_msg, bot_msg, category, tokens_input, tokens_output
    FROM chats WHERE session = ${sessionId} ORDER BY ts ASC
  `;
}

async function saveRating(sessionId, rating) {
  const sql = getSQL();
  try {
    await sql`
      INSERT INTO ratings (session, rating) VALUES (${sessionId}, ${rating})
      ON CONFLICT (session) DO UPDATE SET rating = ${rating}, ts = NOW()
    `;
  } catch (e) {
    console.error("Rating save error:", e);
  }
}

async function getRatings() {
  const sql = getSQL();
  const result = await sql`
    SELECT rating, COUNT(*) as count FROM ratings GROUP BY rating ORDER BY rating
  `;
  const avg = await sql`SELECT AVG(rating)::numeric(3,2) as avg, COUNT(*) as total FROM ratings`;
  const ratingCounts = {};
  result.forEach(function (r) { ratingCounts[r.rating] = parseInt(r.count); });
  return {
    counts: ratingCounts,
    average: parseFloat(avg[0]?.avg || "0"),
    total: parseInt(avg[0]?.total || "0")
  };
}

async function logIncident(sessionId, data) {
  const sql = getSQL();
  try {
    await sql`
      INSERT INTO incidents (session, name, email, phone, description)
      VALUES (${sessionId}, ${data.name}, ${data.email}, ${data.phone || null}, ${data.description})
    `;
  } catch (e) {
    console.error("Incident log error:", e);
  }
}

async function getRecentConversations(days) {
  const sql = getSQL();
  return await sql`
    SELECT c.session, c.ts, c.user_msg, c.bot_msg, c.category,
           r.rating
    FROM chats c
    LEFT JOIN ratings r ON c.session = r.session
    WHERE c.ts > NOW() - INTERVAL '1 day' * ${days}
    ORDER BY c.session, c.ts ASC
  `;
}

async function saveInsight(type, content, sourceSessions) {
  const sql = getSQL();
  await sql`
    INSERT INTO insights (insight_type, content, source_sessions)
    VALUES (${type}, ${content}, ${sourceSessions})
  `;
}

async function getActiveInsights() {
  const sql = getSQL();
  return await sql`
    SELECT content FROM insights
    WHERE active = true
    ORDER BY ts DESC LIMIT 1
  `;
}

async function deactivateOldInsights() {
  const sql = getSQL();
  await sql`UPDATE insights SET active = false WHERE active = true`;
}

async function saveSourceUpdate(content) {
  const sql = getSQL();
  await sql`UPDATE insights SET active = false WHERE insight_type = 'source_update' AND active = true`;
  await sql`
    INSERT INTO insights (insight_type, content, source_sessions, active)
    VALUES ('source_update', ${content}, 'web_sync', true)
  `;
}

async function getActiveSourceUpdate() {
  const sql = getSQL();
  return await sql`
    SELECT content FROM insights
    WHERE insight_type = 'source_update' AND active = true
    ORDER BY ts DESC LIMIT 1
  `;
}

async function cleanupOldChats() {
  const sql = getSQL();
  try {
    const result = await sql`DELETE FROM chats WHERE ts < NOW() - INTERVAL '365 days'`;
    return result;
  } catch (e) {
    console.error("Cleanup error:", e);
  }
}

async function logFeedback(chatId, sessionId, vote) {
  const sql = getSQL();
  try {
    await sql`INSERT INTO feedback (chat_id, session, vote) VALUES (${chatId}, ${sessionId}, ${vote})`;
  } catch (e) {
    console.error("Feedback log error:", e);
  }
}

async function getFeedbackStats() {
  const sql = getSQL();
  const result = await sql`
    SELECT vote, COUNT(*) as count FROM feedback GROUP BY vote
  `;
  var counts = { up: 0, down: 0 };
  result.forEach(function (r) { counts[r.vote] = parseInt(r.count); });

  // Per-category feedback
  const catResult = await sql`
    SELECT c.category, f.vote, COUNT(*) as count
    FROM feedback f JOIN chats c ON f.chat_id = c.id
    GROUP BY c.category, f.vote
  `;
  var byCat = {};
  catResult.forEach(function (r) {
    if (!byCat[r.category]) byCat[r.category] = { up: 0, down: 0 };
    byCat[r.category][r.vote] = parseInt(r.count);
  });

  return { counts: counts, byCategory: byCat };
}

async function resolveIncident(id, resolvedBy) {
  const sql = getSQL();
  await sql`UPDATE incidents SET status = 'resolved', resolved_at = NOW(), resolved_by = ${resolvedBy || null} WHERE id = ${id}`;
}

async function updateIncidentNotes(id, notes) {
  const sql = getSQL();
  await sql`UPDATE incidents SET notes = ${notes} WHERE id = ${id}`;
}

async function getIncidents(limit) {
  const sql = getSQL();
  return await sql`
    SELECT id, session, name, email, phone, description, status, ts, resolved_at, notes, resolved_by
    FROM incidents ORDER BY ts DESC LIMIT ${limit || 50}
  `;
}

async function getRatingsTrend() {
  const sql = getSQL();
  const result = await sql`
    SELECT TO_CHAR(ts, 'YYYY-MM-DD') as day, AVG(rating)::numeric(3,2) as avg, COUNT(*) as count
    FROM ratings WHERE ts > NOW() - INTERVAL '30 days'
    GROUP BY day ORDER BY day
  `;
  return result.map(function(r) { return { day: r.day, avg: parseFloat(r.avg), count: parseInt(r.count) }; });
}

async function getSessionResolutionStats() {
  const sql = getSQL();
  // Sessions with message counts and whether they were escalated
  const result = await sql`
    SELECT s.session, s.msg_count,
           CASE WHEN e.session IS NOT NULL THEN true ELSE false END as escalated
    FROM (SELECT session, COUNT(*) as msg_count FROM chats GROUP BY session) s
    LEFT JOIN (
      SELECT DISTINCT session FROM chats
      WHERE bot_msg ILIKE '%registrado tu incidencia%' OR bot_msg ILIKE '%info@burgerjazz%'
    ) e ON s.session = e.session
  `;
  var total = result.length;
  var quickResolved = 0; // 1-2 messages, not escalated
  var totalMsgs = 0;
  var resolvedSessions = 0;
  result.forEach(function(r) {
    var mc = parseInt(r.msg_count);
    totalMsgs += mc;
    if (!r.escalated) {
      resolvedSessions++;
      if (mc <= 2) quickResolved++;
    }
  });
  return {
    totalSessions: total,
    quickResolved: quickResolved,
    quickResolvedPct: total > 0 ? Math.round(quickResolved / total * 100) : 0,
    avgMsgsPerSession: total > 0 ? (totalMsgs / total).toFixed(1) : "0",
    resolvedSessions: resolvedSessions
  };
}

async function getABStats() {
  const sql = getSQL();
  const result = await sql`
    SELECT c.prompt_version, COUNT(*) as chats,
           AVG(r.rating)::numeric(3,2) as avg_rating,
           COUNT(DISTINCT r.session) as rated_sessions
    FROM chats c
    LEFT JOIN ratings r ON c.session = r.session
    WHERE c.prompt_version IS NOT NULL
    GROUP BY c.prompt_version
  `;
  var stats = {};
  result.forEach(function (r) {
    stats[r.prompt_version] = {
      chats: parseInt(r.chats),
      avgRating: parseFloat(r.avg_rating || "0"),
      ratedSessions: parseInt(r.rated_sessions)
    };
  });
  return stats;
}

async function getAlertData() {
  const sql = getSQL();
  // Last 24h vs previous 24h
  const current = await sql`
    SELECT COUNT(*) as total, COUNT(DISTINCT session) as sessions,
           COUNT(CASE WHEN category = 'error' THEN 1 END) as errors
    FROM chats WHERE ts > NOW() - INTERVAL '24 hours'
  `;
  const previous = await sql`
    SELECT COUNT(*) as total, COUNT(DISTINCT session) as sessions,
           COUNT(CASE WHEN category = 'error' THEN 1 END) as errors
    FROM chats WHERE ts > NOW() - INTERVAL '48 hours' AND ts <= NOW() - INTERVAL '24 hours'
  `;
  const escalations24h = await sql`
    SELECT COUNT(DISTINCT session) as count FROM chats
    WHERE ts > NOW() - INTERVAL '24 hours'
      AND (bot_msg ILIKE '%registrado tu incidencia%' OR bot_msg ILIKE '%info@burgerjazz%'
           OR bot_msg ILIKE '%no puedo resolver%')
  `;
  const avgRating24h = await sql`
    SELECT AVG(rating)::numeric(3,2) as avg, COUNT(*) as total FROM ratings
    WHERE ts > NOW() - INTERVAL '24 hours'
  `;
  const avgRatingPrev = await sql`
    SELECT AVG(rating)::numeric(3,2) as avg FROM ratings
    WHERE ts > NOW() - INTERVAL '48 hours' AND ts <= NOW() - INTERVAL '24 hours'
  `;
  return {
    current: { total: parseInt(current[0]?.total || 0), sessions: parseInt(current[0]?.sessions || 0), errors: parseInt(current[0]?.errors || 0) },
    previous: { total: parseInt(previous[0]?.total || 0), sessions: parseInt(previous[0]?.sessions || 0), errors: parseInt(previous[0]?.errors || 0) },
    escalations: parseInt(escalations24h[0]?.count || 0),
    rating: { avg: parseFloat(avgRating24h[0]?.avg || 0), total: parseInt(avgRating24h[0]?.total || 0) },
    ratingPrev: parseFloat(avgRatingPrev[0]?.avg || 0),
  };
}

// === KNOWLEDGE BASE ===
async function getKnowledgeSections() {
  const sql = getSQL();
  return await sql`SELECT section_key, title, content, updated_at, updated_by, version FROM knowledge_sections ORDER BY id ASC`;
}

async function upsertKnowledgeSection(key, title, content, updatedBy) {
  const sql = getSQL();
  // Save history first
  var existing = await sql`SELECT content, version FROM knowledge_sections WHERE section_key = ${key}`;
  var newVersion = existing.length > 0 ? (existing[0].version || 0) + 1 : 1;
  if (existing.length > 0) {
    await sql`INSERT INTO knowledge_history (section_key, content, updated_by, version) VALUES (${key}, ${existing[0].content}, ${updatedBy || 'system'}, ${existing[0].version || 0})`;
  }
  await sql`INSERT INTO knowledge_sections (section_key, title, content, updated_by, version, updated_at)
    VALUES (${key}, ${title}, ${content}, ${updatedBy || 'system'}, ${newVersion}, NOW())
    ON CONFLICT (section_key) DO UPDATE SET title = ${title}, content = ${content}, updated_by = ${updatedBy || 'system'}, version = ${newVersion}, updated_at = NOW()`;
}

async function getKnowledgeHistory(key, limit) {
  const sql = getSQL();
  return await sql`SELECT content, updated_at, updated_by, version FROM knowledge_history WHERE section_key = ${key} ORDER BY version DESC LIMIT ${limit || 10}`;
}

async function seedKnowledge(sections) {
  const sql = getSQL();
  var existing = await sql`SELECT COUNT(*) as c FROM knowledge_sections`;
  if (parseInt(existing[0].c) > 0) return;
  for (var i = 0; i < sections.length; i++) {
    var s = sections[i];
    await sql`INSERT INTO knowledge_sections (section_key, title, content, updated_by) VALUES (${s.key}, ${s.title}, ${s.content}, 'system')`;
  }
}

module.exports = { initDB, logChat, getStats, getSession, saveRating, getRatings, logIncident, getRecentConversations, saveInsight, getActiveInsights, deactivateOldInsights, saveSourceUpdate, getActiveSourceUpdate, getSQLInstance, cleanupOldChats, logFeedback, getFeedbackStats, resolveIncident, getIncidents, getABStats, getAlertData, updateIncidentNotes, getRatingsTrend, getSessionResolutionStats, getKnowledgeSections, upsertKnowledgeSection, getKnowledgeHistory, seedKnowledge };
