"use strict";

const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const detect = require("../../src/platform/detect");

test("getPlatform: returns a known platform label", () => {
  const platform = detect.getPlatform();
  assert.ok(
    ["windows", "macos", "linux", "unknown"].includes(platform),
    `Expected known platform, got "${platform}"`
  );
});

test("getPlatform: maps win32 to 'windows'", () => {
  if (process.platform !== "win32") return;
  assert.equal(detect.getPlatform(), "windows");
});

test("getPlatform: maps darwin to 'macos'", () => {
  if (process.platform !== "darwin") return;
  assert.equal(detect.getPlatform(), "macos");
});

test("getPlatform: maps linux to 'linux'", () => {
  if (process.platform !== "linux") return;
  assert.equal(detect.getPlatform(), "linux");
});

test("getArch: returns a string matching process.arch", () => {
  assert.equal(detect.getArch(), process.arch);
  assert.ok(typeof detect.getArch() === "string");
});

test("isWindows / isMacOS / isLinux: exactly one is true", () => {
  const flags = [detect.isWindows(), detect.isMacOS(), detect.isLinux()];
  const trueCount = flags.filter(Boolean).length;
  assert.ok(
    trueCount === 1 || (trueCount === 0 && detect.getPlatform() === "unknown"),
    `Exactly one platform flag should be true (or zero for unknown); got ${trueCount}`
  );
});

test("isWindows: matches process.platform", () => {
  assert.equal(detect.isWindows(), process.platform === "win32");
});

test("isMacOS: matches process.platform", () => {
  assert.equal(detect.isMacOS(), process.platform === "darwin");
});

test("isLinux: matches process.platform", () => {
  assert.equal(detect.isLinux(), process.platform === "linux");
});

test("getShell: returns a non-empty string", () => {
  const shell = detect.getShell();
  assert.ok(typeof shell === "string" && shell.length > 0, "getShell must return a non-empty string");
});

test("getShell: respects SHELL env var", () => {
  const original = process.env.SHELL;
  process.env.SHELL = "/custom/shell";
  try {
    assert.equal(detect.getShell(), "/custom/shell");
  } finally {
    if (original === undefined) {
      delete process.env.SHELL;
    } else {
      process.env.SHELL = original;
    }
  }
});

test("getShell: returns .exe path on Windows when not overridden", () => {
  if (process.platform !== "win32") return;
  const shell = detect.getShell();
  // On Windows without env overrides, shell should be cmd.exe or powershell
  assert.ok(
    shell.toLowerCase().endsWith(".exe") || shell === "cmd.exe",
    `Expected .exe path or cmd.exe, got "${shell}"`
  );
});

test("getShell: returns a Unix shell path on non-Windows", () => {
  if (process.platform === "win32") return;
  const shell = detect.getShell();
  assert.ok(
    shell.startsWith("/"),
    `Expected absolute Unix path, got "${shell}"`
  );
});

test("getHomeDir: returns an absolute, normalised path", () => {
  const home = detect.getHomeDir();
  assert.ok(path.isAbsolute(home), `Home dir should be absolute, got "${home}"`);
  assert.equal(home, path.normalize(os.homedir()));
});

test("getTempDir: returns an absolute, normalised path", () => {
  const tmp = detect.getTempDir();
  assert.ok(path.isAbsolute(tmp), `Temp dir should be absolute, got "${tmp}"`);
  assert.equal(tmp, path.normalize(os.tmpdir()));
});

test("getConfigDir: ends with appName", () => {
  const dir = detect.getConfigDir({ appName: "MyTestApp" });
  assert.ok(dir.endsWith("MyTestApp"), `Expected path ending with MyTestApp, got "${dir}"`);
  assert.ok(path.isAbsolute(dir), `Expected absolute path, got "${dir}"`);
});

test("getConfigDir: returns path containing HaxAgent by default", () => {
  const dir = detect.getConfigDir();
  assert.ok(dir.includes("HaxAgent"), `Expected path to contain "HaxAgent", got "${dir}"`);
});

test("getDataDir: ends with appName", () => {
  const dir = detect.getDataDir({ appName: "MyTestApp" });
  assert.ok(dir.endsWith("MyTestApp"), `Expected path ending with MyTestApp, got "${dir}"`);
  assert.ok(path.isAbsolute(dir), `Expected absolute path, got "${dir}"`);
});

test("getDataDir: returns path containing HaxAgent by default", () => {
  const dir = detect.getDataDir();
  assert.ok(dir.includes("HaxAgent"), `Expected path to contain "HaxAgent", got "${dir}"`);
});

test("getConfigDir respects XDG_CONFIG_HOME on Linux", () => {
  if (process.platform !== "linux") return;
  const original = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = "/custom/config";
  try {
    const dir = detect.getConfigDir({ appName: "Test" });
    assert.ok(dir.startsWith("/custom/config"), `Expected /custom/config prefix, got "${dir}"`);
  } finally {
    if (original === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = original;
    }
  }
});

test("getDataDir respects XDG_DATA_HOME on Linux", () => {
  if (process.platform !== "linux") return;
  const original = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = "/custom/data";
  try {
    const dir = detect.getDataDir({ appName: "Test" });
    assert.ok(dir.startsWith("/custom/data"), `Expected /custom/data prefix, got "${dir}"`);
  } finally {
    if (original === undefined) {
      delete process.env.XDG_DATA_HOME;
    } else {
      process.env.XDG_DATA_HOME = original;
    }
  }
});
