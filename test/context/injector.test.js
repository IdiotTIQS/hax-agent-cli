/**
 * Tests for ContextInjector: token-budget-aware prompt context injection.
 * Covers inject, injectFileContext, injectGitContext, injectDependencyContext,
 * injectHistoryContext, injectProjectContext, renderPlacement, truncation.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { ContextInjector } = require("../../src/context/injector");

// ── Constructor ──────────────────────────────────────────────

test("ContextInjector: default token budget is 12000", () => {
  const injector = new ContextInjector();
  assert.equal(injector.tokenBudget, 12000);
});

test("ContextInjector: accepts custom token budget", () => {
  const injector = new ContextInjector({ tokenBudget: 5000 });
  assert.equal(injector.tokenBudget, 5000);
});

test("ContextInjector: default placement is prefix", () => {
  const injector = new ContextInjector();
  assert.equal(injector.defaultPlacement, "prefix");
});

test("ContextInjector: accepts valid placement overrides", () => {
  const systemInjector = new ContextInjector({ placement: "system" });
  assert.equal(systemInjector.defaultPlacement, "system");

  const toolInjector = new ContextInjector({ placement: "tool" });
  assert.equal(toolInjector.defaultPlacement, "tool");
});

test("ContextInjector: rejects invalid placement, falls back to prefix", () => {
  const injector = new ContextInjector({ placement: "invalid" });
  assert.equal(injector.defaultPlacement, "prefix");
});

// ── inject() ─────────────────────────────────────────────────

test("inject: returns prompt and context blocks", () => {
  const injector = new ContextInjector({ tokenBudget: 50000 });
  const result = injector.inject("Hello world", [
    { label: "Files", content: "src/index.js\nsrc/utils.js", priority: 10 },
    { label: "Git", content: "On branch main", priority: 5 },
  ]);
  assert.equal(result.prompt, "Hello world");
  assert.equal(result.contextBlocks.length, 2);
  assert.equal(result.contextBlocks[0].label, "Files"); // Higher priority first
  assert.ok(result.tokensUsed > 0);
  assert.equal(result.truncated, false);
});

test("inject: sorts by priority descending", () => {
  const injector = new ContextInjector({ tokenBudget: 50000 });
  const result = injector.inject("query", [
    { label: "Low", content: "low priority", priority: 1 },
    { label: "High", content: "high priority", priority: 100 },
    { label: "Medium", content: "medium priority", priority: 50 },
  ]);
  assert.equal(result.contextBlocks[0].label, "High");
  assert.equal(result.contextBlocks[1].label, "Medium");
  assert.equal(result.contextBlocks[2].label, "Low");
});

test("inject: truncates when exceeding token budget", () => {
  const injector = new ContextInjector({ tokenBudget: 100 }); // Small budget to force truncation
  const bigContent = "A".repeat(2000);

  const result = injector.inject("query", [
    { label: "First", content: bigContent },
    { label: "Second", content: bigContent },
  ]);
  // Only one partial block should fit (second is skipped due to budget exhaustion)
  assert.ok(result.contextBlocks.length <= 1);
  assert.equal(result.truncated, true);
});

test("inject: filters empty content blocks", () => {
  const injector = new ContextInjector({ tokenBudget: 50000 });
  const result = injector.inject("query", [
    { label: "Empty", content: "" },
    { label: "Whitespace", content: "   \n  " },
    { label: "Valid", content: "has content" },
  ]);
  assert.equal(result.contextBlocks.length, 1);
  assert.equal(result.contextBlocks[0].label, "Valid");
});

test("inject: handles empty context array", () => {
  const injector = new ContextInjector();
  const result = injector.inject("query", []);
  assert.equal(result.contextBlocks.length, 0);
  assert.equal(result.tokensUsed, 0);
  assert.equal(result.truncated, false);
});

// ── injectFileContext ────────────────────────────────────────

test("injectFileContext: formats file contents with scores", () => {
  const injector = new ContextInjector({ tokenBudget: 50000 });
  const files = [
    { path: "src/index.js", snippet: "const x = 1;", score: 10 },
    { path: "src/utils.js", snippet: "export function add() {}", score: 5 },
  ];
  const result = injector.injectFileContext("Find index", files);
  assert.equal(result.prompt, "Find index");
  assert.ok(result.formattedContext.includes("src/index.js"));
  assert.ok(result.formattedContext.includes("const x = 1"));
  assert.ok(result.tokensUsed > 0);
  assert.equal(result.truncated, false);
});

test("injectFileContext: returns empty context for empty files array", () => {
  const injector = new ContextInjector();
  const result = injector.injectFileContext("query", []);
  assert.equal(result.formattedContext, "");
  assert.equal(result.tokensUsed, 0);
});

// ── injectGitContext ─────────────────────────────────────────

test("injectGitContext: formats git info with branch, status, diff", () => {
  const injector = new ContextInjector({ tokenBudget: 50000 });
  const gitInfo = {
    branch: "main",
    status: "M src/index.js\n?? new-file.txt",
    diff: "diff --git a/src/index.js",
  };
  const result = injector.injectGitContext("Review changes", gitInfo);
  assert.ok(result.formattedContext.includes("main"));
  assert.ok(result.formattedContext.includes("M src/index.js"));
  assert.ok(result.formattedContext.includes("diff --git"));
});

test("injectGitContext: returns empty for empty gitInfo", () => {
  const injector = new ContextInjector();
  const result = injector.injectGitContext("query", {});
  assert.equal(result.formattedContext, "");
  assert.equal(result.tokensUsed, 0);
});

// ── injectDependencyContext ──────────────────────────────────

test("injectDependencyContext: formats dependencies and devDependencies", () => {
  const injector = new ContextInjector({ tokenBudget: 50000 });
  const deps = {
    name: "my-app",
    version: "1.0.0",
    dependencies: { express: "^4.18.0", lodash: "^4.17.21" },
    devDependencies: { jest: "^29.0.0" },
  };
  const result = injector.injectDependencyContext("Update deps", deps);
  assert.ok(result.formattedContext.includes("my-app"));
  assert.ok(result.formattedContext.includes("1.0.0"));
  assert.ok(result.formattedContext.includes("express"));
  assert.ok(result.formattedContext.includes("lodash"));
  assert.ok(result.formattedContext.includes("jest"));
});

test("injectDependencyContext: returns empty for empty deps", () => {
  const injector = new ContextInjector();
  const result = injector.injectDependencyContext("query", {});
  assert.equal(result.formattedContext, "");
});

// ── injectHistoryContext ─────────────────────────────────────

test("injectHistoryContext: formats conversation history entries", () => {
  const injector = new ContextInjector({ tokenBudget: 50000 });
  const history = [
    { role: "user", content: "How do I fix the build?" },
    { role: "assistant", content: "Check the webpack config." },
  ];
  const result = injector.injectHistoryContext("Continue", history);
  assert.ok(result.formattedContext.includes("user"));
  assert.ok(result.formattedContext.includes("How do I fix the build"));
  assert.ok(result.formattedContext.includes("assistant"));
  assert.ok(result.formattedContext.includes("webpack config"));
});

test("injectHistoryContext: returns empty for empty history", () => {
  const injector = new ContextInjector();
  const result = injector.injectHistoryContext("query", []);
  assert.equal(result.formattedContext, "");
});

// ── injectProjectContext ─────────────────────────────────────

test("injectProjectContext: formats project overview with tree", () => {
  const injector = new ContextInjector({ tokenBudget: 50000 });
  const info = {
    name: "hax-agent",
    type: "cli",
    languages: ["javascript", "nodejs"],
    root: "/home/user/hax-agent",
    entryPoints: ["src/index.js", "src/cli.js"],
    overview: { totalFiles: 450, totalLines: 120000, testFiles: 80 },
    tree: [
      { name: "src", type: "directory", children: [
        { name: "index.js", type: "file" },
        { name: "cli.js", type: "file" },
      ]},
    ],
  };
  const result = injector.injectProjectContext("Project overview", info);
  assert.ok(result.formattedContext.includes("hax-agent"));
  assert.ok(result.formattedContext.includes("cli"));
  assert.ok(result.formattedContext.includes("javascript"));
  assert.ok(result.formattedContext.includes("/home/user/hax-agent"));
  assert.ok(result.formattedContext.includes("index.js"));
  assert.ok(result.formattedContext.includes("Total lines"));
});

test("injectProjectContext: returns empty for empty projectInfo", () => {
  const injector = new ContextInjector();
  const result = injector.injectProjectContext("query", {});
  assert.equal(result.formattedContext, "");
});

// ── renderPlacement ──────────────────────────────────────────

test("renderPlacement system: uses markdown headings", () => {
  const injector = new ContextInjector();
  const blocks = [
    { label: "Files", content: "src/index.js" },
    { label: "Git", content: "branch: main" },
  ];
  const rendered = injector.renderPlacement("system", blocks);
  assert.ok(rendered.includes("## Files"));
  assert.ok(rendered.includes("## Git"));
  assert.ok(rendered.includes("src/index.js"));
});

test("renderPlacement prefix: wraps in context-injection tags", () => {
  const injector = new ContextInjector();
  const blocks = [{ label: "Files", content: "src/index.js" }];
  const rendered = injector.renderPlacement("prefix", blocks);
  assert.ok(rendered.includes("<context-injection>"));
  assert.ok(rendered.includes("</context-injection>"));
  assert.ok(rendered.includes("### Files"));
});

test("renderPlacement tool: formats as synthetic tool result", () => {
  const injector = new ContextInjector();
  const blocks = [{ label: "Files", content: "src/index.js" }];
  const rendered = injector.renderPlacement("tool", blocks);
  assert.ok(rendered.includes("Tool Result"));
  assert.ok(rendered.includes("auto_context"));
  assert.ok(rendered.includes("### Files"));
});

test("renderPlacement: returns empty for empty blocks", () => {
  const injector = new ContextInjector();
  assert.equal(injector.renderPlacement("system", []), "");
  assert.equal(injector.renderPlacement("prefix", []), "");
  assert.equal(injector.renderPlacement("tool", []), "");
});
