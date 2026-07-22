#!/usr/bin/env node
// Batería de smoke tests contra el bot EN PROD (o preview con BOT_URL=...).
// Pregunta al bot cosas clave del negocio y comprueba que la respuesta no
// contradiga los datos reales (fuente: Rodrigo, NO la web burgerjazz.com).
// Uso:  node scripts/smoke-prod.js            → https://bot.burgerjazz.com
//       BOT_URL=https://... node scripts/smoke-prod.js
//
// Cada caso: { q, must: [regex...], mustNot: [regex...] }
// must    → TODAS deben aparecer en la respuesta
// mustNot → NINGUNA debe aparecer (datos obsoletos / inventados)

const BASE = process.env.BOT_URL || "https://bot.burgerjazz.com";
const ORIGIN = "https://burgerjazz.com"; // /api/chat rechaza peticiones sin Origin

const CASES = [
  {
    name: "JazzFrienzz no existe (descuentos invalidados)",
    q: "Tengo un cupon de descuento de JazzFrienzz, lo puedo usar?",
    must: [/jazzfrienzz/i, /no (esta|está) activo|ya no existe|no funciona|dejaron de funcionar|no.*(valido|válido)/i],
    mustNot: [/puedes canjear|consultar (tu )?saldo|tus puntos acumulados/i],
  },
  {
    name: "Pedir para recoger → pedir.burgerjazz.com",
    q: "Quiero pedir online y recogerlo yo, como lo hago?",
    must: [/pedir\.burgerjazz\.com/i],
    mustNot: [/pedidos\.burgerjazz\.com|pide-ya/i],
  },
  {
    name: "Sin delivery propio (solo Glovo/Uber a domicilio)",
    q: "Teneis reparto a domicilio propio?",
    must: [/glovo|uber/i],
    mustNot: [/nuestro (propio )?(reparto|delivery)|repartidores propios|si,? tenemos delivery propio/i],
  },
  {
    name: "Sin gluten: NO hay en ningun local",
    q: "Teneis pan sin gluten o opciones para celiacos?",
    must: [/no/i, /gluten/i],
    mustNot: [/si,? tenemos (pan |opciones )?sin gluten|pan sin gluten disponible/i],
  },
  {
    name: "Jazz Days: miercoles 2x1 solo en local",
    q: "Cuando es el 2x1 de burgers?",
    must: [/mi(e|é)rcoles/i, /2x1/i],
    mustNot: [/glovo.{0,30}2x1|2x1.{0,40}(en )?(glovo|uber)/i],
  },
  {
    name: "Locales: 8 activos, sin Retiro/Alcorcon/Malasana/Alcobendas",
    q: "En que ciudades y barrios teneis locales?",
    must: [/chamber(i|í)/i, /valladolid/i],
    mustNot: [/retiro|alcorc(o|ó)n|malasa(n|ñ)a|alcobendas/i],
  },
  {
    name: "Retiro esta cerrado",
    q: "Cual es el horario del local de Retiro?",
    must: [/no|cerrad|ya no/i],
    mustNot: [/retiro.{0,80}(abre|abierto|12:|13:|19:|20:)/i],
  },
  {
    name: "Chicken Jazz no existe en la carta",
    q: "Que lleva la Chicken Jazz?",
    must: [/no/i],
    mustNot: [/la chicken jazz lleva|deliciosa chicken/i],
  },
  {
    name: "Sin telefono de atencion (no inventar numeros)",
    q: "Dame el telefono de atencion al cliente",
    must: [/info@burgerjazz\.com|no.*(telefono|teléfono)/i],
    mustNot: [/\b[6-9]\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b/],
  },
  {
    name: "Sin reservas",
    q: "Puedo reservar mesa para 6 personas el sabado?",
    must: [/no/i],
    mustNot: [/reserva confirmada|he reservado|tu reserva/i],
  },
  {
    name: "Menu del dia L-V",
    q: "Hay menu del dia los sabados?",
    must: [/lunes|l-v|viernes|no/i],
    mustNot: [/menu del dia (el )?s(a|á)bado s(i|í)/i],
  },
  {
    name: "Incidencia Glovo → redirigir a la app (no recoger datos)",
    q: "Mi pedido de Glovo ha llegado frio y quiero un reembolso",
    must: [/glovo/i, /app|ayuda/i],
    mustNot: [/dame tu (telefono|teléfono|nombre)|DATOS RECOGIDOS|te paso con un agente/i],
  },
];

async function ask(q, sessionId) {
  const res = await fetch(BASE + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ messages: [{ role: "user", content: q }], sessionId }),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const data = await res.json();
  if (!data.reply) throw new Error("Sin campo reply: " + JSON.stringify(data).slice(0, 200));
  return data.reply;
}

// Comprobacion extra: el widget en prod debe servir la URL de pedidos nueva
async function checkWidget() {
  const res = await fetch(BASE + "/widget.js");
  const body = await res.text();
  const ok = res.ok && body.includes("pedir.burgerjazz.com") && !body.includes("pedidos.burgerjazz.com");
  return { name: "widget.js sirve pedir.burgerjazz.com", ok, detail: ok ? "" : "HTTP " + res.status };
}

(async function main() {
  console.log("Smoke tests contra " + BASE + "  (" + CASES.length + " preguntas + widget)\n");
  const stamp = Date.now();
  let failures = 0;

  const w = await checkWidget();
  console.log((w.ok ? "  ✓ " : "  ✗ ") + w.name + (w.detail ? " — " + w.detail : ""));
  if (!w.ok) failures++;

  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i];
    const sessionId = "smoke-" + stamp + "-" + i;
    let reply, errs = [];
    try {
      reply = await ask(c.q, sessionId);
      for (const re of c.must) if (!re.test(reply)) errs.push("falta " + re);
      for (const re of c.mustNot) if (re.test(reply)) errs.push("aparece " + re);
    } catch (e) {
      errs.push("ERROR " + e.message);
    }
    const ok = errs.length === 0;
    if (!ok) failures++;
    console.log((ok ? "  ✓ " : "  ✗ ") + c.name);
    if (!ok) {
      console.log("      pregunta : " + c.q);
      console.log("      respuesta: " + String(reply || "(sin respuesta)").replace(/\n/g, " ").slice(0, 300));
      errs.forEach((e) => console.log("      problema : " + e));
    }
    // Respetar el rate limit (20/min por sesion, 60/min por IP)
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log("\n" + (CASES.length + 1 - failures) + "/" + (CASES.length + 1) + " OK");
  if (failures > 0) {
    console.log("HAY FALLOS — revisar respuestas arriba (posible dato desactualizado en el bot).");
    process.exit(1);
  }
  console.log("Todo coherente con los datos del negocio.");
})();
