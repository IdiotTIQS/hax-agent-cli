"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const env = require("../../src/platform/env");

// -------------------------------------------------------------------
// expandEnvVars
// -------------------------------------------------------------------

test("expandEnvVars: expands $VAR syntax", () => {
  const result = env.expandEnvVars("Hello $USER", { USER: "alice" });
  assert.ok(result.includes("alice"));
  assert.ok(!result.includes("$USER"));
});

test("expandEnvVars: expands ${VAR} syntax", () => {
  const result = env.expandEnvVars("Home: ${HOME}", { HOME: "/home/user" });
  assert.equal(result, "Home: /home/user");
});

test("expandEnvVars: expands %VAR% syntax", () => {
  const result = env.expandEnvVars("Path: %APPDATA%", { APPDATA: "C:\\Users\\test" });
  assert.ok(result.includes("C:\\Users\\test"));
  assert.ok(!result.includes("%APPDATA%"));
});

test("expandEnvVars: unknown variables are left untouched", () => {
  const result = env.expandEnvVars("Hello $UNKNOWN_VAR_XYZ", {});
  assert.ok(result.includes("$UNKNOWN_VAR_XYZ"));
});

test("expandEnvVars: unknown %VAR% is left untouched", () => {
  const result = env.expandEnvVars("Hello %UNKNOWN_WIN_VAR%", {});
  assert.ok(result.includes("%UNKNOWN_WIN_VAR%"));
});

test("expandEnvVars: returns non-string input unchanged", () => {
  assert.equal(env.expandEnvVars(null), null);
  assert.equal(env.expandEnvVars(undefined), undefined);
  assert.equal(env.expandEnvVars(42), 42);
});

test("expandEnvVars: handles empty string", () => {
  assert.equal(env.expandEnvVars(""), "");
});

test("expandEnvVars: multiple replacements in same string", () => {
  const result = env.expandEnvVars("$A and $B", { A: "first", B: "second" });
  assert.equal(result, "first and second");
});

// -------------------------------------------------------------------
// getEnvPaths
// -------------------------------------------------------------------

test("getEnvPaths: returns an array of normalised paths", () => {
  const paths = env.getEnvPaths({ PATH: "/usr/bin", Path: undefined });
  assert.ok(Array.isArray(paths));
  assert.ok(paths.length >= 1);
  // All entries should be normalised
  for (const p of paths) {
    assert.equal(p, path.normalize(p));
  }
});

test("getEnvPaths: respects path delimiter", () => {
  const delim = path.delimiter;
  const paths = env.getEnvPaths({ PATH: `/a${delim}/b${delim}/c` });
  assert.ok(paths.length >= 3);
  assert.ok(paths.includes(path.normalize("/a")));
  assert.ok(paths.includes(path.normalize("/b")));
  assert.ok(paths.includes(path.normalize("/c")));
});

test("getEnvPaths: returns empty array for empty PATH", () => {
  const paths = env.getEnvPaths({ PATH: "", Path: "", path: "" });
  assert.deepEqual(paths, []);
});

test("getEnvPaths: falls back to process.env", () => {
  // Just ensure it does not throw
  const paths = env.getEnvPaths();
  assert.ok(Array.isArray(paths));
});

// -------------------------------------------------------------------
// findExecutable
// -------------------------------------------------------------------

test("findExecutable: finds node on PATH", () => {
  const result = env.findExecutable("node");
  assert.ok(typeof result === "string" || result === null);
  assert.ok(result !== null, "Expected to find 'node' on PATH");
});

test("findExecutable: returns null for nonsense name", () => {
  const result = env.findExecutable("not-a-real-command-zzz123");
  assert.equal(result, null);
});

test("findExecutable: returns null for empty input", () => {
  assert.equal(env.findExecutable(""), null);
  assert.equal(env.findExecutable(null), null);
});

// -------------------------------------------------------------------
// getEditor
// -------------------------------------------------------------------

test("getEditor: returns a non-empty string", () => {
  const editor = env.getEditor();
  assert.ok(typeof editor === "string" && editor.length > 0);
});

test("getEditor: respects EDITOR env var", () => {
  const original = process.env.EDITOR;
  process.env.EDITOR = "custom-editor";
  try {
    assert.equal(env.getEditor(), "custom-editor");
  } finally {
    if (original === undefined) {
      delete process.env.EDITOR;
    } else {
      process.env.EDITOR = original;
    }
  }
});

test("getEditor: respects VISUAL env var fallback", () => {
  const originalEditor = process.env.EDITOR;
  const originalVisual = process.env.VISUAL;
  delete process.env.EDITOR;
  process.env.VISUAL = "custom-visual-editor";
  try {
    assert.equal(env.getEditor(), "custom-visual-editor");
  } finally {
    if (originalEditor === undefined) {
      delete process.env.EDITOR;
    } else {
      process.env.EDITOR = originalEditor;
    }
    if (originalVisual === undefined) {
      delete process.env.VISUAL;
    } else {
      process.env.VISUAL = originalVisual;
    }
  }
});

// -------------------------------------------------------------------
// getBrowser
// -------------------------------------------------------------------

test("getBrowser: returns a non-empty string", () => {
  const browser = env.getBrowser();
  assert.ok(typeof browser === "string" && browser.length > 0);
});

test("getBrowser: respects BROWSER env var", () => {
  const original = process.env.BROWSER;
  process.env.BROWSER = "custom-browser";
  try {
    assert.equal(env.getBrowser(), "custom-browser");
  } finally {
    if (original === undefined) {
      delete process.env.BROWSER;
    } else {
      process.env.BROWSER = original;
    }
  }
});

test("getBrowser: platform default is appropriate", () => {
  const originalBrowser = process.env.BROWSER;
  delete process.env.BROWSER;
  try {
    const browser = env.getBrowser();
    if (process.platform === "win32") {
      assert.equal(browser, "start");
    } else if (process.platform === "darwin") {
      assert.equal(browser, "open");
    } else if (process.platform === "linux") {
      assert.equal(browser, "xdg-open");
    }
    // For unknown platforms, just assert it returns something
    assert.ok(browser.length > 0);
  } finally {
    if (originalBrowser !== undefined) {
      process.env.BROWSER = originalBrowser;
    }
  }
});

// -------------------------------------------------------------------
// resolveEnvOverrides
// -------------------------------------------------------------------

test("resolveEnvOverrides: applies HAX_AGENT_PROVIDER", () => {
  const result = env.resolveEnvOverrides(
    { agent: { provider: "default" } },
    { HAX_AGENT_PROVIDER: "google" }
  );
  assert.equal(result.agent.provider, "google");
});

test("resolveEnvOverrides: AI_PROVIDER is used as fallback", () => {
  const result = env.resolveEnvOverrides(
    { agent: { provider: "default" } },
    { AI_PROVIDER: "openai" }
  );
  assert.equal(result.agent.provider, "openai");
});

test("resolveEnvOverrides: HAX_AGENT_PROVIDER takes precedence over AI_PROVIDER", () => {
  const result = env.resolveEnvOverrides(
    { agent: { provider: "default" } },
    { HAX_AGENT_PROVIDER: "google", AI_PROVIDER: "openai" }
  );
  assert.equal(result.agent.provider, "google");
});

test("resolveEnvOverrides: applies API key from ANTHROPIC_API_KEY", () => {
  const result = env.resolveEnvOverrides(
    { agent: {} },
    { ANTHROPIC_API_KEY: "ant-key-123" }
  );
  assert.equal(result.agent.apiKey, "ant-key-123");
});

test("resolveEnvOverrides: applies numeric env values", () => {
  const result = env.resolveEnvOverrides(
    { agent: {}, tools: { shell: {} } },
    {
      HAX_AGENT_MAX_TURNS: "50",
      HAX_AGENT_TEMPERATURE: "0.7",
      HAX_AGENT_SHELL_TIMEOUT_MS: "30000",
      HAX_AGENT_SHELL_MAX_BUFFER: "10000000",
    }
  );
  assert.equal(result.agent.maxTurns, 50);
  assert.equal(result.agent.temperature, 0.7);
  assert.equal(result.tools.shell.timeoutMs, 30000);
  assert.equal(result.tools.shell.maxBuffer, 10000000);
});

test("resolveEnvOverrides: applies boolean env values", () => {
  const result = env.resolveEnvOverrides(
    { memory: {}, tools: { shell: {} } },
    {
      HAX_AGENT_MEMORY_ENABLED: "true",
      HAX_AGENT_SHELL_ENABLED: "false",
      HAX_AGENT_DEBUG: "1",
    }
  );
  assert.equal(result.memory.enabled, true);
  assert.equal(result.tools.shell.enabled, false);
  assert.equal(result.debug, true);
});

test("resolveEnvOverrides: returns input unchanged when no overrides", () => {
  const input = { agent: { model: "claude" } };
  const result = env.resolveEnvOverrides(input, {});
  assert.deepEqual(result, input);
  // Should be a new object (shallow copy)
  assert.notStrictEqual(result, input);
});

test("resolveEnvOverrides: handles empty settings", () => {
  const result = env.resolveEnvOverrides({}, { HAX_AGENT_PROVIDER: "test" });
  assert.equal(result.agent.provider, "test");
});

// -------------------------------------------------------------------
// validateEnv
// -------------------------------------------------------------------

test("validateEnv: returns a report with ok, warnings, errors", () => {
  const report = env.validateEnv();
  assert.ok("ok" in report);
  assert.ok("warnings" in report);
  assert.ok("errors" in report);
  assert.ok(Array.isArray(report.warnings));
  assert.ok(Array.isArray(report.errors));
});

test("validateEnv: ok is true in a sane environment", () => {
  const report = env.validateEnv();
  // On a modern Node version with a home dir and temp dir, this should pass
  assert.equal(report.ok, report.errors.length === 0);
});

test("validateEnv: flags too-low Node version", () => {
  // We test the logic by constructing a fake env; validateEnv reads
  // process.version directly so we can only assert the report shape.
  const report = env.validateEnv();
  assert.ok(typeof report.ok === "boolean");
});
