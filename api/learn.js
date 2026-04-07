const Anthropic = require("@anthropic-ai/sdk");
const { initDB, getRecentConversations, saveInsight, deactivateOldInsights } = require("./_db");

let dbReady = false;
let _dbInitPromise = null;

const LEARN_PROMPT = `Eres un analista de calidad para JAZZBOT, el chatbot de atencion al cliente de BURGERJAZZ (cadena de smash burgers en Madrid).

Analiza las siguientes conversaciones reales entre clientes y el bot. Tu objetivo es extraer aprendizajes concretos para que el bot mejore.

GENERA UN BLOQUE DE TEXTO con estas secciones (solo incluye secciones donde haya hallazgos reales):

1. ERRORES DETECTADOS: Respuestas incorrectas del bot (informacion erronea, productos que dijo que no existian pero si existen, precios mal dados, etc.)
2. PREGUNTAS SIN RESPUESTA: Preguntas que el bot no supo responder o desvio sin dar solucion real.
3. PATRONES FRECUENTES: Temas o preguntas que se repiten mucho y el bot deberia manejar mejor.
4. RESPUESTAS MEJORABLES: Casos donde el bot respondio correctamente pero podria haberlo hecho de forma mas util o directa.
5. DATOS NUEVOS: Informacion que los clientes mencionan que el bot desconoce (productos nuevos, locales, horarios cambiados, etc.).

REGLAS:
- Se conciso. Cada punto en 1 frase.
- Solo incluye aprendizajes ACCIONABLES (que el bot pueda aplicar).
- Si una conversacion tiene rating bajo (1-2), presta especial atencion a que fallo.
- No repitas lo obvio. Si el bot hizo bien su trabajo, no lo menciones.
- Formato: texto plano, sin markdown, sin simbolos decorativos.
- Si no hay hallazgos relevantes en una seccion, omitela.
- Maximo 500 palabras total.`;

module.exports = async function handler(req, res) {
  // Auth: Vercel cron header or manual trigger with key
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
    // Fetch conversations from last 7 days
    const rows = await getRecentConversations(7);

    if (!rows || rows.length === 0) {
      return res.status(200).json({ status: "no_data", message: "No conversations to analyze" });
    }

    // Group by session
    const sessions = {};
    rows.forEach(function (r) {
      if (!sessions[r.session]) sessions[r.session] = { messages: [], rating: r.rating, categories: [] };
      sessions[r.session].messages.push({ role: "user", content: r.user_msg });
      sessions[r.session].messages.push({ role: "bot", content: r.bot_msg });
      if (r.category) sessions[r.session].categories.push(r.category);
      if (r.rating) sessions[r.session].rating = r.rating;
    });

    // Build analysis text - prioritize low-rated and recent
    const sessionKeys = Object.keys(sessions);
    // Sort: low ratings first, then by recency
    sessionKeys.sort(function (a, b) {
      var ra = sessions[a].rating || 3;
      var rb = sessions[b].rating || 3;
      if (ra !== rb) return ra - rb;
      return 0;
    });

    // Take max 40 sessions to fit in context
    var analysisText = "";
    var count = 0;
    for (var i = 0; i < sessionKeys.length && count < 40; i++) {
      var s = sessions[sessionKeys[i]];
      var ratingLabel = s.rating ? " [Rating: " + s.rating + "/5]" : "";
      var cats = [...new Set(s.categories)].join(", ");
      analysisText += "\n--- Sesion " + (count + 1) + ratingLabel + (cats ? " [" + cats + "]" : "") + " ---\n";
      s.messages.forEach(function (m) {
        analysisText += (m.role === "user" ? "CLIENTE: " : "BOT: ") + m.content + "\n";
      });
      count++;
    }

    // Call Claude to analyze
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      system: LEARN_PROMPT,
      messages: [{ role: "user", content: "Aqui tienes " + count + " conversaciones recientes para analizar:\n" + analysisText }],
    });

    const insightText = response.content?.[0]?.text || "";

    if (insightText.trim().length > 20) {
      // Deactivate previous insights, save new one
      await deactivateOldInsights();
      await saveInsight("weekly_analysis", insightText, sessionKeys.slice(0, count).join(","));
    }

    return res.status(200).json({
      status: "ok",
      sessions_analyzed: count,
      insight_length: insightText.length,
      insight_preview: insightText.slice(0, 300),
      tokens: {
        input: response.usage?.input_tokens || 0,
        output: response.usage?.output_tokens || 0,
      },
    });
  } catch (err) {
    console.error("Learn error:", err);
    return res.status(500).json({ error: err.message });
  }
};
