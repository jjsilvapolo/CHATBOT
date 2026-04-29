const webpush = require("web-push");
const { initDB } = require("./_db");
const { neon } = require("@neondatabase/serverless");

let dbReady = false;
let _dbInitPromise = null;

function getSQL() { return neon(process.env.DATABASE_URL); }

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!dbReady) {
    if (!_dbInitPromise) _dbInitPromise = initDB();
    await _dbInitPromise;
    // Create push_subscriptions table
    var sql = getSQL();
    try {
      await sql`CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        user_name TEXT NOT NULL,
        endpoint TEXT UNIQUE NOT NULL,
        subscription JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`;
    } catch (e) {}
    dbReady = true;
  }

  var key = req.body?.key || req.query?.key;
  if (key !== process.env.DASHBOARD_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // GET: return VAPID public key
  if (req.method === "GET") {
    return res.status(200).json({ vapidPublicKey: VAPID_PUBLIC });
  }

  // POST: save subscription
  if (req.method === "POST" && req.body?.action === "subscribe") {
    var sub = req.body.subscription;
    var userName = req.body.userName;
    if (!sub || !sub.endpoint || !userName) {
      return res.status(400).json({ error: "subscription and userName required" });
    }
    var sql2 = getSQL();
    try {
      await sql2`INSERT INTO push_subscriptions (user_name, endpoint, subscription)
        VALUES (${userName}, ${sub.endpoint}, ${JSON.stringify(sub)})
        ON CONFLICT (endpoint) DO UPDATE SET subscription = ${JSON.stringify(sub)}, user_name = ${userName}`;
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // POST: send test notification
  if (req.method === "POST" && req.body?.action === "test") {
    return await sendPushToAll("Test BJ Chat", "Las notificaciones funcionan correctamente", res);
  }

  return res.status(400).json({ error: "Unknown action" });
};

async function sendPushToAll(title, body, res) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    if (res) return res.status(500).json({ error: "VAPID not configured" });
    return;
  }
  webpush.setVapidDetails("mailto:info@burgerjazz.com", VAPID_PUBLIC, VAPID_PRIVATE);
  var sql = getSQL();
  var subs = await sql`SELECT subscription, endpoint FROM push_subscriptions`;
  var sent = 0, failed = 0;
  for (var i = 0; i < subs.length; i++) {
    try {
      var sub = typeof subs[i].subscription === "string" ? JSON.parse(subs[i].subscription) : subs[i].subscription;
      await webpush.sendNotification(sub, JSON.stringify({ title: title, body: body, url: "/dashboard.html" }));
      sent++;
    } catch (e) {
      failed++;
      if (e.statusCode === 410 || e.statusCode === 404) {
        try { await sql`DELETE FROM push_subscriptions WHERE endpoint = ${subs[i].endpoint}`; } catch (e2) {}
      }
    }
  }
  if (res) return res.status(200).json({ sent: sent, failed: failed });
}

// Export for use in chat.js
module.exports.sendPushToAll = async function (title, body) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;
  webpush.setVapidDetails("mailto:info@burgerjazz.com", VAPID_PUBLIC, VAPID_PRIVATE);
  var sql = getSQL();
  try {
    var subs = await sql`SELECT subscription, endpoint FROM push_subscriptions`;
    for (var i = 0; i < subs.length; i++) {
      try {
        var sub = typeof subs[i].subscription === "string" ? JSON.parse(subs[i].subscription) : subs[i].subscription;
        await webpush.sendNotification(sub, JSON.stringify({ title: title, body: body, url: "/dashboard.html" }));
      } catch (e) {
        if (e.statusCode === 410 || e.statusCode === 404) {
          try { await sql`DELETE FROM push_subscriptions WHERE endpoint = ${subs[i].endpoint}`; } catch (e2) {}
        }
      }
    }
  } catch (e) {}
};
