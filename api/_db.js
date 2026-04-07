const { neon } = require("@neondatabase/serverless");

let _sql;

function getSQL() {
  if (!_sql) {
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
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
}

async function logChat(sessionId, userMsg, botReply, category, tokens) {
  const sql = getSQL();
  const id = "c_" + Date.now() + "_" + Math.random().toString(36).slice(2, 5);
  try {
    await sql`
      INSERT INTO chats (id, session, user_msg, bot_msg, category, tokens_input, tokens_output)
      VALUES (${id}, ${sessionId}, ${userMsg}, ${botReply}, ${category},
              ${tokens?.input || 0}, ${tokens?.output || 0})
    `;
    // Borrar chats de mas de 1 año
    await sql`DELETE FROM chats WHERE ts < NOW() - INTERVAL '365 days'`;
  } catch (e) {
    console.error("DB log error:", e);
  }
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
      INSERT INTO incidents (session, name, email, description)
      VALUES (${sessionId}, ${data.name}, ${data.email}, ${data.description})
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

module.exports = { initDB, logChat, getStats, getSession, saveRating, getRatings, logIncident, getRecentConversations, saveInsight, getActiveInsights, deactivateOldInsights, saveSourceUpdate, getActiveSourceUpdate };
