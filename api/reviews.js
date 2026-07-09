// Reviews API v2 (09/07/2026, peticion Rodrigo): el panel pasa de "solo borradores fallidos" a un
// CUADRO DE MANDO de reputacion: TODAS las reseñas (lectura EN VIVO de Google por tienda), respuesta
// editable siempre (nueva o sobrescribiendo la publicada — PUT v4 pisa la anterior), y sentimiento
// por tienda (media all-time de Google + ultimos 30 dias vs 30 anteriores + quejas recurrentes).
//
//   GET  /api/reviews                    → legacy: { reviews: [pending drafts] } (compat)
//   GET  /api/reviews?view=stats         → { stores: [{key,name,total,avg,n30,avg30,neg30,unans30,avgPrev,quejas[]}] }
//   GET  /api/reviews?view=list&loc=K    → { items: [{id,author,rating,comment,ts,reply,replyTs,byUs}] } (K = "account/locationId")
//   POST { action:"reply", id, reply, meta } → publica/sobrescribe en Google + registra en BD
//   POST legacy: publish | save | skip
//
// Auth: credencial del dashboard (x-dashboard-key), como el resto del panel.

const { initDB, getPendingReviews, getReview, updateReviewDraft, markReviewPublished, markReviewSkipped, insertReviewIfNew, getSQLInstance } = require("./_db");
const { validateDashKey, readDashKey } = require("./_auth");
const gbp = require("./_gbp");

let dbReady = false;
let _dbInitPromise = null;

// cache en memoria (instancia caliente): stats 10 min, listas por tienda 5 min
let _stats = null, _statsAt = 0;
const _lists = {};

const STOP = {};("de la que el en y a los del se las por un para con no una su al es lo como mas pero sus le ya o fue este ha si porque muy sin sobre tambien me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mi antes algunos que unos yo otro otras otra el tan estas algo nosotros the and for was with this that have very had not you but they were our just too from when back only" ).split(" ").forEach(function(w){STOP[w]=1});
["burger","jazz","burgerjazz","hamburguesa","hamburguesas","local","sitio","lugar","restaurante","google","translated","original","pedido","pedimos","estaba","estaban","esta","están","bien","gran"].forEach(function(w){STOP[w]=1});

function topQuejas(comments) {
  var freq = {};
  comments.forEach(function (c) {
    String(c || "").toLowerCase().replace(/[^a-záéíóúüñ\s]/g, " ").split(/\s+/).forEach(function (w) {
      if (w.length < 4 || STOP[w]) return;
      freq[w] = (freq[w] || 0) + 1;
    });
  });
  return Object.keys(freq).filter(function (w) { return freq[w] >= 2; })
    .sort(function (a, b) { return freq[b] - freq[a]; }).slice(0, 5)
    .map(function (w) { return w + " ×" + freq[w]; });
}

function daysAgo(iso) { var t = new Date(iso).getTime(); return t ? (Date.now() - t) / 86400000 : 9999; }

async function buildStats() {
  var locations = gbp.getLocations();
  var stores = [];
  for (var i = 0; i < locations.length; i++) {
    var loc = locations[i];
    try {
      var m = await gbp.listReviewsMeta(loc, 3); // ~150 reseñas recientes por tienda
      var n30 = 0, s30 = 0, neg30 = 0, un30 = 0, nP = 0, sP = 0, quejasSrc = [];
      m.reviews.forEach(function (rv) {
        var d = daysAgo(rv.updateTime || rv.createTime);
        var r = gbp.starToNumber(rv.starRating);
        if (d <= 30) { n30++; s30 += r; if (r <= 2) neg30++; if (!(rv.reviewReply && rv.reviewReply.comment)) un30++; }
        else if (d <= 60) { nP++; sP += r; }
        if (d <= 90 && r <= 3 && rv.comment) quejasSrc.push(rv.comment);
      });
      stores.push({
        key: loc.account + "/" + loc.id, name: loc.name,
        total: m.totalReviewCount, avg: m.averageRating,
        n30: n30, avg30: n30 ? s30 / n30 : null, neg30: neg30, unans30: un30,
        nPrev: nP, avgPrev: nP ? sP / nP : null,
        quejas: topQuejas(quejasSrc),
      });
    } catch (e) {
      stores.push({ key: loc.account + "/" + loc.id, name: loc.name, error: e.message.slice(0, 120) });
    }
  }
  stores.sort(function (a, b) { return (a.avg30 == null ? 9 : a.avg30) - (b.avg30 == null ? 9 : b.avg30); });
  return { stores: stores, fetchedAt: new Date().toISOString() };
}

module.exports = async function handler(req, res) {
  var authKey = readDashKey(req);
  if (!validateDashKey(authKey)) return res.status(401).json({ error: "Unauthorized" });

  if (!dbReady) {
    if (!_dbInitPromise) _dbInitPromise = initDB();
    await _dbInitPromise;
    dbReady = true;
  }

  try {
    if (req.method === "GET") {
      var view = (req.query && req.query.view) || "";
      if (view === "stats") {
        if (!gbp.isConfigured()) return res.status(200).json({ configured: false, stores: [] });
        if (!_stats || Date.now() - _statsAt > 600000) { _stats = await buildStats(); _statsAt = Date.now(); }
        return res.status(200).json({ configured: true, stats: _stats });
      }
      if (view === "list") {
        if (!gbp.isConfigured()) return res.status(200).json({ configured: false, items: [] });
        var key = String((req.query && req.query.loc) || "");
        var parts = key.split("/");
        if (parts.length !== 2) return res.status(400).json({ error: "loc requerido (account/locationId)" });
        var locs = gbp.getLocations();
        var loc = null; for (var i = 0; i < locs.length; i++) if (locs[i].account === parts[0] && locs[i].id === parts[1]) loc = locs[i];
        if (!loc) return res.status(404).json({ error: "tienda desconocida" });
        var c = _lists[key];
        if (!c || Date.now() - c.t > 300000) {
          var m2 = await gbp.listReviewsMeta(loc, 6); // hasta ~300 reseñas por tienda
          // marca cuales respondio el agente/panel (BD nuestra) para el badge "auto"
          var ids = m2.reviews.map(function (r) { return r.name; });
          var ours = {};
          try {
            var sql = getSQLInstance();
            var rows = await sql`SELECT review_id, status, published_by FROM reviews WHERE review_id = ANY(${ids})`;
            rows.forEach(function (r) { ours[r.review_id] = r; });
          } catch (e) { /* best effort */ }
          c = { t: Date.now(), meta: { total: m2.totalReviewCount, avg: m2.averageRating }, items: m2.reviews.map(function (rv) {
            var o = ours[rv.name];
            return {
              id: rv.name,
              author: (rv.reviewer && rv.reviewer.displayName) || null,
              rating: gbp.starToNumber(rv.starRating),
              comment: rv.comment || "",
              ts: rv.createTime || rv.updateTime || null,
              reply: (rv.reviewReply && rv.reviewReply.comment) || "",
              replyTs: (rv.reviewReply && rv.reviewReply.updateTime) || null,
              byUs: o ? (o.published_by || o.status) : null,
            };
          }) };
          _lists[key] = c;
        }
        return res.status(200).json({ configured: true, loc: { key: key, name: loc.name }, meta: c.meta, items: c.items });
      }
      // legacy: borradores pendientes
      var pending = await getPendingReviews();
      return res.status(200).json({ configured: gbp.isConfigured(), reviews: pending });
    }

    if (req.method === "POST") {
      var body = req.body || {};
      var action = body.action;
      var id = body.id;
      if (!id) return res.status(400).json({ error: "missing id" });
      var who = (readDashKey(req).split(":")[0]) || "panel";

      // v2: responder o SOBRESCRIBIR cualquier reseña (el PUT de Google pisa la respuesta anterior)
      if (action === "reply") {
        var text2 = String(body.reply || "").trim();
        if (!text2) return res.status(400).json({ error: "empty reply" });
        if (!gbp.isConfigured()) return res.status(503).json({ error: "GBP no configurado" });
        try { await gbp.replyToReview(id, text2); }
        catch (e) { return res.status(502).json({ error: "Google rechazó la publicación: " + e.message }); }
        try {
          var meta = body.meta || {};
          await insertReviewIfNew({
            review_id: id, location_id: String(id).split("/")[3] || null,
            location_name: meta.location_name || null, author: meta.author || null,
            rating: meta.rating || null, comment: meta.comment || "",
            review_ts: meta.review_ts || null, draft_reply: text2,
          });
          await markReviewPublished(id, text2, who);
        } catch (e) { /* la publicacion ya esta en Google; el registro es best-effort */ }
        var lk = String(id).split("/reviews/")[0].replace("accounts/", "").replace("/locations/", "/");
        delete _lists[lk]; _stats = null; // invalidar caches
        return res.status(200).json({ status: "published" });
      }

      var review = await getReview(id);
      if (!review) return res.status(404).json({ error: "review not found" });
      if (action === "save") {
        var text = String(body.reply || "").trim();
        if (!text) return res.status(400).json({ error: "empty reply" });
        await updateReviewDraft(id, text);
        return res.status(200).json({ status: "saved" });
      }
      if (action === "skip") { await markReviewSkipped(id); return res.status(200).json({ status: "skipped" }); }
      if (action === "publish") {
        if (review.status !== "draft") return res.status(409).json({ error: "already " + review.status });
        var reply = String(body.reply || review.draft_reply || "").trim();
        if (!reply) return res.status(400).json({ error: "empty reply" });
        if (!gbp.isConfigured()) return res.status(503).json({ error: "GBP no configurado" });
        await updateReviewDraft(id, reply);
        try { await gbp.replyToReview(id, reply); }
        catch (e) { return res.status(502).json({ error: "Google rechazó la publicación: " + e.message }); }
        await markReviewPublished(id, reply, who);
        return res.status(200).json({ status: "published" });
      }
      return res.status(400).json({ error: "unknown action" });
    }

    return res.status(405).json({ error: "method not allowed" });
  } catch (err) {
    console.error("reviews endpoint error:", err);
    return res.status(500).json({ error: err.message });
  }
};
