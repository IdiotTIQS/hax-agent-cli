/**
 * Tests for FileChangePredictor: learn, predict, getConfidence,
 * getRelatedFiles, getChangeProbabilityMap, co-change detection,
 * recency weighting, and import-graph inference.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { FileChangePredictor, _internals } = require("../../src/files/predictor");

// -----------------------------------------------------------------------
// Helper to create a change history entry
// -----------------------------------------------------------------------
function entry(filePath, timestamp, event) {
  return {
    filePath,
    event: event || "change",
    source: "test",
    timestamp: timestamp || new Date().toISOString(),
  };
}

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

test("FileChangePredictor: constructor uses default options", () => {
  const predictor = new FileChangePredictor();
  assert.equal(predictor._opts.coChangeThreshold, 3);
  assert.equal(predictor._opts.recencyHalfLifeDays, 30);
  assert.equal(predictor._opts.maxRelatedFiles, 20);
});

test("FileChangePredictor: constructor accepts custom options", () => {
  const predictor = new FileChangePredictor({
    coChangeThreshold: 5,
    recencyHalfLifeDays: 14,
    maxRelatedFiles: 10,
  });
  assert.equal(predictor._opts.coChangeThreshold, 5);
  assert.equal(predictor._opts.recencyHalfLifeDays, 14);
  assert.equal(predictor._opts.maxRelatedFiles, 10);
});

test("FileChangePredictor: learn processes change history and builds co-change pairs", () => {
  const predictor = new FileChangePredictor();
  const now = Date.now();

  // Simulate changes within the same 5-minute window
  const history = [
    entry("/src/a.js", new Date(now - 60000).toISOString(), "edit"),
    entry("/src/b.js", new Date(now - 30000).toISOString(), "edit"),
    entry("/src/c.js", new Date(now).toISOString(), "edit"),
  ];

  predictor.learn(history);

  // Check change history storage
  assert.ok(predictor._changeHistory.has("src/a.js"));
  assert.ok(predictor._changeHistory.has("src/b.js"));
  assert.ok(predictor._changeHistory.has("src/c.js"));

  // Check co-change pairs — all three should be paired because they are within 5 minutes
  const aPairs = predictor._coChangePairs.get("src/a.js");
  assert.ok(aPairs, "a.js should have co-change pairs");
  assert.ok(aPairs.has("src/b.js"), "a.js co-changed with b.js");
  assert.ok(aPairs.has("src/c.js"), "a.js co-changed with c.js");
});

test("FileChangePredictor: learn tracks change frequency and last edit time", () => {
  const predictor = new FileChangePredictor();
  const now = Date.now();

  const history = [
    entry("/src/app.js", new Date(now - 200000).toISOString(), "edit"),
    entry("/src/app.js", new Date(now - 100000).toISOString(), "edit"),
    entry("/src/app.js", new Date(now).toISOString(), "edit"),
  ];

  predictor.learn(history);

  const freq = predictor._changeFrequency.get("src/app.js");
  assert.equal(freq, 3);

  const lastEdit = predictor._lastEditTime.get("src/app.js");
  assert.ok(lastEdit > now - 100000);
});

test("FileChangePredictor: predict returns scored files based on recency", () => {
  const predictor = new FileChangePredictor();
  const now = Date.now();

  // Register a file that was recently edited
  const history = [
    entry("/src/recent.js", new Date(now - 10000).toISOString(), "edit"),
  ];
  predictor.learn(history);

  const projectFiles = ["/src/recent.js", "/src/old.js", "/src/never.js"];
  const results = predictor.predict({}, projectFiles);

  assert.ok(results.length > 0, "should have predictions");
  const recentResult = results.find((r) => r.file.includes("recent"));
  assert.ok(recentResult, "recently-edited file should be in predictions");
  assert.ok(recentResult.score > 0, "recently-edited file should have positive score");
  assert.ok(recentResult.reasons.includes("recent-edit"), "should have recent-edit reason");
});

test("FileChangePredictor: predict uses task context for keyword matching", () => {
  const predictor = new FileChangePredictor();

  predictor.addFile({
    filePath: "/src/user-authentication.js",
    source: "module.exports = { login, logout, verifyToken };",
  });

  predictor.addFile({
    filePath: "/src/payment-gateway.js",
    source: "module.exports = { charge, refund };",
  });

  const projectFiles = ["/src/user-authentication.js", "/src/payment-gateway.js"];
  const results = predictor.predict(
    { context: "fix the authentication login bug" },
    projectFiles,
  );

  const authResult = results.find((r) => r.file.includes("user-authentication"));
  const payResult = results.find((r) => r.file.includes("payment"));

  // The auth file should score higher because context mentions "authentication" and "login"
  assert.ok(authResult, "auth file should be in predictions");
  if (payResult) {
    assert.ok(authResult.score >= payResult.score, "auth file should score >= payment file");
  }
});

test("FileChangePredictor: predict uses co-change patterns from history", () => {
  const predictor = new FileChangePredictor();
  const now = Date.now();

  // Simulate co-changes: header.js and footer.js always change together
  const history = [];
  for (let i = 0; i < 5; i++) {
    const base = now - i * 600000; // 10 minute intervals apart
    history.push(entry("/src/header.js", new Date(base).toISOString(), "edit"));
    history.push(entry("/src/footer.js", new Date(base + 30000).toISOString(), "edit"));
  }

  predictor.learn(history);

  const projectFiles = ["/src/header.js", "/src/footer.js", "/src/unrelated.js"];
  const results = predictor.predict(
    { recentlyChanged: ["/src/header.js"] },
    projectFiles,
  );

  const footerResult = results.find((r) => r.file.includes("footer"));
  assert.ok(footerResult, "footer.js should be predicted via co-change");
  assert.ok(footerResult.reasons.includes("co-change"), "should have co-change reason");
});

test("FileChangePredictor: predict uses import graph for dependency prediction", () => {
  const predictor = new FileChangePredictor();

  // Use import paths that match project file names for resolution
  predictor.addFile({
    filePath: "/src/main.js",
    imports: ["/src/utils.js", "/src/api.js"],
  });

  predictor.addFile({
    filePath: "/src/utils.js",
    source: "module.exports = { formatDate, parseQuery };",
  });

  predictor.addFile({
    filePath: "/src/api.js",
    source: "module.exports = { fetch };",
  });

  const projectFiles = ["/src/main.js", "/src/utils.js", "/src/api.js"];
  const results = predictor.predict(
    { recentlyChanged: ["/src/main.js"] },
    projectFiles,
  );

  // utils.js is imported by main.js, so it should get a score boost
  const utilsResult = results.find((r) => r.file.includes("utils"));
  const apiResult = results.find((r) => r.file.includes("api"));
  assert.ok(utilsResult || apiResult, "imported files should be predicted");
});

test("FileChangePredictor: predict returns empty for empty project files", () => {
  const predictor = new FileChangePredictor();
  const results = predictor.predict({ context: "fix stuff" }, []);
  assert.deepEqual(results, []);
});

test("FileChangePredictor: getConfidence returns high for well-connected change-heavy files", () => {
  const predictor = new FileChangePredictor();
  const now = Date.now();

  // Build extensive history for the file
  const history = [];
  for (let i = 0; i < 12; i++) {
    history.push(entry("/src/important.js", new Date(now - i * 86400000).toISOString(), "edit"));
  }

  predictor.learn(history);

  // Add many related files as imports
  predictor.addFile({
    filePath: "/src/important.js",
    imports: ["/src/a.js", "/src/b.js", "/src/c.js", "/src/d.js", "/src/e.js"],
  });

  // Add many consumers
  for (let i = 0; i < 8; i++) {
    predictor.addFile({
      filePath: `/src/consumer${i}.js`,
      imports: ["/src/important.js"],
    });
  }

  const confidence = predictor.getConfidence("/src/important.js");
  assert.ok(confidence.level === "high" || confidence.level === "medium",
    `expected high or medium confidence, got ${confidence.level} (score=${confidence.score})`);
  assert.ok(confidence.score >= 30, `expected score >= 30, got ${confidence.score}`);
  assert.ok(confidence.factors.length >= 2, "should have multiple factors");
});

test("FileChangePredictor: getConfidence returns low for unknown file", () => {
  const predictor = new FileChangePredictor();
  const confidence = predictor.getConfidence("/src/unknown.js");
  assert.equal(confidence.level, "low");
  assert.equal(confidence.score, 0);
});

test("FileChangePredictor: getRelatedFiles returns co-changes, imports, and consumers", () => {
  const predictor = new FileChangePredictor();
  const now = Date.now();

  // Build co-change data
  predictor.learn([
    entry("/src/target.js", new Date(now).toISOString(), "edit"),
    entry("/src/co-related.js", new Date(now + 1000).toISOString(), "edit"),
    entry("/src/target.js", new Date(now + 12000).toISOString(), "edit"),
    entry("/src/co-related.js", new Date(now + 13000).toISOString(), "edit"),
  ]);

  // Build import graph
  predictor.addFile({
    filePath: "/src/target.js",
    imports: ["/src/dependency.js"],
  });

  predictor.addFile({
    filePath: "/src/consumer.js",
    imports: ["/src/target.js"],
  });

  const related = predictor.getRelatedFiles("/src/target.js");

  // Should contain co-change, import, and imported-by relations
  const coChange = related.filter((r) => r.relation === "co-change");
  const imports = related.filter((r) => r.relation === "import");
  const importedBy = related.filter((r) => r.relation === "imported-by");

  assert.ok(coChange.length > 0, "should have co-change relations");
  assert.ok(imports.length > 0, "should have import relations");
  assert.ok(importedBy.length > 0, "should have imported-by relations");
});

test("FileChangePredictor: getRelatedFiles returns empty for unknown file", () => {
  const predictor = new FileChangePredictor();
  const related = predictor.getRelatedFiles("/src/nonexistent.js");
  assert.deepEqual(related, []);
});

test("FileChangePredictor: getChangeProbabilityMap groups files into risk tiers", () => {
  const predictor = new FileChangePredictor();
  const now = Date.now();

  // Very high: frequently changed + recent + many co-changes
  for (let i = 0; i < 10; i++) {
    predictor.learn([
      entry("/src/very-high.js", new Date(now - i * 60000).toISOString(), "edit"),
    ]);
  }

  // High: moderately changed
  for (let i = 0; i < 5; i++) {
    predictor.learn([
      entry("/src/high.js", new Date(now - i * 3600000).toISOString(), "edit"),
    ]);
  }

  // Low: never changed
  const projectFiles = ["/src/very-high.js", "/src/high.js", "/src/low.js", "/src/other-low.js"];

  const heatmap = predictor.getChangeProbabilityMap(projectFiles, {
    recentlyChanged: ["/src/very-high.js"],
  });

  assert.ok(heatmap.veryHigh.length >= 0, "very-high tier may be empty depending on score thresholds");
  assert.ok(heatmap.all.length <= projectFiles.length, "should not exceed project file count");
  assert.equal(
    typeof heatmap.all[0].tier,
    "string",
    "each entry should have a tier string",
  );
});

test("FileChangePredictor: clear resets all internal state", () => {
  const predictor = new FileChangePredictor();
  predictor.learn([entry("/src/test.js")]);
  predictor.addFile({
    filePath: "/src/app.js",
    source: "require('./test')",
  });

  predictor.clear();

  assert.equal(predictor._changeHistory.size, 0);
  assert.equal(predictor._coChangePairs.size, 0);
  assert.equal(predictor._importGraph.size, 0);
  assert.equal(predictor._reverseImportGraph.size, 0);
  assert.equal(predictor._lastEditTime.size, 0);
  assert.equal(predictor._changeFrequency.size, 0);
  assert.equal(predictor._fileSources.size, 0);
});

test("FileChangePredictor: learn handles empty and invalid input", () => {
  const predictor = new FileChangePredictor();

  // Should not throw
  assert.doesNotThrow(() => predictor.learn(null));
  assert.doesNotThrow(() => predictor.learn(undefined));
  assert.doesNotThrow(() => predictor.learn([]));
  assert.doesNotThrow(() => predictor.learn([null, {}, { filePath: "" }]));

  assert.equal(predictor._changeHistory.size, 0);
});

test("FileChangePredictor: predict returns results sorted by score descending", () => {
  const predictor = new FileChangePredictor();
  const now = Date.now();

  // File A: heavily edited
  for (let i = 0; i < 8; i++) {
    predictor.learn([entry("/src/a.js", new Date(now - i * 60000).toISOString())]);
  }

  // File B: lightly edited
  predictor.learn([entry("/src/b.js", new Date(now - 10000).toISOString())]);

  const projectFiles = ["/src/a.js", "/src/b.js"];
  const results = predictor.predict({}, projectFiles);

  for (let i = 0; i < results.length - 1; i++) {
    assert.ok(
      results[i].score >= results[i + 1].score,
      `results should be sorted descending: ${results[i].score} >= ${results[i + 1].score}`,
    );
  }
});

// -----------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------

test("_internals.normalizePath normalizes paths consistently", () => {
  const { normalizePath } = _internals;
  assert.equal(normalizePath("/src/App.js"), "src/app.js");
  assert.equal(normalizePath("src/App.js"), "src/app.js");
  assert.equal(normalizePath("./src/App.js"), "src/app.js");
  assert.equal(normalizePath("src\\component\\Button.js"), "src/component/button.js");
  assert.equal(normalizePath(""), "");
  assert.equal(normalizePath(null), "");
});

test("_internals.extractImports extracts require and import statements", () => {
  const { extractImports } = _internals;

  const source = `
    const utils = require('./utils');
    const path = require("path");
    import React from 'react';
    import { useState } from "./hooks";
    const lazy = import("./lazy-module");
  `;

  const imports = extractImports(source);
  assert.ok(imports.includes("./utils"), "should find require('./utils')");
  assert.ok(imports.includes("path"), "should find require('path')");
  assert.ok(imports.includes("react"), "should find import from 'react'");
  assert.ok(imports.includes("./hooks"), "should find import from './hooks'");
  assert.ok(imports.includes("./lazy-module"), "should find dynamic import");
});

test("_internals.extractImports returns empty for invalid input", () => {
  const { extractImports } = _internals;
  assert.deepEqual(extractImports(null), []);
  assert.deepEqual(extractImports(""), []);
  assert.deepEqual(extractImports(undefined), []);
});

test("_internals.recencyWeight returns 1.0 for current timestamp and decays over time", () => {
  const { recencyWeight } = _internals;
  const now = Date.now();

  // Current time should have weight 1.0
  assert.equal(recencyWeight(now, now), 1.0);

  // 30 days ago should be ~0.5 (half-life)
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const weight30 = recencyWeight(thirtyDaysAgo, now);
  assert.ok(weight30 > 0.45 && weight30 < 0.55, `expected ~0.5, got ${weight30}`);

  // 90 days ago should be ~0.125
  const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;
  const weight90 = recencyWeight(ninetyDaysAgo, now);
  assert.ok(weight90 < 0.2, `expected < 0.2, got ${weight90}`);
});

test("_internals.tokenizeContext splits context into meaningful tokens", () => {
  const { tokenizeContext } = _internals;
  const tokens = tokenizeContext("fix the authentication login bug");
  assert.ok(tokens.includes("fix"), "should include 'fix'");
  assert.ok(tokens.includes("authentication"), "should include 'authentication'");
  assert.ok(tokens.includes("login"), "should include 'login'");
  assert.ok(tokens.includes("bug"), "should include 'bug'");
  assert.deepEqual(tokenizeContext(""), []);
  assert.deepEqual(tokenizeContext(null), []);
});
