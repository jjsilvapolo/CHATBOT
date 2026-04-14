const Anthropic = require("@anthropic-ai/sdk");
const { initDB, getRecentConversations, getRatings, getSQLInstance } = require("./_db");

let dbReady = false;
let _dbInitPromise = null;

module.exports = async function handler(req, res) {
  var origin = req.headers.origin || "";
  var allowed = "https://burgerjazz-chatbot.vercel.app";
  if (origin === allowed || /^https:\/\/burgerjazz-chatbot[a-z0-9-]*\.vercel\.app$/.test(origin)) allowed = origin;
  if (origin === "http://localhost:3000" || origin === "http://localhost:5500") allowed = origin;
  res.setHeader("Access-Control-Allow-Origin", allowed);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const authKey = process.env.DASHBOARD_KEY;
  const providedKey = req.query?.key || req.headers.authorization?.replace("Bearer ", "");
  if (!authKey || providedKey !== authKey) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!dbReady) {
    if (!_dbInitPromise) _dbInitPromise = initDB();
    await _dbInitPromise;
    dbReady = true;
  }

  const period = req.query?.period || "weekly"; // weekly or monthly
  const days = period === "monthly" ? 30 : 7;
  const prevDays = days * 2; // for comparison

  try {
    const sql = getSQLInstance();

    // Current period stats
    const current = await sql`
      SELECT COUNT(*) as total,
             COUNT(DISTINCT session) as sessions,
             COALESCE(SUM(tokens_input),0) as tokens_in,
             COALESCE(SUM(tokens_output),0) as tokens_out
      FROM chats WHERE ts > NOW() - INTERVAL '1 day' * ${days}
    `;

    // Previous period stats
    const previous = await sql`
      SELECT COUNT(*) as total, COUNT(DISTINCT session) as sessions
      FROM chats WHERE ts > NOW() - INTERVAL '1 day' * ${prevDays}
        AND ts <= NOW() - INTERVAL '1 day' * ${days}
    `;

    // Categories this period
    const cats = await sql`
      SELECT category, COUNT(*) as count
      FROM chats WHERE ts > NOW() - INTERVAL '1 day' * ${days}
      GROUP BY category ORDER BY count DESC
    `;

    // Daily breakdown
    const daily = await sql`
      SELECT TO_CHAR(ts, 'YYYY-MM-DD') as day, COUNT(*) as count
      FROM chats WHERE ts > NOW() - INTERVAL '1 day' * ${days}
      GROUP BY day ORDER BY day
    `;

    // Peak hours
    const hours = await sql`
      SELECT EXTRACT(HOUR FROM ts)::int as hour, COUNT(*) as count
      FROM chats WHERE ts > NOW() - INTERVAL '1 day' * ${days}
      GROUP BY hour ORDER BY count DESC LIMIT 3
    `;

    // Escalations (synced with chat.js escalation logic)
    const escalated = await sql`
      SELECT COUNT(DISTINCT session) as count FROM chats
      WHERE ts > NOW() - INTERVAL '1 day' * ${days}
        AND (bot_msg ILIKE '%registrado tu incidencia%'
          OR bot_msg ILIKE '%he registrado tu%'
          OR bot_msg ILIKE '%queda registrad%'
          OR bot_msg ILIKE '%te contactara%'
          OR bot_msg ILIKE '%nos pondremos en contacto%'
          OR bot_msg ILIKE '%info@burgerjazz%'
          OR bot_msg ILIKE '%no puedo resolver%')
    `;

    // Incidents
    const incidents = await sql`
      SELECT COUNT(*) as count FROM incidents
      WHERE ts > NOW() - INTERVAL '1 day' * ${days}
    `;

    // Ratings
    const ratings = await getRatings();

    // Get sample conversations (low rated + escalated)
    const conversations = await getRecentConversations(days);

    // Group conversations by session for analysis
    const sessionMap = {};
    conversations.forEach(function (r) {
      if (!sessionMap[r.session]) sessionMap[r.session] = { msgs: [], rating: r.rating, cats: [] };
      sessionMap[r.session].msgs.push("CLIENTE: " + r.user_msg + "\nBOT: " + r.bot_msg);
      if (r.rating) sessionMap[r.session].rating = r.rating;
      if (r.category) sessionMap[r.session].cats.push(r.category);
    });

    // Select interesting sessions for analysis (low rated, escalated, incidents)
    var interestingSessions = [];
    Object.keys(sessionMap).forEach(function (sid) {
      var s = sessionMap[sid];
      if (s.rating && s.rating <= 2) interestingSessions.push(s);
      else if (s.cats.indexOf("incidencia") !== -1 || s.cats.indexOf("pedido_incompleto") !== -1) interestingSessions.push(s);
    });

    // Build data summary for Claude
    var curTotal = parseInt(current[0]?.total || 0);
    var curSessions = parseInt(current[0]?.sessions || 0);
    var prevTotal = parseInt(previous[0]?.total || 0);
    var prevSessions = parseInt(previous[0]?.sessions || 0);
    var escCount = parseInt(escalated[0]?.count || 0);
    var incCount = parseInt(incidents[0]?.count || 0);
    var resRate = curSessions > 0 ? Math.round(((curSessions - escCount) / curSessions) * 100) : 0;

    var dataSummary = "PERIODO: " + (period === "monthly" ? "Ultimo mes (30 dias)" : "Ultima semana (7 dias)") + "\n\n";
    dataSummary += "METRICAS PRINCIPALES:\n";
    dataSummary += "- Total mensajes: " + curTotal + " (periodo anterior: " + prevTotal + ")\n";
    dataSummary += "- Sesiones unicas: " + curSessions + " (anterior: " + prevSessions + ")\n";
    dataSummary += "- Tasa de resolucion: " + resRate + "%\n";
    dataSummary += "- Escalaciones: " + escCount + "\n";
    dataSummary += "- Incidencias registradas: " + incCount + "\n";
    dataSummary += "- Satisfaccion media: " + (ratings.average || "N/A") + "/5 (" + (ratings.total || 0) + " valoraciones)\n\n";

    dataSummary += "CATEGORIAS:\n";
    cats.forEach(function (c) { dataSummary += "- " + c.category + ": " + c.count + "\n"; });

    dataSummary += "\nACTIVIDAD DIARIA:\n";
    daily.forEach(function (d) { dataSummary += "- " + d.day + ": " + d.count + " msgs\n"; });

    dataSummary += "\nHORAS PUNTA:\n";
    hours.forEach(function (h) { dataSummary += "- " + h.hour + ":00h: " + h.count + " msgs\n"; });

    if (interestingSessions.length > 0) {
      dataSummary += "\nCONVERSACIONES PROBLEMATICAS (muestra):\n";
      interestingSessions.slice(0, 5).forEach(function (s, i) {
        dataSummary += "\n--- Caso " + (i + 1) + (s.rating ? " [Rating: " + s.rating + "/5]" : "") + " ---\n";
        dataSummary += s.msgs.slice(0, 6).join("\n") + "\n";
      });
    }

    // Generate report with Claude
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      system: `Genera un informe ${period === "monthly" ? "mensual" : "semanal"} profesional del chatbot de BURGERJAZZ. El informe es para el equipo directivo.

Estructura del informe usando EXACTAMENTE estas etiquetas HTML:

<h2>1. RESUMEN EJECUTIVO</h2>
<p>2-3 frases con lo mas importante del periodo.</p>

<h2>2. METRICAS CLAVE</h2>
Usa una tabla HTML asi:
<table>
<tr><th>Metrica</th><th>Actual</th><th>Anterior</th><th>Variacion</th></tr>
<tr><td>Mensajes totales</td><td>X</td><td>Y</td><td>+Z%</td></tr>
...una fila por cada metrica importante...
</table>

<h2>3. ANALISIS DE CATEGORIAS</h2>
<p>Que consultan los clientes, tendencias. Usa otra tabla si hay varias categorias.</p>

<h2>4. INCIDENCIAS Y ESCALACIONES</h2>
<p>Resumen de problemas detectados.</p>

<h2>5. SATISFACCION DEL CLIENTE</h2>
<p>Nota media, tendencia.</p>

<h2>6. PUNTOS DE MEJORA</h2>
<p>Recomendaciones concretas basadas en los datos. Usa <ul><li> para listar.</p>

<h2>7. CONCLUSIONES</h2>
<p>Cierre breve.</p>

REGLAS:
- Profesional pero directo
- Usa datos concretos, no generalidades
- Incluye porcentajes de variacion vs periodo anterior donde sea posible
- Maximo 700 palabras
- SOLO HTML basico: h2, p, table, tr, th, td, ul, li, strong. Nada de markdown.
- En espanol`,
      messages: [{ role: "user", content: dataSummary }],
    });

    const reportText = response.content?.[0]?.text || "Error generando informe";

    return res.status(200).json({
      status: "ok",
      period: period,
      report: reportText,
      data: {
        total_messages: curTotal,
        prev_messages: prevTotal,
        sessions: curSessions,
        prev_sessions: prevSessions,
        resolution_rate: resRate,
        escalations: escCount,
        incidents: incCount,
        satisfaction: ratings.average || 0,
        categories: cats.map(function (c) { return { name: c.category, count: parseInt(c.count) }; }),
      },
      tokens: {
        input: response.usage?.input_tokens || 0,
        output: response.usage?.output_tokens || 0,
      },
    });
  } catch (err) {
    console.error("Report error:", err);
    return res.status(500).json({ error: err.message });
  }
};
