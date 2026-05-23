/**
 * Tests for dev-tooling scaffold.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  scaffoldPlugin,
  scaffoldSkill,
  scaffoldTool,
  scaffoldAgent,
  scaffoldTest,
} = require("../../src/dev-tooling/scaffold");

// ── Helpers ──────────────────────────────────────────────────────────────────

let tmpRoot;

test.before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hax-scaffold-"));
});

test.after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function tempDir(name) {
  const dir = path.join(tmpRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── scaffoldPlugin ───────────────────────────────────────────────────────────

test("scaffoldPlugin: creates plugin directory with expected files", () => {
  const dir = tempDir("plugin-basic");
  const result = scaffoldPlugin("my-logger", dir);

  assert.ok(result.files.length >= 3);
  assert.ok(fs.existsSync(path.join(dir, "my-logger")));
  assert.ok(fs.existsSync(path.join(dir, "my-logger", "index.js")));
  assert.ok(fs.existsSync(path.join(dir, "my-logger", "package.json")));
  assert.ok(fs.existsSync(path.join(dir, "my-logger", "README.md")));
});

test("scaffoldPlugin: generated index.js is a valid CommonJS module", () => {
  const dir = tempDir("plugin-module");
  scaffoldPlugin("my-logger", dir);

  const pluginPath = path.join(dir, "my-logger", "index.js");
  const plugin = require(pluginPath);

  assert.equal(typeof plugin, "object");
  assert.equal(plugin.name, "my-logger");
  assert.equal(plugin.version, "1.0.0");
  assert.equal(typeof plugin.hooks, "object");
  assert.equal(typeof plugin.register, "function");
});

test("scaffoldPlugin: includes all 7 hook stubs", () => {
  const dir = tempDir("plugin-hooks");
  scaffoldPlugin("test-plugin", dir);

  const plugin = require(path.join(dir, "test-plugin", "index.js"));
  const hookNames = [
    "beforeToolCall", "afterToolCall", "onError",
    "beforeChat", "afterChat", "onSessionStart", "onSessionEnd",
  ];

  for (const name of hookNames) {
    assert.ok(name in plugin.hooks, `Missing hook: ${name}`);
    assert.equal(typeof plugin.hooks[name], "function", `Hook ${name} is not a function`);
    assert.equal(plugin.hooks[name].length, 1, `Hook ${name} should accept 1 arg`);
  }
});

test("scaffoldPlugin: hook stubs are pass-through (return ctx unchanged)", () => {
  const dir = tempDir("plugin-passthrough");
  scaffoldPlugin("passthrough", dir);

  const plugin = require(path.join(dir, "passthrough", "index.js"));
  const ctx = { session: { id: "test" }, message: "hello" };

  assert.strictEqual(plugin.hooks.beforeChat(ctx), ctx);
  assert.strictEqual(plugin.hooks.afterToolCall(ctx), ctx);
  assert.strictEqual(plugin.hooks.onSessionStart(ctx), ctx);
});

test("scaffoldPlugin: package.json has correct fields", () => {
  const dir = tempDir("plugin-pkg");
  scaffoldPlugin("my-logger", dir);

  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "my-logger", "package.json"), "utf-8"));
  assert.equal(pkg.name, "hax-agent-plugin-my-logger");
  assert.equal(pkg.version, "1.0.0");
  assert.equal(pkg.main, "index.js");
  assert.ok(Array.isArray(pkg.keywords));
  assert.ok(pkg.keywords.includes("hax-agent"));
});

test("scaffoldPlugin: README.md lists all hooks", () => {
  const dir = tempDir("plugin-readme");
  scaffoldPlugin("my-logger", dir);

  const readme = fs.readFileSync(path.join(dir, "my-logger", "README.md"), "utf-8");
  assert.ok(readme.includes("my-logger"));
  assert.ok(readme.includes("beforeToolCall"));
  assert.ok(readme.includes("onSessionEnd"));
  assert.ok(readme.includes("Installation"));
  assert.ok(readme.includes("registry.register(myLogger)"));
});

// ── scaffoldSkill ────────────────────────────────────────────────────────────

test("scaffoldSkill: creates SKILL.md with frontmatter", () => {
  const dir = tempDir("skill-basic");
  const result = scaffoldSkill("code-review", dir);

  assert.ok(result.files.length >= 1);
  const skillPath = path.join(dir, "code-review", "SKILL.md");
  assert.ok(fs.existsSync(skillPath));

  const content = fs.readFileSync(skillPath, "utf-8");
  assert.ok(content.startsWith("---"));
  assert.ok(content.includes("name: code-review"));
  assert.ok(content.includes("description:"));
  assert.ok(content.includes("arguments:"));
  assert.ok(content.includes("  - input"));
  assert.ok(content.includes("$input"));
});

// ── scaffoldTool ─────────────────────────────────────────────────────────────

test("scaffoldTool: creates a valid tool module", () => {
  const dir = tempDir("tool-basic");
  scaffoldTool("database.query", dir);

  // Names with dots are sanitized: database.query -> database-query
  const sanitized = "database-query";
  const toolPath = path.join(dir, sanitized, "index.js");
  assert.ok(fs.existsSync(toolPath));

  const mod = require(toolPath);
  const tool = mod.createDatabaseQueryTool();

  assert.equal(tool.name, "database.query");
  assert.equal(typeof tool.description, "string");
  assert.equal(typeof tool.inputSchema, "object");
  assert.equal(tool.inputSchema.type, "object");
  assert.ok(Array.isArray(tool.inputSchema.required));
  assert.equal(typeof tool.execute, "function");
});

test("scaffoldTool: execute function runs and returns expected shape", async () => {
  const dir = tempDir("tool-exec");
  scaffoldTool("my.tool", dir);

  // Names with dots are sanitized: my.tool -> my-tool
  const mod = require(path.join(dir, "my-tool", "index.js"));
  const tool = mod.createMyToolTool();

  const result = await tool.execute({ input: "test-value" }, { root: "/tmp" });

  assert.equal(result.ok, true);
  assert.equal(result.input, "test-value");
  assert.equal(typeof result.message, "string");
});

// ── scaffoldAgent ────────────────────────────────────────────────────────────

test("scaffoldAgent: creates a valid agent definition", () => {
  const dir = tempDir("agent-basic");
  scaffoldAgent("code-reviewer", dir);

  const agentPath = path.join(dir, "code-reviewer", "index.js");
  assert.ok(fs.existsSync(agentPath));

  const agent = require(agentPath);
  assert.equal(agent.name, "code-reviewer");
  assert.ok(typeof agent.description === "string");
  assert.ok(agent.description.length > 0);
  assert.equal(typeof agent.provider, "object");
  assert.equal(agent.provider.type, "anthropic");
  assert.ok(Array.isArray(agent.instructions));
  assert.ok(Array.isArray(agent.tools));
  assert.ok(Array.isArray(agent.agents));
  assert.equal(typeof agent.settings, "object");
});

// ── scaffoldTest ─────────────────────────────────────────────────────────────

test("scaffoldTest: creates a valid test file", () => {
  const dir = tempDir("test-basic");
  const result = scaffoldTest("my-module", dir);

  assert.ok(result.files.length >= 1);
  const testPath = path.join(dir, "my-module.test.js");
  assert.ok(fs.existsSync(testPath));

  const content = fs.readFileSync(testPath, "utf-8");
  assert.ok(content.includes('"use strict"'));
  assert.ok(content.includes('require("node:assert/strict")'));
  assert.ok(content.includes('require("node:test")'));
  assert.ok(content.includes("my-module: basic"));
  assert.ok(content.includes("my-module: handles edge"));
  assert.ok(content.includes("my-module: handles error"));
});

test("scaffoldPlugin: sanitizes messy names", () => {
  const dir = tempDir("plugin-sanitize");
  const result = scaffoldPlugin("  My LOGGER  v2!@#$  ", dir);

  assert.ok(result.dir.endsWith("my-logger-v2"));
  assert.ok(fs.existsSync(path.join(dir, "my-logger-v2", "index.js")));
});
