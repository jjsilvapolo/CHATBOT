// Cross-instance rate limiting backed by Postgres (Neon), so limits hold across
// the multiple serverless instances Vercel runs in parallel — unlike in-memory
// counters. Every function here FAILS OPEN on a DB error: a problem in the
// limiter can never lock legitimate users out.
const { getSQLInstance } = require("./_db");

let _tableReady = false;
async function ensureTable() {
  if (_tableReady) return;
  var sql = getSQLInstance();
  await sql`CREATE TABLE IF NOT EXISTS rate_limits (
    bucket TEXT PRIMARY KEY,
    window_start TIMESTAMPTZ DEFAULT NOW(),
    count INTEGER DEFAULT 0
  )`;
  _tableReady = true;
}

// Increment a bucket within a rolling window and return { allowed, count }.
// Use for "max N actions per window" where every call counts (e.g. deletes, chat).
async function checkRate(bucket, limit, windowSeconds) {
  try {
    await ensureTable();
    var sql = getSQLInstance();
    var rows = await sql`
      INSERT INTO rate_limits (bucket, window_start, count)
      VALUES (${bucket}, NOW(), 1)
      ON CONFLICT (bucket) DO UPDATE SET
        count = CASE WHEN rate_limits.window_start < NOW() - make_interval(secs => ${windowSeconds})
                     THEN 1 ELSE rate_limits.count + 1 END,
        window_start = CASE WHEN rate_limits.window_start < NOW() - make_interval(secs => ${windowSeconds})
                            THEN NOW() ELSE rate_limits.window_start END
      RETURNING count`;
    if (Math.random() < 0.01) {
      try { await sql`DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 day'`; } catch (e) {}
    }
    var count = rows[0] ? parseInt(rows[0].count) : 1;
    return { allowed: count <= limit, count: count };
  } catch (e) {
    console.error("checkRate DB error (fail-open):", e.message);
    return { allowed: true, count: 0 };
  }
}

// Read the current count in the window WITHOUT incrementing (0 if expired/absent).
async function peekRate(bucket, windowSeconds) {
  try {
    await ensureTable();
    var sql = getSQLInstance();
    var rows = await sql`
      SELECT count FROM rate_limits
      WHERE bucket = ${bucket} AND window_start >= NOW() - make_interval(secs => ${windowSeconds})`;
    return rows[0] ? parseInt(rows[0].count) : 0;
  } catch (e) {
    console.error("peekRate DB error (fail-open):", e.message);
    return 0;
  }
}

// Increment a bucket's counter (resetting the window if it expired). Used to
// count failures for brute-force protection. Returns the new count.
async function bumpRate(bucket, windowSeconds) {
  var r = await checkRate(bucket, Infinity, windowSeconds);
  return r.count;
}

// Clear a bucket (e.g. after a successful login).
async function clearRate(bucket) {
  try {
    var sql = getSQLInstance();
    await sql`DELETE FROM rate_limits WHERE bucket = ${bucket}`;
  } catch (e) {}
}

module.exports = { checkRate, peekRate, bumpRate, clearRate };
