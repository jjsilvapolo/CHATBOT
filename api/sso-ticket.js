// SSO DE LA APP DE TRABAJADORES (27/07/2026). El servidor de la app (que ya ha
// autenticado al usuario y comprobado su rol) pide aqui un ticket de dashboard de
// corta vida (8h) para el iframe embebido. Asi la credencial permanente
// (user:password) deja de viajar al navegador. Servidor a servidor, con el
// secreto de federacion (mismo que /api/bridge-kpis).
const { timingSafeEqualStr, mintDashTicket } = require("./_auth");


module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const secret = process.env.BRIDGE_SECRET;
  if (!secret) return res.status(503).json({ error: "bridge_no_configurado" });
  if (!timingSafeEqualStr(String(req.headers["x-bridge-secret"] || ""), secret)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const user = (req.body && req.body.user) || "app";
  const ticket = mintDashTicket(user, 8 * 3600 * 1000);
  return res.status(200).json({ ok: true, ticket, exp: Date.now() + 8 * 3600 * 1000 });
};
