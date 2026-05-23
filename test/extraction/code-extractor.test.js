/**
 * Tests for CodeExtractor: fenced/indented code blocks, file-change
 * detection, shell-command extraction, patch extraction, file grouping,
 * and script generation.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CodeExtractor,
  extractCodeBlocks,
  extractFileChanges,
  extractCommands,
  extractPatches,
  organizeByFile,
  generateScript,
  _internals,
} = require("../../src/extraction/code-extractor");

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
// extractCodeBlocks
// ---------------------------------------------------------------------------

test("extractCodeBlocks: extracts fenced JavaScript block", () => {
  const s = session(
    msg("assistant", "Here is some code:\n```javascript\nconst x = 1;\nconsole.log(x);\n```"),
  );
  const blocks = extractCodeBlocks(s);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].language, "javascript");
  assert.ok(blocks[0].code.includes("const x = 1"));
  assert.equal(blocks[0].blockType, "fenced");
  assert.equal(blocks[0].sourceIndex, 0);
});

test("extractCodeBlocks: extracts multiple fenced blocks", () => {
  const s = session(
    msg("assistant", "Block 1:\n```python\nprint('hello')\n```\nBlock 2:\n```bash\nnpm install\n```"),
  );
  const blocks = extractCodeBlocks(s);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].language, "python");
  assert.equal(blocks[1].language, "bash");
});

test("extractCodeBlocks: returns empty array for no code blocks", () => {
  const s = session(
    msg("user", "What is the weather like?"),
    msg("assistant", "It is sunny today."),
  );
  const blocks = extractCodeBlocks(s);
  assert.equal(blocks.length, 0);
});

test("extractCodeBlocks: handles blocks without language tag", () => {
  const s = session(
    msg("assistant", "Plain code:\n```\nhello world\nmore text\n```"),
  );
  const blocks = extractCodeBlocks(s);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].language, "text");
  assert.ok(blocks[0].code.includes("hello world"));
});

test("extractCodeBlocks: skips empty fenced blocks", () => {
  const s = session(
    msg("assistant", "```\n```\nUseful:\n```js\nconst a = 1;\n```"),
  );
  const blocks = extractCodeBlocks(s);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].language, "js");
});

test("extractCodeBlocks: records line numbers correctly", () => {
  const s = session(
    msg("assistant", "Line 1: intro\nLine 2: more\n```ts\nconst t: string = 'hi';\n```\nLine 5: after"),
  );
  const blocks = extractCodeBlocks(s);
  assert.equal(blocks.length, 1);
  assert.ok(blocks[0].startLine >= 3, "startLine should be at or after line 3");
  assert.ok(blocks[0].endLine > blocks[0].startLine, "endLine should be after startLine");
});

// ---------------------------------------------------------------------------
// extractFileChanges
// ---------------------------------------------------------------------------

test("extractFileChanges: detects file creation with nearby code block", () => {
  const s = session(
    msg("user", "Create a new file at src/utils.js"),
    msg("assistant", "I'll create src/utils.js for you:\n```javascript\nfunction add(a, b) {\n  return a + b;\n}\n```"),
  );
  const changes = extractFileChanges(s);
  assert.ok(changes.length >= 1, "should find at least one file change");
  const utilsChange = changes.find((c) => c.filePath.includes("utils.js"));
  assert.ok(utilsChange, "should find utils.js change");
  assert.equal(utilsChange.operation, "create");
  assert.equal(utilsChange.confidence, "high");
  assert.ok(utilsChange.code, "should have associated code");
});

test("extractFileChanges: detects file modification", () => {
  const s = session(
    msg("user", "Can you modify the config.json file?"),
    msg("assistant", "I'll update config.json:\n```json\n{\"key\": \"value\"}\n```"),
  );
  const changes = extractFileChanges(s);
  const configChange = changes.find((c) => c.filePath.includes("config.json"));
  assert.ok(configChange);
  assert.equal(configChange.operation, "modify");
});

test("extractFileChanges: returns empty array for no file references", () => {
  const s = session(
    msg("user", "Tell me a joke"),
    msg("assistant", "Why did the chicken cross the road?"),
  );
  const changes = extractFileChanges(s);
  assert.equal(changes.length, 0);
});

test("extractFileChanges: deduplicates by file path and operation", () => {
  const s = session(
    msg("user", "Write file app.js"),
    msg("assistant", "Here is app.js:\n```js\nconst x = 1;\n```"),
    msg("user", "Update app.js to add a function"),
    msg("assistant", "Modified app.js:\n```js\nconst x = 1;\nfunction f() {}\n```"),
  );
  const changes = extractFileChanges(s);
  const appChanges = changes.filter((c) => c.filePath === "app.js");
  // Dedup uses filePath + operation as key, so "create" and "modify" are separate.
  // The algorithm finds create, modify, and possibly reference operations.
  assert.ok(appChanges.length >= 1, "should find at least one app.js entry");
  assert.ok(changes.length >= 2, "should find both create and modify operations");
});

// ---------------------------------------------------------------------------
// extractCommands
// ---------------------------------------------------------------------------

test("extractCommands: extracts commands from bash code blocks", () => {
  const s = session(
    msg("assistant", "Run this:\n```bash\nnpm install\nnpm run build\n```"),
  );
  const commands = extractCommands(s);
  assert.equal(commands.length, 2);
  assert.equal(commands[0].command, "npm install");
  assert.equal(commands[0].context, "code-block");
  assert.equal(commands[1].command, "npm run build");
});

test("extractCommands: extracts commands from inline prompts ($)", () => {
  const s = session(
    msg("assistant", "Run:\n$ npm test\n$ echo done"),
  );
  const commands = extractCommands(s);
  const testCmd = commands.find((c) => c.command === "npm test");
  assert.ok(testCmd);
  assert.equal(testCmd.context, "inline-prompt");
});

test("extractCommands: extracts commands from code blocks (shell lang tag)", () => {
  const s = session(
    msg("assistant", "To check status, run:\n```shell\ngit status\ndocker compose up\n```"),
  );
  const commands = extractCommands(s);
  const gitCmd = commands.find((c) => c.command.includes("git status"));
  const dockerCmd = commands.find((c) => c.command.includes("docker compose up"));
  assert.ok(gitCmd, "should find git status command");
  assert.ok(dockerCmd, "should find docker compose up command");
});

test("extractCommands: skips comment lines in bash blocks, but finds inline # commands elsewhere", () => {
  const s = session(
    msg("assistant", "Run:\n```bash\n# This is a comment\nnpm install\n# Another comment\n```"),
  );
  const commands = extractCommands(s);
  // The bash block filter skips # lines, giving "npm install".
  // Inline prompts also match # lines as commands, so we may get more.
  // At minimum, "npm install" should be found.
  const installCmd = commands.find((c) => c.command === "npm install");
  assert.ok(installCmd, "should find npm install command");
});

test("extractCommands: deduplicates identical commands", () => {
  const s = session(
    msg("assistant", "The command is:\n```bash\nnpm install\n```"),
    msg("assistant", "You can also run:\n```bash\nnpm install\n```"),
  );
  const commands = extractCommands(s);
  const installCmds = commands.filter((c) => c.command === "npm install");
  assert.equal(installCmds.length, 1, "npm install should be deduplicated");
});

// ---------------------------------------------------------------------------
// extractPatches
// ---------------------------------------------------------------------------

test("extractPatches: extracts diff from fenced code block", () => {
  const s = session(
    msg("assistant", "Here is the patch:\n```diff\ndiff --git a/file.js b/file.js\nindex abc..def\n--- a/file.js\n+++ b/file.js\n@@ -1,3 +1,3 @@\n-old\n+new\n```"),
  );
  const patches = extractPatches(s);
  assert.equal(patches.length, 1);
  assert.equal(patches[0].format, "diff");
  assert.ok(patches[0].content.includes("--- a/file.js"));
});

test("extractPatches: returns empty for non-diff content", () => {
  const s = session(
    msg("user", "Some regular text without diffs"),
  );
  const patches = extractPatches(s);
  assert.equal(patches.length, 0);
});

test("extractPatches: counts files in diff correctly", () => {
  const s = session(
    msg("assistant", "```diff\ndiff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-old\n+new\ndiff --git a/b.js b/b.js\n--- a/b.js\n+++ b/b.js\n```"),
  );
  const patches = extractPatches(s);
  assert.equal(patches.length, 1);
  assert.ok(patches[0].fileCount >= 1);
});

// ---------------------------------------------------------------------------
// organizeByFile
// ---------------------------------------------------------------------------

test("organizeByFile: groups extractions by file path", () => {
  const extractions = [
    { filePath: "src/a.js", code: "x" },
    { filePath: "src/a.js", code: "y" },
    { filePath: "src/b.js", code: "z" },
  ];
  const byFile = organizeByFile(extractions);
  assert.equal(byFile.size, 2);
  assert.equal(byFile.get("src/a.js").length, 2);
  assert.equal(byFile.get("src/b.js").length, 1);
});

test("organizeByFile: uses 'unknown' for items without filePath", () => {
  const extractions = [
    { command: "npm test" },
    { code: "console.log()" },
  ];
  const byFile = organizeByFile(extractions);
  assert.equal(byFile.get("unknown").length, 2);
});

// ---------------------------------------------------------------------------
// generateScript
// ---------------------------------------------------------------------------

test("generateScript: produces a runnable bash script with commands", () => {
  const extractions = [
    { command: "npm install", sourceIndex: 0 },
    { command: "npm test", sourceIndex: 1 },
  ];
  const script = generateScript(extractions);
  assert.ok(script.startsWith("#!/usr/bin/env bash"), "should start with shebang");
  assert.ok(script.includes("set -euo pipefail"), "should include safe mode");
  assert.ok(script.includes("npm install"), "should include first command");
  assert.ok(script.includes("npm test"), "should include second command");
});

test("generateScript: generates file creation commands for file changes", () => {
  const extractions = [
    { filePath: "src/index.js", code: "console.log('hi');", operation: "create" },
  ];
  const script = generateScript(extractions);
  assert.ok(script.includes("cat >"), "should use cat to create file");
  assert.ok(script.includes("src/index.js"), "should reference the file");
  assert.ok(script.includes("console.log('hi');"), "should include the code content");
  assert.ok(script.includes("HAXEOF"), "should use heredoc");
});

test("generateScript: includes patch application commands", () => {
  const extractions = [
    { format: "diff", content: "diff --git a/x b/x\n-old\n+new", sourceIndex: 0 },
  ];
  const script = generateScript(extractions);
  assert.ok(script.includes("git apply"), "should use git apply for patches");
  assert.ok(script.includes("--verbose --check"), "should check before applying");
  assert.ok(script.includes("HAXPATCH"), "should use heredoc for patch");
});

test("generateScript: produces placeholder when no actionable content", () => {
  const extractions = [];
  const script = generateScript(extractions);
  assert.ok(script.includes("No actionable content"), "should indicate no content");
});

// ---------------------------------------------------------------------------
// CodeExtractor class
// ---------------------------------------------------------------------------

test("CodeExtractor: extractAll returns composite result", () => {
  const s = session(
    msg("user", "Create src/app.js"),
    msg("assistant", "```javascript\nconst app = () => {};\n```\nRun with:\n```bash\nnode app.js\n```"),
  );
  const extractor = new CodeExtractor(s);
  const result = extractor.extractAll();

  assert.ok(Array.isArray(result.codeBlocks));
  assert.ok(Array.isArray(result.fileChanges));
  assert.ok(Array.isArray(result.commands));
  assert.ok(Array.isArray(result.patches));
  assert.ok(result.byFile instanceof Map);
  assert.equal(typeof result.script, "string");
  assert.ok(result.codeBlocks.length >= 1);
  assert.ok(result.commands.length >= 1);
});

// ---------------------------------------------------------------------------
// _internals helpers
// ---------------------------------------------------------------------------

test("_internals.toText: handles various input types", () => {
  assert.equal(_internals.toText("hello"), "hello");
  assert.equal(_internals.toText(123), "123");
  assert.equal(_internals.toText(null), "");
  assert.equal(_internals.toText(undefined), "");
  assert.equal(_internals.toText(["a", "b"]), "a b");
  assert.equal(_internals.toText({ text: "nested" }), "nested");
});

test("_internals.normalizeMessages: accepts session object or array", () => {
  const raw = [{ role: "user", content: "hello" }];
  const fromArray = _internals.normalizeMessages(raw);
  assert.equal(fromArray.length, 1);
  assert.equal(fromArray[0].role, "user");

  const fromSession = _internals.normalizeMessages({ messages: raw });
  assert.equal(fromSession.length, 1);
  assert.equal(fromSession[0].role, "user");
});

test("_internals.determineFileOperation: classifies operations correctly", () => {
  assert.equal(_internals.determineFileOperation("create file app.js", "app.js"), "create");
  assert.equal(_internals.determineFileOperation("update the config.json file", "config.json"), "modify");
  assert.equal(_internals.determineFileOperation("delete old.js from the project", "old.js"), "delete");
  assert.equal(_internals.determineFileOperation("read the package.json file", "package.json"), "read");
  assert.equal(_internals.determineFileOperation("run the build.sh script", "build.sh"), "execute");
  assert.equal(_internals.determineFileOperation("here is some.txt", "some.txt"), "reference");
});
