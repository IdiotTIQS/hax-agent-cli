"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  EnvironmentDetector,
  ENV_TYPES,
  CI_SIGNATURES,
  CLOUD_SIGNATURES,
  RESOURCE_THRESHOLDS,
} = require("../../src/config/environment");

// ---------------------------------------------------------------------------
// Tests: EnvironmentDetector construction
// ---------------------------------------------------------------------------

test("EnvironmentDetector: constructs without options", () => {
  const detector = new EnvironmentDetector();
  assert.ok(detector instanceof EnvironmentDetector);
});

test("EnvironmentDetector: constructs with custom env and readFileSync", () => {
  const detector = new EnvironmentDetector({
    env: { HOME: "/home/user" },
    readFileSync: () => "content",
  });
  assert.ok(detector instanceof EnvironmentDetector);
});

// ---------------------------------------------------------------------------
// Tests: detect() - environment type detection
// ---------------------------------------------------------------------------

test("detect: detects local_dev with no CI or container indicators", () => {
  const detector = new EnvironmentDetector({
    env: { HOME: "/home/user", PATH: "/usr/bin", USER: "dev" },
    readFileSync: () => null,
  });
  const result = detector.detect();
  assert.equal(result.envType, ENV_TYPES.LOCAL_DEV);
  assert.equal(result.isCI, false);
  assert.equal(result.isDocker, false);
  assert.equal(result.isCloud, false);
});

test("detect: detects CI environment from CI=true", () => {
  const detector = new EnvironmentDetector({
    env: { CI: "true", HOME: "/home/runner", GITHUB_ACTIONS: "true" },
    readFileSync: () => null,
  });
  const result = detector.detect();
  assert.equal(result.envType, ENV_TYPES.CI_PIPELINE);
  assert.equal(result.isCI, true);
  // CI=true appears first in the signatures list (exact match), so it wins
  assert.ok(
    result.details.ciPlatform === "CI" || result.details.ciPlatform === "GITHUB_ACTIONS",
    `Expected CI or GITHUB_ACTIONS, got ${result.details.ciPlatform}`
  );
});

test("detect: detects CI environment from GITHUB_ACTIONS alone", () => {
  const detector = new EnvironmentDetector({
    env: { GITHUB_ACTIONS: "true" },
    readFileSync: () => null,
  });
  const result = detector.detect();
  assert.equal(result.envType, ENV_TYPES.CI_PIPELINE);
  assert.equal(result.isCI, true);
  assert.equal(result.details.ciPlatform, "GITHUB_ACTIONS");
});

test("detect: detects Docker environment from /.dockerenv marker", () => {
  const detector = new EnvironmentDetector({
    env: { HOME: "/root" },
    readFileSync: (filePath) => {
      if (filePath === "/.dockerenv") return "docker";
      return null;
    },
  });
  const result = detector.detect();
  assert.equal(result.isDocker, true);
  assert.equal(result.details.containerRuntime, "docker");
});

test("detect: detects Docker environment from cgroup content", () => {
  const detector = new EnvironmentDetector({
    env: { HOME: "/root" },
    readFileSync: (filePath) => {
      if (filePath === "/proc/1/cgroup") return "0::/system.slice/docker-abc123.scope";
      return null;
    },
  });
  const result = detector.detect();
  assert.equal(result.isDocker, true);
  assert.equal(result.details.containerRuntime, "docker");
});

test("detect: detects Kubernetes from KUBERNETES_SERVICE_HOST env", () => {
  const detector = new EnvironmentDetector({
    env: { KUBERNETES_SERVICE_HOST: "10.0.0.1" },
    readFileSync: () => null,
  });
  const result = detector.detect();
  assert.equal(result.isDocker, true, "Should detect container runtime");
  assert.equal(result.details.containerRuntime, "kubernetes");
});

test("detect: detects cloud VM from AWS indicator", () => {
  const detector = new EnvironmentDetector({
    env: { AWS_EXECUTION_ENV: "AWS_Lambda_nodejs20.x" },
    readFileSync: () => null,
  });
  const result = detector.detect();
  assert.equal(result.isCloud, true);
  assert.equal(result.details.cloudPlatform, "AWS_EXECUTION_ENV");
});

test("detect: detects GCP cloud platform", () => {
  const detector = new EnvironmentDetector({
    env: { GOOGLE_CLOUD_PROJECT: "my-project" },
    readFileSync: () => null,
  });
  const result = detector.detect();
  assert.equal(result.isCloud, true);
  assert.equal(result.details.cloudPlatform, "GOOGLE_CLOUD_PROJECT");
});

test("detect: returns timestamp in ISO format", () => {
  const detector = new EnvironmentDetector({
    env: {},
    readFileSync: () => null,
  });
  const result = detector.detect();
  assert.ok(result.timestamp);
  // Should be valid ISO 8601 date string
  const parsed = Date.parse(result.timestamp);
  assert.ok(!Number.isNaN(parsed));
});

// ---------------------------------------------------------------------------
// Tests: isCI()
// ---------------------------------------------------------------------------

test("isCI: returns true in GitHub Actions", () => {
  const detector = new EnvironmentDetector({
    env: { GITHUB_ACTIONS: "true", CI: "true" },
    readFileSync: () => null,
  });
  assert.equal(detector.isCI(), true);
});

test("isCI: returns false in local env", () => {
  const detector = new EnvironmentDetector({
    env: { HOME: "/home/user" },
    readFileSync: () => null,
  });
  assert.equal(detector.isCI(), false);
});

test("isCI: recognizes GitLab CI", () => {
  const detector = new EnvironmentDetector({
    env: { GITLAB_CI: "true" },
    readFileSync: () => null,
  });
  assert.equal(detector.isCI(), true);
});

// ---------------------------------------------------------------------------
// Tests: isDocker()
// ---------------------------------------------------------------------------

test("isDocker: returns true with /.dockerenv present", () => {
  const detector = new EnvironmentDetector({
    env: {},
    readFileSync: (filePath) => (filePath === "/.dockerenv" ? "x" : null),
  });
  assert.equal(detector.isDocker(), true);
});

test("isDocker: returns false with no container markers", () => {
  const detector = new EnvironmentDetector({
    env: {},
    readFileSync: () => null,
  });
  assert.equal(detector.isDocker(), false);
});

// ---------------------------------------------------------------------------
// Tests: isCloud()
// ---------------------------------------------------------------------------

test("isCloud: returns true with Kubernetes env", () => {
  const detector = new EnvironmentDetector({
    env: { KUBERNETES_SERVICE_HOST: "10.0.0.1" },
    readFileSync: () => null,
  });
  assert.equal(detector.isCloud(), true);
});

test("isCloud: returns false with no cloud indicators", () => {
  const detector = new EnvironmentDetector({
    env: { HOME: "/home/user" },
    readFileSync: () => null,
  });
  assert.equal(detector.isCloud(), false);
});

// ---------------------------------------------------------------------------
// Tests: getResourceLimits()
// ---------------------------------------------------------------------------

test("getResourceLimits: returns resource info with expected shape", () => {
  const detector = new EnvironmentDetector();
  const limits = detector.getResourceLimits();
  assert.ok(typeof limits.cpuCount === "number");
  assert.ok(limits.cpuCount >= 1);
  assert.ok(typeof limits.cpuModel === "string");
  assert.ok(typeof limits.memoryTotalMB === "number");
  assert.ok(limits.memoryTotalMB > 0);
  assert.ok(typeof limits.memoryFreeMB === "number");
  assert.ok(limits.memoryFreeMB >= 0);
  assert.ok(typeof limits.diskFreeGB === "number");
  assert.ok(typeof limits.platform === "string");
  assert.ok(["low", "moderate", "high"].includes(limits.tier));
});

// ---------------------------------------------------------------------------
// Tests: recommendForEnv()
// ---------------------------------------------------------------------------

test("recommendForEnv: recommends coding preset for local_dev", () => {
  const detector = new EnvironmentDetector({
    env: { HOME: "/home/user" },
    readFileSync: () => null,
  });
  const detection = detector.detect();
  const rec = detector.recommendForEnv(detection);
  assert.equal(rec.envType, ENV_TYPES.LOCAL_DEV);
  assert.equal(rec.recommendedPreset, "coding");
  assert.ok(typeof rec.rationale === "string");
  assert.ok(rec.rationale.length > 0);
  assert.ok(rec.overrides.permissions);
});

test("recommendForEnv: recommends ci preset for CI environment", () => {
  const detector = new EnvironmentDetector({
    env: { CI: "true", GITHUB_ACTIONS: "true" },
    readFileSync: () => null,
  });
  const detection = detector.detect();
  const rec = detector.recommendForEnv(detection);
  assert.equal(rec.envType, ENV_TYPES.CI_PIPELINE);
  assert.equal(rec.recommendedPreset, "ci");
  assert.equal(rec.overrides.permissions.mode, "yolo");
});

test("recommendForEnv: recommends chat preset for low_resource", () => {
  const detector = new EnvironmentDetector({
    env: { HOME: "/home/user" },
    readFileSync: () => null,
  });
  // Construct a low-resource description manually to avoid real disk detection
  const lowResourceDesc = {
    envType: ENV_TYPES.LOW_RESOURCE,
    isCI: false,
    isDocker: false,
    isCloud: false,
    isLowResource: true,
    details: { ciPlatform: null, cloudPlatform: null, containerRuntime: null },
    capabilities: {},
    resourceLimits: {
      cpuCount: 1,
      cpuModel: "test",
      memoryTotalMB: 512,
      memoryFreeMB: 100,
      diskFreeGB: 2,
      platform: "linux",
      tier: "low",
    },
    timestamp: new Date().toISOString(),
  };
  const rec = detector.recommendForEnv(lowResourceDesc);
  assert.equal(rec.envType, ENV_TYPES.LOW_RESOURCE);
  assert.equal(rec.recommendedPreset, "chat");
  assert.equal(rec.overrides.agent.maxToolTurns, 3);
  assert.equal(rec.overrides.tools.shell.enabled, false);
});

test("recommendForEnv: recommends autonomous preset for Docker", () => {
  const detector = new EnvironmentDetector({
    env: { HOME: "/root" },
    readFileSync: (fp) => (fp === "/.dockerenv" ? "docker" : null),
  });
  const detection = detector.detect();
  const rec = detector.recommendForEnv(detection);
  assert.equal(rec.envType, ENV_TYPES.DOCKER_CONTAINER);
  assert.equal(rec.recommendedPreset, "autonomous");
});

test("recommendForEnv: recommends autonomous for cloud_vm", () => {
  const detector = new EnvironmentDetector({
    env: { AWS_EXECUTION_ENV: "AWS_Lambda_nodejs20.x" },
    readFileSync: () => null,
  });
  const detection = detector.detect();
  const rec = detector.recommendForEnv(detection);
  assert.equal(rec.envType, ENV_TYPES.CLOUD_VM);
  assert.equal(rec.recommendedPreset, "autonomous");
});

test("recommendForEnv: detects() implicitly when no argument given", () => {
  const detector = new EnvironmentDetector({
    env: { HOME: "/home/user" },
    readFileSync: () => null,
  });
  const rec = detector.recommendForEnv();
  assert.equal(rec.envType, ENV_TYPES.LOCAL_DEV);
  assert.equal(rec.recommendedPreset, "coding");
});

// ---------------------------------------------------------------------------
// Tests: capabilities detection
// ---------------------------------------------------------------------------

test("detect: CI environment has no interactive capability", () => {
  const detector = new EnvironmentDetector({
    env: { CI: "true", GITHUB_ACTIONS: "true" },
    readFileSync: () => null,
  });
  const result = detector.detect();
  assert.equal(result.capabilities.interactive, false);
  assert.equal(result.capabilities.persistentStorage, false);
  assert.equal(result.capabilities.ephemeral, true);
});

test("detect: local_dev has interactive capability", () => {
  const detector = new EnvironmentDetector({
    env: { HOME: "/home/user" },
    readFileSync: () => null,
  });
  const result = detector.detect();
  assert.equal(result.capabilities.interactive, true);
});

// ---------------------------------------------------------------------------
// Tests: exported constants
// ---------------------------------------------------------------------------

test("ENV_TYPES contains all five environment types", () => {
  assert.equal(ENV_TYPES.LOCAL_DEV, "local_dev");
  assert.equal(ENV_TYPES.CI_PIPELINE, "ci_pipeline");
  assert.equal(ENV_TYPES.DOCKER_CONTAINER, "docker_container");
  assert.equal(ENV_TYPES.CLOUD_VM, "cloud_vm");
  assert.equal(ENV_TYPES.LOW_RESOURCE, "low_resource");
});

test("CI_SIGNATURES is a non-empty frozen array of objects with 'env' key", () => {
  assert.ok(Array.isArray(CI_SIGNATURES));
  assert.ok(CI_SIGNATURES.length > 0);
  for (const sig of CI_SIGNATURES) {
    assert.ok(typeof sig.env === "string");
    assert.ok(sig.env.length > 0);
  }
});

test("CLOUD_SIGNATURES is a non-empty frozen array of objects with 'env' key", () => {
  assert.ok(Array.isArray(CLOUD_SIGNATURES));
  assert.ok(CLOUD_SIGNATURES.length > 0);
  for (const sig of CLOUD_SIGNATURES) {
    assert.ok(typeof sig.env === "string");
    assert.ok(sig.env.length > 0);
  }
});

test("RESOURCE_THRESHOLDS has low/moderate values for cpu, memory, disk", () => {
  assert.ok(RESOURCE_THRESHOLDS.LOW_CPU_COUNT > 0);
  assert.ok(RESOURCE_THRESHOLDS.MODERATE_CPU_COUNT > RESOURCE_THRESHOLDS.LOW_CPU_COUNT);
  assert.ok(RESOURCE_THRESHOLDS.LOW_MEMORY_MB > 0);
  assert.ok(RESOURCE_THRESHOLDS.MODERATE_MEMORY_MB > RESOURCE_THRESHOLDS.LOW_MEMORY_MB);
  assert.ok(RESOURCE_THRESHOLDS.LOW_DISK_GB > 0);
});
