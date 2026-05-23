/**
 * Tests for ReproductionEngine — recipes, verification, and artifact generation.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const os = require("node:os");
const { ReproductionEngine, ReproductionError } = require("../../src/isolate/reproduce");

// -- Test helpers ------------------------------------------------------------

function makeEnv(overrides = {}) {
  return {
    type: "NODE",
    runtime: "nvm",
    os: os.platform(),
    arch: os.arch(),
    nodeVersion: process.versions.node,
    npmGlobal: [
      { name: "typescript", version: "5.1.6" },
      { name: "prettier", version: "3.0.0" },
    ],
    npmLocal: [
      { name: "lodash", version: "4.17.21" },
    ],
    packages: ["eslint"],
    env: {
      NODE_ENV: "development",
      CUSTOM_VAR: "test-value",
      SECRET_TOKEN: "should-be-filtered",
    },
    name: "test-env",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("ReproductionEngine: creates recipe from environment descriptor", () => {
  const engine = new ReproductionEngine();
  const env = makeEnv();
  const recipe = engine.createRecipe(env);

  assert.equal(typeof recipe.name, "string");
  assert.equal(typeof recipe.description, "string");
  assert.equal(typeof recipe.os, "string");
  assert.ok(["linux", "macos", "windows"].includes(recipe.os));
  assert.equal(typeof recipe.runtime, "object");
  assert.equal(recipe.runtime.type.toLowerCase(), "node");
  assert.ok(Array.isArray(recipe.packages));
  assert.ok(Array.isArray(recipe.setupSteps));
  assert.ok(typeof recipe.generatedAt === "string");
});

test("ReproductionEngine: recipe includes env vars with sensitive values filtered", () => {
  const engine = new ReproductionEngine();
  const env = makeEnv();
  const recipe = engine.createRecipe(env);

  assert.ok(typeof recipe.envVars === "object");
  assert.equal(recipe.envVars.NODE_ENV, "development");
  // SECRET_TOKEN should be filtered
  assert.ok(!("SECRET_TOKEN" in recipe.envVars));
  // CUSTOM_VAR should be included (not blocked)
  assert.equal(recipe.envVars.CUSTOM_VAR, "test-value");
});

test("ReproductionEngine: recipe packages include npmGlobal and npmLocal", () => {
  const engine = new ReproductionEngine();
  const env = makeEnv();
  const recipe = engine.createRecipe(env);

  const pkgNames = recipe.packages.map((p) => p.name);
  assert.ok(pkgNames.includes("typescript"));
  assert.ok(pkgNames.includes("lodash"));
  assert.ok(pkgNames.includes("eslint"));
});

test("ReproductionEngine: recipe setupSteps includes node version", () => {
  const engine = new ReproductionEngine();
  const env = makeEnv({ nodeVersion: "v20.5.0" });
  const recipe = engine.createRecipe(env);

  const stepText = recipe.setupSteps.join(" ");
  assert.ok(stepText.includes("v20.5.0") || stepText.includes("20.5.0"));
});

test("ReproductionEngine: verifyEnvironment returns matches=true for compatible recipe", () => {
  const engine = new ReproductionEngine();
  const env = makeEnv();
  const recipe = engine.createRecipe(env);

  const result = engine.verifyEnvironment(recipe);
  // The recipe was generated from the current env so it should match
  assert.equal(result.matches, true);
  // There may be some warnings but should not be violations
  assert.ok(Array.isArray(result.violations));
  assert.ok(Array.isArray(result.warnings));
});

test("ReproductionEngine: verifyEnvironment detects OS mismatch", () => {
  const engine = new ReproductionEngine();
  const otherOS = os.platform() === "linux" ? "darwin" : "linux";
  const recipe = {
    os: otherOS === "darwin" ? "macos" : "linux",
    arch: "x64",
    runtime: { type: "node", version: process.versions.node },
    packages: [],
    envVars: {},
  };

  const result = engine.verifyEnvironment(recipe);
  assert.equal(result.matches, false);
  assert.ok(result.violations.length > 0);
  assert.ok(result.violations.some((v) => v.toLowerCase().includes("os")));
});

test("ReproductionEngine: generates valid Dockerfile", () => {
  const engine = new ReproductionEngine();
  const env = makeEnv();
  const dockerfile = engine.generateDockerfile(env);

  assert.ok(typeof dockerfile === "string");
  assert.ok(dockerfile.includes("FROM "));
  assert.ok(dockerfile.includes("WORKDIR /app"));
  assert.ok(dockerfile.includes("COPY . ."));
  assert.ok(dockerfile.includes('CMD ["node"]'));
});

test("ReproductionEngine: Dockerfile includes npm packages", () => {
  const engine = new ReproductionEngine();
  const env = makeEnv();
  const dockerfile = engine.generateDockerfile(env);

  assert.ok(dockerfile.includes("typescript"));
  assert.ok(dockerfile.includes("lodash"));
  // Should include the npm install command
  assert.ok(dockerfile.includes("npm install -g"));
});

test("ReproductionEngine: Dockerfile supports custom base image", () => {
  const engine = new ReproductionEngine();
  const env = makeEnv();
  const dockerfile = engine.generateDockerfile(env, {
    baseImage: "node:20-bookworm",
  });

  assert.ok(dockerfile.includes("FROM node:20-bookworm"));
});

test("ReproductionEngine: generates bash setup script (unix target)", () => {
  const engine = new ReproductionEngine();
  const env = makeEnv();
  const script = engine.generateSetupScript(env, { target: "unix" });

  assert.ok(typeof script === "string");
  assert.ok(script.includes("#!/usr/bin/env bash"));
  assert.ok(script.includes("set -euo pipefail"));
  assert.ok(script.includes("npm install -g"));
  assert.ok(script.includes("typescript"));
  assert.ok(script.includes("nvm install"));
});

test("ReproductionEngine: generates PowerShell setup script (windows target)", () => {
  const engine = new ReproductionEngine();
  const env = makeEnv();
  const script = engine.generateSetupScript(env, { target: "windows" });

  assert.ok(typeof script === "string");
  assert.ok(script.includes("Write-Warning") || script.includes("nvm install"));
  assert.ok(script.includes("npm install -g"));
  assert.ok(script.includes("SetEnvironmentVariable") || script.includes("$env:"));
});

test("ReproductionEngine: generates Nix flake", () => {
  const engine = new ReproductionEngine();
  const env = makeEnv({ pythonVersion: "Python 3.10.0" });
  const flake = engine.generateNixFlake(env);

  assert.ok(typeof flake === "string");
  assert.ok(flake.includes("nixpkgs.url"));
  assert.ok(flake.includes("devShells.default"));
  assert.ok(flake.includes("nodejs"));
  assert.ok(flake.includes("python3")); // Because we set pythonVersion
});

test("ReproductionEngine: Nix flake contains nodejs with correct major version", () => {
  const engine = new ReproductionEngine();
  const env = makeEnv({ nodeVersion: "v20.5.0" });
  const flake = engine.generateNixFlake(env);

  // Should reference nodejs_20
  assert.ok(flake.includes("nodejs_20"));
});

test("ReproductionEngine: throws on invalid environment in createRecipe", () => {
  const engine = new ReproductionEngine();
  assert.throws(
    () => engine.createRecipe(null),
    (err) => err instanceof ReproductionError && err.code === "REPRO_INVALID_ENV",
  );
  assert.throws(
    () => engine.createRecipe(undefined),
    (err) => err instanceof ReproductionError,
  );
});

test("ReproductionEngine: throws on invalid environment in generateDockerfile", () => {
  const engine = new ReproductionEngine();
  assert.throws(
    () => engine.generateDockerfile(null),
    (err) => err instanceof ReproductionError && err.code === "REPRO_INVALID_ENV",
  );
});

test("ReproductionEngine: throws on invalid environment in generateSetupScript", () => {
  const engine = new ReproductionEngine();
  assert.throws(
    () => engine.generateSetupScript(null),
    (err) => err instanceof ReproductionError && err.code === "REPRO_INVALID_ENV",
  );
});

test("ReproductionEngine: throws on invalid environment in generateNixFlake", () => {
  const engine = new ReproductionEngine();
  assert.throws(
    () => engine.generateNixFlake(null),
    (err) => err instanceof ReproductionError && err.code === "REPRO_INVALID_ENV",
  );
});

test("ReproductionEngine: verifyEnvironment detects node major version mismatch", () => {
  const engine = new ReproductionEngine();
  const recipe = {
    os: os.platform() === "linux" ? "linux" : os.platform() === "darwin" ? "macos" : "windows",
    arch: os.arch(),
    runtime: { type: "node", version: "v99.0.0" },
    packages: [],
    envVars: {},
  };

  const result = engine.verifyEnvironment(recipe);
  // Should have at least a violation because node major version won't match 99
  const hasNodeViolation = result.violations.some((v) =>
    v.toLowerCase().includes("node") && v.toLowerCase().includes("version"),
  );
  assert.ok(hasNodeViolation);
});
