"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { MonorepoManager } = require("../../src/workspace/monorepo");

// ── Helpers ────────────────────────────────────────────────

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hax-mm-"));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function makePackage(dirPath, name, deps = {}) {
  writeJson(path.join(dirPath, "package.json"), {
    name,
    version: "1.0.0",
    private: true,
    dependencies: deps,
  });
}

function cleanup(dirPath) {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch (_) { /* ignore */ }
}

// ── detectMonorepo ─────────────────────────────────────────

test("detectMonorepo: detects npm workspaces via package.json", () => {
  const tmp = tempDir();
  try {
    writeJson(path.join(tmp, "package.json"), {
      name: "root",
      workspaces: ["packages/*"],
    });
    fs.writeFileSync(path.join(tmp, "package-lock.json"), ""); // npm lockfile

    const mm = new MonorepoManager(tmp);
    const result = mm.detectMonorepo();

    assert.equal(result.isMonorepo, true);
    assert.equal(result.type, "npm");
    assert.equal(result.configFile, "package.json");
  } finally {
    cleanup(tmp);
  }
});

test("detectMonorepo: detects pnpm workspace via pnpm-workspace.yaml", () => {
  const tmp = tempDir();
  try {
    fs.writeFileSync(path.join(tmp, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");

    const mm = new MonorepoManager(tmp);
    const result = mm.detectMonorepo();

    assert.equal(result.isMonorepo, true);
    assert.equal(result.type, "pnpm");
    assert.equal(result.configFile, "pnpm-workspace.yaml");
  } finally {
    cleanup(tmp);
  }
});

test("detectMonorepo: detects lerna via lerna.json", () => {
  const tmp = tempDir();
  try {
    writeJson(path.join(tmp, "lerna.json"), {
      packages: ["packages/*"],
      version: "1.0.0",
    });

    const mm = new MonorepoManager(tmp);
    const result = mm.detectMonorepo();

    assert.equal(result.isMonorepo, true);
    assert.equal(result.type, "lerna");
    assert.equal(result.configFile, "lerna.json");
  } finally {
    cleanup(tmp);
  }
});

test("detectMonorepo: detects nx via nx.json", () => {
  const tmp = tempDir();
  try {
    writeJson(path.join(tmp, "nx.json"), {
      workspaceLayout: { appsDir: "apps", libsDir: "libs" },
    });

    const mm = new MonorepoManager(tmp);
    const result = mm.detectMonorepo();

    assert.equal(result.isMonorepo, true);
    assert.equal(result.type, "nx");
    assert.equal(result.configFile, "nx.json");
  } finally {
    cleanup(tmp);
  }
});

test("detectMonorepo: detects turborepo via turbo.json", () => {
  const tmp = tempDir();
  try {
    writeJson(path.join(tmp, "turbo.json"), {
      pipeline: { build: {} },
    });

    const mm = new MonorepoManager(tmp);
    const result = mm.detectMonorepo();

    assert.equal(result.isMonorepo, true);
    assert.equal(result.type, "turborepo");
    assert.equal(result.configFile, "turbo.json");
  } finally {
    cleanup(tmp);
  }
});

test("detectMonorepo: detects yarn workspaces via package.json + yarn.lock", () => {
  const tmp = tempDir();
  try {
    writeJson(path.join(tmp, "package.json"), {
      name: "root",
      workspaces: ["packages/*"],
    });
    fs.writeFileSync(path.join(tmp, "yarn.lock"), "");

    const mm = new MonorepoManager(tmp);
    const result = mm.detectMonorepo();

    assert.equal(result.isMonorepo, true);
    assert.equal(result.type, "yarn");
  } finally {
    cleanup(tmp);
  }
});

test("detectMonorepo: heuristic detection via packages/ directory", () => {
  const tmp = tempDir();
  try {
    makePackage(path.join(tmp, "packages", "lib-a"), "lib-a");
    makePackage(path.join(tmp, "packages", "lib-b"), "lib-b");

    const mm = new MonorepoManager(tmp);
    const result = mm.detectMonorepo();

    assert.equal(result.isMonorepo, true);
    assert.equal(result.type, "heuristic");
  } finally {
    cleanup(tmp);
  }
});

test("detectMonorepo: heuristic detection via apps/ directory", () => {
  const tmp = tempDir();
  try {
    makePackage(path.join(tmp, "apps", "web"), "web");

    const mm = new MonorepoManager(tmp);
    const result = mm.detectMonorepo();

    assert.equal(result.isMonorepo, true);
    assert.equal(result.type, "heuristic");
    assert.equal(result.pattern, "apps/*");
  } finally {
    cleanup(tmp);
  }
});

test("detectMonorepo: returns false for regular project", () => {
  const tmp = tempDir();
  try {
    makePackage(tmp, "standalone-project");

    const mm = new MonorepoManager(tmp);
    const result = mm.detectMonorepo();

    assert.equal(result.isMonorepo, false);
    assert.equal(result.type, null);
  } finally {
    cleanup(tmp);
  }
});

test("detectMonorepo: handles non-existent directory", () => {
  const mm = new MonorepoManager("/nonexistent/path");
  const result = mm.detectMonorepo();

  assert.equal(result.isMonorepo, false);
  assert.equal(result.type, null);
});

// ── getWorkspaces ──────────────────────────────────────────

test("getWorkspaces: lists all npm workspace packages", () => {
  const tmp = tempDir();
  try {
    writeJson(path.join(tmp, "package.json"), {
      name: "root",
      workspaces: ["packages/*"],
    });
    makePackage(path.join(tmp, "packages", "lib-a"), "lib-a");
    makePackage(path.join(tmp, "packages", "lib-b"), "lib-b");

    const mm = new MonorepoManager(tmp);
    const workspaces = mm.getWorkspaces();

    assert.equal(workspaces.length, 2);
    const names = workspaces.map((w) => w.name).sort();
    assert.deepEqual(names, ["lib-a", "lib-b"]);

    const libA = workspaces.find((w) => w.name === "lib-a");
    assert.equal(libA.version, "1.0.0");
    assert.equal(libA.private, true);
  } finally {
    cleanup(tmp);
  }
});

test("getWorkspaces: includes workspace dependencies", () => {
  const tmp = tempDir();
  try {
    writeJson(path.join(tmp, "package.json"), {
      name: "root",
      workspaces: ["packages/*"],
    });
    makePackage(path.join(tmp, "packages", "lib-a"), "lib-a", { lodash: "^4.0.0" });
    makePackage(path.join(tmp, "packages", "lib-b"), "lib-b", { "lib-a": "workspace:*" });

    const mm = new MonorepoManager(tmp);
    const workspaces = mm.getWorkspaces();

    const libB = workspaces.find((w) => w.name === "lib-b");
    assert.ok(libB.dependencies["lib-a"]);
  } finally {
    cleanup(tmp);
  }
});

test("getWorkspaces: returns empty array for non-monorepo", () => {
  const tmp = tempDir();
  try {
    makePackage(tmp, "standalone");

    const mm = new MonorepoManager(tmp);
    const workspaces = mm.getWorkspaces();

    assert.deepEqual(workspaces, []);
  } finally {
    cleanup(tmp);
  }
});

// ── getDependencyGraph ─────────────────────────────────────

test("getDependencyGraph: builds correct adjacency", () => {
  const tmp = tempDir();
  try {
    writeJson(path.join(tmp, "package.json"), {
      name: "root",
      workspaces: ["packages/*"],
    });
    makePackage(path.join(tmp, "packages", "core"), "core");
    makePackage(path.join(tmp, "packages", "utils"), "utils", { core: "workspace:*" });
    makePackage(path.join(tmp, "packages", "app"), "app", { core: "workspace:*", utils: "workspace:*" });

    const mm = new MonorepoManager(tmp);
    const graph = mm.getDependencyGraph();

    assert.deepEqual(graph.packages.sort(), ["app", "core", "utils"]);

    // dependencies: what each package depends on
    assert.deepEqual(graph.dependencies.core.sort(), []);
    assert.deepEqual(graph.dependencies.utils.sort(), ["core"]);
    assert.deepEqual(graph.dependencies.app.sort(), ["core", "utils"]);

    // dependents: what depends on each package
    assert.deepEqual(graph.dependents.core.sort(), ["app", "utils"]);
    assert.deepEqual(graph.dependents.utils.sort(), ["app"]);
    assert.deepEqual(graph.dependents.app.sort(), []);
  } finally {
    cleanup(tmp);
  }
});

test("getDependencyGraph: handles packages with no internal deps", () => {
  const tmp = tempDir();
  try {
    writeJson(path.join(tmp, "package.json"), {
      name: "root",
      workspaces: ["packages/*"],
    });
    makePackage(path.join(tmp, "packages", "a"), "a");
    makePackage(path.join(tmp, "packages", "b"), "b");

    const mm = new MonorepoManager(tmp);
    const graph = mm.getDependencyGraph();

    assert.deepEqual(graph.dependencies.a, []);
    assert.deepEqual(graph.dependencies.b, []);
  } finally {
    cleanup(tmp);
  }
});

// ── getAffectedPackages ────────────────────────────────────

test("getAffectedPackages: finds directly changed packages", () => {
  const tmp = tempDir();
  try {
    writeJson(path.join(tmp, "package.json"), {
      name: "root",
      workspaces: ["packages/*"],
    });
    makePackage(path.join(tmp, "packages", "core"), "core");
    makePackage(path.join(tmp, "packages", "utils"), "utils", { core: "workspace:*" });
    makePackage(path.join(tmp, "packages", "app"), "app", { utils: "workspace:*" });

    const mm = new MonorepoManager(tmp);
    const affected = mm.getAffectedPackages(["packages/core/src/index.js"]);

    // core is directly changed, utils depends on core, app depends on utils
    assert.deepEqual(affected, ["core", "utils", "app"]);
  } finally {
    cleanup(tmp);
  }
});

test("getAffectedPackages: root config change affects all packages", () => {
  const tmp = tempDir();
  try {
    writeJson(path.join(tmp, "package.json"), {
      name: "root",
      workspaces: ["packages/*"],
    });
    makePackage(path.join(tmp, "packages", "a"), "a");
    makePackage(path.join(tmp, "packages", "b"), "b");

    const mm = new MonorepoManager(tmp);
    const affected = mm.getAffectedPackages(["package.json"]);

    // All packages affected by root config change
    assert.ok(affected.includes("a"));
    assert.ok(affected.includes("b"));
  } finally {
    cleanup(tmp);
  }
});

test("getAffectedPackages: no changes returns empty", () => {
  const tmp = tempDir();
  try {
    writeJson(path.join(tmp, "package.json"), {
      name: "root",
      workspaces: ["packages/*"],
    });
    makePackage(path.join(tmp, "packages", "a"), "a");

    const mm = new MonorepoManager(tmp);
    const affected = mm.getAffectedPackages([]);

    assert.deepEqual(affected, []);
  } finally {
    cleanup(tmp);
  }
});

// ── getBuildOrder ──────────────────────────────────────────

test("getBuildOrder: topological sort of simple dependency chain", () => {
  const tmp = tempDir();
  try {
    writeJson(path.join(tmp, "package.json"), {
      name: "root",
      workspaces: ["packages/*"],
    });
    makePackage(path.join(tmp, "packages", "core"), "core");
    makePackage(path.join(tmp, "packages", "utils"), "utils", { core: "workspace:*" });
    makePackage(path.join(tmp, "packages", "app"), "app", { core: "workspace:*", utils: "workspace:*" });

    const mm = new MonorepoManager(tmp);
    const order = mm.getBuildOrder();

    // core must come before utils, utils before app
    const coreIdx = order.indexOf("core");
    const utilsIdx = order.indexOf("utils");
    const appIdx = order.indexOf("app");

    assert.ok(coreIdx < utilsIdx, "core should build before utils");
    assert.ok(coreIdx < appIdx, "core should build before app");
    assert.ok(utilsIdx < appIdx, "utils should build before app");
  } finally {
    cleanup(tmp);
  }
});

test("getBuildOrder: independent packages can be in any order", () => {
  const tmp = tempDir();
  try {
    writeJson(path.join(tmp, "package.json"), {
      name: "root",
      workspaces: ["packages/*"],
    });
    makePackage(path.join(tmp, "packages", "a"), "a");
    makePackage(path.join(tmp, "packages", "b"), "b");
    makePackage(path.join(tmp, "packages", "c"), "c");

    const mm = new MonorepoManager(tmp);
    const order = mm.getBuildOrder();

    assert.equal(order.length, 3);
    assert.deepEqual(order.sort(), ["a", "b", "c"]);
  } finally {
    cleanup(tmp);
  }
});

test("getBuildOrder: subset of packages respects dependencies", () => {
  const tmp = tempDir();
  try {
    writeJson(path.join(tmp, "package.json"), {
      name: "root",
      workspaces: ["packages/*"],
    });
    makePackage(path.join(tmp, "packages", "core"), "core");
    makePackage(path.join(tmp, "packages", "utils"), "utils", { core: "workspace:*" });
    makePackage(path.join(tmp, "packages", "app"), "app", { utils: "workspace:*" });

    const mm = new MonorepoManager(tmp);

    // Only build utils and app — core is excluded
    const order = mm.getBuildOrder(["utils", "app"]);

    const utilsIdx = order.indexOf("utils");
    const appIdx = order.indexOf("app");

    assert.ok(utilsIdx < appIdx, "utils should build before app even in subset");
  } finally {
    cleanup(tmp);
  }
});

test("getBuildOrder: handles cyclic dependencies gracefully", () => {
  const tmp = tempDir();
  try {
    writeJson(path.join(tmp, "package.json"), {
      name: "root",
      workspaces: ["packages/*"],
    });
    // Create a cycle: a -> b -> a
    makePackage(path.join(tmp, "packages", "a"), "a", { b: "workspace:*" });
    makePackage(path.join(tmp, "packages", "b"), "b", { a: "workspace:*" });

    const mm = new MonorepoManager(tmp);
    const order = mm.getBuildOrder();

    // Should still return all packages even with cycles
    assert.equal(order.length, 2);
    assert.ok(order.includes("a"));
    assert.ok(order.includes("b"));
  } finally {
    cleanup(tmp);
  }
});
