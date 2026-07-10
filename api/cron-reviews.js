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
const crypto = require("crypto");
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
- Breve: 2-4 frases. TERMINA SIEMPRE con la firma exacta: "El equipo de BURGERJAZZ™" (con el símbolo ™, en mayúsculas). Es la última frase de TODA respuesta, sin excepción.
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

DEVUELVE ÚNICAMENTE EL TEXTO DE LA RESPUESTA, sin comillas, sin encabezados, sin explicaciones.

EJEMPLOS REALES APROBADOS POR EL DUEÑO (imita este estilo, tono y estructura; NO los copies literalmente):

EJEMPLO (5★ con nombre y detalle) — 5★ de Mathias Benitez en Chamberí:
RESEÑA: Muy buenas hamburguesas , exelentes servicios de parte de Fanny e Yomalvi mas que recomendado

(Translated by Google)
Very good hamburgers, excellent service from Fanny and Yomalvi, highly recommended
RESPUESTA APROBADA:
¡Mil gracias, Mathias! Nos alegra un montón que disfrutaras de las burgers, y le pasamos tu felicitación a Fanny y Yomalvi: se les va a alegrar el día. ¡Te esperamos de vuelta en Chamberí! — El equipo de BURGERJAZZ™

---

EJEMPLO (5★ sin texto) — 5★ de Carlos Redondo Cornejo en Delicias:
RESEÑA: (sin texto)
RESPUESTA APROBADA:
¡Gracias por las cinco estrellas, Carlos! Te esperamos de vuelta en Delicias. — El equipo de BURGERJAZZ™

---

EJEMPLO (4★) — 4★ de maria gonzalez en Chamberí:
RESEÑA: (sin texto)
RESPUESTA APROBADA:
¡Gracias por tu valoración, María! Nos alegra que disfrutaras de tu visita. Si hay algo que podamos hacer para ganarnos esa quinta estrella, nos encantará saberlo. ¡Te esperamos pronto en Chamberí! — El equipo de BURGERJAZZ™

---

EJEMPLO (3★) — 3★ de Alberto Caballero en Majadahonda:
RESEÑA: Muy bien ambiente, pero no se puede comer por falta de calefacción y con este calor dentro del local es un horno, espero puedan mejorarlo, saludos

(Translated by Google)
The atmosphere is great, but it's impossible to eat because there's no heating, and with this heat inside, it's like an oven. I h
RESPUESTA APROBADA:
Hola, Alberto. Gracias por avisarnos: tienes razón en que con esta ola de calor el local se resiente, y estamos viendo cómo mejorar la climatización de Majadahonda. Nos alegra que el ambiente te gustara; esperamos que la próxima visita sea redonda. — El equipo de BURGERJAZZ™

---

EJEMPLO (1-2★ queja) — 2★ de diana ruiz barrionuevo en Chamberí:
RESEÑA: Paramos allí a comer, el sitio es bastante pequeñito, pero la chica bastante maja
Ahora la comida.... Un poco cara para una hamburguesa sin más (la carne bastante fina)

(Translated by Google)
We stopped there for lunch; the place is quite small, but the girl was very nice.
Now for the food... A bit
RESPUESTA APROBADA:
Hola, Diana. Gracias por darnos tu opinión y por tus palabras hacia nuestra compañera. Sentimos que la burger no te convenciera: nuestro estilo smash lleva carne fina a la plancha para conseguir ese punto crujiente, pero entendemos que no encaje con lo que esperabas. Si quieres contarnos más, escríbenos a info@burgerjazz.com; nos ayuda a mejorar. — El equipo de BURGERJAZZ™

---

EJEMPLO (inglés) — 5★ de Max Muslera Álvarez en Chamberí:
RESEÑA: Fuimos a cenar al Jazzburguer de chamberi. Recibimos un trato súper amable por parte de Fanny. Que pese a las horas que nos recibió a falta de 20 minutos al cierre. Fue eficaz en la preparación y cenamos muy muy rico. Salimos muy contentas con la cena y el trato.
Abrazos a Fanny!

(Translated by Goo
RESPUESTA APROBADA:
¡Muchísimas gracias, Max! Nos encanta saber que Fanny os cuidó tan bien incluso a punto de cerrar; le haremos llegar vuestros abrazos. Nos alegra que la cena estuviera tan rica. ¡Volved pronto! — El equipo de BURGERJAZZ™ Chamberí

---

EJEMPLO (5★ extra) — 5★ de Lisandy Garcia Cruz en Chamberí:
RESEÑA: He ido a cenar , yoma y Fanny me ha tratado estupendo

(Translated by Google)
I went to dinner, and Fanny treated me wonderfully.
RESPUESTA APROBADA:
¡Gracias, Lisandy! Fanny y Yoma se alegrarán muchísimo de leer esto. Un placer tenerte en Chamberí, ¡vuelve cuando quieras! — El equipo de BURGERJAZZ™

---

EJEMPLO (negativa extra) — 2★ de Baz Artz (BazArtz) en Delicias:
RESEÑA: ridiculamente caro para lo que es. esta bueno pero no merece la pena casi 20e.

(Translated by Google)
Ridiculously expensive for what it is. It's okay, but not worth almost €20.
RESPUESTA APROBADA:
Hola, gracias por tu opinión; nos alegra al menos que la burger estuviera buena. Sentimos que el precio no te pareciera acorde: trabajamos con carne fresca y producto de calidad e intentamos ajustarlo al máximo. Tomamos nota, y si quieres darnos más detalle te leemos en info@burgerjazz.com. — El equipo de BURGERJAZZ™`;

function daysAgo(iso) {
  var t = new Date(iso).getTime();
  if (!t) return 9999;
  return (Date.now() - t) / 86400000;
}

async function draftReply(client, ctx, review, prevReplies) {
  var stars = gbp.starToNumber(review.starRating);
  var author = (review.reviewer && review.reviewer.displayName) || "";
  var comment = review.comment || "";
  var userMsg =
    "LOCAL: " + review.__localName + "\n" +
    "AUTOR: " + (author || "(anónimo)") + "\n" +
    "ESTRELLAS: " + stars + "/5\n" +
    "RESEÑA: " + (comment.trim() ? comment.trim() : "(sin texto, solo la valoración)") + "\n\n" +
    (ctx ? "CONTEXTO DEL NEGOCIO (para no inventar datos):\n" + ctx + "\n\n" : "") +
    (prevReplies && prevReplies.length ? "RESPUESTAS RECIENTES YA PUBLICADAS EN ESTE LOCAL — NO repitas sus fórmulas ni empieces igual que ninguna:\n- " + prevReplies.join("\n- ") + "\n\n" : "") +
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
        // anti-plantilla: las ultimas respuestas publicadas de ESTE local (de Google mismo)
        var prevReplies = reviews.filter(function (x) { return x.reviewReply && x.reviewReply.comment; })
          .slice(0, 10).map(function (x) { return String(x.reviewReply.comment).replace(/\s+/g, " ").slice(0, 160); });
        var draft;
        try {
          draft = await draftReply(client, ctx, rv, prevReplies);
        } catch (e) {
          errors.push("draft " + loc.name + ": " + e.message);
          continue;
        }
        if (!draft || draft.length < 5) continue;

        // MODELO APROBACION (09/07/2026, Rodrigo): el agente YA NO publica solo. Guarda el borrador
        // y se lo manda por email con boton "Aprobar y publicar" (token firmado) — o se aprueba/edita
        // en el panel (pestaña Pendientes).
        var posted = false;

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
        if (!posted) {
          published.push({
            id: rv.name,
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
      var SEC = process.env.CRON_SECRET || "";
      var rows = published.map(function (d) {
        var stars = "★".repeat(d.rating) + "☆".repeat(5 - d.rating);
        var color = d.rating >= 4 ? "#16a34a" : d.rating === 3 ? "#d97706" : "#dc2626";
        var tok = crypto.createHmac("sha256", SEC).update(d.id).digest("hex").slice(0, 24);
        var approveUrl = "https://bot.burgerjazz.com/api/reviews?action=approve&id=" + encodeURIComponent(d.id) + "&t=" + tok;
        return '<div style="border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:14px">' +
          '<div style="font-size:12px;color:#6b7280">' + escHTML(d.local) + ' · ' + escHTML(d.author) + '</div>' +
          '<div style="color:' + color + ';font-size:15px;margin:2px 0">' + stars + '</div>' +
          (d.comment ? '<div style="font-size:13px;color:#374151;margin:6px 0">“' + escHTML(d.comment) + '”</div>' : '<div style="font-size:12px;color:#9ca3af;margin:6px 0">(sin texto)</div>') +
          '<div style="font-size:13px;background:#f9fafb;border-left:3px solid #d97706;padding:10px 12px;margin-top:6px;border-radius:0 8px 8px 0"><strong>Propuesta:</strong> ' + escHTML(d.draft) + '</div>' +
          '<div style="margin-top:12px"><a href="' + approveUrl + '" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:700;font-size:13px">✓ Aprobar y publicar</a>' +
          '<a href="https://bot.burgerjazz.com/dashboard.html#resenas" style="display:inline-block;margin-left:8px;color:#374151;text-decoration:none;padding:10px 14px;border:1px solid #e5e7eb;border-radius:8px;font-weight:600;font-size:13px">Editar en el panel</a></div>' +
          '</div>';
      }).join("");

      var errHtml = errors.length ? '<p style="font-size:12px;color:#dc2626">Incidencias (quedan como borrador en el panel): ' + escHTML(errors.join(" · ")) + '</p>' : '';

      var html = '<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto">' +
        '<div style="background:#002855;color:#fff;padding:16px 24px;border-radius:8px 8px 0 0">' +
        '<h2 style="margin:0;font-size:16px">Reseñas — ' + published.length + ' respuesta(s) PENDIENTES DE TU APROBACIÓN</h2></div>' +
        '<div style="background:#fff;padding:20px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">' +
        rows + errHtml +
        '<div style="text-align:center;margin-top:16px">' +
        '<a href="https://bot.burgerjazz.com/dashboard.html#resenas" style="display:inline-block;background:#002855;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;font-size:14px">Ver / corregir en el panel →</a>' +
        '</div>' +
        '<p style="margin-top:14px;font-size:11px;color:#9ca3af">NADA se publica sin tu aprobación: aprueba con un clic desde aquí, o edita/aprueba en el panel (pestaña Pendientes). Total pendientes: ' + totalPending + '. El botón es seguro: si esa reseña ya estaba gestionada te lo dice (no duplica), y tras cada clic verás la lista de las que aún quedan por aprobar.</p>' +
        '</div></div>';

      var emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": "Bearer " + RESEND_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "BurgerJazz Reseñas <alertas@burgerjazz.com>",
          to: ["rodrigo@burgerjazz.com"],
          subject: "⭐ " + published.length + " respuesta(s) a reseñas para APROBAR" + (errors.length ? " · " + errors.length + " incidencia(s)" : ""),
          html: html,
        }),
      });
      if (!emailRes.ok) console.error("Reviews email error:", emailRes.status, await emailRes.text().catch(function(){return ""}));
    }

    return res.status(200).json({
      status: "ok",
      scanned: scanned,
      drafted: published.length,
      errors: errors,
    });
  } catch (err) {
    console.error("cron-reviews error:", err);
    return res.status(500).json({ error: err.message });
  }
};
