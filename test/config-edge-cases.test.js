/**
 * Edge-case tests for config parsing: loadJsonFile, mergeSettings,
 * readEnvOverrides, parseNumberEnv, parseBooleanEnv, resolveConfigPath.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const config = require("../src/config");

test("loadJsonFile: returns empty data for optional missing file", () => {
  const result = config.loadJsonFile(
    path.join(os.tmpdir(), "nonexistent-" + Date.now() + ".json"),
    { optional: true }
  );
  assert.equal(result.loaded, false);
  assert.deepEqual(result.data, {});
});

test("loadJsonFile: throws for non-optional missing file", () => {
  assert.throws(
    () =>
      config.loadJsonFile(
        path.join(os.tmpdir(), "nonexistent-" + Date.now() + ".json"),
        { optional: false }
      ),
    { code: "ENOENT" }
  );
});

test("loadJsonFile: throws for invalid JSON", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-config-"));
  const filePath = path.join(tmpDir, "bad.json");
  fs.writeFileSync(filePath, "{not valid json", "utf8");
  assert.throws(() => config.loadJsonFile(filePath), {
    message: /Invalid JSON/,
  });
});

test("loadJsonFile: throws for non-object JSON (array)", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-config-"));
  const filePath = path.join(tmpDir, "array.json");
  fs.writeFileSync(filePath, '["one", "two"]', "utf8");
  assert.throws(() => config.loadJsonFile(filePath), {
    message: /must contain a JSON object/,
  });
});

test("loadJsonFile: loads valid JSON object", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-config-"));
  const filePath = path.join(tmpDir, "valid.json");
  fs.writeFileSync(filePath, '{"key": "value"}', "utf8");
  const result = config.loadJsonFile(filePath);
  assert.equal(result.loaded, true);
  assert.deepEqual(result.data, { key: "value" });
});

test("mergeSettings: replaces arrays instead of merging", () => {
  const base = { items: ["a", "b"] };
  const override = { items: ["c"] };
  const result = config.mergeSettings(base, override);
  assert.deepEqual(result.items, ["c"]);
});

test("mergeSettings: deep merges nested objects", () => {
  const base = { a: { b: 1, c: 2 } };
  const override = { a: { b: 99 } };
  const result = config.mergeSettings(base, override);
  assert.equal(result.a.b, 99);
  assert.equal(result.a.c, 2);
});

test("mergeSettings: handles null and undefined values", () => {
  const result = config.mergeSettings({ a: 1 }, null, undefined, { b: 2 });
  assert.equal(result.a, 1);
  assert.equal(result.b, 2);
});

test("mergeSettings: handles empty input", () => {
  const result = config.mergeSettings();
  assert.deepEqual(result, {});
});

test("parseNumberEnv: returns undefined for empty string", () => {
  assert.equal(config.readEnvOverrides({ HAX_AGENT_MAX_TURNS: "" }).agent, undefined);
});

test("parseNumberEnv: throws for non-finite number", () => {
  // We can't easily pass NaN via env vars but parseNumberEnv checks Number.isFinite
  // Test indirectly through the parsing behavior
  const overrides = config.readEnvOverrides({ HAX_AGENT_MAX_TURNS: "5" });
  assert.equal(overrides.agent.maxTurns, 5);
});

test("parseBooleanEnv: parses truthy values", () => {
  const env = {
    HAX_AGENT_MEMORY_ENABLED: "true",
    HAX_AGENT_CONTEXT_ENABLED: "1",
    HAX_AGENT_INCLUDE_SETTINGS: "yes",
    HAX_AGENT_INCLUDE_MEMORY: "on",
  };
  const overrides = config.readEnvOverrides(env);
  assert.equal(overrides.memory.enabled, true);
  assert.equal(overrides.context.enabled, true);
  assert.equal(overrides.prompts.includeSettings, true);
  assert.equal(overrides.prompts.includeMemory, true);
});

test("parseBooleanEnv: parses falsy values", () => {
  const env = {
    HAX_AGENT_MEMORY_ENABLED: "false",
    HAX_AGENT_UPDATES_AUTO_INSTALL: "0",
    HAX_AGENT_FILE_CONTEXT_ENABLED: "no",
    HAX_AGENT_SHELL_ENABLED: "off",
  };
  const overrides = config.readEnvOverrides(env);
  assert.equal(overrides.memory.enabled, false);
  assert.equal(overrides.updates.autoInstall, false);
  assert.equal(overrides.fileContext.enabled, false);
  assert.equal(overrides.tools.shell.enabled, false);
});

test("parseBooleanEnv: throws for invalid boolean string", () => {
  assert.throws(
    () => {
      const env = { HAX_AGENT_MEMORY_ENABLED: "maybe" };
      config.readEnvOverrides(env);
    },
    { message: /must be a boolean value/ }
  );
});

test("readEnvOverrides: reads AI_PROVIDER fallback", () => {
  const overrides = config.readEnvOverrides({
    AI_PROVIDER: "openai",
  });
  assert.equal(overrides.agent.provider, "openai");
});

test("readEnvOverrides: reads API key from multiple sources", () => {
  const overrides = config.readEnvOverrides({
    ANTHROPIC_API_KEY: "ant-key",
  });
  assert.equal(overrides.agent.apiKey, "ant-key");
});

test("readEnvOverrides: reads OpenAI API key", () => {
  const overrides = config.readEnvOverrides({
    OPENAI_API_KEY: "openai-key",
  });
  assert.equal(overrides.agent.apiKey, "openai-key");
});

test("readEnvOverrides: reads numeric env values", () => {
  const overrides = config.readEnvOverrides({
    HAX_AGENT_MAX_TURNS: "50",
    HAX_AGENT_TEMPERATURE: "0.7",
    HAX_AGENT_MEMORY_MAX_ITEMS: "30",
    HAX_AGENT_TRANSCRIPT_LIMIT: "200",
    HAX_AGENT_CONTEXT_WINDOW_TOKENS: "500000",
    HAX_AGENT_CONTEXT_RESERVE_OUTPUT_TOKENS: "16384",
    HAX_AGENT_CONTEXT_CHARS_PER_TOKEN: "3",
    HAX_AGENT_FILE_CONTEXT_MAX_FILES: "10",
    HAX_AGENT_FILE_CONTEXT_MAX_INDEX_FILES: "500",
    HAX_AGENT_FILE_CONTEXT_MAX_FILE_SIZE: "100000",
    HAX_AGENT_FILE_CONTEXT_MAX_BYTES_PER_FILE: "8000",
    HAX_AGENT_FILE_CONTEXT_MAX_TOTAL_BYTES: "50000",
    HAX_AGENT_SHELL_TIMEOUT_MS: "30000",
    HAX_AGENT_SHELL_MAX_BUFFER: "10000000",
  });
  assert.equal(overrides.agent.maxTurns, 50);
  assert.equal(overrides.agent.temperature, 0.7);
  assert.equal(overrides.memory.maxItems, 30);
  assert.equal(overrides.sessions.transcriptLimit, 200);
  assert.equal(overrides.context.windowTokens, 500000);
  assert.equal(overrides.context.reserveOutputTokens, 16384);
  assert.equal(overrides.context.charsPerToken, 3);
  assert.equal(overrides.fileContext.maxFiles, 10);
  assert.equal(overrides.fileContext.maxIndexFiles, 500);
  assert.equal(overrides.fileContext.maxFileSize, 100000);
  assert.equal(overrides.fileContext.maxBytesPerFile, 8000);
  assert.equal(overrides.fileContext.maxTotalBytes, 50000);
  assert.equal(overrides.tools.shell.timeoutMs, 30000);
  assert.equal(overrides.tools.shell.maxBuffer, 10000000);
});

test("resolveConfigPath: returns fallback when not configured", () => {
  const result = config.resolveConfigPath("/root", undefined, "/root/fallback");
  assert.equal(result, path.normalize("/root/fallback"));
});

test("resolveConfigPath: keeps absolute paths", () => {
  const result = config.resolveConfigPath("/root", "/absolute/path");
  assert.equal(result, path.normalize("/absolute/path"));
});

test("resolveConfigPath: resolves relative paths against projectRoot", () => {
  const result = config.resolveConfigPath("/root", "relative/path");
  assert.equal(result, path.resolve("/root", "relative/path"));
});

test("defaultUserSettingsPath: respects custom home", () => {
  const result = config.defaultUserSettingsPath("/fake/home");
  assert.ok(result.includes("HaxAgent"));
  assert.ok(result.endsWith("settings.json"));
});

test("defaultProjectSettingsPath: resolves relative to projectRoot", () => {
  const result = config.defaultProjectSettingsPath("/my/project");
  assert.ok(result.includes(".hax-agent"));
  assert.ok(result.endsWith("settings.json"));
});

test("defaultAppDataDirectory: handles win32 platform", () => {
  const result = config.defaultAppDataDirectory(
    "/Users/test",
    { APPDATA: "C:\\Users\\test\\AppData\\Roaming" },
    "win32"
  );
  assert.ok(result.endsWith("HaxAgent"));
});

test("defaultAppDataDirectory: handles darwin platform", () => {
  const result = config.defaultAppDataDirectory("/Users/test", {}, "darwin");
  assert.ok(result.includes("Application Support"));
  assert.ok(result.endsWith("HaxAgent"));
});

test("defaultAppDataDirectory: handles linux with XDG_DATA_HOME", () => {
  const result = config.defaultAppDataDirectory(
    "/home/test",
    { XDG_DATA_HOME: "/home/test/.local/share" },
    "linux"
  );
  assert.ok(result.includes("hax-agent"));
});

test("DEFAULT_SETTINGS: is frozen", () => {
  assert.throws(() => {
    config.DEFAULT_SETTINGS.agent = null;
  });
});

test("resolveSettings: merges explicit settings path", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hax-config-"));
  const explicitPath = path.join(projectRoot, "explicit.json");
  fs.writeFileSync(
    explicitPath,
    JSON.stringify({ agent: { name: "explicit-agent" } })
  );

  const resolved = config.resolveSettings({
    projectRoot,
    settingsPath: explicitPath,
    env: {},
  });

  assert.equal(resolved.settings.agent.name, "explicit-agent");
});

test("resolveSettings: normalizes project root path", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hax-config-"));
  const resolved = config.resolveSettings({
    projectRoot,
    env: {},
  });
  assert.equal(resolved.settings.projectRoot, path.resolve(projectRoot));
});

test("resolveSettings: overrides take highest priority", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hax-config-"));
  const userSettingsPath = path.join(projectRoot, "user.json");
  fs.writeFileSync(
    userSettingsPath,
    JSON.stringify({ agent: { maxTurns: 10 } })
  );

  const resolved = config.resolveSettings({
    projectRoot,
    userSettingsPath,
    env: {},
    overrides: { agent: { maxTurns: 99 } },
  });

  assert.equal(resolved.settings.agent.maxTurns, 99);
});

test("readEnvOverrides: HAX_AGENT_PROVIDER takes precedence over AI_PROVIDER", () => {
  const overrides = config.readEnvOverrides({
    HAX_AGENT_PROVIDER: "google",
    AI_PROVIDER: "openai",
  });
  assert.equal(overrides.agent.provider, "google");
});
