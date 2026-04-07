const Anthropic = require("@anthropic-ai/sdk");
const { initDB, saveSourceUpdate } = require("./_db");

let dbReady = false;
let _dbInitPromise = null;

// Current knowledge embedded in the system prompt (keep in sync with chat.js)
const CURRENT_KNOWLEDGE = `BURGERS: BASIC JAZZ 9,95€ | BURGER JAZZ 13,95€ | ROYAL JAZZ 13,95€ | OLD JAZZ 14,95€ | BLUE JAZZ 13,95€ | MONTERREY JAZZ 14,95€ | BACON CHEESE JAZZ 13,95€
COMBOS: COMBO JAZZ SOLO 13,95€ | MENU DIA 14,90€
PATATAS: Basic 3,90€ | Spicy 3,90€ | Bacon Cheese 5,90€ | Truffle 5,90€
SALSAS: Ketchup, Mostaza, Cheddar Jalapeno, BBQ, Truffle Mayo, Salsa BJ (1,50€, Truffle Mayo 1,90€)
BATIDOS: Chocolate Belga, Galleta Maria, Vainilla Madagascar (5,90€)
POSTRES: Nutella Candy Jazz, Pistachio Candy Jazz (4,90€)
EXTRAS: +Carne 2,90€ | +Bacon 1€ | +Queso 1€ | +Jalapeno 0,50€
LOCALES: Chamberi, Plaza Espana, Retiro, Delicias, Alcorcon, Majadahonda, Pozuelo, Mirasierra, Alcobendas, Valladolid
CERRADOS: Malasana, CC Moraleja Green`;

const SYNC_PROMPT = `Eres un verificador de datos para el chatbot de BURGERJAZZ. Tu trabajo es comparar la informacion que el chatbot tiene actualmente con la informacion real de la web.

DATOS ACTUALES DEL CHATBOT:
${CURRENT_KNOWLEDGE}

Analiza el contenido de la web que te proporciono y compara con los datos actuales. Genera SOLO las diferencias encontradas en este formato:

Si hay cambios:
- Lista cada cambio concreto: que era antes y que es ahora
- Nuevos productos, precios actualizados, locales nuevos/cerrados, horarios cambiados, promos nuevas
- Se especifico con precios y nombres exactos

Si NO hay cambios relevantes, responde exactamente: "SIN CAMBIOS"

REGLAS:
- Solo reporta cambios REALES y verificables del contenido web
- No inventes ni asumas cambios
- Ignora diferencias de formato o redaccion
- Maximo 400 palabras
- Texto plano, sin markdown`;

// Fetch a webpage and extract text content
async function fetchPage(url) {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "BurgerJazz-Bot/1.0", "Accept": "text/html" },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return "";
    const html = await resp.text();
    // Strip HTML tags, scripts, styles - extract text
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&euro;/g, "€")
      .replace(/&#8364;/g, "€")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 15000); // limit to ~15k chars
  } catch (e) {
    console.error("Fetch error for " + url + ":", e.message);
    return "";
  }
}

module.exports = async function handler(req, res) {
  const isCron = req.headers["x-vercel-cron"] === "true";
  const authKey = process.env.LEARN_KEY || "bjlearn2024";
  const providedKey = req.query?.key || req.headers["x-learn-key"];

  if (!isCron && providedKey !== authKey) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!dbReady) {
    if (!_dbInitPromise) _dbInitPromise = initDB();
    await _dbInitPromise;
    dbReady = true;
  }

  try {
    // Fetch key pages from burgerjazz.com
    const [menuPage, mainPage, allergenPage] = await Promise.all([
      fetchPage("https://www.burgerjazz.com/menu"),
      fetchPage("https://www.burgerjazz.com"),
      fetchPage("https://www.burgerjazz.com/alergenos-burgerjazz"),
    ]);

    const webContent = [
      menuPage ? "=== PAGINA MENU ===\n" + menuPage : "",
      mainPage ? "=== PAGINA PRINCIPAL ===\n" + mainPage : "",
      allergenPage ? "=== PAGINA ALERGENOS ===\n" + allergenPage : "",
    ].filter(Boolean).join("\n\n");

    if (webContent.length < 100) {
      return res.status(200).json({ status: "error", message: "No se pudo obtener contenido de la web" });
    }

    // Ask Claude to compare
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: SYNC_PROMPT,
      messages: [{ role: "user", content: "Contenido actual de la web de BurgerJazz:\n\n" + webContent }],
    });

    const result = response.content?.[0]?.text || "";
    const hasChanges = !result.includes("SIN CAMBIOS");

    if (hasChanges && result.trim().length > 20) {
      await saveSourceUpdate(result);
    }

    return res.status(200).json({
      status: "ok",
      has_changes: hasChanges,
      content_length: webContent.length,
      result_preview: result.slice(0, 500),
      tokens: {
        input: response.usage?.input_tokens || 0,
        output: response.usage?.output_tokens || 0,
      },
    });
  } catch (err) {
    console.error("Sync error:", err);
    return res.status(500).json({ error: err.message });
  }
};
