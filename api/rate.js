const { initDB, saveRating } = require("./_db");

let dbReady = false;
let _dbInitPromise = null;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!dbReady) {
    if (!_dbInitPromise) _dbInitPromise = initDB();
    await _dbInitPromise;
    dbReady = true;
  }

  const { sessionId, rating } = req.body;
  if (!sessionId || typeof sessionId !== "string" || sessionId.length > 60) {
    return res.status(400).json({ error: "Invalid sessionId" });
  }
  var r = parseInt(rating);
  if (isNaN(r) || r < 1 || r > 5) {
    return res.status(400).json({ error: "rating (1-5) required" });
  }

  await saveRating(sessionId, r);
  return res.status(200).json({ ok: true });
};
