// Cron: informe semanal del chatbot — lunes 8:00 UTC (10:00 Madrid)
// Genera el report internamente y envia email via Resend

const Anthropic = require("@anthropic-ai/sdk");
const { initDB, getRecentConversations, getRatings, getSQLInstance, getFeedbackStats, getRatingsTrend, getSessionResolutionStats } = require("./_db");

let dbReady = false;
let _dbInitPromise = null;

module.exports = async function handler(req, res) {
  var authHeader = req.headers["authorization"];
  if (authHeader !== "Bearer " + process.env.CRON_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }

  try {
    if (!dbReady) {
      if (!_dbInitPromise) _dbInitPromise = initDB();
      await _dbInitPromise;
      dbReady = true;
    }

    var sql = getSQLInstance();
    var days = 7;
    var prevDays = 14;
    var dayNames = ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"];

    // === QUERIES (same as report.js) ===
    var current = await sql`SELECT COUNT(*) as total, COUNT(DISTINCT session) as sessions, COALESCE(SUM(tokens_input),0) as tokens_in, COALESCE(SUM(tokens_output),0) as tokens_out FROM chats WHERE ts > NOW() - INTERVAL '7 days'`;
    var previous = await sql`SELECT COUNT(*) as total, COUNT(DISTINCT session) as sessions FROM chats WHERE ts > NOW() - INTERVAL '14 days' AND ts <= NOW() - INTERVAL '7 days'`;
    var cats = await sql`SELECT category, COUNT(*) as count FROM chats WHERE ts > NOW() - INTERVAL '7 days' GROUP BY category ORDER BY count DESC`;
    var daily = await sql`SELECT TO_CHAR(ts, 'YYYY-MM-DD') as day, EXTRACT(DOW FROM ts)::int as dow, COUNT(*) as count, COUNT(DISTINCT session) as sessions FROM chats WHERE ts > NOW() - INTERVAL '7 days' GROUP BY day, dow ORDER BY day`;
    var hours = await sql`SELECT EXTRACT(HOUR FROM ts)::int as hour, COUNT(*) as count FROM chats WHERE ts > NOW() - INTERVAL '7 days' GROUP BY hour ORDER BY hour`;
    var escalated = await sql`SELECT COUNT(DISTINCT session) as count FROM chats WHERE ts > NOW() - INTERVAL '7 days' AND (bot_msg ILIKE '%registrado tu incidencia%' OR bot_msg ILIKE '%he registrado tu%' OR bot_msg ILIKE '%queda registrad%' OR bot_msg ILIKE '%te contactara%' OR bot_msg ILIKE '%nos pondremos en contacto%' OR bot_msg ILIKE '%info@burgerjazz%' OR bot_msg ILIKE '%no puedo resolver%')`;
    var incidentsTotal = await sql`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'resolved') as resolved, COUNT(*) FILTER (WHERE status != 'resolved' OR status IS NULL) as pending FROM incidents WHERE ts > NOW() - INTERVAL '7 days'`;
    var agentSessions = await sql`SELECT COUNT(DISTINCT session) as count FROM chats WHERE ts > NOW() - INTERVAL '7 days' AND (prompt_version = 'ADMIN' OR user_msg = '[ADMIN]')`;
    var avgMsgs = await sql`SELECT AVG(mc)::numeric(4,1) as avg_msgs FROM (SELECT session, COUNT(*) as mc FROM chats WHERE ts > NOW() - INTERVAL '7 days' GROUP BY session) sub`;
    var longSessions = await sql`SELECT session, COUNT(*) as mc FROM chats WHERE ts > NOW() - INTERVAL '7 days' GROUP BY session HAVING COUNT(*) > 6 ORDER BY mc DESC LIMIT 10`;
    var frustratedSessions = await sql`SELECT DISTINCT session FROM chats WHERE ts > NOW() - INTERVAL '7 days' AND (user_msg ILIKE '%no me sirve%' OR user_msg ILIKE '%no funciona%' OR user_msg ILIKE '%no me ayuda%' OR user_msg ILIKE '%quiero hablar con%' OR user_msg ILIKE '%persona real%' OR user_msg ILIKE '%agente%' OR user_msg ILIKE '%no entiendes%') LIMIT 20`;
    var deliveryPropio = await sql`SELECT COUNT(DISTINCT session) as total FROM chats WHERE ts > NOW() - INTERVAL '7 days' AND (user_msg ILIKE '%pedidos.burgerjazz%' OR user_msg ILIKE '%delivery propio%' OR user_msg ILIKE '%vuestra web%' OR user_msg ILIKE '%vuestra pagina%' OR bot_msg ILIKE '%pedidos.burgerjazz.com%')`;
    var criticalOwn = await sql`SELECT COUNT(DISTINCT session) FILTER (WHERE user_msg ILIKE '%no llega%' OR user_msg ILIKE '%no ha llegado%' OR user_msg ILIKE '%donde esta mi pedido%') as pedido_no_llega, COUNT(DISTINCT session) FILTER (WHERE user_msg ILIKE '%cancelar%pedido%') as cancelar, COUNT(DISTINCT session) FILTER (WHERE user_msg ILIKE '%falta%' OR user_msg ILIKE '%incompleto%' OR user_msg ILIKE '%no viene%') as producto_faltante, COUNT(DISTINCT session) FILTER (WHERE user_msg ILIKE '%frio%' OR user_msg ILIKE '%mal estado%' OR user_msg ILIKE '%equivocado%') as calidad_producto FROM chats WHERE ts > NOW() - INTERVAL '7 days'`;

    var ratings = await getRatings();
    var feedback = await getFeedbackStats();

    // === BUILD SUMMARY ===
    var curTotal = parseInt(current[0]?.total || 0);
    var curSessions = parseInt(current[0]?.sessions || 0);
    var prevTotal = parseInt(previous[0]?.total || 0);
    var prevSessions = parseInt(previous[0]?.sessions || 0);
    var escCount = parseInt(escalated[0]?.count || 0);
    var incTotal = parseInt(incidentsTotal[0]?.total || 0);
    var incResolved = parseInt(incidentsTotal[0]?.resolved || 0);
    var incPending = parseInt(incidentsTotal[0]?.pending || 0);
    var agentCount = parseInt(agentSessions[0]?.count || 0);
    var resRate = curSessions > 0 ? Math.round(((curSessions - escCount) / curSessions) * 100) : 0;
    var tokensIn = parseInt(current[0]?.tokens_in || 0);
    var tokensOut = parseInt(current[0]?.tokens_out || 0);
    var estimatedCost = ((tokensIn / 1000000) * 0.8 + (tokensOut / 1000000) * 4).toFixed(4);

    var d = "PERIODO: Ultima semana (7 dias)\n\n";
    d += "=== METRICAS ===\n";
    d += "- Total mensajes: " + curTotal + " (anterior: " + prevTotal + ")\n";
    d += "- Sesiones: " + curSessions + " (anterior: " + prevSessions + ")\n";
    d += "- Media msgs/sesion: " + (avgMsgs[0]?.avg_msgs || "N/A") + "\n";
    d += "- Resolucion bot: " + resRate + "%\n";
    d += "- Escalaciones: " + escCount + "\n";
    d += "- Agente humano: " + agentCount + " sesiones\n";
    d += "- Coste: $" + estimatedCost + "\n\n";

    d += "=== ACTIVIDAD DIARIA ===\n";
    daily.forEach(function(r) { d += "- " + r.day + " (" + dayNames[r.dow] + "): " + r.count + " msgs, " + r.sessions + " sesiones\n"; });

    d += "\n=== CATEGORIAS ===\n";
    cats.forEach(function(c) { d += "- " + c.category + ": " + c.count + "\n"; });

    d += "\n=== INCIDENCIAS ===\n";
    d += "- Total: " + incTotal + " | Resueltas: " + incResolved + " | Pendientes: " + incPending + "\n";

    d += "\n=== SATISFACCION ===\n";
    d += "- Media: " + (ratings.average || "N/A") + "/5 (" + (ratings.total || 0) + " valoraciones)\n";
    d += "- Feedback: +" + (feedback.counts?.up || 0) + " / -" + (feedback.counts?.down || 0) + "\n";

    d += "\n=== FRUSTRACION ===\n";
    d += "- Sesiones largas (>6 msgs): " + longSessions.length + "\n";
    d += "- Frustracion explicita: " + frustratedSessions.length + "\n";

    d += "\n=== CANAL PROPIO ===\n";
    d += "- Sesiones delivery propio: " + (deliveryPropio[0]?.total || 0) + "\n";
    d += "- Pedido no llega: " + (criticalOwn[0]?.pedido_no_llega || 0) + "\n";
    d += "- Cancelaciones: " + (criticalOwn[0]?.cancelar || 0) + "\n";
    d += "- Producto faltante: " + (criticalOwn[0]?.producto_faltante || 0) + "\n";
    d += "- Calidad producto: " + (criticalOwn[0]?.calidad_producto || 0) + "\n";

    // === GENERATE REPORT WITH CLAUDE ===
    var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    var response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: "Eres un analista de datos del chatbot de BURGERJAZZ (cadena de hamburguesas en Madrid). Genera un informe semanal en HTML para email. Estructura: 1) Resumen ejecutivo (5 frases), 2) Metricas clave en tabla, 3) Canal propio (problemas criticos), 4) Satisfaccion, 5) Top 3 acciones recomendadas. Usa HTML: h2, p, table, tr, th, td, ul, li, strong, span. Colores: style=\"color:#16a34a\" (bueno), style=\"color:#dc2626\" (malo). Maximo 800 palabras. En espanol. Se directo y accionable.",
      messages: [{ role: "user", content: d }],
    });

    var reportHtml = response.content?.[0]?.text || "Error generando informe";

    // === DATE INFO ===
    var now = new Date();
    var weekStart = new Date(now); weekStart.setDate(now.getDate() - 7);
    var dateRange = weekStart.toISOString().slice(0, 10) + " al " + new Date(now.getTime() - 86400000).toISOString().slice(0, 10);

    // === SEND EMAIL ===
    var resendKey = (process.env.RESEND_API_KEY || "").replace(/^"|"$/g, "");
    if (!resendKey) {
      return res.status(500).json({ error: "RESEND_API_KEY missing" });
    }

    var emailHtml = '<div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto">'
      + '<div style="background:#002855;padding:20px;border-radius:12px 12px 0 0">'
      + '<h1 style="color:#fff;margin:0;font-size:22px">BURGERJAZZ CHATBOT</h1>'
      + '<p style="color:rgba(255,255,255,.7);margin:4px 0 0;font-size:13px">Informe Semanal — ' + dateRange + '</p>'
      + '</div>'
      + '<div style="background:#f9fafb;padding:16px;border:1px solid #e5e7eb">'
      + '<table style="width:100%;border-collapse:separate;border-spacing:6px;margin-bottom:16px">'
      + '<tr>'
      + '<td style="padding:10px;text-align:center;background:#EDE9FE;border-radius:8px"><b style="font-size:18px;color:#7C3AED">' + curSessions + '</b><br><span style="font-size:10px;color:#666">Sesiones</span></td>'
      + '<td style="padding:10px;text-align:center;background:#CCFBF1;border-radius:8px"><b style="font-size:18px;color:#0D9488">' + curTotal + '</b><br><span style="font-size:10px;color:#666">Mensajes</span></td>'
      + '<td style="padding:10px;text-align:center;background:#DCFCE7;border-radius:8px"><b style="font-size:18px;color:#16A34A">' + resRate + '%</b><br><span style="font-size:10px;color:#666">Resolucion</span></td>'
      + '<td style="padding:10px;text-align:center;background:' + (escCount > 5 ? "#FEE2E2" : "#DCFCE7") + ';border-radius:8px"><b style="font-size:18px;color:' + (escCount > 5 ? "#DC2626" : "#16A34A") + '">' + escCount + '</b><br><span style="font-size:10px;color:#666">Escalaciones</span></td>'
      + '<td style="padding:10px;text-align:center;background:' + (incPending > 0 ? "#FEF3C7" : "#DCFCE7") + ';border-radius:8px"><b style="font-size:18px;color:' + (incPending > 0 ? "#D97706" : "#16A34A") + '">' + incPending + '</b><br><span style="font-size:10px;color:#666">Inc. pendientes</span></td>'
      + '</tr></table>'
      + reportHtml
      + '</div>'
      + '<div style="background:#002855;padding:10px;border-radius:0 0 12px 12px;text-align:center">'
      + '<span style="color:rgba(255,255,255,.5);font-size:10px">Informe automatico semanal | ' + now.toISOString().slice(0, 16).replace("T", " ") + ' UTC</span>'
      + '</div></div>';

    var emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + resendKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "BurgerJazz Chatbot <informes@burgerjazz.com>",
        to: ["rodrigo@burgerjazz.com"],
        subject: "Informe Semanal Chatbot BJ — " + dateRange + " — " + curSessions + " sesiones, " + resRate + "% resolucion",
        html: emailHtml,
      }),
    });

    var emailResult = await emailRes.json();

    return res.status(200).json({
      status: "ok",
      period: dateRange,
      sessions: curSessions,
      messages: curTotal,
      resolution: resRate + "%",
      escalations: escCount,
      email: emailResult.id ? "sent" : "failed",
    });
  } catch (err) {
    console.error("Cron report error:", err);
    return res.status(500).json({ error: err.message });
  }
};
