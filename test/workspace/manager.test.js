"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { WorkspaceManager, ProjectEntry } = require("../../src/workspace/manager");

// ── Helpers ────────────────────────────────────────────────

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hax-wm-"));
}

function makeProject(dirPath, name) {
  const p = path.join(dirPath, name);
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, "package.json"), JSON.stringify({ name, version: "1.0.0" }), "utf8");
  return p;
}

function cleanup(dirPath) {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch (_) { /* ignore */ }
}

// ── addProject ─────────────────────────────────────────────

test("addProject: registers a project and sets it as current", () => {
  const tmp = tempDir();
  try {
    const p = makeProject(tmp, "proj-a");
    const wm = new WorkspaceManager();
    const entry = wm.addProject(p);

    assert.ok(entry instanceof ProjectEntry);
    assert.equal(entry.root, path.resolve(p));
    assert.equal(entry.name, "proj-a");

    const current = wm.getCurrentProject();
    assert.ok(current instanceof ProjectEntry);
    assert.equal(current.root, path.resolve(p));
  } finally {
    cleanup(tmp);
  }
});

test("addProject: registers multiple projects, current stays first", () => {
  const tmp = tempDir();
  try {
    const a = makeProject(tmp, "proj-a");
    const b = makeProject(tmp, "proj-b");
    const wm = new WorkspaceManager();

    wm.addProject(a);
    wm.addProject(b);

    const current = wm.getCurrentProject();
    assert.equal(current.root, path.resolve(a));
    assert.equal(wm.listProjects().length, 2);
  } finally {
    cleanup(tmp);
  }
});

test("addProject: rejects non-existent directory", () => {
  const wm = new WorkspaceManager();
  assert.throws(
    () => wm.addProject("/nonexistent/path/for/testing"),
    { message: /does not exist/ },
  );
});

test("addProject: rejects path that is a file, not directory", () => {
  const tmp = tempDir();
  try {
    const filePath = path.join(tmp, "file.txt");
    fs.writeFileSync(filePath, "hello", "utf8");
    const wm = new WorkspaceManager();
    assert.throws(
      () => wm.addProject(filePath),
      { message: /not a directory/ },
    );
  } finally {
    cleanup(tmp);
  }
});

test("addProject: rejects duplicate registration", () => {
  const tmp = tempDir();
  try {
    const p = makeProject(tmp, "proj-a");
    const wm = new WorkspaceManager();
    wm.addProject(p);
    assert.throws(
      () => wm.addProject(p),
      { message: /already registered/ },
    );
  } finally {
    cleanup(tmp);
  }
});

test("addProject: accepts config overrides", () => {
  const tmp = tempDir();
  try {
    const p = makeProject(tmp, "proj-a");
    const wm = new WorkspaceManager();
    const entry = wm.addProject(p, { name: "custom-name", customKey: true });
    assert.equal(entry.name, "custom-name");
    assert.equal(entry.config.customKey, true);
  } finally {
    cleanup(tmp);
  }
});

// ── removeProject ──────────────────────────────────────────

test("removeProject: removes a project and updates current", () => {
  const tmp = tempDir();
  try {
    const a = makeProject(tmp, "proj-a");
    const b = makeProject(tmp, "proj-b");
    const wm = new WorkspaceManager();

    wm.addProject(a);
    wm.addProject(b);

    // Current is a, remove a -> current falls to b
    const removed = wm.removeProject(a);
    assert.equal(removed, true);
    assert.equal(wm.listProjects().length, 1);
    assert.equal(wm.getCurrentProject().root, path.resolve(b));
  } finally {
    cleanup(tmp);
  }
});

test("removeProject: current is null when no projects remain", () => {
  const tmp = tempDir();
  try {
    const a = makeProject(tmp, "proj-a");
    const wm = new WorkspaceManager();

    wm.addProject(a);
    wm.removeProject(a);

    assert.equal(wm.getCurrentProject(), null);
    assert.equal(wm.listProjects().length, 0);
  } finally {
    cleanup(tmp);
  }
});

test("removeProject: returns false for unknown project", () => {
  const wm = new WorkspaceManager();
  assert.equal(wm.removeProject("/unknown/path"), false);
});

// ── listProjects ───────────────────────────────────────────

test("listProjects: returns metadata with active flag", () => {
  const tmp = tempDir();
  try {
    const a = makeProject(tmp, "proj-a");
    const b = makeProject(tmp, "proj-b");
    const wm = new WorkspaceManager();

    wm.addProject(a, { name: "Alpha" });
    wm.addProject(b, { name: "Beta" });
    wm.switchProject(b);

    const list = wm.listProjects();
    assert.equal(list.length, 2);

    const alpha = list.find((p) => p.name === "Alpha");
    const beta = list.find((p) => p.name === "Beta");

    assert.equal(alpha.active, false);
    assert.equal(beta.active, true);
    assert.equal(alpha.hasConfig, true);
    assert.ok(typeof alpha.registeredAt === "string");
  } finally {
    cleanup(tmp);
  }
});

// ── switchProject ──────────────────────────────────────────

test("switchProject: switches active project and updates lastAccessed", () => {
  const tmp = tempDir();
  try {
    const a = makeProject(tmp, "proj-a");
    const b = makeProject(tmp, "proj-b");
    const wm = new WorkspaceManager();

    wm.addProject(a);
    wm.addProject(b);

    const beforeA = wm.getCurrentProject().lastAccessed;

    // Small delay to ensure timestamp changes
    const start = Date.now();
    while (Date.now() === start) { /* busy-wait briefly */ }

    wm.switchProject(b);
    const current = wm.getCurrentProject();
    assert.equal(current.root, path.resolve(b));
    assert.ok(new Date(current.lastAccessed) >= new Date(beforeA));
  } finally {
    cleanup(tmp);
  }
});

test("switchProject: throws for unregistered project", () => {
  const wm = new WorkspaceManager();
  assert.throws(
    () => wm.switchProject("/unknown/project"),
    { message: /not registered/ },
  );
});

// ── getProjectContext ──────────────────────────────────────

test("getProjectContext: returns full context with settings", () => {
  const tmp = tempDir();
  try {
    const p = makeProject(tmp, "proj-a");
    const wm = new WorkspaceManager({ settings: { shared: true } });

    wm.addProject(p, { local: true });

    const ctx = wm.getProjectContext(p);
    assert.equal(ctx.projectRoot, path.resolve(p));
    assert.equal(ctx.name, "proj-a");
    assert.ok(ctx.settings && typeof ctx.settings === "object");
    assert.ok(typeof ctx.lastAccessed === "string");
  } finally {
    cleanup(tmp);
  }
});

test("getProjectContext: throws for unregistered project", () => {
  const wm = new WorkspaceManager();
  assert.throws(
    () => wm.getProjectContext("/unknown"),
    { message: /not registered/ },
  );
});

// ── scanWorkspace ──────────────────────────────────────────

test("scanWorkspace: discovers projects in packages/ directory", () => {
  const tmp = tempDir();
  try {
    // Create a monorepo-like structure
    const packagesDir = path.join(tmp, "packages");
    fs.mkdirSync(path.join(packagesDir, "utils"), { recursive: true });
    fs.mkdirSync(path.join(packagesDir, "core"), { recursive: true });
    fs.writeFileSync(path.join(packagesDir, "utils", "package.json"), JSON.stringify({ name: "utils" }), "utf8");
    fs.writeFileSync(path.join(packagesDir, "core", "package.json"), JSON.stringify({ name: "core" }), "utf8");

    // Add a directory without package.json — should be skipped
    fs.mkdirSync(path.join(packagesDir, "empty-dir"), { recursive: true });

    const wm = new WorkspaceManager();
    const discovered = wm.scanWorkspace(tmp);

    const names = discovered.map((d) => d.name).sort();
    assert.ok(names.includes("utils"));
    assert.ok(names.includes("core"));
  } finally {
    cleanup(tmp);
  }
});

test("scanWorkspace: discovers projects in apps/ directory", () => {
  const tmp = tempDir();
  try {
    const appsDir = path.join(tmp, "apps");
    fs.mkdirSync(path.join(appsDir, "web"), { recursive: true });
    fs.writeFileSync(path.join(appsDir, "web", "package.json"), JSON.stringify({ name: "web" }), "utf8");

    const wm = new WorkspaceManager();
    const discovered = wm.scanWorkspace(tmp);

    const web = discovered.find((d) => d.name === "web");
    assert.ok(web);
    assert.equal(web.discoveredVia, "apps/<package.json>");
  } finally {
    cleanup(tmp);
  }
});

test("scanWorkspace: handles empty directory gracefully", () => {
  const tmp = tempDir();
  try {
    const wm = new WorkspaceManager();
    const discovered = wm.scanWorkspace(tmp);

    // Should only report the root if it has a project indicator, or empty
    // Since the root is empty, it should return an empty array
    assert.ok(Array.isArray(discovered));
    assert.equal(discovered.length, 0);
  } finally {
    cleanup(tmp);
  }
});

test("scanWorkspace: does not return duplicates", () => {
  const tmp = tempDir();
  try {
    // Create root package.json so root is a project indicator
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: "root" }), "utf8");

    const wm = new WorkspaceManager();
    const discovered = wm.scanWorkspace(tmp);

    // Root itself should be found once
    const rootEntries = discovered.filter((d) => d.root === path.resolve(tmp));
    assert.equal(rootEntries.length, 1);
  } finally {
    cleanup(tmp);
  }
});

test("ProjectEntry: metadata returns expected fields", () => {
  const entry = new ProjectEntry("/test/proj", { name: "test" });
  const meta = entry.metadata();

  assert.equal(meta.name, "test");
  assert.equal(meta.root, path.resolve("/test/proj"));
  assert.equal(meta.hasConfig, true);
  assert.ok(typeof meta.registeredAt === "string");
  assert.equal(meta.lastAccessed, meta.registeredAt);
});

test("ProjectEntry: touch updates lastAccessed", () => {
  const entry = new ProjectEntry("/test/proj");
  const original = entry.lastAccessed;

  // Busy wait for timestamp change
  const start = Date.now();
  while (Date.now() === start) { /* wait */ }

  entry.touch();
  assert.ok(new Date(entry.lastAccessed) >= new Date(original));
});
