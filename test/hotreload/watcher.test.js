/**
 * Tests for ConfigWatcher: watch, onChange, onSectionChange, pause, resume,
 * close, debounce, and hash-based change detection.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { ConfigWatcher, hashFile } = require("../../src/hotreload/watcher");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-watcher-"));

function tmpFile(name) {
  return path.join(tmpDir, name);
}

function writeJson(filePath, obj) {
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

// ---- Construction ----

test("ConfigWatcher: constructor accepts custom debounceMs", () => {
  const w = new ConfigWatcher({ debounceMs: 500 });
  assert.equal(w._debounceMs, 500);
  w.close();
});

test("ConfigWatcher: constructor defaults debounceMs to 300", () => {
  const w = new ConfigWatcher();
  assert.equal(w._debounceMs, 300);
  w.close();
});

test("ConfigWatcher: constructor clamps negative debounceMs to 0", () => {
  const w = new ConfigWatcher({ debounceMs: -50 });
  assert.equal(w._debounceMs, 0);
  w.close();
});

// ---- watch ----

test("ConfigWatcher: watch throws for empty configPath", () => {
  const w = new ConfigWatcher();
  assert.throws(() => w.watch(""), { message: /non-empty string/ });
  assert.throws(() => w.watch(null), { message: /non-empty string/ });
  w.close();
});

test("ConfigWatcher: watch returns the resolved path and sets up watcher", () => {
  const file = tmpFile("basic.json");
  writeJson(file, { ui: { theme: "dark" } });

  const w = new ConfigWatcher();
  const resolved = w.watch(file);
  assert.ok(path.isAbsolute(resolved));
  assert.ok(w._watcher !== null);
  w.close();
});

// ---- onChange handler ----

test("ConfigWatcher: onChange registers handler and returns unsubscribe", () => {
  const file = tmpFile("onchange.json");
  writeJson(file, { ui: { theme: "dark" } });

  const w = new ConfigWatcher({ debounceMs: 0 });
  w.watch(file);

  const calls = [];
  const unsub = w.onChange((oldCfg, newCfg, sections) => {
    calls.push({ oldCfg, newCfg, sections });
  });

  assert.equal(typeof unsub, "function");

  // Trigger change.
  writeJson(file, { ui: { theme: "dark" }, permissions: { mode: "auto" } });
  fs.utimesSync(file, new Date(), new Date());

  // With debounce 0 the handler fires synchronously via _onFileChanged -> _checkAndNotify
  // but since fs.watch is async on most platforms we need a tick.
  // Use a small timeout to let the event loop flush.
  return new Promise((resolve) => {
    setTimeout(() => {
      assert.ok(calls.length >= 1, "onChange handler should have been called at least once");
      w.close();
      resolve();
    }, 150);
  });
});

// ---- pause / resume ----

test("ConfigWatcher: pause suppresses notifications", () => {
  const file = tmpFile("pause.json");
  writeJson(file, { ui: { locale: "en" } });

  const w = new ConfigWatcher({ debounceMs: 10 });
  w.watch(file);

  let fired = false;
  w.onChange(() => { fired = true; });

  w.pause();

  // Mutate file while paused.
  writeJson(file, { ui: { locale: "fr" } });
  fs.utimesSync(file, new Date(), new Date());

  return new Promise((resolve) => {
    setTimeout(() => {
      assert.equal(fired, false, "handler should NOT fire while paused");
      w.close();
      resolve();
    }, 80);
  });
});

test("ConfigWatcher: resume re-establishes baseline and allows future notifications", () => {
  const file = tmpFile("resume.json");
  writeJson(file, { ui: { locale: "en" } });

  const w = new ConfigWatcher({ debounceMs: 50 });
  w.watch(file);

  let fireCount = 0;
  w.onChange(() => { fireCount++; });

  // Pause, make a change, resume.
  w.pause();
  writeJson(file, { ui: { locale: "fr" } });
  fs.utimesSync(file, new Date(), new Date());

  return new Promise((resolve) => {
    setTimeout(() => {
      assert.equal(fireCount, 0, "still no events during pause window");
      w.resume();

      // Make another change after resume.
      writeJson(file, { ui: { locale: "de" } });
      fs.utimesSync(file, new Date(), new Date());

      setTimeout(() => {
        assert.equal(fireCount, 1, "handler should fire for post-resume change");
        w.close();
        resolve();
      }, 150);
    }, 80);
  });
});

// ---- onSectionChange ----

test("ConfigWatcher: onSectionChange registers per-section handler", () => {
  const file = tmpFile("section.json");
  writeJson(file, { ui: { theme: "dark" }, permissions: { mode: "normal" } });

  const w = new ConfigWatcher({ debounceMs: 0 });
  w.watch(file);

  const uiCalls = [];
  const permCalls = [];

  w.onSectionChange("ui", (oldVal, newVal) => uiCalls.push({ oldVal, newVal }));
  w.onSectionChange("permissions", (oldVal, newVal) => permCalls.push({ oldVal, newVal }));

  // Trigger a change that affects both sections.
  writeJson(file, { ui: { theme: "light" }, permissions: { mode: "auto" } });
  fs.utimesSync(file, new Date(), new Date());

  return new Promise((resolve) => {
    setTimeout(() => {
      assert.ok(uiCalls.length >= 1, "ui handler should fire");
      assert.ok(permCalls.length >= 1, "permissions handler should fire");
      w.close();
      resolve();
    }, 150);
  });
});

test("ConfigWatcher: onSectionChange throws for invalid arguments", () => {
  const w = new ConfigWatcher();
  assert.throws(() => w.onSectionChange("", () => {}), { message: /non-empty string/ });
  assert.throws(() => w.onSectionChange("ui", "not-a-fn"), { message: /must be a function/ });
  w.close();
});

// ---- close ----

test("ConfigWatcher: close stops the watcher and clears state", () => {
  const file = tmpFile("close.json");
  writeJson(file, { ui: { theme: "dark" } });

  const w = new ConfigWatcher({ debounceMs: 0 });
  w.watch(file);

  assert.ok(w._watcher !== null);
  assert.ok(w._configPath !== null);

  w.close();

  assert.equal(w._watcher, null);
  assert.equal(w._configPath, null);
  assert.equal(w._lastHash, null);
  assert.equal(w._timer, null);
});

// ---- hashFile helper ----

test("hashFile: returns hex sha256 for valid file", () => {
  const file = tmpFile("hash-test.json");
  const content = '{"key": "value"}';
  fs.writeFileSync(file, content, "utf8");

  const expected = sha256(content);
  const actual = hashFile(file);
  assert.equal(actual, expected);
});

test("hashFile: returns null for missing file", () => {
  const result = hashFile(tmpFile("does-not-exist.json"));
  assert.equal(result, null);
});

// ---- Deduplication via hash ----

test("ConfigWatcher: does not fire onChange when content hash is unchanged", () => {
  const file = tmpFile("same-hash.json");
  writeJson(file, { value: 42 });

  const w = new ConfigWatcher({ debounceMs: 10 });
  w.watch(file);

  let fireCount = 0;
  w.onChange(() => { fireCount++; });

  // Touch the file without changing content.
  fs.utimesSync(file, new Date(), new Date());

  return new Promise((resolve) => {
    setTimeout(() => {
      assert.equal(fireCount, 0, "handler should not fire for unchanged content");
      w.close();
      resolve();
    }, 80);
  });
});

// ---- onChange unsubscription ----

test("ConfigWatcher: onChange unsubscribe removes the handler", () => {
  const file = tmpFile("unsub.json");
  writeJson(file, { x: 1 });

  const w = new ConfigWatcher({ debounceMs: 0 });
  w.watch(file);

  let fireCount = 0;
  const unsub = w.onChange(() => { fireCount++; });

  unsub();

  writeJson(file, { x: 2 });
  fs.utimesSync(file, new Date(), new Date());

  return new Promise((resolve) => {
    setTimeout(() => {
      assert.equal(fireCount, 0, "unsubscribed handler should not fire");
      w.close();
      resolve();
    }, 150);
  });
});

// ---- Malformed JSON is skipped ----

test("ConfigWatcher: does not fire onChange when file contains invalid JSON", () => {
  const file = tmpFile("bad-json.json");
  writeJson(file, { valid: true });

  const w = new ConfigWatcher({ debounceMs: 10 });
  w.watch(file);

  let fireCount = 0;
  w.onChange(() => { fireCount++; });

  // Write invalid JSON.
  fs.writeFileSync(file, "{ not valid json }", "utf8");
  fs.utimesSync(file, new Date(), new Date());

  return new Promise((resolve) => {
    setTimeout(() => {
      assert.equal(fireCount, 0, "handler should not fire for malformed JSON");
      w.close();
      resolve();
    }, 80);
  });
});
