"use strict";
const path = require("path");
function createPersonalizationHook(cwd) {
  const { extractLocalRules } = require("./personalization");
  const { factsToMarkdown } = require("./personalization");
  const { saveRules } = require("./rules");
  return { onSessionEnd: async (session) => { const facts = extractLocalRules(session.messages || []); if (facts.length > 0) { saveRules(cwd, factsToMarkdown(facts)); } return { facts: facts.length }; } };
}
module.exports = { createPersonalizationHook };
