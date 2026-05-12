const Anthropic = require("@anthropic-ai/sdk");
const { initDB, getRecentConversations, getRatings, getSQLInstance, getFeedbackStats, getRatingsTrend, getSessionResolutionStats, getIncidents } = require("./_db");

let dbReady = false;
let _dbInitPromise = null;

module.exports = async function handler(req, res) {
  var origin = req.headers.origin || "";
  var allowed = "https://bot.burgerjazz.com";
  if (origin === "https://bot.burgerjazz.com") allowed = origin;
  else if (origin === "https://burgerjazz-chatbot.vercel.app" || /^https:\/\/burgerjazz-chatbot[a-z0-9-]*\.vercel\.app$/.test(origin)) allowed = origin;
  else if (origin === "http://localhost:3000" || origin === "http://localhost:5500") allowed = origin;
  res.setHeader("Access-Control-Allow-Origin", allowed);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const providedKey = req.query?.key || req.headers.authorization?.replace("Bearer ", "");
  function validateKey(rawKey) {
    if (!rawKey) return false;
    var parts = rawKey.split(":");
    if (parts.length >= 2) {
      try { var users = JSON.parse(process.env.DASHBOARD_USERS || "{}"); if (users[parts[0]] && users[parts[0]] === parts.slice(1).join(":")) return true; } catch(e) {}
    }
    if (rawKey === process.env.DASHBOARD_KEY) return true;
    return false;
  }
  if (!validateKey(providedKey)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!dbReady) {
    if (!_dbInitPromise) _dbInitPromise = initDB();
    await _dbInitPromise;
    dbReady = true;
  }

  const period = req.query?.period || "weekly";
  const days = period === "monthly" ? 30 : 7;
  const prevDays = days * 2;

  try {
    const sql = getSQLInstance();

    // === 1. VOLUME & COMPARISON ===
    const current = await sql`
      SELECT COUNT(*) as total,
             COUNT(DISTINCT session) as sessions,
             COALESCE(SUM(tokens_input),0) as tokens_in,
             COALESCE(SUM(tokens_output),0) as tokens_out
      FROM chats WHERE ts > NOW() - INTERVAL '1 day' * ${days}
    `;
    const previous = await sql`
      SELECT COUNT(*) as total, COUNT(DISTINCT session) as sessions
      FROM chats WHERE ts > NOW() - INTERVAL '1 day' * ${prevDays}
        AND ts <= NOW() - INTERVAL '1 day' * ${days}
    `;

    // === 2. CATEGORIES ===
    const cats = await sql`
      SELECT category, COUNT(*) as count
      FROM chats WHERE ts > NOW() - INTERVAL '1 day' * ${days}
      GROUP BY category ORDER BY count DESC
    `;

    // === 3. DAILY + HOURLY ===
    const daily = await sql`
      SELECT TO_CHAR(ts, 'YYYY-MM-DD') as day,
             EXTRACT(DOW FROM ts)::int as dow,
             COUNT(*) as count,
             COUNT(DISTINCT session) as sessions
      FROM chats WHERE ts > NOW() - INTERVAL '1 day' * ${days}
      GROUP BY day, dow ORDER BY day
    `;
    const hours = await sql`
      SELECT EXTRACT(HOUR FROM ts)::int as hour, COUNT(*) as count
      FROM chats WHERE ts > NOW() - INTERVAL '1 day' * ${days}
      GROUP BY hour ORDER BY hour
    `;

    // === 4. ESCALATIONS ===
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

    // === 5. INCIDENTS (resolved vs pending + detail) ===
    const incidentsTotal = await sql`
      SELECT COUNT(*) as total,
             COUNT(*) FILTER (WHERE status = 'resolved') as resolved,
             COUNT(*) FILTER (WHERE status != 'resolved' OR status IS NULL) as pending
      FROM incidents WHERE ts > NOW() - INTERVAL '1 day' * ${days}
    `;
    const incidentTypes = await sql`
      SELECT description, name, phone, status, ts
      FROM incidents WHERE ts > NOW() - INTERVAL '1 day' * ${days}
      ORDER BY ts DESC LIMIT 20
    `;

    // === 6. SATISFACTION ===
    const ratings = await getRatings();
    const ratingsTrend = await getRatingsTrend();
    const feedback = await getFeedbackStats();

    // === 7. RESOLUTION ===
    const resolution = await getSessionResolutionStats();
    const agentSessions = await sql`
      SELECT COUNT(DISTINCT session) as count FROM chats
      WHERE ts > NOW() - INTERVAL '1 day' * ${days}
        AND (prompt_version = 'ADMIN' OR user_msg = '[ADMIN]')
    `;
    const avgMsgs = await sql`
      SELECT AVG(mc)::numeric(4,1) as avg_msgs FROM (
        SELECT session, COUNT(*) as mc FROM chats
        WHERE ts > NOW() - INTERVAL '1 day' * ${days}
        GROUP BY session
      ) sub
    `;

    // === 8. FRUSTRATION PATTERNS ===

    // Long sessions (>6 msgs) = potential frustration
    const longSessions = await sql`
      SELECT session, COUNT(*) as mc FROM chats
      WHERE ts > NOW() - INTERVAL '1 day' * ${days}
      GROUP BY session HAVING COUNT(*) > 6
      ORDER BY mc DESC LIMIT 10
    `;

    // Repeated questions in same session (user asks similar thing twice)
    const repeatedQuestions = await sql`
      SELECT session, COUNT(*) as repeats FROM (
        SELECT session, LOWER(SUBSTRING(user_msg FROM 1 FOR 40)) as q,
               COUNT(*) as cnt
        FROM chats
        WHERE ts > NOW() - INTERVAL '1 day' * ${days}
          AND user_msg IS NOT NULL AND LENGTH(user_msg) > 10
        GROUP BY session, q
        HAVING COUNT(*) > 1
      ) sub
      GROUP BY session ORDER BY repeats DESC LIMIT 10
    `;

    // Unanswered needs: sessions that ended with user message (bot didn't solve it)
    const abandonedSessions = await sql`
      SELECT COUNT(DISTINCT sub.session) as count FROM (
        SELECT session,
               LAST_VALUE(user_msg) OVER (PARTITION BY session ORDER BY ts ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) as last_user,
               LAST_VALUE(bot_msg) OVER (PARTITION BY session ORDER BY ts ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) as last_bot,
               COUNT(*) OVER (PARTITION BY session) as mc
        FROM chats WHERE ts > NOW() - INTERVAL '1 day' * ${days}
      ) sub
      WHERE sub.mc >= 2
        AND sub.last_bot IS NOT NULL
        AND (sub.last_bot ILIKE '%no puedo%'
          OR sub.last_bot ILIKE '%no tengo informacion%'
          OR sub.last_bot ILIKE '%contacta directamente%'
          OR sub.last_bot ILIKE '%no dispongo%'
          OR sub.last_bot ILIKE '%lo siento%no%')
      LIMIT 1
    `;

    // Categories with worst satisfaction (low ratings by category)
    const catSatisfaction = await sql`
      SELECT c.category, AVG(r.rating)::numeric(3,2) as avg_rating, COUNT(r.id) as ratings_count
      FROM chats c
      JOIN ratings r ON c.session = r.session
      WHERE c.ts > NOW() - INTERVAL '1 day' * ${days}
        AND c.category IS NOT NULL
      GROUP BY c.category
      HAVING COUNT(r.id) >= 2
      ORDER BY avg_rating ASC
    `;

    // Most common user intents that lead to escalation
    const escalationTriggers = await sql`
      SELECT c1.category, c1.user_msg
      FROM chats c1
      WHERE c1.ts > NOW() - INTERVAL '1 day' * ${days}
        AND c1.session IN (
          SELECT DISTINCT session FROM chats
          WHERE ts > NOW() - INTERVAL '1 day' * ${days}
            AND (bot_msg ILIKE '%registrado tu incidencia%'
              OR bot_msg ILIKE '%info@burgerjazz%'
              OR bot_msg ILIKE '%no puedo resolver%')
        )
        AND c1.user_msg IS NOT NULL
        AND c1.category != 'general'
      ORDER BY c1.ts ASC
      LIMIT 30
    `;

    // Peak frustration hours: escalations by hour
    const escalationHours = await sql`
      SELECT EXTRACT(HOUR FROM ts)::int as hour, COUNT(DISTINCT session) as esc_count
      FROM chats
      WHERE ts > NOW() - INTERVAL '1 day' * ${days}
        AND (bot_msg ILIKE '%registrado tu incidencia%'
          OR bot_msg ILIKE '%info@burgerjazz%'
          OR bot_msg ILIKE '%no puedo resolver%')
      GROUP BY hour ORDER BY esc_count DESC LIMIT 5
    `;

    // === 9. CANAL PROPIO: delivery propio, pedidos web, incidencias criticas ===

    // Delivery propio issues (pedidos.burgerjazz.com)
    const deliveryPropio = await sql`
      SELECT COUNT(DISTINCT session) as total FROM chats
      WHERE ts > NOW() - INTERVAL '1 day' * ${days}
        AND (user_msg ILIKE '%pedidos.burgerjazz%'
          OR user_msg ILIKE '%delivery propio%'
          OR user_msg ILIKE '%vuestra web%'
          OR user_msg ILIKE '%vuestra pagina%'
          OR user_msg ILIKE '%por la web%'
          OR bot_msg ILIKE '%pedidos.burgerjazz.com%')
    `;

    // Glovo/Uber redirections (for comparison — these are NOT our problem)
    const deliveryExterno = await sql`
      SELECT COUNT(DISTINCT session) as total FROM chats
      WHERE ts > NOW() - INTERVAL '1 day' * ${days}
        AND (user_msg ILIKE '%glovo%' OR user_msg ILIKE '%uber%'
          OR bot_msg ILIKE '%app de Glovo%' OR bot_msg ILIKE '%app de Uber%')
    `;

    // Critical own-channel issues (the 4 escalation cases)
    const criticalOwn = await sql`
      SELECT
        COUNT(DISTINCT session) FILTER (WHERE user_msg ILIKE '%no llega%' OR user_msg ILIKE '%no ha llegado%' OR user_msg ILIKE '%donde esta mi pedido%' OR user_msg ILIKE '%lleva%esperando%' OR user_msg ILIKE '%tarda%') as pedido_no_llega,
        COUNT(DISTINCT session) FILTER (WHERE user_msg ILIKE '%cancelar%pedido%' OR user_msg ILIKE '%quiero cancelar%') as cancelar,
        COUNT(DISTINCT session) FILTER (WHERE user_msg ILIKE '%cambiar%direccion%' OR user_msg ILIKE '%direccion%equivocad%' OR user_msg ILIKE '%me he equivocado%direccion%') as cambio_direccion,
        COUNT(DISTINCT session) FILTER (WHERE user_msg ILIKE '%modificar%pedido%' OR user_msg ILIKE '%anadir%' OR user_msg ILIKE '%quitar%' OR user_msg ILIKE '%cambiar%pedido%') as modificar_pedido,
        COUNT(DISTINCT session) FILTER (WHERE user_msg ILIKE '%falta%' OR user_msg ILIKE '%incompleto%' OR user_msg ILIKE '%no viene%' OR user_msg ILIKE '%no vino%' OR user_msg ILIKE '%faltaba%') as producto_faltante,
        COUNT(DISTINCT session) FILTER (WHERE user_msg ILIKE '%frio%' OR user_msg ILIKE '%mal estado%' OR user_msg ILIKE '%equivocado%' OR user_msg ILIKE '%no es lo que%') as calidad_producto
      FROM chats
      WHERE ts > NOW() - INTERVAL '1 day' * ${days}
    `;

    // Own channel: time from first message to escalation (response time proxy)
    const escalationSpeed = await sql`
      SELECT session,
             MIN(ts) as first_msg,
             MAX(ts) FILTER (WHERE bot_msg ILIKE '%DATOS RECOGIDOS%' OR bot_msg ILIKE '%Le paso con un agente%') as escalation_ts
      FROM chats
      WHERE ts > NOW() - INTERVAL '1 day' * ${days}
      GROUP BY session
      HAVING MAX(ts) FILTER (WHERE bot_msg ILIKE '%DATOS RECOGIDOS%' OR bot_msg ILIKE '%Le paso con un agente%') IS NOT NULL
    `;
    var avgEscalationMins = 0;
    if (escalationSpeed.length > 0) {
      var totalMins = 0;
      escalationSpeed.forEach(function(r) {
        totalMins += (new Date(r.escalation_ts) - new Date(r.first_msg)) / 60000;
      });
      avgEscalationMins = (totalMins / escalationSpeed.length).toFixed(1);
    }

    // Own channel: incidents by time of day (when do problems happen?)
    const incidentHours = await sql`
      SELECT EXTRACT(HOUR FROM ts)::int as hour, COUNT(*) as count
      FROM incidents WHERE ts > NOW() - INTERVAL '1 day' * ${days}
      GROUP BY hour ORDER BY count DESC
    `;

    // Own channel: repeat complainers (same phone/name in multiple incidents)
    const repeatComplainers = await sql`
      SELECT phone, name, COUNT(*) as incidents
      FROM incidents
      WHERE ts > NOW() - INTERVAL '1 day' * ${days}
        AND phone IS NOT NULL AND phone != 'No proporcionado'
      GROUP BY phone, name
      HAVING COUNT(*) > 1
      ORDER BY incidents DESC LIMIT 5
    `;

    // Sessions where user explicitly expressed frustration
    const frustratedSessions = await sql`
      SELECT DISTINCT session FROM chats
      WHERE ts > NOW() - INTERVAL '1 day' * ${days}
        AND (user_msg ILIKE '%no me sirve%'
          OR user_msg ILIKE '%no funciona%'
          OR user_msg ILIKE '%no me ayuda%'
          OR user_msg ILIKE '%quiero hablar con%'
          OR user_msg ILIKE '%persona real%'
          OR user_msg ILIKE '%agente%'
          OR user_msg ILIKE '%esto es ridiculo%'
          OR user_msg ILIKE '%mala experiencia%'
          OR user_msg ILIKE '%no entiendes%'
          OR user_msg ILIKE '%ya te lo he dicho%'
          OR user_msg ILIKE '%otra vez%lo mismo%')
      LIMIT 20
    `;

    // === 9. SAMPLE CONVERSATIONS ===
    const conversations = await getRecentConversations(days);
    const sessionMap = {};
    conversations.forEach(function (r) {
      if (!sessionMap[r.session]) sessionMap[r.session] = { msgs: [], rating: r.rating, cats: [], sid: r.session };
      sessionMap[r.session].msgs.push("CLIENTE: " + r.user_msg + "\nBOT: " + r.bot_msg);
      if (r.rating) sessionMap[r.session].rating = r.rating;
      if (r.category) sessionMap[r.session].cats.push(r.category);
    });

    // Interesting = low rated + escalated + frustrated
    var frustratedSet = new Set(frustratedSessions.map(function(r){return r.session}));
    var interestingSessions = [];
    Object.keys(sessionMap).forEach(function (sid) {
      var s = sessionMap[sid];
      s.frustrated = frustratedSet.has(sid);
      if (s.rating && s.rating <= 2) { s.reason = "Valoracion baja (" + s.rating + "/5)"; interestingSessions.push(s); }
      else if (s.frustrated) { s.reason = "Cliente frustrado (expresion explicita)"; interestingSessions.push(s); }
      else if (s.cats.indexOf("incidencia") !== -1 || s.cats.indexOf("pedido_incompleto") !== -1) { s.reason = "Incidencia/problema"; interestingSessions.push(s); }
    });

    // === BUILD DATA SUMMARY ===
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
    var costPerSession = curSessions > 0 ? ((tokensIn / 1000000 * 0.8 + tokensOut / 1000000 * 4) / curSessions * 100).toFixed(2) : "0";
    var dayNames = ["Dom","Lun","Mar","Mie","Jue","Vie","Sab"];

    var d = "PERIODO: " + (period === "monthly" ? "Ultimo mes (30 dias)" : "Ultima semana (7 dias)") + "\n\n";

    d += "=== METRICAS PRINCIPALES ===\n";
    d += "- Total mensajes: " + curTotal + " (anterior: " + prevTotal + ", variacion: " + (prevTotal > 0 ? ((curTotal - prevTotal) / prevTotal * 100).toFixed(1) + "%" : "N/A") + ")\n";
    d += "- Sesiones unicas: " + curSessions + " (anterior: " + prevSessions + ", variacion: " + (prevSessions > 0 ? ((curSessions - prevSessions) / prevSessions * 100).toFixed(1) + "%" : "N/A") + ")\n";
    d += "- Media mensajes/sesion: " + (avgMsgs[0]?.avg_msgs || "N/A") + "\n";
    d += "- Resolucion por bot (sin humano): " + resRate + "%\n";
    d += "- Escalaciones: " + escCount + " (" + (curSessions > 0 ? (escCount / curSessions * 100).toFixed(1) : 0) + "% de sesiones)\n";
    d += "- Sesiones con agente humano: " + agentCount + "\n";
    d += "- Coste periodo: $" + estimatedCost + " (~" + costPerSession + " centavos/sesion)\n\n";

    d += "=== ACTIVIDAD DIARIA ===\n";
    daily.forEach(function(r) { d += "- " + r.day + " (" + dayNames[r.dow] + "): " + r.count + " msgs, " + r.sessions + " sesiones\n"; });

    d += "\n=== DISTRIBUCION HORARIA ===\n";
    hours.forEach(function(h) { d += "- " + h.hour + ":00h: " + h.count + " msgs\n"; });

    d += "\n=== CATEGORIAS ===\n";
    cats.forEach(function(c) {
      var pct = curTotal > 0 ? (parseInt(c.count) / curTotal * 100).toFixed(1) : 0;
      d += "- " + c.category + ": " + c.count + " (" + pct + "%)\n";
    });

    d += "\n=== SATISFACCION POR CATEGORIA ===\n";
    if (catSatisfaction.length > 0) {
      catSatisfaction.forEach(function(c) { d += "- " + c.category + ": " + c.avg_rating + "/5 (" + c.ratings_count + " valoraciones)\n"; });
    } else { d += "- Sin datos suficientes\n"; }

    d += "\n=== INCIDENCIAS ===\n";
    d += "- Total: " + incTotal + " | Resueltas: " + incResolved + " | Pendientes: " + incPending + "\n";
    if (incidentTypes.length > 0) {
      d += "- Detalle:\n";
      incidentTypes.forEach(function(inc) {
        d += "  * [" + (inc.status || "pendiente") + "] " + (inc.description || "Sin descripcion").slice(0, 120) + "\n";
      });
    }

    d += "\n=== SATISFACCION GLOBAL ===\n";
    d += "- Media: " + (ratings.average || "N/A") + "/5 (" + (ratings.total || 0) + " valoraciones)\n";
    d += "- Distribucion: " + JSON.stringify(ratings.distribution || {}) + "\n";
    if (ratingsTrend.length > 0) {
      d += "- Tendencia diaria:\n";
      ratingsTrend.forEach(function(r) { d += "  " + r.day + ": " + r.avg + "/5 (" + r.count + " val)\n"; });
    }

    d += "\n=== FEEDBACK (pulgar arriba/abajo) ===\n";
    d += "- Positivos: " + (feedback.counts?.up || 0) + ", Negativos: " + (feedback.counts?.down || 0) + "\n";
    if (feedback.byCategory && Object.keys(feedback.byCategory).length > 0) {
      d += "- Por categoria:\n";
      Object.keys(feedback.byCategory).forEach(function(cat) {
        var f = feedback.byCategory[cat];
        d += "  " + cat + ": +" + (f.up || 0) + " / -" + (f.down || 0) + "\n";
      });
    }

    d += "\n=== RESOLUCION DE SESIONES ===\n";
    d += "- Total sesiones (historico): " + resolution.totalSessions + "\n";
    d += "- Resueltas por bot: " + resolution.resolvedSessions + "\n";
    d += "- Resolucion rapida (1-2 msgs): " + resolution.quickResolved + " (" + resolution.quickResolvedPct + "%)\n";
    d += "- Media msgs/sesion (historico): " + resolution.avgMsgsPerSession + "\n";

    d += "\n=== PATRONES DE FRUSTRACION ===\n";
    d += "- Sesiones largas (>6 msgs, posible frustracion): " + longSessions.length + "\n";
    if (longSessions.length > 0) {
      d += "  Top: " + longSessions.slice(0, 5).map(function(s) { return s.session.slice(0, 12) + " (" + s.mc + " msgs)"; }).join(", ") + "\n";
    }
    d += "- Sesiones con preguntas repetidas: " + repeatedQuestions.length + "\n";
    d += "- Sesiones con frustracion explicita del cliente: " + frustratedSessions.length + "\n";
    d += "- Sesiones donde el bot no pudo resolver: " + (abandonedSessions[0]?.count || 0) + "\n";

    if (escalationHours.length > 0) {
      d += "- Horas con mas escalaciones:\n";
      escalationHours.forEach(function(h) { d += "  " + h.hour + ":00h: " + h.esc_count + " escalaciones\n"; });
    }

    if (escalationTriggers.length > 0) {
      d += "- Temas que provocan escalacion:\n";
      var triggerCats = {};
      escalationTriggers.forEach(function(t) {
        if (t.category) triggerCats[t.category] = (triggerCats[t.category] || 0) + 1;
      });
      Object.keys(triggerCats).sort(function(a, b) { return triggerCats[b] - triggerCats[a]; }).forEach(function(cat) {
        d += "  " + cat + ": " + triggerCats[cat] + " mensajes pre-escalacion\n";
      });
      d += "- Ejemplos de mensajes que llevan a escalacion:\n";
      escalationTriggers.slice(0, 8).forEach(function(t) {
        d += '  "' + (t.user_msg || "").slice(0, 80) + '" [' + (t.category || "general") + ']\n';
      });
    }

    d += "\n=== CANAL PROPIO (pedidos.burgerjazz.com) — SECCION CRITICA ===\n";
    d += "- Sesiones relacionadas con delivery propio: " + (deliveryPropio[0]?.total || 0) + "\n";
    d += "- Sesiones sobre Glovo/Uber (redirigidas, NO son nuestro problema): " + (deliveryExterno[0]?.total || 0) + "\n";
    d += "- Problemas criticos canal propio:\n";
    d += "  * Pedido no llega / tarda mucho: " + (criticalOwn[0]?.pedido_no_llega || 0) + " sesiones\n";
    d += "  * Cancelar pedido: " + (criticalOwn[0]?.cancelar || 0) + " sesiones\n";
    d += "  * Cambio de direccion: " + (criticalOwn[0]?.cambio_direccion || 0) + " sesiones\n";
    d += "  * Modificar pedido: " + (criticalOwn[0]?.modificar_pedido || 0) + " sesiones\n";
    d += "  * Producto faltante / incompleto: " + (criticalOwn[0]?.producto_faltante || 0) + " sesiones\n";
    d += "  * Calidad producto (frio, equivocado, mal estado): " + (criticalOwn[0]?.calidad_producto || 0) + " sesiones\n";
    d += "- Tiempo medio hasta escalacion (bot recoge datos y pasa a agente): " + avgEscalationMins + " minutos\n";
    d += "- Escalaciones totales del periodo: " + escalationSpeed.length + "\n";
    if (incidentHours.length > 0) {
      d += "- Horas con mas incidencias:\n";
      incidentHours.slice(0, 5).forEach(function(h) { d += "  " + h.hour + ":00h: " + h.count + " incidencias\n"; });
    }
    if (repeatComplainers.length > 0) {
      d += "- Clientes recurrentes (misma persona, multiples incidencias):\n";
      repeatComplainers.forEach(function(r) {
        d += "  " + (r.name || "Anonimo") + " (tel: " + (r.phone || "?").slice(-4) + "): " + r.incidents + " incidencias\n";
      });
    }

    if (interestingSessions.length > 0) {
      d += "\n=== CONVERSACIONES PROBLEMATICAS (muestra detallada) ===\n";
      interestingSessions.slice(0, 8).forEach(function(s, i) {
        d += "\n--- Caso " + (i + 1) + " | " + s.reason + " ---\n";
        d += "Categorias: " + (s.cats.length ? [...new Set(s.cats)].join(", ") : "N/A") + "\n";
        d += s.msgs.slice(0, 8).join("\n") + "\n";
      });
    }

    // === GENERATE REPORT ===
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 5000,
      system: `Eres un analista de datos experto en experiencia de cliente y operaciones de delivery. Genera un informe ${period === "monthly" ? "mensual" : "semanal"} del chatbot de BURGERJAZZ (cadena de hamburguesas en Madrid, 10+ locales, delivery propio via pedidos.burgerjazz.com).

CONTEXTO CLAVE DEL NEGOCIO:
- BurgerJazz tiene DELIVERY PROPIO (pedidos.burgerjazz.com) en Chamberi, Retiro, Delicias, Plaza Espana y Mirasierra. Este es su CANAL PROPIO donde la experiencia depende 100% de ellos.
- Tambien venden en Glovo y Uber Eats, pero esos problemas los gestiona la plataforma, NO BurgerJazz.
- Los PROBLEMAS CRITICOS del canal propio son: pedido no llega, cancelaciones, cambios de direccion, modificaciones, producto faltante, calidad del producto.
- Cuando un cliente tiene un problema critico con delivery propio, el bot recoge datos (pedido, nombre, telefono) y escala a un agente humano.
- El objetivo es que el CANAL PROPIO ofrezca una experiencia SUPERIOR a Glovo/Uber para captar clientes.

TU OBJETIVO: Encontrar patrones que ayuden a MEJORAR la experiencia del canal propio, detectar donde se frustran los clientes y proponer mejoras concretas. Las metricas generales importan, pero lo CRITICO son los problemas del canal propio.

Estructura EXACTA con etiquetas HTML:

<h2>1. RESUMEN EJECUTIVO</h2>
<p>4-5 frases: tendencia general, el problema mas grave del canal propio, dato de satisfaccion, accion mas urgente.</p>

<h2>2. DASHBOARD DE METRICAS</h2>
<table> comparativa completa. Columnas: Metrica | Actual | Anterior | Variacion (con color).
Incluir: mensajes, sesiones, msgs/sesion, resolucion bot, escalaciones, agente humano, coste total, coste/sesion.

<h2>3. CANAL PROPIO: RADIOGRAFIA DE PROBLEMAS</h2>
<p>ESTA ES LA SECCION MAS IMPORTANTE DEL INFORME.</p>
<p>Analiza los datos del canal propio (pedidos.burgerjazz.com):</p>
<ul>
<li>Desglose de problemas criticos: pedido no llega, cancelaciones, cambios direccion, modificaciones, producto faltante, calidad</li>
<li>A que horas se concentran los problemas? Correlaciona con horarios de servicio</li>
<li>Tiempo medio hasta que el bot escala a un agente — es suficientemente rapido?</li>
<li>Hay clientes recurrentes con problemas (misma persona, multiples incidencias)?</li>
<li>Incidencias resueltas vs pendientes — se estan gestionando bien?</li>
</ul>
<p>Compara volumen canal propio vs Glovo/Uber para dimensionar.</p>
<p>INTERPRETA: que tipo de problema es mas frecuente? hay un patron horario? hay un problema operativo de fondo (ej: siempre faltan productos a la hora de maxima demanda)?</p>

<h2>4. MAPA DE FRUSTRACION</h2>
<p>Donde se frustran los clientes:</p>
<ul>
<li>Sesiones largas (el bot da vueltas sin resolver)</li>
<li>Preguntas repetidas (el cliente repite porque la respuesta no sirvio)</li>
<li>Expresiones explicitas de frustracion</li>
<li>Temas que provocan escalacion (con ejemplos de mensajes reales)</li>
<li>Preguntas que el bot NO sabe responder</li>
</ul>
<p>Clasifica por IMPACTO x SOLUCIONABILIDAD.</p>

<h2>5. MAPA DE ACTIVIDAD</h2>
<p>Cuando usan el bot: dias, horas punta. Tabla de distribucion horaria. Cuando deberian tener agentes disponibles para el canal propio?</p>

<h2>6. QUE PREGUNTAN LOS CLIENTES</h2>
<table> de categorias con volumen y %. Que categorias crecen? Donde falla el bot?</p>

<h2>7. SATISFACCION Y CALIDAD</h2>
<p>Nota media, distribucion, tendencia. Satisfaccion POR CATEGORIA — cuales tienen peor nota? Correlaciona con frustracion y canal propio.</p>

<h2>8. CASOS REALES</h2>
<p>Conversaciones problematicas. Para cada caso: que paso, por que fallo, que mejorar. Prioriza casos de canal propio.</p>

<h2>9. EFICIENCIA</h2>
<p>Resolucion bot vs humano, coste. Esta ahorrando tiempo al equipo? Cuantas gestiones evita a los agentes?</p>

<h2>10. PLAN DE ACCION</h2>
<table>
<tr><th>#</th><th>Accion</th><th>Problema que resuelve</th><th>Impacto</th><th>Esfuerzo</th></tr>
</table>
<p>Minimo 6 acciones. Prioriza las del canal propio. Incluye tanto mejoras del bot como mejoras operativas (ej: "revisar proceso de preparacion entre 13-15h si hay pico de productos faltantes").</p>

<h2>11. CONCLUSION</h2>
<p>Nota al bot (1-10). Nota al canal propio (1-10). Tendencia. Proximo foco.</p>

REGLAS:
- INTERPRETA, no listes. "5 pedidos no llegaron" es insuficiente. "5 pedidos no llegaron, 4 de ellos entre 13-15h en zona Chamberi, lo que sugiere un cuello de botella operativo en esa franja" es lo que necesitamos.
- Datos concretos SIEMPRE
- Colores: style="color:#16a34a" (mejora), style="color:#dc2626" (problema)
- Maximo 1800 palabras
- SOLO HTML: h2, h3, p, table, tr, th, td, ul, li, strong, span. NO markdown
- En espanol
- Si no hay datos, di "Sin datos suficientes" en vez de inventar
- Se BRUTALMENTE honesto. Si el canal propio tiene problemas graves, dilo sin rodeos.
- Cada seccion debe terminar con un INSIGHT accionable, no solo datos`,
      messages: [{ role: "user", content: d }],
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
        agent_sessions: agentCount,
        incidents: { total: incTotal, resolved: incResolved, pending: incPending },
        satisfaction: ratings.average || 0,
        satisfaction_distribution: ratings.distribution || {},
        satisfaction_total: ratings.total || 0,
        feedback: feedback.counts || {},
        feedback_by_category: feedback.byCategory || {},
        resolution: resolution,
        ratings_trend: ratingsTrend,
        categories: cats.map(function(c) { return { name: c.category, count: parseInt(c.count) }; }),
        hourly: hours.map(function(h) { return { hour: parseInt(h.hour), count: parseInt(h.count) }; }),
        daily: daily.map(function(r) { return { day: r.day, dow: parseInt(r.dow), count: parseInt(r.count), sessions: parseInt(r.sessions) }; }),
        cost: { tokens_in: tokensIn, tokens_out: tokensOut, estimated: "$" + estimatedCost, per_session_cents: costPerSession },
        frustration: {
          long_sessions: longSessions.length,
          repeated_questions: repeatedQuestions.length,
          frustrated_explicit: frustratedSessions.length,
          bot_couldnt_resolve: parseInt(abandonedSessions[0]?.count || 0),
        },
        cat_satisfaction: catSatisfaction.map(function(c) { return { category: c.category, avg: parseFloat(c.avg_rating), count: parseInt(c.ratings_count) }; }),
        own_channel: {
          delivery_propio_sessions: parseInt(deliveryPropio[0]?.total || 0),
          delivery_externo_sessions: parseInt(deliveryExterno[0]?.total || 0),
          critical_issues: {
            pedido_no_llega: parseInt(criticalOwn[0]?.pedido_no_llega || 0),
            cancelar: parseInt(criticalOwn[0]?.cancelar || 0),
            cambio_direccion: parseInt(criticalOwn[0]?.cambio_direccion || 0),
            modificar_pedido: parseInt(criticalOwn[0]?.modificar_pedido || 0),
            producto_faltante: parseInt(criticalOwn[0]?.producto_faltante || 0),
            calidad_producto: parseInt(criticalOwn[0]?.calidad_producto || 0),
          },
          avg_escalation_minutes: parseFloat(avgEscalationMins),
          total_escalations: escalationSpeed.length,
          repeat_complainers: repeatComplainers.length,
        },
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
