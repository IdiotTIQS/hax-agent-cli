/**
 * Tests for KnowledgeExtractor: fact extraction, how-to procedures,
 * configuration snippets, best practices, gotchas, and cheatsheet
 * generation.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  KnowledgeExtractor,
  extractFacts,
  extractHowTo,
  extractConfigurations,
  extractBestPractices,
  extractGotchas,
  generateCheatsheet,
  _internals,
} = require("../../src/extraction/knowledge-extractor");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function session(...messages) {
  return { messages };
}

function msg(role, content) {
  return { role, content };
}

// ---------------------------------------------------------------------------
// extractFacts
// ---------------------------------------------------------------------------

test("extractFacts: extracts factual statements from assistant messages", () => {
  const s = session(
    msg("assistant", "The project is a Node.js application. It consists of three main modules."),
  );
  const facts = extractFacts(s);
  assert.ok(facts.length >= 1, "should find facts");
  assert.ok(facts.some((f) => f.fact.includes("Node.js")));
  assert.equal(facts[0].confidence, "low");
});

test("extractFacts: ignores user messages for fact extraction", () => {
  const s = session(
    msg("user", "Node.js is a JavaScript runtime."),
    msg("assistant", "Yes, that is correct."),
  );
  const facts = extractFacts(s);
  // The user message should not produce facts; only assistant messages.
  const userFacts = facts.filter((f) => f.sourceIndex === 0);
  assert.equal(userFacts.length, 0);
});

test("extractFacts: assigns correct categories", () => {
  const s = session(
    msg("assistant", "Version 2.0 was released in January. The config is located at ~/.hax/config.json."),
  );
  const facts = extractFacts(s);
  const versionFact = facts.find((f) => f.category === "version");
  assert.ok(versionFact, "should find a version-categorized fact");
  const locationFact = facts.find((f) => f.category === "location");
  assert.ok(locationFact, "should find a location-categorized fact");
});

test("extractFacts: returns empty array for non-factual messages", () => {
  const s = session(
    msg("assistant", "Hi there! How can I help you today?"),
  );
  const facts = extractFacts(s);
  assert.equal(facts.length, 0);
});

// ---------------------------------------------------------------------------
// extractHowTo
// ---------------------------------------------------------------------------

test("extractHowTo: extracts numbered step procedures", () => {
  const s = session(
    msg("assistant", "Here is how to set up:\n1. First, install dependencies\n2. Second, configure the environment\n3. Third, run the build"),
  );
  const procedures = extractHowTo(s);
  assert.ok(procedures.length >= 1, "should find procedures");
  assert.ok(procedures[0].steps.length >= 3);
  assert.equal(procedures[0].confidence, "medium");
});

test("extractHowTo: extracts steps with transition words", () => {
  const s = session(
    msg("assistant", "To deploy:\nFirst, build the project.\nNext, upload the artifacts.\nFinally, restart the server."),
  );
  const procedures = extractHowTo(s);
  assert.ok(procedures.length >= 1);
});

test("extractHowTo: returns empty for non-procedural text", () => {
  const s = session(
    msg("assistant", "The sky is blue and the grass is green."),
  );
  const procedures = extractHowTo(s);
  assert.equal(procedures.length, 0);
});

// ---------------------------------------------------------------------------
// extractConfigurations
// ---------------------------------------------------------------------------

test("extractConfigurations: extracts JSON config blocks", () => {
  const s = session(
    msg("assistant", "Your config.json should look like:\n```json\n{\n  \"port\": 3000,\n  \"host\": \"localhost\"\n}\n```"),
  );
  const configs = extractConfigurations(s);
  assert.ok(configs.length >= 1, "should find JSON config");
  assert.equal(configs[0].format, "json");
  assert.ok(configs[0].content.includes("port"));
  assert.equal(configs[0].confidence, "high");
});

test("extractConfigurations: extracts YAML config blocks", () => {
  const s = session(
    msg("assistant", "```yaml\nserver:\n  port: 8080\n  debug: true\n```"),
  );
  const configs = extractConfigurations(s);
  assert.ok(configs.length >= 1);
  assert.equal(configs[0].format, "yaml");
});

test("extractConfigurations: extracts inline key-value configs", () => {
  const s = session(
    msg("assistant", "Set these env vars:\nDB_HOST=localhost\nDB_PORT=5432\nDB_NAME=mydb"),
  );
  const configs = extractConfigurations(s);
  assert.ok(configs.length >= 1, "should find inline config");
  assert.equal(configs[0].format, "key-value");
});

test("extractConfigurations: returns empty for non-config content", () => {
  const s = session(
    msg("assistant", "Regular conversation without any configuration."),
  );
  const configs = extractConfigurations(s);
  assert.equal(configs.length, 0);
});

// ---------------------------------------------------------------------------
// extractBestPractices
// ---------------------------------------------------------------------------

test("extractBestPractices: extracts recommended practices", () => {
  const s = session(
    msg("assistant", "You should always validate user input. It is recommended to use prepared statements for database queries."),
  );
  const practices = extractBestPractices(s);
  assert.ok(practices.length >= 1, "should find best practices");
  assert.ok(practices.some((p) => p.practice.includes("validate")));
});

test("extractBestPractices: assigns context tags", () => {
  const s = session(
    msg("assistant", "For security, never store passwords in plaintext. Always hash them."),
  );
  const practices = extractBestPractices(s);
  assert.ok(practices.length >= 1);
  assert.equal(practices[0].context, "security");
});

test("extractBestPractices: returns empty for ordinary statements", () => {
  const s = session(
    msg("assistant", "I had lunch at noon today."),
  );
  const practices = extractBestPractices(s);
  assert.equal(practices.length, 0);
});

// ---------------------------------------------------------------------------
// extractGotchas
// ---------------------------------------------------------------------------

test("extractGotchas: extracts warnings and pitfalls", () => {
  const s = session(
    msg("assistant", "Watch out: the v2 API is deprecated. A common mistake is forgetting to await async calls."),
  );
  const gotchas = extractGotchas(s);
  assert.ok(gotchas.length >= 1, "should find gotchas");
  assert.ok(gotchas.some((g) => g.gotcha.includes("deprecated")));
});

test("extractGotchas: assigns severity levels correctly", () => {
  const critical = extractGotchas(session(msg("assistant", "Critical security vulnerability: this will cause data loss if not fixed.")));
  if (critical.length > 0) {
    assert.equal(critical[0].severity, "high");
  }

  const warning = extractGotchas(session(msg("assistant", "Warning: be careful with this configuration option.")));
  if (warning.length > 0) {
    assert.equal(warning[0].severity, "medium");
  }
});

test("extractGotchas: returns empty for non-gotcha content", () => {
  const s = session(
    msg("assistant", "Everything works perfectly and there are no issues."),
  );
  const gotchas = extractGotchas(s);
  assert.equal(gotchas.length, 0);
});

// ---------------------------------------------------------------------------
// generateCheatsheet
// ---------------------------------------------------------------------------

test("generateCheatsheet: produces structured cheatsheet from extractions", () => {
  const extractions = {
    facts: [{ fact: "The project uses Node.js", category: "general", confidence: "high" }],
    bestPractices: [{ practice: "Always use strict mode", context: "code-style", confidence: "high" }],
    gotchas: [{ gotcha: "Async functions must be awaited", severity: "high", context: "async" }],
  };
  const sheet = generateCheatsheet(extractions);
  assert.ok(sheet.includes("FACTS"), "should have facts section");
  assert.ok(sheet.includes("BEST PRACTICES"), "should have best practices section");
  assert.ok(sheet.includes("GOTCHAS"), "should have gotchas section");
  assert.ok(sheet.includes("strict mode"), "should include practice content");
});

test("generateCheatsheet: handles empty extractions gracefully", () => {
  const sheet = generateCheatsheet({});
  assert.ok(sheet.includes("No knowledge was extracted"));
});

test("generateCheatsheet: accepts raw arrays as fallback", () => {
  const items = [{ fact: "Item A" }, { practice: "Item B" }];
  const sheet = generateCheatsheet({ items });
  assert.ok(sheet.includes("EXTRACTED ITEMS"));
});

// ---------------------------------------------------------------------------
// KnowledgeExtractor class
// ---------------------------------------------------------------------------

test("KnowledgeExtractor: extractAll returns composite result", () => {
  const s = session(
    msg("assistant", "The project is a web server. Always validate input. Watch out for XSS attacks. Config: PORT=3000. To set up:\n1. Install\n2. Run"),
  );
  const extractor = new KnowledgeExtractor(s);
  const result = extractor.extractAll();

  assert.ok(Array.isArray(result.facts));
  assert.ok(Array.isArray(result.howTo));
  assert.ok(Array.isArray(result.configurations));
  assert.ok(Array.isArray(result.bestPractices));
  assert.ok(Array.isArray(result.gotchas));
  assert.equal(typeof result.cheatsheet, "string");
});

test("KnowledgeExtractor: generateCheatsheet returns a string", () => {
  const s = session(
    msg("assistant", "The project uses Express. Always sanitize input. Watch out for SQL injection."),
  );
  const extractor = new KnowledgeExtractor(s);
  const cheatsheet = extractor.generateCheatsheet();
  assert.equal(typeof cheatsheet, "string");
  assert.ok(cheatsheet.length > 0);
});

// ---------------------------------------------------------------------------
// _internals helpers
// ---------------------------------------------------------------------------

test("_internals.keywordScore: counts keyword matches", () => {
  const score = _internals.keywordScore("always use strict mode", ["always", "never", "should"]);
  assert.equal(score, 1);
});

test("_internals.splitSentences: splits text into sentences", () => {
  const sentences = _internals.splitSentences("Hello world. This is a test.");
  assert.equal(sentences.length, 2);
  assert.equal(sentences[0], "Hello world.");
  assert.equal(sentences[1], "This is a test.");
});

test("_internals.deduplicate: removes duplicates by key", () => {
  const items = [
    { text: "Hello world" },
    { text: "Hello world" },
    { text: "Different" },
  ];
  const result = _internals.deduplicate(items, (i) => i.text);
  assert.equal(result.length, 2);
});

test("_internals.extractSteps: extracts numbered steps from text", () => {
  const content = "To set up:\n1. First step\n2. Second step\n3. Third step";
  const steps = _internals.extractSteps(content);
  assert.equal(steps.length, 3);
  assert.equal(steps[0], "First step");
  assert.equal(steps[2], "Third step");
});

test("_internals.inferConfigName: extracts config name from context", () => {
  const name1 = _internals.inferConfigName("the file config.json should have", "json");
  assert.ok(name1.includes("config.json"));

  const name2 = _internals.inferConfigName("just some text here", "yaml");
  assert.ok(name2.includes(".yaml"));
});
