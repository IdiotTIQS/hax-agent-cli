import { extractLocalRules, factsToMarkdown } from "./personalization.js";
import { saveRules } from "./rules.js";

function createPersonalizationHook(cwd: string): { onSessionEnd(session: { messages?: Array<{ content?: unknown }> }): Promise<{ facts: number }> } {
  return {
    onSessionEnd: async (session: { messages?: Array<{ content?: unknown }> }) => {
      const facts = extractLocalRules(session.messages || []);
      if (facts.length > 0) { saveRules(cwd, factsToMarkdown(facts)); }
      return { facts: facts.length };
    }
  };
}
export { createPersonalizationHook };
