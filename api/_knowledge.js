// Legacy file - knowledge now lives in the database (knowledge_sections table).
// Kept for backwards compatibility. sync.js no longer imports this.
const CURRENT_KNOWLEDGE = "Knowledge is now stored in the database. Use getKnowledgeSections() from _db.js.";
module.exports = { CURRENT_KNOWLEDGE };
