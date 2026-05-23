/**
 * Tests for documentation content structure and integrity.
 * Validates that all doc entries have required fields and ids are unique.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  COMMANDS_DOCS,
  TOOLS_DOCS,
  PLUGINS_DOCS,
  CONFIG_DOCS,
  API_DOCS,
  EXAMPLES,
} = require("../../src/docs/content");

const REQUIRED_FIELDS = ["id", "title", "description"];

function assertValidDoc(doc, section) {
  for (const field of REQUIRED_FIELDS) {
    assert.ok(doc[field], `${section} "${doc.id || "unknown"}": missing required field "${field}"`);
  }
  assert.equal(typeof doc.id, "string", `${section} "${doc.id}": id must be a string`);
  assert.ok(doc.id.length > 0, `${section}: id must be non-empty`);
  assert.equal(typeof doc.title, "string", `${section} "${doc.id}": title must be a string`);
  assert.equal(typeof doc.description, "string", `${section} "${doc.id}": description must be a string`);
}

function assertUniqueIds(docs, section) {
  const seen = new Set();
  for (const doc of docs) {
    assert.ok(!seen.has(doc.id), `${section}: duplicate id "${doc.id}"`);
    seen.add(doc.id);
  }
}

test("COMMANDS_DOCS: all entries have required fields", () => {
  assert.ok(COMMANDS_DOCS.length >= 8, "should have at least 8 command docs");
  for (const doc of COMMANDS_DOCS) {
    assertValidDoc(doc, "COMMANDS_DOCS");
  }
});

test("COMMANDS_DOCS: all ids are unique", () => {
  assertUniqueIds(COMMANDS_DOCS, "COMMANDS_DOCS");
});

test("COMMANDS_DOCS: includes core commands", () => {
  const ids = COMMANDS_DOCS.map((d) => d.id);
  assert.ok(ids.includes("cmd-help"), "should include /help");
  assert.ok(ids.includes("cmd-exit"), "should include /exit");
  assert.ok(ids.includes("cmd-config"), "should include /config");
  assert.ok(ids.includes("cmd-tools"), "should include /tools");
  assert.ok(ids.includes("cmd-model"), "should include /model");
  assert.ok(ids.includes("cmd-sessions"), "should include /sessions");
  assert.ok(ids.includes("cmd-memory"), "should include /memory");
  assert.ok(ids.includes("cmd-permissions"), "should include /permissions");
});

test("TOOLS_DOCS: all entries have required fields", () => {
  assert.ok(TOOLS_DOCS.length >= 8, "should have at least 8 tool docs");
  for (const doc of TOOLS_DOCS) {
    assertValidDoc(doc, "TOOLS_DOCS");
  }
});

test("TOOLS_DOCS: all ids are unique", () => {
  assertUniqueIds(TOOLS_DOCS, "TOOLS_DOCS");
});

test("TOOLS_DOCS: includes all built-in tools", () => {
  const ids = TOOLS_DOCS.map((d) => d.id);
  const expected = [
    "tool-file-read", "tool-file-write", "tool-file-edit",
    "tool-file-delete", "tool-file-glob", "tool-file-search",
    "tool-file-readdir", "tool-shell", "tool-web-fetch",
    "tool-web-search", "tool-stock-quote",
  ];
  for (const id of expected) {
    assert.ok(ids.includes(id), `TOOLS_DOCS should include ${id}`);
  }
});

test("TOOLS_DOCS: arg objects have required fields when present", () => {
  for (const doc of TOOLS_DOCS) {
    if (Array.isArray(doc.args)) {
      for (const arg of doc.args) {
        assert.ok(arg.name, `TOOLS_DOCS "${doc.id}": arg missing name`);
        assert.ok(arg.type, `TOOLS_DOCS "${doc.id}": arg "${arg.name}" missing type`);
        assert.equal(typeof arg.required, "boolean", `TOOLS_DOCS "${doc.id}" arg "${arg.name}": required must be boolean`);
      }
    }
  }
});

test("PLUGINS_DOCS: all entries have required fields", () => {
  assert.ok(PLUGINS_DOCS.length >= 8, "should have at least 8 plugin docs");
  for (const doc of PLUGINS_DOCS) {
    assertValidDoc(doc, "PLUGINS_DOCS");
  }
});

test("PLUGINS_DOCS: all ids are unique", () => {
  assertUniqueIds(PLUGINS_DOCS, "PLUGINS_DOCS");
});

test("PLUGINS_DOCS: includes all hook documentation", () => {
  const ids = PLUGINS_DOCS.map((d) => d.id);
  const expected = [
    "plugins-overview", "plugins-hooks",
    "plugins-before-tool-call", "plugins-after-tool-call",
    "plugins-on-error", "plugins-before-chat", "plugins-after-chat",
    "plugins-session-start", "plugins-session-end", "plugins-examples",
  ];
  for (const id of expected) {
    assert.ok(ids.includes(id), `PLUGINS_DOCS should include ${id}`);
  }
});

test("CONFIG_DOCS: all entries have required fields", () => {
  assert.ok(CONFIG_DOCS.length >= 8, "should have at least 8 config docs");
  for (const doc of CONFIG_DOCS) {
    assertValidDoc(doc, "CONFIG_DOCS");
  }
});

test("CONFIG_DOCS: all ids are unique", () => {
  assertUniqueIds(CONFIG_DOCS, "CONFIG_DOCS");
});

test("CONFIG_DOCS: settings entries have required fields when present", () => {
  for (const doc of CONFIG_DOCS) {
    if (Array.isArray(doc.settings)) {
      for (const s of doc.settings) {
        assert.ok(s.path, `CONFIG_DOCS "${doc.id}": setting missing path`);
        assert.ok(s.type, `CONFIG_DOCS "${doc.id}" setting "${s.path}": missing type`);
        assert.ok(s.hasOwnProperty("default"), `CONFIG_DOCS "${doc.id}" setting "${s.path}": missing default`);
      }
    }
  }
});

test("API_DOCS: all entries have required fields", () => {
  assert.ok(API_DOCS.length >= 8, "should have at least 8 API docs");
  for (const doc of API_DOCS) {
    assertValidDoc(doc, "API_DOCS");
  }
});

test("API_DOCS: all ids are unique", () => {
  assertUniqueIds(API_DOCS, "API_DOCS");
});

test("API_DOCS: covers core modules", () => {
  const ids = API_DOCS.map((d) => d.id);
  const expected = [
    "api-config", "api-context", "api-memory", "api-providers",
    "api-tools", "api-orchestration", "api-plugins", "api-permissions",
    "api-agent-engine", "api-renderer",
  ];
  for (const id of expected) {
    assert.ok(ids.includes(id), `API_DOCS should include ${id}`);
  }
});

test("EXAMPLES: all entries have required fields", () => {
  assert.ok(EXAMPLES.length >= 4, "should have at least 4 examples");
  for (const doc of EXAMPLES) {
    assertValidDoc(doc, "EXAMPLES");
  }
});

test("EXAMPLES: all ids are unique", () => {
  assertUniqueIds(EXAMPLES, "EXAMPLES");
});

test("All docs sections are non-empty arrays", () => {
  const sections = { COMMANDS_DOCS, TOOLS_DOCS, PLUGINS_DOCS, CONFIG_DOCS, API_DOCS, EXAMPLES };
  for (const [name, docs] of Object.entries(sections)) {
    assert.ok(Array.isArray(docs), `${name} should be an array`);
    assert.ok(docs.length > 0, `${name} should not be empty`);
  }
});

test("No duplicate IDs across all sections", () => {
  const allDocs = [
    ...COMMANDS_DOCS,
    ...TOOLS_DOCS,
    ...PLUGINS_DOCS,
    ...CONFIG_DOCS,
    ...API_DOCS,
    ...EXAMPLES,
  ];
  const seen = new Set();
  const duplicates = [];
  for (const doc of allDocs) {
    if (seen.has(doc.id)) {
      duplicates.push(doc.id);
    }
    seen.add(doc.id);
  }
  assert.deepEqual(duplicates, [], "Duplicate doc IDs found: " + duplicates.join(", "));
});

test("seeAlso references point to existing doc IDs", () => {
  const allIds = new Set();
  for (const doc of [
    ...COMMANDS_DOCS,
    ...TOOLS_DOCS,
    ...PLUGINS_DOCS,
    ...CONFIG_DOCS,
    ...API_DOCS,
    ...EXAMPLES,
  ]) {
    allIds.add(doc.id);
  }

  const broken = [];
  for (const doc of [
    ...COMMANDS_DOCS,
    ...TOOLS_DOCS,
    ...PLUGINS_DOCS,
    ...CONFIG_DOCS,
    ...API_DOCS,
    ...EXAMPLES,
  ]) {
    if (Array.isArray(doc.seeAlso)) {
      for (const ref of doc.seeAlso) {
        if (!allIds.has(ref)) {
          broken.push({ from: doc.id, to: ref });
        }
      }
    }
  }
  if (broken.length > 0) {
    const msg = broken.map((b) => `${b.from} -> ${b.to}`).join(", ");
    assert.fail(`Broken seeAlso references: ${msg}`);
  } else {
    assert.equal(broken.length, 0, "no broken seeAlso references");
  }
});
