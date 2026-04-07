const Anthropic = require("@anthropic-ai/sdk");
const { initDB, getStats, getSession, getRatings } = require("./_db");

let dbReady = false;
let _dbInitPromise = null;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  const authKey = req.query.key || req.headers["x-dashboard-key"];
  if (authKey !== process.env.DASHBOARD_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    if (!dbReady) {
      if (!_dbInitPromise) _dbInitPromise = initDB();
      await _dbInitPromise;
      dbReady = true;
    }

    // If session query param, return full session
    if (req.query.session) {
      const msgs = await getSession(req.query.session);
      return res.status(200).json({ messages: msgs.map(function(m) {
        return { ts: m.ts, user: m.user_msg, bot: m.bot_msg, category: m.category };
      })});
    }

    const stats = await getStats();
    stats.ratings = await getRatings();

    // Estimate cost (Haiku 4.5: $0.80/M input, $4/M output)
    stats.estimatedCost =
      "$" +
      (
        (stats.totalTokens.input / 1000000) * 0.8 +
        (stats.totalTokens.output / 1000000) * 4
      ).toFixed(4);

    // Check Anthropic credit status
    try {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const test = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 5,
        messages: [{ role: "user", content: "ok" }],
      });
      stats.creditStatus = "ok";
    } catch (err) {
      if (err.message && err.message.includes("credit")) {
        stats.creditStatus = "NO_CREDIT";
      } else if (err.message && err.message.includes("auth")) {
        stats.creditStatus = "AUTH_ERROR";
      } else {
        stats.creditStatus = "error";
        stats.creditError = err.message;
      }
    }

    return res.status(200).json(stats);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
