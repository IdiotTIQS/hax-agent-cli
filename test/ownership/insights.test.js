"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { OwnershipTracker } = require("../../src/ownership/tracker");
const { BlameEngine } = require("../../src/ownership/blame");
const { OwnershipInsights } = require("../../src/ownership/insights");

test("OwnershipInsights: constructor requires OwnershipTracker instance", () => {
  assert.throws(() => new OwnershipInsights(null), {
    message: "OwnershipInsights requires an OwnershipTracker instance",
  });
  assert.throws(() => new OwnershipInsights({}), {
    message: "OwnershipInsights requires an OwnershipTracker instance",
  });

  const tracker = new OwnershipTracker();
  const insights = new OwnershipInsights(tracker);
  assert.ok(insights);
});

test("OwnershipInsights: constructor accepts optional BlameEngine", () => {
  const tracker = new OwnershipTracker();
  const blame = new BlameEngine(tracker);
  const insights = new OwnershipInsights(tracker, blame);
  assert.ok(insights);
  assert.equal(insights._blame, blame);
});

test("OwnershipInsights: getKnowledgeMap returns structured author-directory mapping", () => {
  const tracker = new OwnershipTracker();

  tracker.recordChange("src/core/engine.js", "agent-a");
  tracker.recordChange("src/core/engine.js", "agent-a");
  tracker.recordChange("src/core/parser.js", "agent-b");
  tracker.recordChange("src/ui/renderer.js", "agent-c");
  tracker.recordChange("src/ui/renderer.js", "agent-c");
  tracker.recordChange("src/ui/renderer.js", "agent-c");
  tracker.recordChange("src/ui/renderer.js", "agent-a");

  const insights = new OwnershipInsights(tracker);
  const map = insights.getKnowledgeMap();

  // Check byAuthor
  assert.ok(map.byAuthor);
  assert.ok(map.byAuthor["agent-a"]);
  const aEntries = map.byAuthor["agent-a"];
  assert.ok(aEntries.length >= 1);

  // Check byDirectory
  assert.ok(map.byDirectory);
  assert.ok(map.byDirectory["src/core"]);
  assert.ok(map.byDirectory["src/ui"]);

  // Check authorExpertise
  assert.ok(map.authorExpertise);
  assert.ok(map.authorExpertise["agent-c"]);
  // agent-c should have expertise in src/ui
  assert.ok(map.authorExpertise["agent-c"].directories["src/ui"]);
  assert.equal(map.authorExpertise["agent-c"].directories["src/ui"].fileCount, 1);
});

test("OwnershipInsights: getKnowledgeMap handles root-level files", () => {
  const tracker = new OwnershipTracker();
  tracker.recordChange("README.md", "agent-a");
  tracker.recordChange("package.json", "agent-b");

  const insights = new OwnershipInsights(tracker);
  const map = insights.getKnowledgeMap();

  assert.ok(map.byDirectory["(root)"]);
  const rootFiles = map.byDirectory["(root)"];
  assert.equal(rootFiles.length, 2);
});

test("OwnershipInsights: identifyBusFactor finds files with single contributor", () => {
  const tracker = new OwnershipTracker();

  // File with single contributor (bus factor risk)
  tracker.recordChange("src/critical.js", "agent-x");
  tracker.recordChange("src/critical.js", "agent-x");
  tracker.recordChange("src/critical.js", "agent-x");

  // File with multiple contributors (no bus factor risk)
  tracker.recordChange("src/safe.js", "agent-a");
  tracker.recordChange("src/safe.js", "agent-b");

  const insights = new OwnershipInsights(tracker);
  const busFactors = insights.identifyBusFactor();

  assert.equal(busFactors.length, 1);
  assert.equal(busFactors[0].filePath, "src/critical.js");
  assert.equal(busFactors[0].soleContributor, "agent-x");
  assert.equal(busFactors[0].changeCount, 3);
  assert.ok(busFactors[0].risk);
});

test("OwnershipInsights: identifyBusFactor assigns risk levels by change count", () => {
  const tracker = new OwnershipTracker();

  // Critical: 20+ changes by single author
  for (let i = 0; i < 25; i++) {
    tracker.recordChange("src/critical.js", "agent-x");
  }

  // Low: < 5 changes by single author
  tracker.recordChange("src/low.js", "agent-y");
  tracker.recordChange("src/low.js", "agent-y");

  const insights = new OwnershipInsights(tracker);
  const busFactors = insights.identifyBusFactor();

  const critical = busFactors.find((f) => f.filePath === "src/critical.js");
  const low = busFactors.find((f) => f.filePath === "src/low.js");

  assert.ok(critical);
  assert.equal(critical.risk, "critical");

  assert.ok(low);
  assert.equal(low.risk, "low");

  // Critical should come before low
  assert.ok(
    busFactors.indexOf(critical) < busFactors.indexOf(low)
  );
});

test("OwnershipInsights: identifyBusFactor accepts optional file subset", () => {
  const tracker = new OwnershipTracker();

  tracker.recordChange("src/a.js", "agent-x");
  tracker.recordChange("src/b.js", "agent-y");

  const insights = new OwnershipInsights(tracker);
  const busFactors = insights.identifyBusFactor(["src/a.js"]);

  assert.equal(busFactors.length, 1);
  assert.equal(busFactors[0].filePath, "src/a.js");
});

test("OwnershipInsights: identifyOrphans finds files with no or low changes", () => {
  const tracker = new OwnershipTracker();

  // File with sufficient changes (not orphan)
  tracker.recordChange("src/active.js", "agent-a");
  tracker.recordChange("src/active.js", "agent-a");
  tracker.recordChange("src/active.js", "agent-b");

  // File with single low change (orphan at threshold 2)
  tracker.recordChange("src/neglected.js", "agent-c");

  const insights = new OwnershipInsights(tracker);
  const orphans = insights.identifyOrphans({ threshold: 2 });

  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].filePath, "src/neglected.js");
  assert.equal(orphans[0].totalChanges, 1);
  assert.ok(orphans[0].reason.includes("below threshold"));
});

test("OwnershipInsights: identifyOrphans returns all files as orphans at high threshold", () => {
  const tracker = new OwnershipTracker();

  tracker.recordChange("src/a.js", "agent-x");
  tracker.recordChange("src/b.js", "agent-y");
  tracker.recordChange("src/b.js", "agent-y");

  const insights = new OwnershipInsights(tracker);
  const orphans = insights.identifyOrphans({ threshold: 10 });

  // At threshold 10, files with max 1 and max 2 changes should be orphans
  assert.equal(orphans.length, 2);
});

test("OwnershipInsights: getContributionStats returns comprehensive author summary", () => {
  const tracker = new OwnershipTracker();

  const t1 = new Date(Date.now() - 10000).toISOString();
  const t2 = new Date().toISOString();

  tracker.recordChange("src/core/engine.js", "agent-a", {
    type: "added",
    timestamp: t1,
    message: "initial commit",
  });
  tracker.recordChange("src/core/parser.js", "agent-a", {
    type: "added",
    timestamp: t1,
  });
  tracker.recordChange("src/core/engine.js", "agent-a", {
    type: "modified",
    timestamp: t2,
    message: "refactor",
  });
  tracker.recordChange("src/ui/header.js", "agent-a", {
    type: "added",
    timestamp: t2,
  });

  const insights = new OwnershipInsights(tracker);
  const stats = insights.getContributionStats("agent-a");

  assert.equal(stats.author, "agent-a");
  assert.equal(stats.totalChanges, 4);
  assert.equal(stats.filesTouched, 3);
  assert.ok(stats.firstChange);
  assert.ok(stats.lastChange);
  assert.deepEqual(stats.changeTypes, { added: 3, modified: 1 });

  // Check directories
  assert.ok(stats.directories["src/core"]);
  assert.equal(stats.directories["src/core"], 3);
  assert.equal(stats.directories["src/ui"], 1);

  // Check top files
  assert.equal(stats.topFiles.length, 3);
  assert.equal(stats.topFiles[0].filePath, "src/core/engine.js");
  assert.equal(stats.topFiles[0].changeCount, 2);
});

test("OwnershipInsights: getContributionStats returns empty stats for unknown author", () => {
  const tracker = new OwnershipTracker();
  tracker.recordChange("src/a.js", "agent-a");

  const insights = new OwnershipInsights(tracker);
  const stats = insights.getContributionStats("agent-z");

  assert.equal(stats.author, "agent-z");
  assert.equal(stats.totalChanges, 0);
  assert.equal(stats.filesTouched, 0);
  assert.equal(stats.ownedFiles, 0);
  assert.equal(stats.firstChange, null);
  assert.equal(stats.lastChange, null);
  assert.deepEqual(stats.changeTypes, {});
  assert.deepEqual(stats.topFiles, []);
});

test("OwnershipInsights: generateOwnershipReport produces comprehensive report", () => {
  const tracker = new OwnershipTracker();

  // agent-a owns multiple files
  tracker.recordChange("src/core/module.js", "agent-a");
  tracker.recordChange("src/core/module.js", "agent-a");
  tracker.recordChange("src/core/helpers.js", "agent-a");

  // agent-b has single owner file (bus factor)
  tracker.recordChange("src/secret/solo.js", "agent-b");
  tracker.recordChange("src/secret/solo.js", "agent-b");
  tracker.recordChange("src/secret/solo.js", "agent-b");

  // Shared file
  tracker.recordChange("src/shared/utils.js", "agent-a");
  tracker.recordChange("src/shared/utils.js", "agent-b");

  const insights = new OwnershipInsights(tracker);
  const report = insights.generateOwnershipReport();

  // Summary
  assert.equal(report.summary.totalFiles, 4);
  assert.equal(report.summary.totalAuthors, 2);
  assert.equal(report.summary.totalChanges, 8);

  // Bus factor
  assert.ok(report.busFactorRisks);
  assert.equal(typeof report.busFactorRisks.critical, "number");
  assert.equal(typeof report.busFactorRisks.high, "number");
  assert.equal(typeof report.busFactorRisks.medium, "number");
  assert.equal(typeof report.busFactorRisks.low, "number");

  // Orphans
  assert.equal(typeof report.orphans, "number");

  // Top authors
  assert.ok(report.topAuthors.length >= 1);

  // Most changed files
  assert.ok(report.mostChangedFiles.length >= 1);

  // Directory ownership
  assert.ok(report.directoryOwnership);

  // Knowledge transfer suggestions
  assert.ok(Array.isArray(report.knowledgeTransferSuggestions));

  // generatedAt
  assert.ok(report.generatedAt);
  assert.ok(new Date(report.generatedAt).getTime() > 0);
});

test("OwnershipInsights: suggestKnowledgeTransfer finds backup owners for bus factor files", () => {
  const tracker = new OwnershipTracker();

  // File with bus factor risk (sole contributor: agent-x)
  tracker.recordChange("src/components/Button.js", "agent-x");
  tracker.recordChange("src/components/Button.js", "agent-x");

  // Other files in same directory with different authors
  tracker.recordChange("src/components/Modal.js", "agent-y");
  tracker.recordChange("src/components/Modal.js", "agent-y");

  tracker.recordChange("src/components/Table.js", "agent-z");
  tracker.recordChange("src/components/Table.js", "agent-z");

  const insights = new OwnershipInsights(tracker);
  const suggestions = insights.suggestKnowledgeTransfer();

  // There should be a suggestion for Button.js (bus factor file)
  const buttonSuggestion = suggestions.find(
    (s) => s.filePath === "src/components/Button.js"
  );

  assert.ok(buttonSuggestion);
  assert.equal(buttonSuggestion.currentOwner, "agent-x");
  assert.ok(buttonSuggestion.suggestedBackups.length >= 1);

  // agent-y should be suggested as backup (contributes in same directory)
  const yBackup = buttonSuggestion.suggestedBackups.find(
    (b) => b.author === "agent-y"
  );
  assert.ok(yBackup);
  assert.ok(yBackup.relevanceScore > 0);

  // agent-z should also be suggested
  const zBackup = buttonSuggestion.suggestedBackups.find(
    (b) => b.author === "agent-z"
  );
  assert.ok(zBackup);
});

test("OwnershipInsights: suggestKnowledgeTransfer handles directories with no backup candidates", () => {
  const tracker = new OwnershipTracker();

  // All files in a directory have single contributor (same person)
  tracker.recordChange("src/isolated/FileA.js", "agent-solo");
  tracker.recordChange("src/isolated/FileB.js", "agent-solo");

  const insights = new OwnershipInsights(tracker);
  const suggestions = insights.suggestKnowledgeTransfer();

  // Should have bus factor entries but no backup suggestions
  // (everyone else in the directory is the same person)
  for (const s of suggestions) {
    if (s.filePath === "src/isolated/FileA.js") {
      // May have no backup candidates or only empty array
      assert.ok(Array.isArray(s.suggestedBackups));
      assert.equal(s.suggestedBackups.length, 0);
    }
  }
});
