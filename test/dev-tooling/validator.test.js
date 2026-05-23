/**
 * Tests for dev-tooling validator.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  validatePlugin,
  validateSkill,
  validateAgentDef,
  validateConfig,
  CONFIG_SCHEMA,
} = require("../../src/dev-tooling/validator");

// ── Helpers ──────────────────────────────────────────────────────────────────

let tmpRoot;

test.before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hax-validator-"));
});

test.after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function writeTempFile(name, content) {
  const file = path.join(tmpRoot, name);
  fs.writeFileSync(file, content, "utf-8");
  return file;
}

// ── validatePlugin ───────────────────────────────────────────────────────────

test("validatePlugin: accepts valid plugin file", () => {
  const filePath = writeTempFile("valid-plugin.js", [
    '"use strict";',
    'const plugin = {',
    '  name: "my-plugin",',
    '  version: "1.0.0",',
    '  hooks: {',
    '    beforeChat(ctx) { return ctx; },',
    '    afterChat(ctx) { return ctx; },',
    '  },',
    '};',
    'module.exports = plugin;',
  ].join("\n"));

  const result = validatePlugin(filePath);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("validatePlugin: rejects nonexistent file", () => {
  const result = validatePlugin(path.join(tmpRoot, "nonexistent.js"));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("not found")));
});

test("validatePlugin: rejects module that does not export an object", () => {
  const filePath = writeTempFile("bad-plugin.js", 'module.exports = "string";\n');

  const result = validatePlugin(filePath);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("must export an object")));
});

test("validatePlugin: rejects plugin with no name", () => {
  const filePath = writeTempFile("no-name-plugin.js", [
    '"use strict";',
    'module.exports = { hooks: { beforeChat: (ctx) => ctx } };',
  ].join("\n"));

  const result = validatePlugin(filePath);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("name")));
});

test("validatePlugin: rejects unknown hook names", () => {
  const filePath = writeTempFile("bad-hook-plugin.js", [
    '"use strict";',
    'module.exports = {',
    '  name: "test",',
    '  hooks: {',
    '    beforeBanana: (ctx) => ctx,',
    '  },',
    '};',
  ].join("\n"));

  const result = validatePlugin(filePath);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("beforeBanana") && e.includes("Unknown hook")));
});

test("validatePlugin: rejects non-function hook values", () => {
  const filePath = writeTempFile("bad-fn-plugin.js", [
    '"use strict";',
    'module.exports = {',
    '  name: "test",',
    '  hooks: {',
    '    beforeChat: "not-a-function",',
    '  },',
    '};',
  ].join("\n"));

  const result = validatePlugin(filePath);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("must be a function")));
});

test("validatePlugin: warns on non-semver version", () => {
  const filePath = writeTempFile("bad-ver-plugin.js", [
    '"use strict";',
    'module.exports = {',
    '  name: "test",',
    '  version: "alpha-beta",',
    '  hooks: { beforeChat: (ctx) => ctx },',
    '};',
  ].join("\n"));

  const result = validatePlugin(filePath);
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((w) => w.includes("semver")));
});

test("validatePlugin: warns on non-string description", () => {
  const filePath = writeTempFile("bad-desc-plugin.js", [
    '"use strict";',
    'module.exports = {',
    '  name: "test",',
    '  description: 123,',
    '  hooks: { beforeChat: (ctx) => ctx },',
    '};',
  ].join("\n"));

  const result = validatePlugin(filePath);
  assert.ok(result.warnings.some((w) => w.includes("description")));
});

// ── validateSkill ────────────────────────────────────────────────────────────

test("validateSkill: accepts a valid skill file", () => {
  const filePath = writeTempFile("valid-skill.md", [
    "---",
    "name: my-skill",
    "description: Does something useful",
    "arguments:",
    "  - input",
    "---",
    "",
    "# My Skill",
    "",
    "This skill does things with $input.",
  ].join("\n"));

  const result = validateSkill(filePath);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("validateSkill: rejects missing frontmatter", () => {
  const filePath = writeTempFile("no-frontmatter.md", "# Just a heading\n\nNo frontmatter.");

  const result = validateSkill(filePath);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("frontmatter")));
});

test("validateSkill: rejects empty file", () => {
  const filePath = writeTempFile("empty.md", "");

  const result = validateSkill(filePath);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("empty")));
});

test("validateSkill: rejects missing description in frontmatter", () => {
  const filePath = writeTempFile("no-desc-skill.md", [
    "---",
    "name: test-skill",
    "---",
    "",
    "# Body",
  ].join("\n"));

  const result = validateSkill(filePath);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("description")));
});

test("validateSkill: warns on unknown frontmatter keys", () => {
  const filePath = writeTempFile("unknown-key-skill.md", [
    "---",
    "name: test-skill",
    "description: A test",
    "custom-mystery-key: weird",
    "---",
    "",
    "# Body",
  ].join("\n"));

  const result = validateSkill(filePath);
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((w) => w.includes("custom-mystery-key")));
});

test("validateSkill: warns on empty body", () => {
  const filePath = writeTempFile("empty-body-skill.md", [
    "---",
    "name: test-skill",
    "description: A test",
    "---",
  ].join("\n"));

  const result = validateSkill(filePath);
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((w) => w.includes("empty")));
});

// ── validateAgentDef ─────────────────────────────────────────────────────────

test("validateAgentDef: accepts valid agent definition object", () => {
  const def = {
    name: "my-agent",
    description: "A helpful agent",
    instructions: ["You are a helpful assistant."],
    tools: ["file.read", "shell"],
    settings: { maxTurns: 20, temperature: 0.5 },
    agents: [],
  };

  const result = validateAgentDef(def);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("validateAgentDef: rejects missing name and description", () => {
  const result = validateAgentDef({ instructions: ["hi"] });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("name")));
  assert.ok(result.errors.some((e) => e.includes("description")));
});

test("validateAgentDef: rejects non-string instructions array elements", () => {
  const def = {
    name: "test",
    description: "A test agent",
    instructions: ["valid", 123],
  };

  const result = validateAgentDef(def);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("instructions")));
});

test("validateAgentDef: rejects invalid maxTurns in settings", () => {
  const def = {
    name: "test",
    description: "A test agent",
    settings: { maxTurns: -1 },
  };

  const result = validateAgentDef(def);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("maxTurns")));
});

test("validateAgentDef: rejects invalid temperature in settings", () => {
  const def = {
    name: "test",
    description: "A test agent",
    settings: { temperature: 5 },
  };

  const result = validateAgentDef(def);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("temperature")));
});

// ── validateConfig ───────────────────────────────────────────────────────────

test("validateConfig: accepts valid config object", () => {
  const config = {
    agent: {
      name: "hax-agent",
      model: "claude-sonnet-4-20250514",
      maxTurns: 20,
      temperature: 0.2,
    },
    memory: { enabled: true, maxItems: 20 },
    sessions: { transcriptLimit: 100 },
    context: { enabled: true, reserveOutputTokens: 8192 },
    fileContext: { enabled: true, maxFiles: 8, maxIndexFiles: 2000 },
    permissions: { mode: "normal" },
  };

  const result = validateConfig(config);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("validateConfig: rejects non-object config", () => {
  const result = validateConfig(null);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("object")));
});

test("validateConfig: rejects invalid permissions mode", () => {
  const config = {
    agent: { name: "test", model: "gpt-4", maxTurns: 20, temperature: 0.2 },
    memory: { enabled: true, maxItems: 20 },
    sessions: { transcriptLimit: 100 },
    context: { enabled: true, reserveOutputTokens: 8192 },
    fileContext: { enabled: true, maxFiles: 8, maxIndexFiles: 2000 },
    permissions: { mode: "unsafe" },
  };

  const result = validateConfig(config);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("mode") && e.includes("normal") && e.includes("yolo")));
});

test("validateConfig: rejects invalid maxTurns type", () => {
  const config = {
    agent: { name: "test", model: "gpt-4", maxTurns: "twenty", temperature: 0.2 },
    memory: { enabled: true, maxItems: 20 },
    sessions: { transcriptLimit: 100 },
    context: { enabled: true, reserveOutputTokens: 8192 },
    fileContext: { enabled: true, maxFiles: 8, maxIndexFiles: 2000 },
    permissions: { mode: "normal" },
  };

  const result = validateConfig(config);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("agent.maxTurns")));
});

test("validateConfig: warns on unknown config sections", () => {
  const config = {
    agent: { name: "test", model: "gpt-4", maxTurns: 20, temperature: 0.2 },
    unknownSection: { foo: "bar" },
  };

  const result = validateConfig(config);
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((w) => w.includes("unknownSection")));
});

test("validateConfig: validates fileContext maxFiles range", () => {
  const config = {
    agent: { name: "test", model: "gpt-4", maxTurns: 20, temperature: 0.2 },
    fileContext: { maxFiles: 999 },
    permissions: { mode: "normal" },
  };

  const result = validateConfig(config);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("fileContext.maxFiles") && e.includes("100")));
});
