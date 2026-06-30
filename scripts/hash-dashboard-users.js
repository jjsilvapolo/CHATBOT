#!/usr/bin/env node
// Convierte el DASHBOARD_USERS en claro a su versión hasheada (scrypt), para
// pegar el resultado en la variable de entorno de Vercel. Las claves dejan de
// estar en texto plano. El código (api/_auth.js) acepta tanto hash como claro,
// así que el login sigue funcionando durante la migración.
//
// Uso:
//   DASHBOARD_USERS='{"Marta":"clave1","Nacho":"clave2"}' node scripts/hash-dashboard-users.js
//
// Pega la salida (una línea JSON) en la env var DASHBOARD_USERS de Vercel.
const crypto = require("crypto");

function hash(pw) {
  var salt = crypto.randomBytes(16);
  var h = crypto.scryptSync(String(pw), salt, 32);
  return "scrypt$" + salt.toString("hex") + "$" + h.toString("hex");
}

var raw = process.env.DASHBOARD_USERS;
if (!raw) {
  console.error("Define DASHBOARD_USERS con el JSON en claro. Ej:");
  console.error("  DASHBOARD_USERS='{\"Marta\":\"clave1\"}' node scripts/hash-dashboard-users.js");
  process.exit(1);
}

var users;
try { users = JSON.parse(raw); } catch (e) {
  console.error("DASHBOARD_USERS no es JSON válido:", e.message);
  process.exit(1);
}

var out = {};
Object.keys(users).forEach(function (u) { out[u] = hash(users[u]); });
console.log(JSON.stringify(out));
