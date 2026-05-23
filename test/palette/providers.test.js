"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  SlashCommandsProvider,
  ToolCommandsProvider,
  RecentFilesProvider,
  SessionHistoryProvider,
  PluginCommandsProvider,
  QuickActionsProvider,
  createDefaultProviders,
} = require("../../src/palette/providers");

// ── SlashCommandsProvider ─────────────────────────────────────────

test("SlashCommandsProvider: has name", () => {
  const provider = new SlashCommandsProvider();
  assert.equal(provider.name, "Slash Commands");
});

test("SlashCommandsProvider: getItems returns all slash commands", () => {
  const provider = new SlashCommandsProvider();
  const items = provider.getItems();

  assert.ok(Array.isArray(items), "should return an array");
  assert.ok(items.length > 20, "should have many commands");

  // Verify item structure
  const first = items[0];
  assert.equal(typeof first.id, "string");
  assert.equal(typeof first.name, "string");
  assert.equal(typeof first.description, "string");
  assert.equal(typeof first.action, "function");
  assert.ok(Array.isArray(first.keywords));
  assert.ok(first.name.startsWith("/"), "command names should start with /");
});

test("SlashCommandsProvider: item action executes correctly", () => {
  const provider = new SlashCommandsProvider();
  const items = provider.getItems();
  const helpItem = items.find((i) => i.id === "cmd-help");
  assert.ok(helpItem, "should have help command");
  assert.ok(helpItem.name === "/help");
  assert.ok(helpItem.keywords.includes("h") || helpItem.keywords.includes("?"));
});

test("SlashCommandsProvider: item action returns command string by default", () => {
  const provider = new SlashCommandsProvider();
  const items = provider.getItems();
  const helpItem = items.find((i) => i.id === "cmd-help");
  const result = helpItem.action();
  assert.ok(typeof result === "string", "action should return a string");
  assert.ok(result.includes("help"), "action should return help command string");
});

test("SlashCommandsProvider: item action uses context.executeCommand when provided", () => {
  let executed = null;
  const context = {
    executeCommand: (name) => { executed = name; return "done"; },
  };
  const provider = new SlashCommandsProvider();
  const items = provider.getItems(context);
  const exitItem = items.find((i) => i.id === "cmd-exit");
  const result = exitItem.action();
  assert.equal(executed, "exit");
  assert.equal(result, "done");
});

// ── ToolCommandsProvider ──────────────────────────────────────────

test("ToolCommandsProvider: has name", () => {
  const provider = new ToolCommandsProvider();
  assert.equal(provider.name, "Tool Commands");
});

test("ToolCommandsProvider: getItems returns items from tool list", () => {
  const mockTools = [
    { name: "file.read", description: "Read files from disk", keywords: ["read"] },
    { name: "file.write", description: "Write files to disk", keywords: ["write"] },
    { name: "shell.run", description: "Run shell commands", keywords: ["exec"] },
  ];
  const provider = new ToolCommandsProvider({ getTools: () => mockTools });
  const items = provider.getItems();

  assert.equal(items.length, 3);
  assert.equal(items[0].name, "file.read");
  assert.equal(items[0].category, "Tools");
  assert.equal(items[1].name, "file.write");
  assert.equal(items[0].keywords.includes("file.read"), true);
});

test("ToolCommandsProvider: item action invokes tool", () => {
  let invoked = null;
  const context = {
    invokeTool: (name) => { invoked = name; return "tool-result"; },
  };
  const provider = new ToolCommandsProvider({
    getTools: () => [{ name: "file.read", description: "", keywords: [] }],
  });
  const items = provider.getItems(context);
  const result = items[0].action();
  assert.equal(invoked, "file.read");
  assert.equal(result, "tool-result");
});

test("ToolCommandsProvider: getItems returns empty array when no tools", () => {
  const provider = new ToolCommandsProvider({ getTools: () => [] });
  const items = provider.getItems();
  assert.deepEqual(items, []);
});

// ── RecentFilesProvider ───────────────────────────────────────────

test("RecentFilesProvider: has name", () => {
  const provider = new RecentFilesProvider();
  assert.equal(provider.name, "Recent Files");
});

test("RecentFilesProvider: getItems returns files after refresh", () => {
  const provider = new RecentFilesProvider();
  provider.refresh([
    "/project/src/index.js",
    "/project/src/utils.js",
    "/project/test/test.js",
  ]);
  const items = provider.getItems();

  assert.equal(items.length, 3);
  assert.equal(items[0].name, "index.js");
  assert.equal(items[0].category, "Recent Files");
  assert.equal(items[1].name, "utils.js");
});

test("RecentFilesProvider: respects maxFiles option", () => {
  const provider = new RecentFilesProvider({ maxFiles: 2 });
  const files = Array.from({ length: 10 }, (_, i) => `/project/file-${i}.js`);
  provider.refresh(files);
  const items = provider.getItems();
  assert.equal(items.length, 2, "should be capped at maxFiles");
});

test("RecentFilesProvider: getItems returns empty when no files refreshed", () => {
  const provider = new RecentFilesProvider();
  const items = provider.getItems();
  assert.deepEqual(items, []);
});

test("RecentFilesProvider: item action opens file via context", () => {
  let opened = null;
  const context = {
    openFile: (path) => { opened = path; return "opened"; },
  };
  const provider = new RecentFilesProvider();
  provider.refresh(["/project/test.js"]);
  const items = provider.getItems(context);
  const result = items[0].action();
  assert.equal(opened, "/project/test.js");
  assert.equal(result, "opened");
});

// ── SessionHistoryProvider ────────────────────────────────────────

test("SessionHistoryProvider: has name", () => {
  const provider = new SessionHistoryProvider();
  assert.equal(provider.name, "Session History");
});

test("SessionHistoryProvider: getItems returns sessions", () => {
  const mockSessions = [
    { id: "session-abc123", updatedAt: new Date().toISOString(), preview: "Hello, can you help me?" },
    { id: "session-def456", updatedAt: new Date().toISOString(), preview: "Write a function" },
  ];
  const provider = new SessionHistoryProvider({
    listSessions: () => mockSessions,
    maxSessions: 10,
  });
  const items = provider.getItems();

  assert.equal(items.length, 2);
  assert.equal(items[0].category, "Sessions");
  assert.equal(items[0].name, "session-abc1");
  assert.ok(items[0].description.includes("Hello") || items[0].description.includes("session"));
});

test("SessionHistoryProvider: handles entries() method on sessions", () => {
  const mockSessions = [
    {
      id: "session-ghi789",
      updatedAt: new Date().toISOString(),
      entries: () => [
        { role: "user", content: "First message content here" },
        { role: "assistant", content: "Response" },
      ],
    },
  ];
  const provider = new SessionHistoryProvider({
    listSessions: () => mockSessions,
  });
  const items = provider.getItems();
  assert.equal(items.length, 1);
  assert.ok(items[0].description.includes("First message"));
});

test("SessionHistoryProvider: respects maxSessions", () => {
  const sessions = Array.from({ length: 30 }, (_, i) => ({
    id: `session-${i}`,
    updatedAt: new Date().toISOString(),
    preview: `Session ${i}`,
  }));
  const provider = new SessionHistoryProvider({
    listSessions: () => sessions,
    maxSessions: 5,
  });
  const items = provider.getItems();
  assert.equal(items.length, 5, "should be capped at maxSessions");
});

test("SessionHistoryProvider: item action resumes session via context", () => {
  let resumed = null;
  const context = {
    resumeSession: (id) => { resumed = id; return "resumed"; },
  };
  const provider = new SessionHistoryProvider({
    listSessions: () => [{ id: "session-xyz", updatedAt: new Date().toISOString(), preview: "test" }],
  });
  const items = provider.getItems(context);
  const result = items[0].action();
  assert.equal(resumed, "session-xyz");
  assert.equal(result, "resumed");
});

// ── PluginCommandsProvider ────────────────────────────────────────

test("PluginCommandsProvider: has name", () => {
  const provider = new PluginCommandsProvider();
  assert.equal(provider.name, "Plugin Commands");
});

test("PluginCommandsProvider: getItems returns plugin commands", () => {
  const mockPlugins = [
    { name: "my-plugin", description: "Does something useful", version: "1.0.0" },
    { name: "another-plugin", description: "Another utility", version: "2.0.0" },
  ];
  const provider = new PluginCommandsProvider({ getPlugins: () => mockPlugins });
  const items = provider.getItems();

  assert.equal(items.length, 2);
  assert.equal(items[0].name, "my-plugin");
  assert.equal(items[0].category, "Plugins");
  assert.equal(items[0].description, "Does something useful");
  assert.equal(items[1].name, "another-plugin");
});

test("PluginCommandsProvider: item action invokes plugin via context", () => {
  let invoked = null;
  const context = {
    invokePlugin: (name) => { invoked = name; return "plugin-result"; },
  };
  const provider = new PluginCommandsProvider({
    getPlugins: () => [{ name: "test-plugin", description: "", version: "1.0" }],
  });
  const items = provider.getItems(context);
  const result = items[0].action();
  assert.equal(invoked, "test-plugin");
  assert.equal(result, "plugin-result");
});

test("PluginCommandsProvider: getItems returns empty when no plugins", () => {
  const provider = new PluginCommandsProvider({ getPlugins: () => [] });
  const items = provider.getItems();
  assert.deepEqual(items, []);
});

// ── QuickActionsProvider ──────────────────────────────────────────

test("QuickActionsProvider: has name", () => {
  const provider = new QuickActionsProvider();
  assert.equal(provider.name, "Quick Actions");
});

test("QuickActionsProvider: getItems returns all quick actions", () => {
  const provider = new QuickActionsProvider();
  const items = provider.getItems();

  assert.ok(Array.isArray(items));
  assert.ok(items.length >= 5, "should have at least 5 quick actions");

  // Verify structure
  for (const item of items) {
    assert.equal(typeof item.id, "string");
    assert.equal(typeof item.name, "string");
    assert.equal(item.category, "Quick Actions");
    assert.equal(typeof item.action, "function");
    assert.ok(Array.isArray(item.keywords));
  }
});

test("QuickActionsProvider: contains expected actions", () => {
  const provider = new QuickActionsProvider();
  const items = provider.getItems();

  const ids = items.map((i) => i.id);
  assert.ok(ids.includes("qa-new-session"), "should have new session action");
  assert.ok(ids.includes("qa-clear-conversation"), "should have clear conversation action");
  assert.ok(ids.includes("qa-compact"), "should have compact action");
  assert.ok(ids.includes("qa-show-help"), "should have show help action");
  assert.ok(ids.includes("qa-exit"), "should have exit action");
});

test("QuickActionsProvider: item action returns command string by default", () => {
  const provider = new QuickActionsProvider();
  const items = provider.getItems();
  const exitItem = items.find((i) => i.id === "qa-exit");
  const result = exitItem.action();
  assert.equal(result, "/exit");
});

test("QuickActionsProvider: item action uses context.executeCommand", () => {
  let executed = null;
  const context = {
    executeCommand: (name) => { executed = name; return "cmd-done"; },
  };
  const provider = new QuickActionsProvider();
  const items = provider.getItems(context);
  const clearItem = items.find((i) => i.id === "qa-clear-conversation");
  const result = clearItem.action();
  assert.equal(executed, "clear");
  assert.equal(result, "cmd-done");
});

// ── createDefaultProviders ────────────────────────────────────────

test("createDefaultProviders: returns all expected providers", () => {
  const providers = createDefaultProviders();
  assert.ok(providers.slashCommands instanceof SlashCommandsProvider);
  assert.ok(providers.quickActions instanceof QuickActionsProvider);
  assert.ok(providers.recentFiles instanceof RecentFilesProvider);
});

test("createDefaultProviders: configures tools provider when given", () => {
  const getTools = () => [{ name: "test.tool", description: "test" }];
  const providers = createDefaultProviders({ getTools });
  assert.ok(providers.tools instanceof ToolCommandsProvider);
  const items = providers.tools.getItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].name, "test.tool");
});

test("createDefaultProviders: configures sessions provider when given", () => {
  const listSessions = () => [{ id: "s1", preview: "test" }];
  const providers = createDefaultProviders({ listSessions });
  assert.ok(providers.sessions instanceof SessionHistoryProvider);
  const items = providers.sessions.getItems();
  assert.equal(items.length, 1);
});

test("createDefaultProviders: configures plugins provider when given", () => {
  const getPlugins = () => [{ name: "p1", description: "test", version: "1.0" }];
  const providers = createDefaultProviders({ getPlugins });
  assert.ok(providers.plugins instanceof PluginCommandsProvider);
  const items = providers.plugins.getItems();
  assert.equal(items.length, 1);
});

test("createDefaultProviders: refreshes recent files when given", () => {
  const providers = createDefaultProviders({
    recentFiles: ["/project/a.js", "/project/b.js"],
  });
  const items = providers.recentFiles.getItems();
  assert.equal(items.length, 2);
  assert.equal(items[0].name, "a.js");
});
