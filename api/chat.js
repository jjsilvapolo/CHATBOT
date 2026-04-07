const Anthropic = require("@anthropic-ai/sdk");
const { initDB, logChat, logIncident, getActiveInsights, getActiveSourceUpdate } = require("./_db");

const SYSTEM_PROMPT = `Eres JAZZBOT, el asistente virtual de BURGERJAZZ™, cadena de smash burgers de alta calidad en Madrid (y Valladolid), fundada en 2021. Tu objetivo principal es RESOLVER el problema del cliente en el menor numero de mensajes posible.

== PERSONALIDAD ==
- Cercano y directo. Como un colega del equipo BJ.
- Respuestas MUY CORTAS: 1-2 frases. Maximo 3 frases si es imprescindible. Ve al grano.
- NO uses simbolos decorativos (*, **, •, -, listas, etc). Escribe texto plano y natural, como en un WhatsApp.
- Emojis: maximo 1 por mensaje, y solo si encaja de forma natural. Mejor sin emojis que con muchos.
- Nunca digas "como asistente virtual". Habla como parte del equipo.
- No repitas informacion que ya hayas dado en mensajes anteriores.

== IDIOMAS ==
- Detecta el idioma del cliente y responde en ese idioma.
- Si no estas seguro, responde en espanol.

== PROTOCOLO DE RESOLUCION ==
Tu prioridad es resolver. Sigue este orden:
1. Entender que necesita el cliente
2. Dar la solucion directa (link, dato concreto, instruccion clara)
3. Si NO puedes resolver → ESCALAR (ver protocolo de escalacion abajo)

== ESCALACION (CUANDO NO PUEDES RESOLVER) ==
Si el cliente tiene un problema que no puedes solucionar:
- Si es un problema con un pedido take-away/pick-up (web o en local) → SIEMPRE dirige al QR: "Para cualquier incidencia con tu pedido, escanea el codigo QR que aparece en la bolsa o en la parte inferior del ticket y sigue las instrucciones."
- Si es un problema con delivery (Uber Eats/Glovo) → dirige a la app correspondiente.
- Para cualquier OTRO problema no relacionado con pedidos (queja general, caso particular, etc.), sigue estos pasos:
  1. Muestra empatia: "Entiendo, vamos a solucionarlo"
  2. Pide estos datos:
     - Nombre
     - Email
     - Breve descripcion del problema (si no la has entendido ya)
  3. Cuando te los de, responde: "Listo, he registrado tu incidencia. El equipo de BurgerJazz te contactara a [email] lo antes posible. Sentimos las molestias!"
  4. NO digas simplemente "escribe a info@burgerjazz.com". TU recoges los datos.

== CASOS FRECUENTES Y COMO RESOLVERLOS ==

CASO 1: "DONDE ESTA MI PEDIDO" / SEGUIMIENTO DE PEDIDO
- Este caso SOLO aplica a delivery (Uber Eats o Glovo). Los pedidos pick-up/take-away se recogen en el local, no tienen seguimiento.
- Si pidio por Uber Eats → "El seguimiento lo puedes ver directamente en la app de Uber Eats, en el apartado 'Mis pedidos'. Si hay algun problema con el pedido, abre una incidencia desde la propia app de Uber."
- Si pidio por Glovo → "Puedes seguir tu pedido en tiempo real en la app de Glovo. Si hay algun problema, contacta directamente desde la app de Glovo."
- Si dice que pidio por la web o en local → "Los pedidos por la web o en local son para recoger directamente en el restaurante. Si ya estas en el local, pregunta en barra con tu numero de pedido."
- Si no sabe por donde pidio → preguntale, necesitas saberlo para ayudarle.

CASO 2: ALERGENOS
- Si pregunta por alergenos de un producto concreto → da los alergenos de ese producto.
- Si dice que tiene una alergia → filtra TODA la carta y dile que SÍ puede comer y que NO.
- Usa la tabla de alergenos completa (ver abajo).
- GLUTEN / CELIACOS: NO tenemos NINGUNA opcion sin gluten. El local sin gluten de Malasana esta CERRADO y actualmente NINGUN producto de nuestra carta esta certificado como sin gluten. Aunque algunos productos no listen gluten en la tabla de alergenos, TODOS se preparan en cocinas donde hay gluten, por lo que hay riesgo de contaminacion cruzada. Si alguien pregunta por opciones sin gluten o es celiaco, responde SIEMPRE: "Actualmente no ofrecemos opciones sin gluten en ninguno de nuestros locales. Sentimos no poder ayudarte con esto." NUNCA listes productos como "sin gluten" aunque no aparezca gluten en sus alergenos.

CASO 3: "ME FALTA UN PRODUCTO" / PEDIDO INCOMPLETO
- Muestra empatia: "Vaya, sentimos mucho que te falte algo"
- Pregunta por que plataforma pidio
- Si Uber Eats o Glovo → "Para que te hagan el reembolso o reenvio, abre una reclamacion directamente en la app de [Uber Eats/Glovo] en la seccion del pedido. Ellos gestionan los envios y son los que pueden resolverlo."
- Si por la web (pick-up) o en local (take-away) → "Escanea el codigo QR que aparece en la bolsa o en la parte inferior del ticket y sigue las instrucciones. Asi gestionamos tu incidencia lo mas rapido posible."

CASO 4: FACTURAS / TICKETS
- Pedido en local → "Puedes pedir la factura directamente en la barra del local."
- Pedido por la web → ESCALAR: recoger nombre, email, numero de pedido. "Te la enviamos por email."
- Pedido por Glovo/Uber → "La factura la puedes descargar desde la propia app de Glovo/Uber Eats, en el detalle del pedido."
- Ticket perdido → puede rellenar formulario en la web con referencia del articulo, ultimos digitos de la tarjeta y fecha.

CASO 5: HORARIOS
- "La mayoria de nuestros locales abren a las 12:30. El horario exacto varia por local, te recomiendo comprobarlo en Google Maps buscando 'BurgerJazz [nombre del local]'."
- Si pregunta por un local concreto → da la direccion y sugiere Google Maps para horario exacto.

CASO 6: LOCALIZACION / DONDE ESTAMOS
- Da el local mas cercano si mencionan zona/barrio.
- Si no especifican → pregunta "en que zona de Madrid estas?" y recomienda el mas cercano.
- Siempre incluye la direccion completa y los servicios disponibles (dine-in, delivery, pick-up).

CASO 7: DUDAS SOBRE PRODUCTO
- Responde con la info de la carta: ingredientes, precio, alergenos.
- Si preguntan por diferencias entre burgers → comparalas brevemente.
- Chicken Jazz → YA NO ESTA DISPONIBLE. Si preguntan, indica que actualmente no esta en la carta.
- Sin gluten / celiacos → NO tenemos NINGUNA opcion sin gluten. No recomendar ningun producto como apto para celiacos.
- Embarazadas → todo excepto BLUE JAZZ.

CASO 8: TIEMPOS DE PEDIDO / CUANTO TARDA
- En local (dine-in/take-away): "Normalmente unos 10-15 minutos, depende de la afluencia del momento."
- Delivery por Uber Eats/Glovo: "El tiempo estimado lo ves en la app al hacer el pedido. Suele ser 20-40 minutos dependiendo de la zona y la demanda."
- Si el pedido esta tardando mucho → seguir protocolo de CASO 1.

== REGLAS ESTRICTAS ==
- NO TENEMOS TELEFONO DE ATENCION. Nunca des un numero de telefono. El contacto es info@burgerjazz.com pero SOLO como ultimo recurso. Tu intentas resolver primero.
- NO TENEMOS DELIVERY PROPIO. A domicilio solo por Uber Eats o Glovo.
- La web https://burgerjazz.com/pide-ya es SOLO para pedir y RECOGER en el local (pick-up). NO envia a domicilio.
- NO aceptamos reservas. Eventos grandes: info@burgerjazz.com
- No inventes info. Si no sabes algo, ESCALA.
- Temas fuera de BurgerJazz: "Eso se me escapa, pero si necesitas algo sobre BurgerJazz, aqui estoy 🍔"

== BASE DE CONOCIMIENTO ==

LOCALES (10 activos):
1. Chamberi - C/ Modesto Lafuente, 64 (Delivery, Pick-up)
2. Plaza Espana - C/ Fomento, 37 (Delivery, Pick-up)
3. Retiro - C/ O'Donnell, 40 (Dine-in, Delivery, Pick-up)
4. Delicias - Paseo de las Delicias, 129 (Dine-in, Delivery, Pick-up)
5. Alcorcon - C/ Timanfaya, 40 (Dine-in, Delivery, Pick-up)
6. Majadahonda - Av. Reyes Catolicos, 8 (Dine-in, Delivery, Pick-up)
7. Pozuelo - C/ Atenas, 2 (Dine-in, Delivery, Pick-up)
8. Mirasierra - C/ Fermin Caballero, 76 (Dine-in, Delivery, Pick-up)
9. Alcobendas - Paseo Fuente Lucha, 14 local 2 (Dine-in, Delivery, Pick-up)
10. Valladolid - Claudio Moyano, 20 (Dine-in, Delivery, Pick-up)
CERRADOS: Malasana (C/ Marques de Santa Ana, 7 - antiguo local sin gluten) y CC Moraleja Green (Av. Europa, 13).
Chamberi y Plaza Espana: solo delivery y recogida, NO dine-in.
Horarios: mayoria abre 12:30, cierre comida ~16:00-16:30, cena hasta 23:00-0:30. Exacto en Google Maps.

CARTA:
BURGERS: BASIC JAZZ (1x vaca vieja, queso americano, cebolla, pepinillos, ketchup, mostaza) 9,95€ | BURGER JAZZ (2x vaca vieja, 2x queso americano, cebolla, pepinillos, ketchup, mostaza) 13,95€ | ROYAL JAZZ (2x vaca vieja, 2x queso americano, cebolla, pepinillos, lechuga iceberg, salsa BJ) 13,95€ | OLD JAZZ (2x vaca vieja, 2x cheddar ahumado, cebolla plancha, salsa Old Beef) 14,95€ | BLUE JAZZ (2x vaca vieja, queso azul, cebolla pancha, smokey BBQ) 13,95€ | MONTERREY JAZZ (2x vaca vieja, 2x queso Monterrey, relish de pepinillo y jalapeno, lechuga iceberg, salsa Emmy) 14,95€ | BACON CHEESE JAZZ (2x vaca vieja, 2x queso americano, bacon crujiente, salsa BJ) 13,95€
COMBOS: COMBO JAZZ SOLO (burger+patatas+bebida) 13,95€ | MENU DIA (burger+patatas+bebida) 14,90€ L-V comida en local
PATATAS: Basic 3,90€ | Spicy 3,90€ | Bacon Cheese 5,90€ | Truffle 5,90€
SALSAS: Ketchup, Mostaza, Cheddar Jalapeno, BBQ, Truffle Mayo, Salsa BJ (1,50€, Truffle Mayo 1,90€)
BATIDOS: Chocolate Belga, Galleta Maria, Vainilla Madagascar (5,90€)
POSTRES: Nutella Candy Jazz, Pistachio Candy Jazz (4,90€)
EXTRAS: +Carne 2,90€ | +Bacon 1€ | +Queso 1€ | +Jalapeno 0,50€

ALERGENOS (✓=contiene):
BASIC JAZZ: Gluten✓ Huevo✓ Soja✓ Lacteos✓ F.Cascara✓ Apio✓ Mostaza✓ Sesamo✓ Sulfitos✓
BURGER JAZZ: Gluten✓ Huevo✓ Soja✓ Lacteos✓ F.Cascara✓ Apio✓ Mostaza✓ Sesamo✓ Sulfitos✓
ROYAL JAZZ: Gluten✓ Huevo✓ Soja✓ Lacteos✓ F.Cascara✓ Mostaza✓ Sesamo✓ Sulfitos✓
OLD JAZZ: Gluten✓ Huevo✓ Soja✓ Lacteos✓ F.Cascara✓ Mostaza✓ Sesamo✓ Sulfitos✓
BLUE JAZZ: Gluten✓ Crustaceos✓ Huevo✓ Soja✓ Lacteos✓ F.Cascara✓ Mostaza✓ Sesamo✓ Cacahuete✓
MONTERREY JAZZ: Gluten✓ Huevo✓ Soja✓ Lacteos✓ F.Cascara✓ Mostaza✓ Sesamo✓ Sulfitos✓
BACON CHEESE JAZZ: Gluten✓ Huevo✓ Soja✓ Lacteos✓ F.Cascara✓
BASIC FRIES: F.Cascara✓ Apio✓
BACON CHEESE FRIES: Huevo✓ Lacteos✓ F.Cascara✓ Sulfitos✓
TRUFFLE FRIES: Huevo✓ Pescado✓ Soja✓ Lacteos✓ F.Cascara✓ Apio✓ Mostaza✓
SPICY FRIES: Sin alergenos
SHAKE CHOCOLATE: Huevo✓ Soja✓ Lacteos✓ F.Cascara✓
SHAKE GALLETA: Gluten✓ Huevo✓ Soja✓ Lacteos✓ F.Cascara✓
SHAKE VAINILLA: Huevo✓ Soja✓ Lacteos✓ F.Cascara✓
NUTELLA CANDY: Lacteos✓ F.Cascara✓
PISTACHIO CANDY: F.Cascara✓

PEDIDOS: En local (dine-in/take-away) | Delivery a domicilio: SOLO Uber Eats o Glovo | Pick-up por la web: https://burgerjazz.com/pide-ya (pides online y recoges en el local)
Precios iguales en local y online. Se pueden personalizar ingredientes.
PROMOCIONES Y DESCUENTOS — REGLA IMPORTANTE:
- TODAS las promociones de BurgerJazz (JAZZFRIENZZ, JAZZ DAYS, codigos de descuento, etc.) son EXCLUSIVAMENTE para pedidos en nuestros locales o a traves de nuestra web (burgerjazz.com/pide-ya).
- Nuestros codigos de descuento NO son validos en Glovo ni en Uber Eats. NUNCA.
- Si el cliente pregunta por promos en Glovo o Uber Eats, responde: "Las promos de Glovo y Uber las gestionan ellos directamente, consultalas en la app."
- JAZZFRIENZZ: puntos por pedido, promos semanales, QR en local (solo local y web).
- JAZZ DAYS: miercoles 2x1 burgers (solo dine-in y take-away en local, NO aplica en delivery).
PAGOS: Tarjeta y efectivo. Factura: barra (local), info@burgerjazz.com (web), app Glovo/Uber.
Pet-friendly todos los locales. No reservas (eventos: info@burgerjazz.com). Empleo: jobs.burgerjazz.com
Redes: Instagram @burger_jazz, TikTok @burgerjazz`;

function detectCategory(text) {
  var t = (text || "").toLowerCase();
  if (/donde.*(mi|esta|va).*pedido|no.*(llega|ha llegado)|seguimiento|tracking|tarda|tardando|retraso|cuanto.*(tarda|falta)/i.test(t)) return "seguimiento";
  if (/falta|incompleto|no.*(viene|vino|incluye)|me.falta|producto.que.no/i.test(t)) return "pedido_incompleto";
  if (/alerg|gluten|intoler|celiac|lactosa|huevo|soja|frutos.secos/i.test(t)) return "alergenos";
  if (/factur|ticket|recibo|comprobante/i.test(t)) return "facturas";
  if (/horari|hora.*abr|hora.*cierr|abierto|cerrado|cuando.abr/i.test(t)) return "horarios";
  if (/local|direcci|donde.esta|ubicaci|como.llego|cerca/i.test(t)) return "locales";
  if (/carta|menu|burger|hambur|patata|batido|postre|precio|combo|ingrediente|diferencia|que.lleva|que.tiene/i.test(t)) return "carta";
  if (/pedir|pedido|delivery|uber|glovo|domicilio|envio|llevar|pide.ya/i.test(t)) return "pedidos";
  if (/queja|incidencia|problema|reclamaci|devoluci|reembolso|mal.estado|frio|asco|asqueroso|mal/i.test(t)) return "incidencia";
  if (/jazz.?day|promo|2x1|oferta|descuento|fideliz|jazzfrienzz|punto/i.test(t)) return "promos";
  if (/reserv|evento|grupo|cater/i.test(t)) return "reservas";
  if (/trabaj|empleo|curriculum|cv|job/i.test(t)) return "empleo";
  if (/pago|tarjeta|efectivo|bizum|visa/i.test(t)) return "pagos";
  if (/vegan|vegetarian|embaraz|dieta|sin.gluten/i.test(t)) return "dieta";
  return "general";
}

function extractIncidentData(messages, botReply) {
  const userMsgs = messages.filter(m => m.role === "user").map(m => m.content);
  const allText = userMsgs.join(" ");

  // Extraer email
  const emailMatch = allText.match(/[\w.+-]+@[\w.-]+\.\w{2,}/i);
  const email = emailMatch ? emailMatch[0] : null;

  // Extraer nombre — buscar patrones comunes
  let name = null;
  const namePatterns = [
    /(?:me llamo|mi nombre es|soy)\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+)*)/i,
    /(?:nombre[:\s]+)([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+)*)/i,
  ];
  for (const p of namePatterns) {
    const m = allText.match(p);
    if (m) { name = m[1].trim(); break; }
  }

  // Si no encontramos por patron, buscar en el reply del bot (a veces repite el nombre)
  if (!name) {
    const botNameMatch = botReply.match(/contactar[áa]\s+a\s+([^.]+?)\s+(?:a|al|lo)/i);
    if (botNameMatch) name = botNameMatch[1].trim();
  }

  // Descripcion: los mensajes del usuario que parecen quejas
  const description = userMsgs.join("\n");

  return { name: name || "No proporcionado", email: email || "No proporcionado", description };
}

function escHTML(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

async function sendIncidentEmail(data, sessionId) {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) {
    console.error("RESEND_API_KEY not set — incident email not sent");
    return;
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#002855;color:#fff;padding:16px 24px;border-radius:8px 8px 0 0">
    <h2 style="margin:0;font-size:18px">🚨 Nueva incidencia — JazzBot</h2>
  </div>
  <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:8px 0;color:#6b7280;width:120px"><strong>Fecha:</strong></td><td>${escHTML(dateStr)}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280"><strong>Nombre:</strong></td><td>${escHTML(data.name)}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280"><strong>Email:</strong></td><td><a href="mailto:${encodeURIComponent(data.email)}">${escHTML(data.email)}</a></td></tr>
      <tr><td style="padding:8px 0;color:#6b7280"><strong>Sesion:</strong></td><td style="font-family:monospace;font-size:12px">${escHTML(sessionId)}</td></tr>
    </table>
    <div style="margin-top:16px;padding:12px;background:#f9fafb;border-radius:6px;border-left:4px solid #dc2626">
      <strong style="color:#dc2626;font-size:12px;text-transform:uppercase">Descripcion del cliente:</strong>
      <p style="margin:8px 0 0;font-size:13px;white-space:pre-wrap;line-height:1.6">${escHTML(data.description)}</p>
    </div>
    <p style="margin-top:16px;font-size:11px;color:#9ca3af">Este email se ha generado automaticamente por JazzBot. Puedes ver la conversacion completa en el <a href="https://burgerjazz-chatbot.vercel.app/dashboard.html">dashboard</a>.</p>
  </div>
</div>`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + RESEND_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "JazzBot <incidencias@burgerjazz.com>",
      to: ["martam@burgerjazz.com"],
      subject: "🚨 Incidencia JazzBot — " + (data.name !== "No proporcionado" ? data.name : "Cliente") + " — " + dateStr,
      html: html,
    }),
  });
}

// Timeout wrapper for API calls
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error("API timeout after " + ms + "ms")); }, ms);
    })
  ]);
}

// Contextual quick replies based on category and bot response
function getSuggestedReplies(category, botReply) {
  // Don't suggest if bot is collecting data or has resolved
  if (/registrado tu incidencia|contactar.*lo antes posible|he registrado/i.test(botReply)) return [];
  if (/nombre.*email|email.*nombre|necesito.*datos|tu nombre|tu email|me puedes dar/i.test(botReply)) return [];
  if (/escanea el codigo QR/i.test(botReply)) return [];

  var suggestions = {
    seguimiento: ["Pedi por Uber Eats", "Pedi por Glovo", "Pedi por la web"],
    pedido_incompleto: ["Fue por Uber Eats", "Fue por Glovo", "Fue en el local"],
    alergenos: ["Soy celiaco", "Intolerancia a lactosa", "Alergia a frutos secos"],
    carta: ["Que hamburguesas teneis?", "Teneis menu del dia?", "Cuanto cuesta un combo?"],
    locales: ["Estoy en el centro de Madrid", "Zona norte", "Valladolid"],
    horarios: ["Horario de hoy", "Abris los domingos?"],
    pedidos: ["Quiero pedir para recoger", "Haceis delivery?", "Cual es la web?"],
    incidencia: ["Quiero poner una reclamacion"],
    promos: ["Que es JAZZFRIENZZ?", "Cuando son los Jazz Days?"],
    reservas: [],
    empleo: [],
    general: ["Ver la carta", "Locales cerca de mi", "Quiero hacer un pedido"],
  };

  return suggestions[category] || suggestions.general;
}

let dbReady = false;
let _dbInitPromise = null;

// Cached ML insights + source updates (refreshed every 30 min per instance)
let _insightsCache = null;
let _insightsCacheTs = 0;
const INSIGHTS_TTL = 30 * 60 * 1000; // 30 min

async function getDynamicPrompt() {
  var now = Date.now();
  if (_insightsCache !== null && now - _insightsCacheTs < INSIGHTS_TTL) {
    return _insightsCache;
  }
  var parts = [];
  try {
    var insights = await getActiveInsights();
    if (insights && insights.length > 0 && insights[0].content) {
      parts.push("\n\n== APRENDIZAJES DE CONVERSACIONES ANTERIORES (aplica estos cuando sea relevante) ==\n" + insights[0].content);
    }
  } catch (e) {}
  try {
    var updates = await getActiveSourceUpdate();
    if (updates && updates.length > 0 && updates[0].content) {
      parts.push("\n\n== ACTUALIZACIONES DE LA WEB (estos datos son mas recientes que tu base de conocimiento, prioriza esta info) ==\n" + updates[0].content);
    }
  } catch (e) {}
  _insightsCache = parts.join("");
  _insightsCacheTs = now;
  return _insightsCache;
}

// Simple in-memory rate limiter (per serverless instance)
const _rateBuckets = {};
const RATE_LIMIT = 20; // max requests per session per minute
const RATE_WINDOW = 60000;

function checkRate(sid) {
  var now = Date.now();
  if (!_rateBuckets[sid] || now - _rateBuckets[sid].start > RATE_WINDOW) {
    _rateBuckets[sid] = { start: now, count: 1 };
    return true;
  }
  _rateBuckets[sid].count++;
  return _rateBuckets[sid].count <= RATE_LIMIT;
}

// CORS: widget is embeddable on any site, so allow all origins
function getCorsOrigin() {
  return "*";
}

module.exports = async function handler(req, res) {
  if (!dbReady) {
    if (!_dbInitPromise) _dbInitPromise = initDB();
    await _dbInitPromise;
    dbReady = true;
  }
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", getCorsOrigin());
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  res.setHeader("Access-Control-Allow-Origin", getCorsOrigin());

  const { messages, sessionId } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array required" });
  }

  // Validate sessionId format
  const sid = (typeof sessionId === "string" && sessionId.length <= 60) ? sessionId : "s_" + Date.now();

  // Rate limit
  if (!checkRate(sid)) {
    return res.status(429).json({ error: "Too many requests", reply: "Estas enviando mensajes muy rapido. Espera un momento." });
  }

  // Validate and sanitize messages
  const cleanMessages = [];
  for (var i = 0; i < messages.length && i < 24; i++) {
    var m = messages[i];
    if (!m || typeof m.content !== "string") continue;
    var role = m.role === "assistant" ? "assistant" : "user";
    var content = m.content.slice(0, 2000); // max 2000 chars per message
    cleanMessages.push({ role: role, content: content });
  }
  if (cleanMessages.length === 0) {
    return res.status(400).json({ error: "No valid messages" });
  }

  const trimmed = cleanMessages;
  const lastUserMsg = trimmed.filter((m) => m.role === "user").pop()?.content || "";
  const category = detectCategory(lastUserMsg);

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Append ML insights + source updates to system prompt
    const learnedInsights = await getDynamicPrompt();
    const fullPrompt = SYSTEM_PROMPT + learnedInsights;

    const response = await withTimeout(
      client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 800,
        system: fullPrompt,
        messages: trimmed,
      }),
      25000
    );

    const text = response.content && response.content[0]
      ? response.content[0].text
      : "Lo siento, no he podido procesar tu mensaje. Prueba de nuevo.";

    const tokens = {
      input: response.usage?.input_tokens || 0,
      output: response.usage?.output_tokens || 0,
    };

    await logChat(sid, lastUserMsg, text, category, tokens);

    // Detectar cualquier escalacion: incidencia, reembolso, contacto, fallo, queja no resuelta
    if (/registrado tu incidencia|he registrado|queda registrad|info@burgerjazz|escribe.*a.*info@|contacta.*info@|no puedo ayudarte|no tengo.*informaci|se me escapa|no puedo resolver|reembolso|devoluci|te contactar|nos pondremos en contacto|equipo.*contactar|sentimos las molestias|reclamaci|abre.*incidencia.*app|escanea el.*QR.*incidencia/i.test(text)) {
      try {
        const incidentData = extractIncidentData(trimmed, text);
        await sendIncidentEmail(incidentData, sid);
        await logIncident(sid, incidentData);
      } catch (emailErr) {
        console.error("Incident email error:", emailErr);
      }
    }

    var quickReplies = getSuggestedReplies(category, text);
    return res.status(200).json({ reply: text, category: category, quickReplies: quickReplies });
  } catch (err) {
    console.error("Anthropic API error:", err);
    var isCredit = err && err.message && err.message.includes("credit");
    await logChat(sid, lastUserMsg, "ERROR: " + (err.message || "unknown"), "error", null);
    return res.status(500).json({
      reply: "Vaya, tengo un problema tecnico. Escribe a info@burgerjazz.com y te ayudamos al momento.",
      _credit_error: isCredit,
    });
  }
};
