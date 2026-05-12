const { initDB, getAlertData } = require("./_db");

let dbReady = false;
let _dbInitPromise = null;

function escHTML(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

module.exports = async function handler(req, res) {
  const isCron = req.headers["x-vercel-cron"] === "true";
  const authKey = process.env.LEARN_KEY;
  const providedKey = req.query?.key || req.headers["x-learn-key"];

  if (!isCron && (!authKey || providedKey !== authKey)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!dbReady) {
    if (!_dbInitPromise) _dbInitPromise = initDB();
    await _dbInitPromise;
    dbReady = true;
  }

  try {
    var data = await getAlertData();
    var alerts = [];

    // Check for anomalies
    // 1. Error spike: >5 errors in 24h or >3x previous
    if (data.current.errors > 5) {
      alerts.push({ type: "error", msg: "Errores API: " + data.current.errors + " en las ultimas 24h (anterior: " + data.previous.errors + ")" });
    } else if (data.current.errors > 0 && data.previous.errors > 0 && data.current.errors > data.previous.errors * 3) {
      alerts.push({ type: "error", msg: "Pico de errores: " + data.current.errors + " vs " + data.previous.errors + " del dia anterior" });
    }

    // 2. Satisfaction drop: avg rating < 3 or dropped >1 point
    if (data.rating.total >= 3 && data.rating.avg < 3) {
      alerts.push({ type: "warning", msg: "Satisfaccion baja: " + data.rating.avg.toFixed(1) + "/5 en las ultimas 24h (" + data.rating.total + " valoraciones)" });
    } else if (data.ratingPrev > 0 && data.rating.avg > 0 && data.ratingPrev - data.rating.avg > 1) {
      alerts.push({ type: "warning", msg: "Caida de satisfaccion: " + data.rating.avg.toFixed(1) + " vs " + data.ratingPrev.toFixed(1) + " del dia anterior" });
    }

    // 3. Escalation spike: >10 in 24h or >3x previous day's rate
    if (data.escalations > 10) {
      alerts.push({ type: "warning", msg: "Alto volumen de escalaciones: " + data.escalations + " en 24h" });
    }

    // 4. Traffic drop: <20% of previous day (possible outage)
    if (data.previous.total > 10 && data.current.total < data.previous.total * 0.2) {
      alerts.push({ type: "info", msg: "Trafico inusualmente bajo: " + data.current.total + " mensajes (anterior: " + data.previous.total + "). Posible caida?" });
    }

    // 5. No traffic at all when there was before
    if (data.previous.total > 5 && data.current.total === 0) {
      alerts.push({ type: "error", msg: "Sin actividad en las ultimas 24h. El chatbot puede estar caido." });
    }

    if (alerts.length === 0) {
      return res.status(200).json({ status: "ok", message: "No anomalies detected", data: data });
    }

    // Send alert email
    var RESEND_KEY = process.env.RESEND_API_KEY;
    if (RESEND_KEY) {
      var alertRows = alerts.map(function(a) {
        var color = a.type === "error" ? "#dc2626" : a.type === "warning" ? "#d97706" : "#2563eb";
        var icon = a.type === "error" ? "🔴" : a.type === "warning" ? "🟡" : "🔵";
        return '<tr><td style="padding:10px 14px;border-bottom:1px solid #e5e7eb">' + icon + '</td><td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:' + color + ';font-weight:700">' + escHTML(a.msg) + '</td></tr>';
      }).join("");

      var html = '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">' +
        '<div style="background:#002855;color:#fff;padding:16px 24px;border-radius:8px 8px 0 0">' +
        '<h2 style="margin:0;font-size:16px">Alertas JazzBot — ' + new Date().toLocaleDateString("es-ES") + '</h2></div>' +
        '<div style="background:#fff;padding:20px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">' +
        '<table style="width:100%;border-collapse:collapse;font-size:13px">' + alertRows + '</table>' +
        '<div style="margin-top:16px;padding:12px;background:#f9fafb;border-radius:6px;font-size:12px;color:#6b7280">' +
        '<strong>Resumen 24h:</strong> ' + data.current.total + ' mensajes, ' + data.current.sessions + ' sesiones, ' + data.escalations + ' escalaciones, ' + data.current.errors + ' errores' +
        '</div>' +
        '<p style="margin-top:12px;font-size:11px;color:#9ca3af">Ver detalles en el <a href="https://bot.burgerjazz.com/dashboard.html">dashboard</a></p>' +
        '</div></div>';

      var emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": "Bearer " + RESEND_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "JazzBot <alertas@burgerjazz.com>",
          to: ["rodrigo@burgerjazz.com"],
          subject: (alerts.some(function(a){return a.type==="error"}) ? "🔴" : "🟡") + " Alerta JazzBot — " + alerts.length + " anomalia(s) detectada(s)",
          html: html,
        }),
      });
      if (!emailRes.ok) console.error("Alert email error:", emailRes.status, await emailRes.text().catch(function(){return ""}));
    }

    // Send Slack alert too
    var slackUrl = process.env.SLACK_WEBHOOK_URL;
    if (slackUrl) {
      var slackText = alerts.map(function(a) {
        var icon = a.type === "error" ? ":red_circle:" : a.type === "warning" ? ":large_yellow_circle:" : ":large_blue_circle:";
        return icon + " " + a.msg;
      }).join("\n");

      await fetch(slackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: ":warning: *Alertas JazzBot*\n" + slackText }),
      });
    }

    return res.status(200).json({ status: "alerts_sent", alerts: alerts, data: data });
  } catch (err) {
    console.error("Alert error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
};
