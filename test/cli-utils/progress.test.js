/**
 * Tests for cli-utils/progress: Spinner, ProgressBar, withSpinner.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { Writable } = require("node:stream");

const { Spinner, ProgressBar, withSpinner, SPINNER_FRAMES } = require("../../src/cli-utils/progress");
const { ANSI, THEME } = require("../../src/renderer");

// ── Spinner ────────────────────────────────────────────────

test("Spinner: starts and stops without error", () => {
  const out = new Writable({
    write(_chunk, _encoding, callback) { callback(); },
  });
  out.isTTY = true;

  const spinner = new Spinner(out);
  spinner.start("Loading");
  assert.equal(spinner.active, true);
  assert.equal(spinner.message, "Loading");

  spinner.stop();
  assert.equal(spinner.active, false);
  assert.equal(spinner.timer, null);
});

test("Spinner: updates message", () => {
  const out = new Writable({
    write(_chunk, _encoding, callback) { callback(); },
  });
  out.isTTY = true;

  const spinner = new Spinner(out);
  spinner.start("Loading");
  assert.equal(spinner.message, "Loading");

  spinner.updateMessage("Processing");
  assert.equal(spinner.message, "Processing");

  spinner.stop();
});

test("Spinner: does not write when not a TTY", () => {
  let written = false;
  const out = new Writable({
    write(_chunk, _encoding, callback) {
      written = true;
      callback();
    },
  });
  out.isTTY = false;

  const spinner = new Spinner(out);
  spinner.start("test");
  // On a non-TTY, the spinner does not set up an interval
  assert.equal(spinner.timer, null);
  assert.equal(written, false);

  spinner.stop();
});

test("Spinner: stop on already stopped spinner is safe", () => {
  const out = new Writable({
    write(_chunk, _encoding, callback) { callback(); },
  });
  out.isTTY = true;

  const spinner = new Spinner(out);
  // Calling stop before start is safe
  spinner.stop();
  assert.equal(spinner.active, false);

  spinner.start("test");
  spinner.stop();
  // Second stop is safe
  spinner.stop();
  assert.equal(spinner.active, false);
});

test("Spinner: start with no message defaults to empty", () => {
  const out = new Writable({
    write(_chunk, _encoding, callback) { callback(); },
  });
  out.isTTY = true;

  const spinner = new Spinner(out);
  spinner.start();
  assert.equal(spinner.message, "");
  spinner.stop();
});

// ── ProgressBar ────────────────────────────────────────────

test("ProgressBar: renders at 0%, 50%, 100%", () => {
  const bar = new ProgressBar();
  bar.start();

  let out = bar.render(0);
  assert.ok(out.includes("0"));
  assert.ok(out.includes("%"));

  out = bar.render(50);
  assert.ok(out.includes("50"));
  assert.ok(out.includes("%"));
  // Check that roughly half the bar is filled
  const completeChars = (out.match(/=/g) || []).length;
  assert.ok(completeChars >= 18 && completeChars <= 22, `expected ~20 '=', got ${completeChars}`);

  out = bar.render(100);
  assert.ok(out.includes("100"));
  assert.ok(out.includes("%"));
  const fullChars = (out.match(/=/g) || []).length;
  assert.equal(fullChars, 40);
});

test("ProgressBar: handles invalid percentages gracefully", () => {
  const bar = new ProgressBar();

  // NaN
  let out = bar.render(NaN);
  assert.ok(out.includes("0.0%"));

  // Negative
  out = bar.render(-10);
  assert.ok(out.includes("0.0%"));

  // Over 100
  out = bar.render(150);
  assert.ok(out.includes("100.0%"));

  // null / undefined
  out = bar.render(null);
  assert.ok(out.includes("0.0%"));

  out = bar.render(undefined);
  assert.ok(out.includes("0.0%"));

  // Non-number
  out = bar.render("foo");
  assert.ok(out.includes("0.0%"));
});

test("ProgressBar: custom width and characters", () => {
  const bar = new ProgressBar({
    width: 20,
    complete: "#",
    incomplete: "-",
    decimals: 2,
  });

  const out = bar.render(25);
  assert.ok(out.includes("#"));
  assert.ok(out.includes("-"));
  assert.ok(out.includes("25.00%"));
  // 25% of 20 = 5 complete chars
  const hashCount = (out.match(/#/g) || []).length;
  assert.equal(hashCount, 5);
});

test("ProgressBar: plain style uses brackets", () => {
  const bar = new ProgressBar({ style: "plain" });
  const out = bar.render(50);
  assert.ok(out.startsWith("["));
  assert.ok(out.includes("]"));
  // Should not contain ANSI codes
  assert.ok(!out.includes("\x1B"));
});

test("ProgressBar: ETA is shown when enabled", () => {
  const bar = new ProgressBar({
    width: 10,
    showEta: true,
    total: 100,
  });

  const out = bar.render(50, 5000);
  assert.ok(out.includes("ETA"), `Expected "ETA" in output, got: ${out}`);
});

test("ProgressBar: start/elapsed timing", (t) => {
  const bar = new ProgressBar();
  bar.start();
  // Must wait a tick for elapsed to be > 0
  return new Promise((resolve) => {
    setTimeout(() => {
      const elapsed = bar.elapsed();
      assert.ok(elapsed > 0);
      resolve();
    }, 10);
  });
});

// ── withSpinner ────────────────────────────────────────────

test("withSpinner: returns function result", async () => {
  const fn = async () => 42;
  const result = await withSpinner(fn, "Computing...");
  assert.equal(result, 42);
});

test("withSpinner: preserves error throws", async () => {
  const fn = async () => {
    throw new Error("something went wrong");
  };

  await assert.rejects(
    withSpinner(fn, "Failing..."),
    /something went wrong/,
  );
});

test("withSpinner: handles synchronous return value wrapped in Promise", async () => {
  const fn = () => "hello";
  const result = await withSpinner(fn, "Greeting");
  assert.equal(result, "hello");
});

test("withSpinner: handles null/undefined return", async () => {
  const fn = async () => null;
  const result = await withSpinner(fn, "Loading...");
  assert.equal(result, null);
});
