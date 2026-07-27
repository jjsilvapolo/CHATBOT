// PUENTE DE FEDERACION (22/07/2026). KPIs read-only de reseñas para la app de
// trabajadores (cerebro diario + tarjeta de canales digitales). NO expone textos de
// clientes ni datos personales: solo agregados (nota media, volumenes, pendientes).
//
// Auth: cabecera `x-bridge-secret`. El valor canonico vive en BRIDGE_SECRET (env);
// mientras no este dado de alta en Vercel, vale el secreto embebido (repos privados,
// codigo solo-servidor; migrar a env cuando se pueda y borrar el fallback).
const { getSQLInstance } = require("./_db");
const { timingSafeEqualStr } = require("./_auth");

const BRIDGE_FALLBACK = "3dd79c8d1c6da07755ab42df53b55583a97d99d342784655bf8805c61f2fdd0b";

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });
  const secret = process.env.BRIDGE_SECRET || BRIDGE_FALLBACK;
  if (!timingSafeEqualStr(String(req.headers["x-bridge-secret"] || ""), secret)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const sql = getSQLInstance();
    // Una sola pasada agregada: global 30d + desglose por local + pendientes.
    const [tot30, porLocal, pendientes, nuevas7d, bajas7d] = await Promise.all([
      sql`SELECT COUNT(*)::int AS n, ROUND(AVG(rating)::numeric, 2) AS media FROM reviews WHERE review_ts >= NOW() - INTERVAL '30 days'`,
      sql`SELECT COALESCE(location_name, location_id, 'desconocido') AS local, COUNT(*)::int AS n, ROUND(AVG(rating)::numeric, 2) AS media
          FROM reviews WHERE review_ts >= NOW() - INTERVAL '30 days'
          GROUP BY 1 ORDER BY media ASC NULLS LAST`,
      sql`SELECT COUNT(*)::int AS n FROM reviews WHERE status = 'draft'`,
      sql`SELECT COUNT(*)::int AS n FROM reviews WHERE review_ts >= NOW() - INTERVAL '7 days'`,
      // Reseñas malas (<=2) de la ultima semana: lo unico accionable en el dia a dia.
      sql`SELECT COALESCE(location_name, location_id, 'desconocido') AS local, rating, review_ts::date AS dia
          FROM reviews WHERE review_ts >= NOW() - INTERVAL '7 days' AND rating <= 2
          ORDER BY review_ts DESC LIMIT 20`,
    ]);
    return res.status(200).json({
      ok: true,
      fuente: "jazzbot-resenas",
      at: new Date().toISOString(),
      resenas: {
        notaMedia30d: tot30[0] && tot30[0].media != null ? Number(tot30[0].media) : null,
        total30d: (tot30[0] && tot30[0].n) || 0,
        nuevas7d: (nuevas7d[0] && nuevas7d[0].n) || 0,
        pendientesRespuesta: (pendientes[0] && pendientes[0].n) || 0,
        porLocal: porLocal.map((r) => ({ local: r.local, n: r.n, media: r.media != null ? Number(r.media) : null })),
        malas7d: bajas7d.map((r) => ({ local: r.local, rating: r.rating, dia: String(r.dia).slice(0, 10) })),
      },
    });
  } catch (e) {
    return res.status(500).json({ error: "bridge_error", detail: String((e && e.message) || e).slice(0, 120) });
  }
};
