// Daily cron: pull new Google reviews for every BurgerJazz location, draft a
// reply with Claude and PUBLISH it straight to Google, then email Rodrigo a
// digest of what was posted (the panel /resenas.html remains available to
// edit/correct any published reply — a re-publish overwrites it on Google).
//
// Approval model chosen by Rodrigo (06/07/2026): AUTO-PUBLISH everything, "con
// mucho criterio" — the drafting prompt carries extra-strict rules for negative
// and delicate reviews instead of a human gate.
//
// Inert until Google Business Profile access is configured: if _gbp.isConfigured()
// is false it returns {status:"not_configured"} without touching anything.

const Anthropic = require("@anthropic-ai/sdk");
const { initDB, insertReviewIfNew, markReviewPublished, getKnowledgeSections, countPendingReviews } = require("./_db");
const { isAuthorizedCron } = require("./_auth");
const gbp = require("./_gbp");

let dbReady = false;
let _dbInitPromise = null;

// Only reply to reviews newer than this, so the first run doesn't answer
// years of history. Reviews already answered on Google are skipped.
const MAX_AGE_DAYS = 30;
// Bound cost/latency per run — a daily cron won't see more than a handful of
// new reviews across 8 locales anyway.
const MAX_REPLIES_PER_RUN = 25;

const REPLY_SYSTEM = `Eres el responsable de reputación online de BURGERJAZZ, una cadena de smash burgers con locales en Madrid y Valladolid. Redactas la RESPUESTA PÚBLICA del negocio a una reseña de Google.

TONO Y ESTILO:
- Cercano, humano y agradecido. Nada de plantillas robóticas.
- Español de España, tuteo, natural. Sin emojis excesivos (máximo uno, y solo si encaja).
- Breve: 2-4 frases. Firma como "El equipo de BurgerJazz" o menciona el local.
- Si la persona da su nombre, salúdala por su nombre.
- Menciona el local concreto cuando aporte cercanía.

IDIOMA: responde en el idioma de la reseña (si viene en inglés, en inglés; ignora la coletilla "(Translated by Google)" — el idioma real es el del texto original). Por defecto, español.

SEGÚN LA VALORACIÓN:
- 4-5 estrellas: agradece de forma genuina, destaca algo concreto que mencionan si lo hay, invítales a volver. Si citan a un empleado por su nombre, di que le harás llegar el mensaje.
- 3 estrellas: agradece, reconoce que hay margen de mejora, muestra ganas de hacerlo mejor.
- 1-2 estrellas: disculpa sincera y sobria, SIN admitir culpa legal ni entrar en detalles del incidente. Invita a escribir a info@burgerjazz.com para resolverlo en privado. Nunca discutas ni culpes al cliente.

TEMAS DELICADOS (higiene, intoxicación, ALERGIAS, condiciones laborales, quejas legales, trato discriminatorio) — TU RESPUESTA SE PUBLICA SIN REVISIÓN HUMANA, sé especialmente prudente:
- NO confirmes ni niegues los hechos que describe la reseña; no repitas la acusación con tus palabras.
- Fórmula: agradecer el aviso + "nos lo tomamos muy en serio y lo vamos a revisar con el equipo" + invitar a info@burgerjazz.com con los datos.
- Alergias: di que las alergias son una prioridad absoluta y pide los datos del pedido por email. Nada más.
- Condiciones laborales: el bienestar del equipo nos importa de verdad y lo revisaremos. No entres en detalles del local ni de la persona.
- Cuanto más grave la acusación, más corta y sobria la respuesta.

PROHIBIDO:
- Prometer descuentos, regalos o compensaciones concretas.
- Inventar datos (platos, promociones, horarios) que no conozcas.
- Copiar literalmente reseñas anteriores: varía la redacción.
- Revelar datos internos o personales.
- Ironía, sarcasmo o ponerse a la defensiva, por injusta que parezca la reseña.

DEVUELVE ÚNICAMENTE EL TEXTO DE LA RESPUESTA, sin comillas, sin encabezados, sin explicaciones.`;

function daysAgo(iso) {
  var t = new Date(iso).getTime();
  if (!t) return 9999;
  return (Date.now() - t) / 86400000;
}

async function draftReply(client, ctx, review) {
  var stars = gbp.starToNumber(review.starRating);
  var author = (review.reviewer && review.reviewer.displayName) || "";
  var comment = review.comment || "";
  var userMsg =
    "LOCAL: " + review.__localName + "\n" +
    "AUTOR: " + (author || "(anónimo)") + "\n" +
    "ESTRELLAS: " + stars + "/5\n" +
    "RESEÑA: " + (comment.trim() ? comment.trim() : "(sin texto, solo la valoración)") + "\n\n" +
    (ctx ? "CONTEXTO DEL NEGOCIO (para no inventar datos):\n" + ctx + "\n\n" : "") +
    "Redacta la respuesta pública.";

  var response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 400,
    system: REPLY_SYSTEM,
    messages: [{ role: "user", content: userMsg }],
  });
  return (response.content?.[0]?.text || "").trim();
}

function escHTML(s) { return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }

module.exports = async function handler(req, res) {
  if (!isAuthorizedCron(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!gbp.isConfigured()) {
    return res.status(200).json({ status: "not_configured", message: "GBP env vars missing — nada que hacer todavía." });
  }

  if (!dbReady) {
    if (!_dbInitPromise) _dbInitPromise = initDB();
    await _dbInitPromise;
    dbReady = true;
  }

  try {
    var locations = gbp.getLocations();
    if (locations.length === 0) {
      return res.status(200).json({ status: "no_locations", message: "GBP_LOCATIONS vacío." });
    }

    // Compact business context from the knowledge base so replies don't invent data.
    var ctx = "";
    try {
      var sections = await getKnowledgeSections();
      ctx = sections.map(function (s) { return s.title + ": " + s.content; }).join("\n").slice(0, 4000);
    } catch (e) { /* knowledge is best-effort */ }

    var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    var published = [];
    var errors = [];
    var scanned = 0;

    for (var li = 0; li < locations.length; li++) {
      var loc = locations[li];
      var reviews;
      try {
        reviews = await gbp.listReviews(loc);
      } catch (e) {
        errors.push(loc.name + ": " + e.message);
        continue;
      }
      for (var ri = 0; ri < reviews.length; ri++) {
        if (published.length >= MAX_REPLIES_PER_RUN) break;
        var rv = reviews[ri];
        scanned++;
        // Skip reviews already answered (by staff or a previous run of ours) —
        // Google is the source of truth, so a re-run never double-replies.
        if (rv.reviewReply && rv.reviewReply.comment) continue;
        // Skip old history on first run.
        if (daysAgo(rv.updateTime || rv.createTime) > MAX_AGE_DAYS) continue;

        rv.__localName = loc.name;
        var draft;
        try {
          draft = await draftReply(client, ctx, rv);
        } catch (e) {
          errors.push("draft " + loc.name + ": " + e.message);
          continue;
        }
        if (!draft || draft.length < 5) continue;

        // Publish straight to Google (Rodrigo's auto model). If the PUT fails
        // we leave it recorded as a draft so the panel can retry it by hand.
        var posted = true;
        try {
          await gbp.replyToReview(rv.name, draft);
        } catch (e) {
          posted = false;
          errors.push("publicar " + loc.name + ": " + e.message);
        }

        await insertReviewIfNew({
          review_id: rv.name, // full resource name — stable & unique
          location_id: loc.id,
          location_name: loc.name,
          author: (rv.reviewer && rv.reviewer.displayName) || null,
          rating: gbp.starToNumber(rv.starRating),
          comment: rv.comment || "",
          review_ts: rv.createTime || rv.updateTime || null,
          draft_reply: draft,
        });
        if (posted) {
          await markReviewPublished(rv.name, draft, "auto");
          published.push({
            local: loc.name,
            author: (rv.reviewer && rv.reviewer.displayName) || "(anónimo)",
            rating: gbp.starToNumber(rv.starRating),
            comment: rv.comment || "",
            draft: draft,
          });
        }
      }
      if (published.length >= MAX_REPLIES_PER_RUN) break;
    }

    // Email digest of what was published (plus any failures left as drafts).
    var RESEND_KEY = process.env.RESEND_API_KEY;
    if ((published.length > 0 || errors.length > 0) && RESEND_KEY) {
      var totalPending = await countPendingReviews();
      var rows = published.map(function (d) {
        var stars = "★".repeat(d.rating) + "☆".repeat(5 - d.rating);
        var color = d.rating >= 4 ? "#16a34a" : d.rating === 3 ? "#d97706" : "#dc2626";
        return '<div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:12px">' +
          '<div style="font-size:12px;color:#6b7280">' + escHTML(d.local) + ' · ' + escHTML(d.author) + '</div>' +
          '<div style="color:' + color + ';font-size:15px;margin:2px 0">' + stars + '</div>' +
          (d.comment ? '<div style="font-size:13px;color:#374151;margin:6px 0">“' + escHTML(d.comment) + '”</div>' : '<div style="font-size:12px;color:#9ca3af;margin:6px 0">(sin texto)</div>') +
          '<div style="font-size:13px;background:#f9fafb;border-left:3px solid #16a34a;padding:8px 10px;margin-top:6px"><strong>Respuesta publicada:</strong> ' + escHTML(d.draft) + '</div>' +
          '</div>';
      }).join("");

      var errHtml = errors.length ? '<p style="font-size:12px;color:#dc2626">Incidencias (quedan como borrador en el panel): ' + escHTML(errors.join(" · ")) + '</p>' : '';

      var html = '<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto">' +
        '<div style="background:#002855;color:#fff;padding:16px 24px;border-radius:8px 8px 0 0">' +
        '<h2 style="margin:0;font-size:16px">Reseñas de Google — ' + published.length + ' respuesta(s) publicada(s) hoy</h2></div>' +
        '<div style="background:#fff;padding:20px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">' +
        rows + errHtml +
        '<div style="text-align:center;margin-top:16px">' +
        '<a href="https://bot.burgerjazz.com/resenas.html" style="display:inline-block;background:#002855;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;font-size:14px">Ver / corregir en el panel →</a>' +
        '</div>' +
        '<p style="margin-top:14px;font-size:11px;color:#9ca3af">Modo automático: las respuestas ya están en Google. Si alguna no te convence, edítala en el panel y se sobrescribe. Pendientes de reintento: ' + totalPending + '.</p>' +
        '</div></div>';

      var emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": "Bearer " + RESEND_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "BurgerJazz Reseñas <alertas@burgerjazz.com>",
          to: ["rodrigo@burgerjazz.com"],
          subject: "⭐ " + published.length + " respuesta(s) a reseñas publicadas" + (errors.length ? " · " + errors.length + " incidencia(s)" : ""),
          html: html,
        }),
      });
      if (!emailRes.ok) console.error("Reviews email error:", emailRes.status, await emailRes.text().catch(function(){return ""}));
    }

    return res.status(200).json({
      status: "ok",
      scanned: scanned,
      published: published.length,
      errors: errors,
    });
  } catch (err) {
    console.error("cron-reviews error:", err);
    return res.status(500).json({ error: err.message });
  }
};
