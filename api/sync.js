const Anthropic = require("@anthropic-ai/sdk");
const { initDB, saveSourceUpdate, getKnowledgeSections, upsertKnowledgeSection } = require("./_db");

let dbReady = false;
let _dbInitPromise = null;

function buildSyncPrompt(currentKnowledge) {
  return `Eres un verificador de datos para el chatbot de BURGERJAZZ. Tu trabajo es comparar la informacion que el chatbot tiene actualmente con la informacion real de la web.

DATOS ACTUALES DEL CHATBOT:
${currentKnowledge}

Analiza el contenido de la web que te proporciono y compara con los datos actuales.

Si hay cambios, responde en formato JSON exacto (sin markdown):
{"changes":[{"section":"nombre_seccion","description":"que cambio","new_content":"contenido completo actualizado de esa seccion"}]}

Secciones validas: locales, horarios, carta, alergenos, delivery, promos, pagos

IMPORTANTE: "new_content" debe contener el texto COMPLETO actualizado de la seccion, no solo el cambio. Copia todo el contenido actual y aplica el cambio.

Si NO hay cambios relevantes, responde exactamente: {"changes":[]}

REGLAS:
- Solo reporta cambios REALES y verificables del contenido web
- No inventes ni asumas cambios
- Ignora diferencias de formato o redaccion
- El JSON debe ser valido`;
}

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
  const authKey = process.env.LEARN_KEY;
  const providedKey = req.query?.key || req.headers["x-learn-key"];

  if (!isCron && (!authKey || providedKey !== authKey)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!dbReady) {
    if (!_dbInitPromise) _dbInitPromise = initDB();
    await _dbInitPromise;
    dbReady = true;
  }

  try {
    // Fetch key pages from burgerjazz.com
    const [menuPage, mainPage, allergenPage, ayudaPage, localesPage, pideYaPage] = await Promise.all([
      fetchPage("https://www.burgerjazz.com/menu"),
      fetchPage("https://www.burgerjazz.com"),
      fetchPage("https://www.burgerjazz.com/alergenos-burgerjazz"),
      fetchPage("https://www.burgerjazz.com/ayuda"),
      fetchPage("https://www.burgerjazz.com/locales"),
      fetchPage("https://pedidos.burgerjazz.com"),
    ]);

    const webContent = [
      menuPage ? "=== PAGINA MENU ===\n" + menuPage : "",
      mainPage ? "=== PAGINA PRINCIPAL ===\n" + mainPage : "",
      allergenPage ? "=== PAGINA ALERGENOS ===\n" + allergenPage : "",
      ayudaPage ? "=== PAGINA AYUDA (HORARIOS/FAQ) ===\n" + ayudaPage : "",
      localesPage ? "=== PAGINA LOCALES ===\n" + localesPage : "",
      pideYaPage ? "=== DELIVERY PROPIO ===\n" + pideYaPage : "",
    ].filter(Boolean).join("\n\n");

    if (webContent.length < 100) {
      return res.status(200).json({ status: "error", message: "No se pudo obtener contenido de la web" });
    }

    // Read current knowledge from DB
    var sections = await getKnowledgeSections();
    var currentKnowledge = sections.map(function(s) { return s.title + ":\n" + s.content; }).join("\n\n");
    if (!currentKnowledge || currentKnowledge.length < 50) {
      currentKnowledge = "Sin datos previos";
    }

    // Ask Claude to compare
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      system: buildSyncPrompt(currentKnowledge),
      messages: [{ role: "user", content: "Contenido actual de la web de BurgerJazz:\n\n" + webContent }],
    });

    const result = response.content?.[0]?.text || "";
    var changesApplied = 0;

    try {
      var parsed = JSON.parse(result);
      if (parsed.changes && parsed.changes.length > 0) {
        for (var i = 0; i < parsed.changes.length; i++) {
          var ch = parsed.changes[i];
          if (ch.section && ch.new_content) {
            var existingSection = sections.find(function(s) { return s.section_key === ch.section; });
            var title = existingSection ? existingSection.title : ch.section;
            await upsertKnowledgeSection(ch.section, title, ch.new_content, "sync");
            changesApplied++;
          }
        }
        // Also save as source update for the dynamic prompt layer
        var summary = parsed.changes.map(function(c) { return c.description; }).join(". ");
        await saveSourceUpdate(summary);
      }
    } catch(parseErr) {
      // Fallback: save as text source update if JSON parse fails
      if (result.length > 20 && !result.includes('"changes":[]')) {
        await saveSourceUpdate(result);
      }
    }

    return res.status(200).json({
      status: "ok",
      changes_applied: changesApplied,
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
