import { extractLocalRules, factsToMarkdown } from "./personalization.js";
import { saveRules } from "./rules.js";

function createPersonalizationHook(cwd) {
  return { onSessionEnd: async (session) => { const facts = extractLocalRules(session.messages || []); if (facts.length > 0) { saveRules(cwd, factsToMarkdown(facts)); } return { facts: facts.length }; } };
}
export { createPersonalizationHook };
