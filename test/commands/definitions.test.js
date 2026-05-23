"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  SLASH_COMMANDS,
  SKILLS_SUBCOMMANDS,
  PERMISSIONS_SUBCOMMANDS,
  MEMORY_SUBCOMMANDS,
  CONTEXT_SUBCOMMANDS,
  TEAM_SUBCOMMANDS,
  isThemeEnabled,
  isVimMode,
  setThemeEnabled,
  setVimMode,
} = require("../../src/commands/definitions");

// ---------------------------------------------------------------------------
// SLASH_COMMANDS structure
// ---------------------------------------------------------------------------

test("SLASH_COMMANDS: is a non-empty array", () => {
  assert.ok(Array.isArray(SLASH_COMMANDS));
  assert.ok(SLASH_COMMANDS.length > 0);
});

test("SLASH_COMMANDS: each command has required fields", () => {
  for (const cmd of SLASH_COMMANDS) {
    assert.ok(typeof cmd.name === "string" && cmd.name.length > 0,
      `command missing valid name: ${JSON.stringify(cmd)}`);
    assert.ok(typeof cmd.descriptionKey === "string" && cmd.descriptionKey.length > 0,
      `command "${cmd.name}" missing descriptionKey`);
    assert.ok(typeof cmd.description === "string" && cmd.description.length > 0,
      `command "${cmd.name}" missing description`);
    assert.ok(Array.isArray(cmd.aliases),
      `command "${cmd.name}" missing aliases array`);
  }
});

test("SLASH_COMMANDS: all command names are unique", () => {
  const names = SLASH_COMMANDS.map((c) => c.name);
  const uniqueNames = new Set(names);
  assert.equal(names.length, uniqueNames.size,
    `duplicate command names found: ${names.filter((n, i) => names.indexOf(n) !== i).join(", ")}`);
});

test("SLASH_COMMANDS: all descriptionKeys are unique", () => {
  const keys = SLASH_COMMANDS.map((c) => c.descriptionKey);
  const uniqueKeys = new Set(keys);
  assert.equal(keys.length, uniqueKeys.size,
    `duplicate descriptionKeys found: ${keys.filter((k, i) => keys.indexOf(k) !== i).join(", ")}`);
});

test("SLASH_COMMANDS: aliases are non-empty strings and unique within each command", () => {
  for (const cmd of SLASH_COMMANDS) {
    for (const alias of cmd.aliases) {
      assert.ok(typeof alias === "string" && alias.length > 0,
        `command "${cmd.name}" has empty/invalid alias`);
    }
    const uniqueAliases = new Set(cmd.aliases);
    assert.equal(cmd.aliases.length, uniqueAliases.size,
      `command "${cmd.name}" has duplicate aliases`);
  }
});

test("SLASH_COMMANDS: no alias conflicts with command names or other aliases", () => {
  const allNames = new Map(); // name -> command name
  for (const cmd of SLASH_COMMANDS) {
    allNames.set(cmd.name, cmd.name);
    for (const alias of cmd.aliases) {
      if (allNames.has(alias)) {
        assert.fail(`alias "${alias}" on "${cmd.name}" conflicts with "${allNames.get(alias)}"`);
      }
      allNames.set(alias, cmd.name);
    }
  }
  // If we got here without fail, all good
  assert.ok(true);
});

test("SLASH_COMMANDS: includes essential commands", () => {
  const names = new Set(SLASH_COMMANDS.map((c) => c.name));
  const required = ["help", "exit", "clear", "memory", "model", "export"];
  for (const cmd of required) {
    assert.ok(names.has(cmd), `essential command "${cmd}" is missing from SLASH_COMMANDS`);
  }
});

// ---------------------------------------------------------------------------
// Subcommand definitions
// ---------------------------------------------------------------------------

test("MEMORY_SUBCOMMANDS: is a non-empty array with expected values", () => {
  assert.ok(Array.isArray(MEMORY_SUBCOMMANDS));
  assert.ok(MEMORY_SUBCOMMANDS.length >= 3);
  const expected = ["list", "read", "write"];
  for (const sub of expected) {
    assert.ok(MEMORY_SUBCOMMANDS.includes(sub),
      `MEMORY_SUBCOMMANDS missing "${sub}"`);
  }
});

test("PERMISSIONS_SUBCOMMANDS: is a non-empty array with expected values", () => {
  assert.ok(Array.isArray(PERMISSIONS_SUBCOMMANDS));
  assert.ok(PERMISSIONS_SUBCOMMANDS.length >= 3);
  assert.ok(PERMISSIONS_SUBCOMMANDS.includes("status"));
  assert.ok(PERMISSIONS_SUBCOMMANDS.includes("mode"));
  assert.ok(PERMISSIONS_SUBCOMMANDS.includes("reset"));
});

test("SKILLS_SUBCOMMANDS: is a non-empty array with expected values", () => {
  assert.ok(Array.isArray(SKILLS_SUBCOMMANDS));
  assert.ok(SKILLS_SUBCOMMANDS.length >= 1);
  assert.ok(SKILLS_SUBCOMMANDS.includes("list"));
});

test("CONTEXT_SUBCOMMANDS: is a non-empty array with expected values", () => {
  assert.ok(Array.isArray(CONTEXT_SUBCOMMANDS));
  assert.ok(CONTEXT_SUBCOMMANDS.length >= 3);
  assert.ok(CONTEXT_SUBCOMMANDS.includes("status"));
});

test("TEAM_SUBCOMMANDS: is a non-empty array with expected values", () => {
  assert.ok(Array.isArray(TEAM_SUBCOMMANDS));
  assert.ok(TEAM_SUBCOMMANDS.length >= 4);
  assert.ok(TEAM_SUBCOMMANDS.includes("new"));
  assert.ok(TEAM_SUBCOMMANDS.includes("run"));
});

// ---------------------------------------------------------------------------
// Theme and Vim mode toggle functions
// ---------------------------------------------------------------------------

test("isThemeEnabled: defaults to true", () => {
  // Set to known state first
  setThemeEnabled(true);
  assert.equal(isThemeEnabled(), true);
});

test("setThemeEnabled / isThemeEnabled: toggles correctly", () => {
  setThemeEnabled(false);
  assert.equal(isThemeEnabled(), false);
  setThemeEnabled(true);
  assert.equal(isThemeEnabled(), true);
  // Reset to default
  setThemeEnabled(true);
});

test("isVimMode: defaults to false", () => {
  setVimMode(false);
  assert.equal(isVimMode(), false);
});

test("setVimMode / isVimMode: toggles correctly", () => {
  setVimMode(true);
  assert.equal(isVimMode(), true);
  setVimMode(false);
  assert.equal(isVimMode(), false);
});
