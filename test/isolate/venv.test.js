/**
 * Tests for VirtualEnv — environment detection, creation, activation.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { VirtualEnv, VirtualEnvError, ENV_TYPES } = require("../../src/isolate/venv");

// -- Helper to set up a temp directory ---------------------------------------

let tmpDir;

test.before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-venv-test-"));
});

test.after(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("VirtualEnv: ENV_TYPES contains NODE, PYTHON, DOCKER, NIX", () => {
  assert.equal(ENV_TYPES.NODE, "NODE");
  assert.equal(ENV_TYPES.PYTHON, "PYTHON");
  assert.equal(ENV_TYPES.DOCKER, "DOCKER");
  assert.equal(ENV_TYPES.NIX, "NIX");
  assert.ok(Object.isFrozen(ENV_TYPES));
});

test("VirtualEnv: creates instance with default options", () => {
  const venv = new VirtualEnv();
  assert.ok(venv instanceof VirtualEnv);
  assert.deepEqual(venv._types, ENV_TYPES);
});

test("VirtualEnv: detect() returns not-detected in empty directory", () => {
  const venv = new VirtualEnv();
  const result = venv.detect(tmpDir);
  assert.equal(result.detected, false);
  assert.equal(result.type, null);
  assert.equal(result.runtime, null);
  assert.deepEqual(result.indicators, []);
});

test("VirtualEnv: detect() finds Python venv by VIRTUAL_ENV env var", () => {
  const fakeVenv = path.join(tmpDir, ".venv");
  fs.mkdirSync(fakeVenv, { recursive: true });

  const original = process.env.VIRTUAL_ENV;
  process.env.VIRTUAL_ENV = fakeVenv;

  try {
    const venv = new VirtualEnv();
    const result = venv.detect(tmpDir);
    assert.equal(result.detected, true);
    assert.equal(result.type, ENV_TYPES.PYTHON);
    assert.equal(result.runtime, "venv");
    assert.equal(result.path, fakeVenv);
    assert.ok(result.indicators.length > 0);
  } finally {
    if (original) {
      process.env.VIRTUAL_ENV = original;
    } else {
      delete process.env.VIRTUAL_ENV;
    }
  }
});

test("VirtualEnv: detect() finds conda by CONDA_PREFIX env var", () => {
  const fakeCondaPrefix = path.join(tmpDir, "miniconda3", "envs", "test-env");
  fs.mkdirSync(fakeCondaPrefix, { recursive: true });

  const originalPrefix = process.env.CONDA_PREFIX;
  const originalName = process.env.CONDA_DEFAULT_ENV;
  process.env.CONDA_PREFIX = fakeCondaPrefix;
  process.env.CONDA_DEFAULT_ENV = "test-env";

  try {
    const venv = new VirtualEnv();
    const result = venv.detect(tmpDir);
    assert.equal(result.detected, true);
    assert.equal(result.type, ENV_TYPES.PYTHON);
    assert.equal(result.runtime, "conda");
    assert.equal(result.name, "test-env");
  } finally {
    if (originalPrefix) {
      process.env.CONDA_PREFIX = originalPrefix;
    } else {
      delete process.env.CONDA_PREFIX;
    }
    if (originalName) {
      process.env.CONDA_DEFAULT_ENV = originalName;
    } else {
      delete process.env.CONDA_DEFAULT_ENV;
    }
  }
});

test("VirtualEnv: detect() finds NVM by NVM_DIR env var", () => {
  const nvmDir = path.join(tmpDir, ".nvm");

  const original = process.env.NVM_DIR;
  process.env.NVM_DIR = nvmDir;

  try {
    const venv = new VirtualEnv();
    const result = venv.detect(tmpDir);
    assert.equal(result.detected, true);
    assert.equal(result.type, ENV_TYPES.NODE);
    assert.equal(result.runtime, "nvm");
  } finally {
    if (original) {
      process.env.NVM_DIR = original;
    } else {
      delete process.env.NVM_DIR;
    }
  }
});

test("VirtualEnv: detect() finds Dockerfile by filesystem scan", () => {
  const dockerfilePath = path.join(tmpDir, "Dockerfile");
  fs.writeFileSync(dockerfilePath, "FROM node:18", "utf8");

  const venv = new VirtualEnv();
  const result = venv.detect(tmpDir);
  assert.equal(result.detected, true);
  assert.equal(result.type, ENV_TYPES.DOCKER);
  assert.equal(result.runtime, "docker");
  assert.ok(result.indicators.includes(dockerfilePath));

  fs.unlinkSync(dockerfilePath);
});

test("VirtualEnv: detect() finds flake.nix by filesystem scan", () => {
  const nixPath = path.join(tmpDir, "flake.nix");
  fs.writeFileSync(nixPath, "{}", "utf8");

  const venv = new VirtualEnv();
  const result = venv.detect(tmpDir);
  assert.equal(result.detected, true);
  assert.equal(result.type, ENV_TYPES.NIX);
  assert.equal(result.runtime, "nix");
  assert.ok(result.indicators.includes(nixPath));

  fs.unlinkSync(nixPath);
});

test("VirtualEnv: detect() finds .nvmrc for Node version", () => {
  const nvmrcPath = path.join(tmpDir, ".nvmrc");
  fs.writeFileSync(nvmrcPath, "18.17.0", "utf8");

  const venv = new VirtualEnv();
  const result = venv.detect(tmpDir);
  assert.equal(result.detected, true);
  assert.equal(result.type, ENV_TYPES.NODE);
  assert.equal(result.runtime, "nvm");
  assert.equal(result.nodeVersion, "18.17.0");

  fs.unlinkSync(nvmrcPath);
});

test("VirtualEnv: isIsolated() returns false by default", () => {
  const venv = new VirtualEnv();
  // In test environment we should not be isolated
  // (unless we are in Docker — we check HAX_ENV_ACTIVE is unset)
  const wasActive = process.env.HAX_ENV_ACTIVE;
  delete process.env.HAX_ENV_ACTIVE;
  delete process.env.VIRTUAL_ENV;
  delete process.env.CONDA_PREFIX;
  delete process.env.IN_NIX_SHELL;

  try {
    assert.equal(venv.isIsolated(), false);
  } finally {
    if (wasActive) process.env.HAX_ENV_ACTIVE = wasActive;
  }
});

test("VirtualEnv: isIsolated() returns true when HAX_ENV_ACTIVE is set", () => {
  const venv = new VirtualEnv();
  process.env.HAX_ENV_ACTIVE = "true";

  try {
    assert.equal(venv.isIsolated(), true);
  } finally {
    delete process.env.HAX_ENV_ACTIVE;
  }
});

test("VirtualEnv: isIsolated() returns true when IN_NIX_SHELL is set", () => {
  const venv = new VirtualEnv();
  const original = process.env.IN_NIX_SHELL;
  process.env.IN_NIX_SHELL = "1";

  try {
    assert.equal(venv.isIsolated(), true);
  } finally {
    if (original) {
      process.env.IN_NIX_SHELL = original;
    } else {
      delete process.env.IN_NIX_SHELL;
    }
  }
});

test("VirtualEnv: activate/deactivate round-trip preserves PATH", () => {
  const venv = new VirtualEnv();
  const envPath = path.join(tmpDir, "test-venv");
  fs.mkdirSync(path.join(envPath, "bin"), { recursive: true });

  const originalPath = process.env.PATH;
  const env = { type: "PYTHON", path: envPath, name: "test-venv" };

  const activated = venv.activate(env);
  assert.equal(activated.activated, true);
  assert.ok(activated.env.PATH.includes(envPath));

  // Deactivate
  const deactivated = venv.deactivate();
  assert.equal(deactivated.restored, true);
  assert.equal(process.env.PATH, originalPath);
  assert.equal(process.env.HAX_ENV_ACTIVE, undefined);
});

test("VirtualEnv: activate() throws on invalid environment", () => {
  const venv = new VirtualEnv();
  assert.throws(
    () => venv.activate(null),
    (err) => err instanceof VirtualEnvError && err.code === "VENV_INVALID_ENV",
  );
  assert.throws(
    () => venv.activate({}),
    (err) => err instanceof VirtualEnvError && err.code === "VENV_INVALID_ENV",
  );
});

test("VirtualEnv: create() for PYTHON type returns correct command structure", () => {
  const venv = new VirtualEnv();
  const envPath = path.join(tmpDir, "create-test-env");

  const result = venv.create("PYTHON", {
    path: envPath,
    name: "test-py-env",
    pythonVersion: "3.11",
    packages: ["requests", "numpy"],
  });

  assert.equal(result.type, "PYTHON");
  assert.equal(result.name, "test-py-env");
  assert.equal(result.created, true);
  assert.ok(result.commands.length > 0);
  assert.ok(result.commands[0].includes("python3.11 -m venv"));
  assert.ok(result.commands[0].includes(envPath));
});

test("VirtualEnv: create() for NODE type returns correct commands", () => {
  const venv = new VirtualEnv();
  const result = venv.create("NODE", {
    name: "test-node-env",
    nodeVersion: "20.0.0",
    packages: ["typescript", "prettier"],
  });

  assert.equal(result.type, "NODE");
  assert.equal(result.name, "test-node-env");
  assert.equal(result.created, true);
  assert.ok(result.commands[0].includes("nvm install 20.0.0"));
});

test("VirtualEnv: create() for DOCKER type returns correct commands", () => {
  const venv = new VirtualEnv();
  const envPath = path.join(tmpDir, "docker-test");

  const result = venv.create("DOCKER", {
    path: envPath,
    name: "test-docker-env",
    baseImage: "node:18-bullseye",
  });

  assert.equal(result.type, "DOCKER");
  assert.equal(result.name, "test-docker-env");
  assert.equal(result.created, true);
  assert.ok(result.commands.some((c) => c.includes("docker build")));
});

test("VirtualEnv: create() throws on unknown type", () => {
  const venv = new VirtualEnv();
  assert.throws(
    () => venv.create("UNKNOWN"),
    (err) => err instanceof VirtualEnvError && err.code === "VENV_INVALID_TYPE",
  );
});

test("VirtualEnv: getInfo() returns system metadata", () => {
  const venv = new VirtualEnv();
  const env = { type: "PYTHON", path: "/some/venv", name: "test" };

  const info = venv.getInfo(env);
  assert.equal(info.type, "PYTHON");
  assert.equal(info.path, "/some/venv");
  assert.equal(info.name, "test");
  assert.equal(typeof info.os, "string");
  assert.equal(typeof info.arch, "string");
  assert.equal(info.nodeVersion, process.versions.node);
  assert.equal(typeof info.hostname, "string");
  assert.ok(info.cpus > 0);
  assert.ok(info.totalMemory > 0);
});

test("VirtualEnv: deactivate() is idempotent when nothing active", () => {
  const venv = new VirtualEnv();
  const result = venv.deactivate();
  assert.equal(result.restored, false);
  assert.equal(result.originalEnv, null);
});
