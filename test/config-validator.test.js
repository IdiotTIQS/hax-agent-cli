/**
 * Tests for configuration validator.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { validateSettings, assertValidSettings, RULES } = require("../src/config-validator");

test("validateSettings: returns empty array for valid default settings", () => {
  const settings = {
    agent: { name: "hax-agent", model: "claude-sonnet-4-20250514", maxTurns: 20, temperature: 0.2 },
    memory: { enabled: true, maxItems: 20 },
    sessions: { transcriptLimit: 100 },
    context: { enabled: true, windowTokens: undefined, reserveOutputTokens: 8192, charsPerToken: 4 },
    fileContext: { enabled: true, maxFiles: 8, maxIndexFiles: 2000, maxFileSize: 512000, maxBytesPerFile: 32000, maxTotalBytes: 120000 },
    permissions: { mode: "normal" },
    tools: { shell: { enabled: true, timeoutMs: 10000, maxBuffer: 52428800 } },
    ui: { locale: "en" },
  };
  const issues = validateSettings(settings);
  assert.equal(issues.length, 0);
});

test("validateSettings: catches invalid maxTurns", () => {
  const issues = validateSettings({
    agent: { name: "test", model: "gpt-4", maxTurns: 0, temperature: 0.2 },
    memory: { enabled: true, maxItems: 20 },
    sessions: { transcriptLimit: 100 },
    context: { enabled: true, reserveOutputTokens: 8192, charsPerToken: 4 },
    fileContext: { enabled: true, maxFiles: 8, maxIndexFiles: 2000, maxFileSize: 512000, maxBytesPerFile: 32000, maxTotalBytes: 120000 },
    permissions: { mode: "normal" },
    tools: { shell: { enabled: true, timeoutMs: 10000, maxBuffer: 52428800 } },
    ui: { locale: "en" },
  });
  const maxTurnsIssues = issues.filter((i) => i.path === "agent.maxTurns");
  assert.ok(maxTurnsIssues.length > 0);
});

test("validateSettings: catches invalid temperature", () => {
  const issues = validateSettings({
    agent: { name: "test", model: "gpt-4", maxTurns: 20, temperature: 5 },
    memory: { enabled: true, maxItems: 20 },
    sessions: { transcriptLimit: 100 },
    context: { enabled: true, reserveOutputTokens: 8192, charsPerToken: 4 },
    fileContext: { enabled: true, maxFiles: 8, maxIndexFiles: 2000, maxFileSize: 512000, maxBytesPerFile: 32000, maxTotalBytes: 120000 },
    permissions: { mode: "normal" },
    tools: { shell: { enabled: true, timeoutMs: 10000, maxBuffer: 52428800 } },
    ui: { locale: "en" },
  });
  const tempIssues = issues.filter((i) => i.path === "agent.temperature");
  assert.ok(tempIssues.length > 0);
});

test("validateSettings: catches invalid permissions mode", () => {
  const issues = validateSettings({
    agent: { name: "test", model: "gpt-4", maxTurns: 20, temperature: 0.2 },
    memory: { enabled: true, maxItems: 20 },
    sessions: { transcriptLimit: 100 },
    context: { enabled: true, reserveOutputTokens: 8192, charsPerToken: 4 },
    fileContext: { enabled: true, maxFiles: 8, maxIndexFiles: 2000, maxFileSize: 512000, maxBytesPerFile: 32000, maxTotalBytes: 120000 },
    permissions: { mode: "unsafe" },
    tools: { shell: { enabled: true, timeoutMs: 10000, maxBuffer: 52428800 } },
    ui: { locale: "en" },
  });
  const permIssues = issues.filter((i) => i.path === "permissions.mode");
  assert.ok(permIssues.length > 0);
});

test("validateSettings: catches invalid shell timeout", () => {
  const issues = validateSettings({
    agent: { name: "test", model: "gpt-4", maxTurns: 20, temperature: 0.2 },
    memory: { enabled: true, maxItems: 20 },
    sessions: { transcriptLimit: 100 },
    context: { enabled: true, reserveOutputTokens: 8192, charsPerToken: 4 },
    fileContext: { enabled: true, maxFiles: 8, maxIndexFiles: 2000, maxFileSize: 512000, maxBytesPerFile: 32000, maxTotalBytes: 120000 },
    permissions: { mode: "normal" },
    tools: { shell: { enabled: true, timeoutMs: 0, maxBuffer: 52428800 } },
    ui: { locale: "en" },
  });
  const shellIssues = issues.filter((i) => i.path === "tools.shell.timeoutMs");
  assert.ok(shellIssues.length > 0);
});

test("validateSettings: catches invalid locale", () => {
  const issues = validateSettings({
    agent: { name: "test", model: "gpt-4", maxTurns: 20, temperature: 0.2 },
    memory: { enabled: true, maxItems: 20 },
    sessions: { transcriptLimit: 100 },
    context: { enabled: true, reserveOutputTokens: 8192, charsPerToken: 4 },
    fileContext: { enabled: true, maxFiles: 8, maxIndexFiles: 2000, maxFileSize: 512000, maxBytesPerFile: 32000, maxTotalBytes: 120000 },
    permissions: { mode: "normal" },
    tools: { shell: { enabled: true, timeoutMs: 10000, maxBuffer: 52428800 } },
    ui: { locale: "invalid" },
  });
  const localeIssues = issues.filter((i) => i.path === "ui.locale");
  assert.ok(localeIssues.length > 0);
});

test("validateSettings: returns issues for missing required fields", () => {
  const issues = validateSettings({
    agent: {},
    memory: {},
    sessions: {},
    context: {},
    fileContext: {},
    permissions: {},
    tools: { shell: {} },
    ui: {},
  });
  assert.ok(issues.length > 0);
});

test("assertValidSettings: throws on errors", () => {
  assert.throws(
    () => {
      assertValidSettings({
        agent: { name: "test", model: "gpt-4", maxTurns: 20, temperature: 0.2 },
        memory: { enabled: true, maxItems: 20 },
        sessions: { transcriptLimit: 100 },
        context: { enabled: true, reserveOutputTokens: 8192, charsPerToken: 4 },
        fileContext: { enabled: true, maxFiles: 8, maxIndexFiles: 2000, maxFileSize: 512000, maxBytesPerFile: 32000, maxTotalBytes: 120000 },
        permissions: { mode: "invalid" },
        tools: { shell: { enabled: true, timeoutMs: 10000, maxBuffer: 52428800 } },
        ui: { locale: "en" },
      });
    },
    { message: /Configuration validation failed/ }
  );
});

test("assertValidSettings: does not throw for valid settings", () => {
  const warnings = assertValidSettings({
    agent: { name: "hax-agent", model: "claude-sonnet-4-20250514", maxTurns: 20, temperature: 0.2 },
    memory: { enabled: true, maxItems: 20 },
    sessions: { transcriptLimit: 100 },
    context: { enabled: true, windowTokens: undefined, reserveOutputTokens: 8192, charsPerToken: 4 },
    fileContext: { enabled: true, maxFiles: 8, maxIndexFiles: 2000, maxFileSize: 512000, maxBytesPerFile: 32000, maxTotalBytes: 120000 },
    permissions: { mode: "normal" },
    tools: { shell: { enabled: true, timeoutMs: 10000, maxBuffer: 52428800 } },
    ui: { locale: "en" },
  });
  assert.equal(warnings.length, 0);
});

test("validateSettings: accepts valid API URL", () => {
  const issues = validateSettings({
    agent: { name: "test", model: "gpt-4", maxTurns: 20, temperature: 0.2, apiUrl: "https://api.example.com" },
    memory: { enabled: true, maxItems: 20 },
    sessions: { transcriptLimit: 100 },
    context: { enabled: true, reserveOutputTokens: 8192, charsPerToken: 4 },
    fileContext: { enabled: true, maxFiles: 8, maxIndexFiles: 2000, maxFileSize: 512000, maxBytesPerFile: 32000, maxTotalBytes: 120000 },
    permissions: { mode: "normal" },
    tools: { shell: { enabled: true, timeoutMs: 10000, maxBuffer: 52428800 } },
    ui: { locale: "en" },
  });
  const apiUrlIssues = issues.filter((i) => i.path === "agent.apiUrl");
  assert.equal(apiUrlIssues.length, 0);
});

test("validateSettings: catches invalid API URL", () => {
  const issues = validateSettings({
    agent: { name: "test", model: "gpt-4", maxTurns: 20, temperature: 0.2, apiUrl: "not-a-url" },
    memory: { enabled: true, maxItems: 20 },
    sessions: { transcriptLimit: 100 },
    context: { enabled: true, reserveOutputTokens: 8192, charsPerToken: 4 },
    fileContext: { enabled: true, maxFiles: 8, maxIndexFiles: 2000, maxFileSize: 512000, maxBytesPerFile: 32000, maxTotalBytes: 120000 },
    permissions: { mode: "normal" },
    tools: { shell: { enabled: true, timeoutMs: 10000, maxBuffer: 52428800 } },
    ui: { locale: "en" },
  });
  const apiUrlIssues = issues.filter((i) => i.path === "agent.apiUrl");
  assert.ok(apiUrlIssues.length > 0);
});

test("validateSettings: yolo mode is valid", () => {
  const issues = validateSettings({
    agent: { name: "test", model: "gpt-4", maxTurns: 20, temperature: 0.2 },
    memory: { enabled: true, maxItems: 20 },
    sessions: { transcriptLimit: 100 },
    context: { enabled: true, reserveOutputTokens: 8192, charsPerToken: 4 },
    fileContext: { enabled: true, maxFiles: 8, maxIndexFiles: 2000, maxFileSize: 512000, maxBytesPerFile: 32000, maxTotalBytes: 120000 },
    permissions: { mode: "yolo" },
    tools: { shell: { enabled: true, timeoutMs: 10000, maxBuffer: 52428800 } },
    ui: { locale: "en" },
  });
  const permIssues = issues.filter((i) => i.path === "permissions.mode");
  assert.equal(permIssues.length, 0);
});
