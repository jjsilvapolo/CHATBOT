// Reviews approval endpoint (backs /resenas.html).
// Auth: same dashboard credential as the rest of the panel (x-dashboard-key /
// Bearer / body.key — never the query string, per _auth.js).
//
//   GET  /api/reviews                      → { reviews: [pending drafts] }
//   POST /api/reviews { action, id, ... }  → publish | save | skip
//
// Publishing calls Google Business Profile. Everything else is DB-only.

const { initDB, getPendingReviews, getReview, updateReviewDraft, markReviewPublished, markReviewSkipped } = require("./_db");
const { validateDashKey, readDashKey } = require("./_auth");
const gbp = require("./_gbp");

let dbReady = false;
let _dbInitPromise = null;

module.exports = async function handler(req, res) {
  var authKey = readDashKey(req);
  if (!validateDashKey(authKey)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!dbReady) {
    if (!_dbInitPromise) _dbInitPromise = initDB();
    await _dbInitPromise;
    dbReady = true;
  }

  try {
    if (req.method === "GET") {
      var pending = await getPendingReviews();
      return res.status(200).json({ configured: gbp.isConfigured(), reviews: pending });
    }

    if (req.method === "POST") {
      var body = req.body || {};
      var action = body.action;
      var id = body.id; // review_id = full GBP resource name
      if (!id) return res.status(400).json({ error: "missing id" });

      var review = await getReview(id);
      if (!review) return res.status(404).json({ error: "review not found" });

      var who = (readDashKey(req).split(":")[0]) || "panel";

      if (action === "save") {
        var text = String(body.reply || "").trim();
        if (!text) return res.status(400).json({ error: "empty reply" });
        await updateReviewDraft(id, text);
        return res.status(200).json({ status: "saved" });
      }

      if (action === "skip") {
        await markReviewSkipped(id);
        return res.status(200).json({ status: "skipped" });
      }

      if (action === "publish") {
        if (review.status !== "draft") return res.status(409).json({ error: "already " + review.status });
        var reply = String(body.reply || review.draft_reply || "").trim();
        if (!reply) return res.status(400).json({ error: "empty reply" });
        if (!gbp.isConfigured()) return res.status(503).json({ error: "GBP no configurado" });

        // Persist the (possibly edited) text before hitting Google, then post.
        await updateReviewDraft(id, reply);
        try {
          await gbp.replyToReview(id, reply);
        } catch (e) {
          return res.status(502).json({ error: "Google rechazó la publicación: " + e.message });
        }
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
