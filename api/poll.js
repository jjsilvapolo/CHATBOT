const { initDB, getSession } = require("./_db");

let dbReady = false;
let _dbInitPromise = null;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  var sid = req.query.session;
  var after = req.query.after; // ISO timestamp: only return msgs after this
  if (!sid || typeof sid !== "string" || sid.length > 60) {
    return res.status(400).json({ error: "Invalid session" });
  }

  try {
    if (!dbReady) {
      if (!_dbInitPromise) _dbInitPromise = initDB();
      await _dbInitPromise;
      dbReady = true;
    }

    var rows = await getSession(sid);
    // Filter only admin messages (prompt_version = ADMIN)
    var adminMsgs = rows.filter(function (r) {
      return r.user_msg === "[ADMIN]";
    });

    // If "after" param, only return newer messages
    if (after) {
      var afterDate = new Date(after);
      adminMsgs = adminMsgs.filter(function (r) {
        return new Date(r.ts) > afterDate;
      });
    }

    var result = adminMsgs.map(function (r) {
      return { text: r.bot_msg, ts: r.ts };
    });

    return res.status(200).json({ messages: result });
  } catch (e) {
    return res.status(500).json({ error: "Server error" });
  }
};
