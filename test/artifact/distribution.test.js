/**
 * Tests for DistributionManager — channel management, artifact distribution,
 * status tracking, sync, multi-channel push, dry-run mode.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { DistributionManager } = require("../../src/artifact/distribution");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeArtifact(name, version, type) {
  return {
    name,
    version,
    type: type || "generic",
    files: [],
    metadata: {},
    checksums: {},
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// addChannel
// ---------------------------------------------------------------------------

test("addChannel: registers a valid channel and returns it", () => {
  const dm = new DistributionManager();
  const ch = dm.addChannel("test-local", {
    type: "local_dir",
    path: "/tmp/dist",
  });

  assert.equal(ch.name, "test-local");
  assert.equal(ch.type, "local_dir");
  assert.equal(ch.status, "ready");
  assert.equal(ch.lastSync, null);
});

test("addChannel: rejects missing name or type", () => {
  const dm = new DistributionManager();

  assert.throws(
    () => dm.addChannel("", { type: "local_dir" }),
    /name is required/
  );

  assert.throws(
    () => dm.addChannel("ch", {}),
    /type is required/
  );
});

test("addChannel: rejects unknown channel types", () => {
  const dm = new DistributionManager();
  assert.throws(
    () => dm.addChannel("bad", { type: "ftp_server" }),
    /Unknown channel type/
  );
});

test("addChannel: accepts all valid channel types", () => {
  const dm = new DistributionManager();

  assert.doesNotThrow(() => dm.addChannel("local", { type: "local_dir", path: "/tmp" }));
  assert.doesNotThrow(() => dm.addChannel("npm", { type: "npm_registry" }));
  assert.doesNotThrow(() => dm.addChannel("docker", { type: "docker_registry" }));
  assert.doesNotThrow(() => dm.addChannel("gh", { type: "github_release" }));
  assert.doesNotThrow(() => dm.addChannel("custom", { type: "custom", url: "https://example.com" }));

  assert.equal(dm.listChannels().length, 5);
});

// ---------------------------------------------------------------------------
// distribute
// ---------------------------------------------------------------------------

test("distribute: pushes to local_dir channel and writes files", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-dist-"));
  const dm = new DistributionManager();

  dm.addChannel("local", { type: "local_dir", path: tmpDir });

  // Create real files
  const srcFile = path.join(tmpDir, "input.txt");
  fs.writeFileSync(srcFile, "artifact data", "utf8");

  const art = makeArtifact("test-pkg", "1.0.0", "bundle");
  art.files = [srcFile];

  const result = dm.distribute(art, ["local"]);
  assert.equal(result.artifact, "test-pkg@1.0.0");
  assert.equal(result.channels.local.status, "success");

  // Verify on disk
  const destManifest = path.join(tmpDir, "test-pkg", "1.0.0", "manifest.json");
  assert.ok(fs.existsSync(destManifest));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("distribute: dry-run does not write anything", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-dry-"));
  const dm = new DistributionManager();

  dm.addChannel("local", { type: "local_dir", path: tmpDir });

  const art = makeArtifact("dry-pkg", "1.0.0");
  const result = dm.distribute(art, ["local"], { dryRun: true });

  assert.equal(result.channels.local.status, "dry_run");
  assert.ok(result.channels.local.message.includes("Would distribute"));

  // No files should exist
  const destDir = path.join(tmpDir, "dry-pkg");
  assert.ok(!fs.existsSync(destDir));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("distribute: reports error for nonexistent channel", () => {
  const dm = new DistributionManager();
  const art = makeArtifact("pkg", "1.0.0");

  const result = dm.distribute(art, ["nonexistent"]);
  assert.equal(result.channels.nonexistent.status, "error");
  assert.ok(result.channels.nonexistent.error.includes("not found"));
});

test("distribute: distributes to multiple channels in one call", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-multi-"));
  const dm = new DistributionManager();

  dm.addChannel("ch-a", { type: "local_dir", path: path.join(tmpDir, "a") });
  dm.addChannel("ch-b", { type: "local_dir", path: path.join(tmpDir, "b") });

  const art = makeArtifact("multi-pkg", "1.0.0");
  const result = dm.distribute(art, ["ch-a", "ch-b"]);

  assert.equal(result.channels["ch-a"].status, "success");
  assert.equal(result.channels["ch-b"].status, "success");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("distribute: npm_registry, docker_registry, github_release, and custom channels simulate success", () => {
  const dm = new DistributionManager();

  dm.addChannel("npm", { type: "npm_registry", registry: "https://registry.example.com" });
  dm.addChannel("docker", { type: "docker_registry", registry: "docker.example.com" });
  dm.addChannel("gh", { type: "github_release", url: "https://github.com/user/repo" });
  dm.addChannel("cust", { type: "custom", url: "https://example.com/webhook" });

  const art = makeArtifact("sim-pkg", "1.0.0");
  const result = dm.distribute(art, ["npm", "docker", "gh", "cust"]);

  assert.equal(result.channels.npm.status, "success");
  assert.ok(result.channels.npm.registry.includes("example.com"));

  assert.equal(result.channels.docker.status, "success");
  assert.ok(result.channels.docker.tag);

  assert.equal(result.channels.gh.status, "success");
  assert.ok(result.channels.gh.tag.includes("1.0.0"));

  assert.equal(result.channels.cust.status, "pending");
});

test("distribute: custom channel with handler function is invoked", () => {
  const dm = new DistributionManager();
  const received = [];

  dm.addChannel("cust-fn", {
    type: "custom",
    url: "https://example.com",
    handler: (artifact, config) => {
      received.push({ artifact, config });
      return { delivered: true };
    },
  });

  const art = makeArtifact("fn-pkg", "3.0.0");
  const result = dm.distribute(art, ["cust-fn"]);

  assert.equal(result.channels["cust-fn"].status, "success");
  assert.equal(received.length, 1);
  assert.equal(received[0].artifact.name, "fn-pkg");
  assert.equal(result.channels["cust-fn"].custom.delivered, true);
});

// ---------------------------------------------------------------------------
// getDistributionStatus
// ---------------------------------------------------------------------------

test("getDistributionStatus: reports status per channel before and after distribution", () => {
  const dm = new DistributionManager();

  dm.addChannel("local", { type: "local_dir", path: "/tmp/nowhere" });
  dm.addChannel("npm", { type: "npm_registry" });

  const art = makeArtifact("status-pkg", "1.0.0");

  // Before distribution
  const before = dm.getDistributionStatus(art);
  assert.equal(before.local.status, "not_distributed");
  assert.equal(before.npm.status, "not_distributed");

  // After distribution
  dm.distribute(art, ["local"]);
  const after = dm.getDistributionStatus(art);
  assert.equal(after.local.status, "success");
  assert.equal(after.npm.status, "not_distributed");
});

// ---------------------------------------------------------------------------
// sync
// ---------------------------------------------------------------------------

test("sync: verifies distributed artifacts are present on local_dir", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-sync-"));
  const dm = new DistributionManager();

  dm.addChannel("local", { type: "local_dir", path: tmpDir });

  const art = makeArtifact("sync-pkg", "1.0.0");
  dm.distribute(art, ["local"]);

  const result = dm.sync("local");
  assert.equal(result.channel, "local");
  assert.equal(result.status, "synced");
  assert.ok(result.artifactsChecked >= 1);
  assert.equal(result.missing.length, 0);
  assert.ok(result.present.length >= 1);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("sync: detects missing artifacts when directory is deleted", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-sync2-"));
  const dm = new DistributionManager();

  dm.addChannel("local", { type: "local_dir", path: tmpDir });

  const art = makeArtifact("vanish-pkg", "1.0.0");
  dm.distribute(art, ["local"]);

  // Delete the distributed directory to simulate a missing artifact
  const artifactDir = path.join(tmpDir, "vanish-pkg");
  fs.rmSync(artifactDir, { recursive: true, force: true });

  const result = dm.sync("local");
  assert.equal(result.status, "partial");
  assert.ok(result.missing.length >= 1);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("sync: throws for nonexistent channel", () => {
  const dm = new DistributionManager();
  assert.throws(
    () => dm.sync("does-not-exist"),
    /not found/
  );
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test("distribute: throws for invalid artifact", () => {
  const dm = new DistributionManager();
  dm.addChannel("local", { type: "local_dir", path: "/tmp" });

  assert.throws(
    () => dm.distribute({}, ["local"]),
    /must have name and version/
  );
});

test("distribute: throws for empty channels array", () => {
  const dm = new DistributionManager();
  const art = makeArtifact("pkg", "1.0.0");

  assert.throws(
    () => dm.distribute(art, []),
    /At least one channel/
  );
});
