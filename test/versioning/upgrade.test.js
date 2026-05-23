/**
 * Tests for UpgradeEngine: registerUpgrade, getUpgradePath, upgrade,
 * checkCompatibility, getAvailableUpgrades, getLatestVersion, etc.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { UpgradeEngine } = require("../../src/versioning/upgrade");

// ---------------------------------------------------------------------------
// registerUpgrade
// ---------------------------------------------------------------------------

test("UpgradeEngine: registerUpgrade stores an upgrade function", () => {
  const engine = new UpgradeEngine();
  const fn = (data) => data;

  engine.registerUpgrade("1.0.0", "1.1.0", fn);

  assert.equal(engine.countUpgrades(), 1);
  assert.equal(engine.hasUpgrade("1.0.0", "1.1.0"), true);
});

test("UpgradeEngine: registerUpgrade throws for invalid inputs", () => {
  const engine = new UpgradeEngine();

  assert.throws(() => engine.registerUpgrade(123, "1.0.0", () => {}), {
    message: /must be strings/,
  });
  assert.throws(() => engine.registerUpgrade("1.0.0", "1.1.0", "not-fn"), {
    message: /must be a function/,
  });
  assert.throws(() => engine.registerUpgrade("1.0.0", "1.0.0", () => {}), {
    message: /must be different/,
  });
});

test("UpgradeEngine: registerUpgrade throws for downgrade path", () => {
  const engine = new UpgradeEngine();

  assert.throws(() => engine.registerUpgrade("2.0.0", "1.0.0", () => {}), {
    message: /must be an upgrade/,
  });
});

test("UpgradeEngine: registerUpgrade throws for duplicate path", () => {
  const engine = new UpgradeEngine();
  engine.registerUpgrade("1.0.0", "1.1.0", () => {});

  assert.throws(() => engine.registerUpgrade("1.0.0", "1.1.0", () => {}), {
    message: /already registered/,
  });
});

test("UpgradeEngine: registerUpgrade tracks latest version per component", () => {
  const engine = new UpgradeEngine();
  engine.registerUpgrade("1.0.0", "1.1.0", () => {}, { component: "plugin-auth" });
  engine.registerUpgrade("1.1.0", "2.0.0", () => {}, { component: "plugin-auth" });

  assert.equal(engine.getLatestVersion("plugin-auth"), "2.0.0");
});

// ---------------------------------------------------------------------------
// getUpgradePath
// ---------------------------------------------------------------------------

test("UpgradeEngine: getUpgradePath returns empty array for same version", () => {
  const engine = new UpgradeEngine();
  const path = engine.getUpgradePath("1.0.0", "1.0.0");
  assert.deepEqual(path, []);
});

test("UpgradeEngine: getUpgradePath finds direct path", () => {
  const engine = new UpgradeEngine();
  engine.registerUpgrade("1.0.0", "1.1.0", () => {});

  const path = engine.getUpgradePath("1.0.0", "1.1.0");
  assert.deepEqual(path, [{ from: "1.0.0", to: "1.1.0" }]);
});

test("UpgradeEngine: getUpgradePath finds multi-step path (BFS shortest)", () => {
  const engine = new UpgradeEngine();
  engine.registerUpgrade("1.0.0", "1.1.0", () => {});
  engine.registerUpgrade("1.1.0", "1.2.0", () => {});
  engine.registerUpgrade("1.0.0", "2.0.0", () => {}); // Direct but longer jump
  engine.registerUpgrade("1.2.0", "2.0.0", () => {});

  const path = engine.getUpgradePath("1.0.0", "2.0.0");
  // BFS finds the direct path (2 steps via 1.0.0->2.0.0 is shorter than 3 steps via 1.1.0->1.2.0->2.0.0)
  assert.equal(path.length, 1);
  assert.deepEqual(path, [{ from: "1.0.0", to: "2.0.0" }]);
});

test("UpgradeEngine: getUpgradePath returns null when no path exists", () => {
  const engine = new UpgradeEngine();
  engine.registerUpgrade("1.0.0", "1.1.0", () => {});

  const path = engine.getUpgradePath("1.0.0", "3.0.0");
  assert.equal(path, null);
});

// ---------------------------------------------------------------------------
// upgrade
// ---------------------------------------------------------------------------

test("UpgradeEngine: upgrade returns data unchanged for same version", () => {
  const engine = new UpgradeEngine();
  const result = engine.upgrade({ foo: "bar" }, "1.0.0", "1.0.0");

  assert.deepEqual(result.data, { foo: "bar" });
  assert.deepEqual(result.steps, []);
  assert.equal(result.originalVersion, "1.0.0");
  assert.equal(result.finalVersion, "1.0.0");
});

test("UpgradeEngine: upgrade executes a single step", () => {
  const engine = new UpgradeEngine();
  engine.registerUpgrade("1.0.0", "1.1.0", (data) => {
    data.upgraded = true;
    data.newField = "present";
    return data;
  });

  const result = engine.upgrade({ name: "test" }, "1.0.0", "1.1.0");

  assert.equal(result.data.upgraded, true);
  assert.equal(result.data.newField, "present");
  assert.equal(result.data.name, "test");
  assert.deepEqual(result.steps, ["1.0.0 -> 1.1.0"]);
});

test("UpgradeEngine: upgrade executes a multi-step chain", () => {
  const engine = new UpgradeEngine();
  engine.registerUpgrade("1.0.0", "1.1.0", (data) => {
    data.step1 = true;
    return data;
  });
  engine.registerUpgrade("1.1.0", "2.0.0", (data) => {
    data.step2 = true;
    data.schemaVersion = 2;
    return data;
  });

  const result = engine.upgrade({ name: "test" }, "1.0.0", "2.0.0");

  assert.equal(result.data.step1, true);
  assert.equal(result.data.step2, true);
  assert.equal(result.data.schemaVersion, 2);
  assert.deepEqual(result.steps, ["1.0.0 -> 1.1.0", "1.1.0 -> 2.0.0"]);
});

test("UpgradeEngine: upgrade does not mutate original data", () => {
  const engine = new UpgradeEngine();
  engine.registerUpgrade("1.0.0", "1.1.0", (data) => {
    data.modified = true;
    return data;
  });

  const original = { name: "test", nested: { deep: true } };
  const result = engine.upgrade(original, "1.0.0", "1.1.0");

  // The original should not be modified (shallow copy)
  assert.equal(original.modified, undefined);
  // But note: shallow copy means nested objects may still reference original
});

test("UpgradeEngine: upgrade throws when no path exists", () => {
  const engine = new UpgradeEngine();

  assert.throws(() => engine.upgrade({}, "1.0.0", "2.0.0"), {
    message: /No upgrade path found/,
  });
});

test("UpgradeEngine: upgrade throws when a step fails", () => {
  const engine = new UpgradeEngine();
  engine.registerUpgrade("1.0.0", "1.1.0", () => {
    throw new Error("Migration failed: invalid schema");
  });

  assert.throws(() => engine.upgrade({}, "1.0.0", "1.1.0"), {
    message: /Upgrade step.*failed/,
  });
});

// ---------------------------------------------------------------------------
// checkCompatibility
// ---------------------------------------------------------------------------

test("UpgradeEngine: checkCompatibility returns incompatible for unknown component", () => {
  const engine = new UpgradeEngine();
  const result = engine.checkCompatibility("nonexistent", "^1.0.0");

  assert.equal(result.compatible, false);
  assert.ok(result.reason.includes("no registered versions"));
  assert.equal(result.currentVersion, null);
});

test("UpgradeEngine: checkCompatibility returns compatible for known component", () => {
  const engine = new UpgradeEngine();
  engine.registerUpgrade("1.0.0", "1.1.0", () => {}, { component: "plugin-auth" });

  const result = engine.checkCompatibility("plugin-auth", "^1.0.0");
  assert.equal(result.compatible, true);
  assert.equal(result.currentVersion, "1.1.0");
});

test("UpgradeEngine: checkCompatibility with registered compatibility requirements", () => {
  const engine = new UpgradeEngine();
  engine.registerUpgrade("1.0.0", "2.0.0", () => {}, { component: "plugin-auth" });
  engine.registerCompatibility("plugin-auth", "2.0.0", {
    requires: "^2.0.0",
    engineMin: "2.0.0",
  });

  // Compatible with ^2.0.0
  const result1 = engine.checkCompatibility("plugin-auth", "^2.0.0");
  assert.equal(result1.compatible, true);

  // Not compatible with ^1.0.0 because it requires ^2.0.0
  const result2 = engine.checkCompatibility("plugin-auth", "^1.0.0");
  assert.equal(result2.compatible, false);
});

// ---------------------------------------------------------------------------
// getAvailableUpgrades
// ---------------------------------------------------------------------------

test("UpgradeEngine: getAvailableUpgrades returns upgrades from a specific version", () => {
  const engine = new UpgradeEngine();
  engine.registerUpgrade("1.0.0", "1.1.0", () => {});
  engine.registerUpgrade("1.1.0", "1.2.0", () => {});
  engine.registerUpgrade("1.0.0", "2.0.0", () => {});

  const from1 = engine.getAvailableUpgrades("1.0.0");
  assert.equal(from1.length, 2);
  assert.deepEqual(from1, [
    { from: "1.0.0", to: "1.1.0" },
    { from: "1.0.0", to: "2.0.0" },
  ]);

  const from2 = engine.getAvailableUpgrades("2.0.0");
  assert.equal(from2.length, 0);
});

test("UpgradeEngine: getAvailableUpgrades returns all when no version specified", () => {
  const engine = new UpgradeEngine();
  engine.registerUpgrade("1.0.0", "1.1.0", () => {});
  engine.registerUpgrade("1.1.0", "1.2.0", () => {});

  const all = engine.getAvailableUpgrades();
  assert.equal(all.length, 2);
});

// ---------------------------------------------------------------------------
// removeUpgrade
// ---------------------------------------------------------------------------

test("UpgradeEngine: removeUpgrade removes a registered path", () => {
  const engine = new UpgradeEngine();
  engine.registerUpgrade("1.0.0", "1.1.0", () => {});

  assert.equal(engine.countUpgrades(), 1);
  const removed = engine.removeUpgrade("1.0.0", "1.1.0");
  assert.equal(removed, true);
  assert.equal(engine.countUpgrades(), 0);
  assert.equal(engine.hasUpgrade("1.0.0", "1.1.0"), false);
});

test("UpgradeEngine: removeUpgrade returns false for nonexistent path", () => {
  const engine = new UpgradeEngine();
  assert.equal(engine.removeUpgrade("1.0.0", "1.1.0"), false);
});

// ---------------------------------------------------------------------------
// countUpgrades / getAllVersions
// ---------------------------------------------------------------------------

test("UpgradeEngine: countUpgrades tracks total registered paths", () => {
  const engine = new UpgradeEngine();
  assert.equal(engine.countUpgrades(), 0);

  engine.registerUpgrade("1.0.0", "1.1.0", () => {}, { component: "a" });
  engine.registerUpgrade("1.1.0", "1.2.0", () => {}, { component: "a" });
  engine.registerUpgrade("1.0.0", "2.0.0", () => {}, { component: "b" });

  assert.equal(engine.countUpgrades(), 3);
});

test("UpgradeEngine: getAllVersions tracks all components", () => {
  const engine = new UpgradeEngine();
  engine.registerUpgrade("1.0.0", "1.1.0", () => {}, { component: "plugin-auth" });
  engine.registerUpgrade("2.0.0", "2.1.0", () => {}, { component: "plugin-storage" });

  const versions = engine.getAllVersions();
  assert.equal(versions.get("plugin-auth"), "1.1.0");
  assert.equal(versions.get("plugin-storage"), "2.1.0");
});
