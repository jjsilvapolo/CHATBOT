// Cron semanal (miércoles) — publica el Google Post "JAZZ DAYS 2x1" en todas
// las fichas GBP abiertas. Mismo estilo que cron-reviews: fetch directo a la
// API v4 (localPosts) con el token de _gbp, inerte si faltan envs.
//
// GET /api/cron-posts            → publica (solo miércoles, salvo ?force=1)
// GET /api/cron-posts?dry=1      → no publica, devuelve lo que haría
const gbp = require("./_gbp");

const V4_BASE = "https://mybusiness.googleapis.com/v4";
const { isAuthorizedCron } = require("./_auth");

// Locales que NO deben recibir el post hasta la fecha indicada (incluida):
// cierres de agosto 2026 + Delicias, que en agosto no abre los miércoles.
// Expira solo por fecha — no hay nada que revertir en septiembre.
const SKIP_UNTIL = {
  "15010597736517818018": "2026-09-01", // La Moraleja — vacaciones todo agosto
  "3307313997894419988": "2026-09-01", // Valladolid — vacaciones todo agosto
  "3388964124982530556": "2026-08-31", // Delicias — en agosto cierra los miércoles (J-D)
};

// Rotación de textos (uno por semana, determinista). Todos factuales:
// 2x1 en burgers, miércoles, solo en local, no Glovo/Uber.
const TEXTS = [
  "🍔 JAZZ DAYS: todos los miércoles, 2x1 en burgers. Pides dos, pagas una. Válido en el local (para comer aquí o llevar). ¡Hoy toca!",
  "Miércoles = JAZZ DAYS 🎷 2x1 en todas nuestras smash burgers pidiendo en el local. Trae a alguien: la segunda va por la casa.",
  "Hoy es miércoles y eso solo significa una cosa: JAZZ DAYS. 2x1 en burgers en el local, para comer aquí o para llevar. 🍔🍔",
  "2x1 en smash burgers HOY por ser miércoles: nuestros JAZZ DAYS. Pide dos burgers en el local y paga solo una.",
  "JAZZ DAYS 🍔 Cada miércoles, dos burgers por el precio de una en todos nuestros locales. Solo pidiendo en el local — te esperamos.",
  "El plan del miércoles: JAZZ DAYS. 2x1 en burgers en el local (comer aquí o llevar). La costra crujiente la ponemos nosotros, tú trae el hambre.",
];

function madridDateParts() {
  var s = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  }).formatToParts(new Date());
  var get = function (t) { return (s.find(function (p) { return p.type === t; }) || {}).value; };
  return { iso: get("year") + "-" + get("month") + "-" + get("day"), weekday: get("weekday") };
}

// Semana ISO aproximada para rotar textos (estable durante todo el día).
function weekIndex(iso) {
  var d = new Date(iso + "T12:00:00Z");
  return Math.floor(d.getTime() / (7 * 24 * 3600 * 1000));
}

module.exports = async function handler(req, res) {
  if (!isAuthorizedCron(req)) return res.status(401).json({ error: "Unauthorized" });
  if (!gbp.isConfigured()) {
    return res.status(200).json({ status: "not_configured", message: "GBP env vars missing." });
  }

  var today = madridDateParts();
  var dry = req.query && req.query.dry === "1";
  var force = req.query && req.query.force === "1";
  if (today.weekday !== "Wed" && !force && !dry) {
    return res.status(200).json({ status: "skipped", reason: "hoy no es miércoles en Madrid (" + today.weekday + ")" });
  }

  var text = TEXTS[weekIndex(today.iso) % TEXTS.length];
  var post = {
    languageCode: "es",
    topicType: "STANDARD",
    summary: text,
    callToAction: {
      actionType: "LEARN_MORE",
      url: "https://pedir.burgerjazz.com/blog/jazz-days-2x1-miercoles",
    },
    media: [{ mediaFormat: "PHOTO", sourceUrl: "https://pedir.burgerjazz.com/products/burger-jazz.jpg" }],
  };

  var results = [];
  var token = await gbp.getAccessToken();
  for (var i = 0; i < gbp.getLocations().length; i++) {
    var loc = gbp.getLocations()[i];
    var skipUntil = SKIP_UNTIL[loc.id];
    if (skipUntil && today.iso <= skipUntil) {
      results.push({ name: loc.name, status: "skipped_closed", until: skipUntil });
      continue;
    }
    if (dry) { results.push({ name: loc.name, status: "dry" }); continue; }
    try {
      var r = await fetch(V4_BASE + "/accounts/" + loc.account + "/locations/" + loc.id + "/localPosts", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify(post),
      });
      if (r.ok) {
        results.push({ name: loc.name, status: "published" });
      } else {
        var errTxt = await r.text().catch(function () { return ""; });
        results.push({ name: loc.name, status: "error", http: r.status, detail: errTxt.slice(0, 200) });
      }
    } catch (e) {
      results.push({ name: loc.name, status: "error", detail: String(e.message).slice(0, 200) });
    }
  }

  var published = results.filter(function (x) { return x.status === "published"; }).length;
  return res.status(200).json({ status: "ok", date: today.iso, text: text, published: published, results: results });
};
