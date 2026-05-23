/**
 * Tests for dev-tooling project-init.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  initProject,
  verifyProject,
  getProjectInfo,
  HAX_DIR,
  DEFAULT_CONFIG,
} = require("../../src/dev-tooling/project-init");

// ── Helpers ──────────────────────────────────────────────────────────────────

let tmpRoot;

test.before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hax-pinit-"));
});

test.after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function tempDir(name) {
  const dir = path.join(tmpRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── initProject ──────────────────────────────────────────────────────────────

test("initProject: creates .hax-agent directory and subdirectories", () => {
  const dir = tempDir("init-basic");
  const result = initProject(dir);

  assert.ok(result.created.length > 0);
  assert.ok(fs.existsSync(path.join(dir, HAX_DIR)));
  assert.ok(fs.existsSync(path.join(dir, HAX_DIR, "plugins")));
  assert.ok(fs.existsSync(path.join(dir, HAX_DIR, "skills")));
  assert.ok(fs.existsSync(path.join(dir, HAX_DIR, "sessions")));
  assert.ok(fs.existsSync(path.join(dir, HAX_DIR, "logs")));
  assert.ok(fs.existsSync(path.join(dir, HAX_DIR, "memory")));
  assert.ok(fs.existsSync(path.join(dir, HAX_DIR, "config.json")));
  assert.equal(result.configPath, path.join(dir, HAX_DIR, "config.json"));
});

test("initProject: creates valid config.json with defaults", () => {
  const dir = tempDir("init-config");
  initProject(dir);

  const config = JSON.parse(fs.readFileSync(path.join(dir, HAX_DIR, "config.json"), "utf-8"));

  assert.equal(config.agent.name, DEFAULT_CONFIG.agent.name);
  assert.equal(config.memory.enabled, true);
  assert.equal(config.permissions.mode, "normal");
});

test("initProject: merges custom config with defaults", () => {
  const dir = tempDir("init-custom-config");
  initProject(dir, {
    config: {
      agent: { name: "custom-agent", maxTurns: 50 },
    },
  });

  const config = JSON.parse(fs.readFileSync(path.join(dir, HAX_DIR, "config.json"), "utf-8"));

  assert.equal(config.agent.name, "custom-agent");
  assert.equal(config.agent.maxTurns, 50);
  // Defaults from other sections should still be present
  assert.equal(config.agent.model, DEFAULT_CONFIG.agent.model);
  assert.equal(config.memory.enabled, true);
});

test("initProject: appends entries to existing .gitignore", () => {
  const dir = tempDir("init-gitignore");
  const gitignorePath = path.join(dir, ".gitignore");
  fs.writeFileSync(gitignorePath, "node_modules/\n", "utf-8");

  initProject(dir);

  const content = fs.readFileSync(gitignorePath, "utf-8");
  assert.ok(content.includes("node_modules/"));
  assert.ok(content.includes(".hax-agent/sessions/"));
  assert.ok(content.includes(".hax-agent/logs/"));
});

test("initProject: creates .gitignore if it does not exist", () => {
  const dir = tempDir("init-no-gitignore");
  initProject(dir);

  const gitignorePath = path.join(dir, ".gitignore");
  assert.ok(fs.existsSync(gitignorePath));
  const content = fs.readFileSync(gitignorePath, "utf-8");
  assert.ok(content.includes(".hax-agent/"));
});

test("initProject: skipGitignore option prevents modification", () => {
  const dir = tempDir("init-skip-gitignore");
  initProject(dir, { skipGitignore: true });

  const gitignorePath = path.join(dir, ".gitignore");
  assert.ok(!fs.existsSync(gitignorePath));
});

test("initProject: force option overwrites existing config", () => {
  const dir = tempDir("init-force");
  const configPath = path.join(dir, HAX_DIR, "config.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ agent: { name: "old" } }), "utf-8");

  initProject(dir, { force: true });

  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  assert.equal(config.agent.name, DEFAULT_CONFIG.agent.name);
});

// ── verifyProject ────────────────────────────────────────────────────────────

test("verifyProject: returns valid for a properly initialized project", () => {
  const dir = tempDir("verify-valid");
  initProject(dir);

  const result = verifyProject(dir);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("verifyProject: returns invalid for nonexistent directory", () => {
  const result = verifyProject(path.join(tmpRoot, "nonexistent"));

  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
  assert.ok(result.errors.some((e) => e.includes("does not exist")));
});

test("verifyProject: returns invalid for directory without .hax-agent", () => {
  const dir = tempDir("verify-missing");
  // Directory exists but no init was run
  const result = verifyProject(dir);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("Missing .hax-agent")));
});

test("verifyProject: warns about missing config.json", () => {
  const dir = tempDir("verify-no-config");
  const haxDir = path.join(dir, HAX_DIR);
  fs.mkdirSync(haxDir, { recursive: true });
  fs.mkdirSync(path.join(haxDir, "plugins"), { recursive: true });

  const result = verifyProject(dir);
  // Should still be valid (config is warn, not error)
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((w) => w.includes("config.json")));
});

test("verifyProject: reports invalid JSON in config", () => {
  const dir = tempDir("verify-bad-json");
  const haxDir = path.join(dir, HAX_DIR);
  fs.mkdirSync(haxDir, { recursive: true });
  fs.writeFileSync(path.join(haxDir, "config.json"), "not json", "utf-8");

  const result = verifyProject(dir);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("invalid JSON")));
});

// ── getProjectInfo ───────────────────────────────────────────────────────────

test("getProjectInfo: reads project name from directory", () => {
  const dir = tempDir("project-info-basic");
  initProject(dir);

  const info = getProjectInfo(dir);
  assert.equal(typeof info.name, "string");
  assert.ok(info.name.length > 0);
  assert.equal(typeof info.type, "string");
});

test("getProjectInfo: reads name from package.json", () => {
  const dir = tempDir("project-info-pkg");
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@scope/my-app" }), "utf-8");
  initProject(dir);

  const info = getProjectInfo(dir);
  assert.equal(info.name, "@scope/my-app");
});

test("getProjectInfo: detects project type from config files", () => {
  const dir = tempDir("project-info-type");
  fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({}), "utf-8");
  initProject(dir);

  const info = getProjectInfo(dir);
  assert.equal(info.type, "typescript");
});

test("getProjectInfo: returns loaded config", () => {
  const dir = tempDir("project-info-config");
  initProject(dir, { config: { agent: { name: "test-bot" } } });

  const info = getProjectInfo(dir);
  assert.ok(info.config !== null);
  assert.equal(info.config.agent.name, "test-bot");
});
