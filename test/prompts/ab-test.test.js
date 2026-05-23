"use strict";

const { strict: assert } = require("node:assert");
const { describe, it, beforeEach } = require("node:test");

const { ABTestEngine } = require("../../src/prompts/ab-test");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run N trials where a specific variant always gets high scores and the
 * rest get low scores.  The winnerName must match an actual variant name
 * so scores are correctly assigned regardless of random selection order.
 */
function populateBiasedTrials(engine, name, count, winnerName, gap) {
  const spread = gap || 0.35;
  for (let i = 0; i < count; i++) {
    const { variant, trialId } = engine.run(name, { iteration: i });
    if (variant.name === winnerName) {
      engine.recordScore(name, trialId, {
        successRate: 0.75 + spread,
        tokenEfficiency: 0.65 + spread,
        userSatisfaction: 0.80 + spread,
        toolAccuracy: 0.70 + spread,
      });
    } else {
      engine.recordScore(name, trialId, {
        successRate: 0.55 + Math.random() * 0.08,
        tokenEfficiency: 0.45 + Math.random() * 0.08,
        userSatisfaction: 0.50 + Math.random() * 0.08,
        toolAccuracy: 0.50 + Math.random() * 0.08,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ABTestEngine", () => {
  let engine;

  beforeEach(() => {
    engine = new ABTestEngine();
  });

  // -----------------------------------------------------------------------
  // createExperiment
  // -----------------------------------------------------------------------

  describe("createExperiment", () => {
    it("creates a valid experiment with two or more variants", () => {
      const exp = engine.createExperiment("tone-test", [
        { name: "formal", template: "Dear user, please note..." },
        { name: "casual", template: "Hey there!" },
      ]);

      assert.ok(exp);
      assert.strictEqual(exp.name, "tone-test");
      assert.strictEqual(exp.variants.length, 2);
      assert.strictEqual(exp.active, true);
      assert.ok(typeof exp.createdAt === "number");
    });

    it("throws when fewer than 2 variants are supplied", () => {
      assert.throws(
        () => engine.createExperiment("solo", [{ name: "only", template: "..." }]),
        /at least 2 variants/
      );
    });

    it("throws on duplicate experiment names", () => {
      engine.createExperiment("dup", [
        { name: "a", template: "Template A" },
        { name: "b", template: "Template B" },
      ]);
      assert.throws(
        () =>
          engine.createExperiment("dup", [
            { name: "a", template: "A" },
            { name: "b", template: "B" },
          ]),
        /already exists/
      );
    });

    it("throws on duplicate variant names within an experiment", () => {
      assert.throws(
        () =>
          engine.createExperiment("dups", [
            { name: "x", template: "X" },
            { name: "x", template: "X" },
          ]),
        /Duplicate variant name/
      );
    });

    it("throws when a variant is missing a name", () => {
      assert.throws(
        () =>
          engine.createExperiment("no-name", [
            { template: "no name" },
            { name: "ok", template: "OK" },
          ]),
        /must have a string "name"/
      );
    });

    it("throws when a variant is missing a template", () => {
      assert.throws(
        () =>
          engine.createExperiment("no-tpl", [
            { name: "a", template: "A" },
            { name: "b" },
          ]),
        /requires a string "template"/
      );
    });

    it("accepts optional experiment-level weight overrides", () => {
      const exp = engine.createExperiment(
        "weighted",
        [
          { name: "v1", template: "T1" },
          { name: "v2", template: "T2" },
        ],
        { weights: { successRate: 0.6, tokenEfficiency: 0.1 } }
      );

      assert.strictEqual(exp.weights.successRate, 0.6);
      assert.strictEqual(exp.weights.tokenEfficiency, 0.1);
      // Dimensions not overridden fall back to defaults
      assert.strictEqual(exp.weights.userSatisfaction, 0.2);
      assert.strictEqual(exp.weights.toolAccuracy, 0.15);
    });

    it("accepts a seed for reproducible trial selection", () => {
      const exp = engine.createExperiment(
        "seeded",
        [
          { name: "a", template: "A" },
          { name: "b", template: "B" },
        ],
        { seed: 42 }
      );
      assert.strictEqual(exp.seed, 42);
    });
  });

  // -----------------------------------------------------------------------
  // run
  // -----------------------------------------------------------------------

  describe("run", () => {
    it("returns selected variant and trial ID", () => {
      engine.createExperiment("test", [
        { name: "v1", template: "T1" },
        { name: "v2", template: "T2" },
      ]);

      const result = engine.run("test", { userId: "abc" });
      assert.ok(result.variant);
      assert.ok(["v1", "v2"].includes(result.variant.name));
      assert.ok(typeof result.variant.template === "string");
      assert.strictEqual(result.trialId, 1);
      assert.strictEqual(result.experiment, "test");
    });

    it("increments trial IDs across multiple runs", () => {
      engine.createExperiment("t", [
        { name: "a", template: "A" },
        { name: "b", template: "B" },
      ]);

      const r1 = engine.run("t");
      const r2 = engine.run("t");
      const r3 = engine.run("t");

      assert.strictEqual(r1.trialId, 1);
      assert.strictEqual(r2.trialId, 2);
      assert.strictEqual(r3.trialId, 3);
    });

    it("throws for unknown experiment", () => {
      assert.throws(() => engine.run("nonexistent"), /not found/);
    });

    it("throws for inactive experiment", () => {
      engine.createExperiment("inactive", [
        { name: "x", template: "X" },
        { name: "y", template: "Y" },
      ]);
      engine.deactivateExperiment("inactive");
      assert.throws(() => engine.run("inactive"), /no longer active/);
    });

    it("respects variant weights in selection (deterministic with seed)", () => {
      // Use a seed so we can assert on distribution
      const seeded = new ABTestEngine();
      seeded.createExperiment(
        "weighted",
        [
          { name: "heavy", template: "H", weight: 9 },
          { name: "light", template: "L", weight: 1 },
        ],
        { seed: 123 }
      );

      const counts = { heavy: 0, light: 0 };
      for (let i = 0; i < 100; i++) {
        const { variant } = seeded.run("weighted");
        counts[variant.name]++;
      }

      // Heavy variant should be chosen much more often
      assert.ok(counts.heavy > 60, `Expected heavy > 60, got ${counts.heavy}`);
      assert.ok(counts.light < 40, `Expected light < 40, got ${counts.light}`);
    });
  });

  // -----------------------------------------------------------------------
  // recordScore
  // -----------------------------------------------------------------------

  describe("recordScore", () => {
    it("records and clamps scores to [0, 1]", () => {
      engine.createExperiment("scores", [
        { name: "a", template: "A" },
        { name: "b", template: "B" },
      ]);

      const { trialId } = engine.run("scores");
      const updated = engine.recordScore("scores", trialId, {
        successRate: 1.5,
        tokenEfficiency: -0.3,
        userSatisfaction: 0.75,
        toolAccuracy: 0.6,
      });

      assert.strictEqual(updated.scores.successRate, 1);
      assert.strictEqual(updated.scores.tokenEfficiency, 0);
      assert.strictEqual(updated.scores.userSatisfaction, 0.75);
      assert.strictEqual(updated.scores.toolAccuracy, 0.6);
    });

    it("throws when recording scores twice for the same trial", () => {
      engine.createExperiment("double", [
        { name: "a", template: "A" },
        { name: "b", template: "B" },
      ]);

      const { trialId } = engine.run("double");
      engine.recordScore("double", trialId, { successRate: 0.8 });
      assert.throws(
        () => engine.recordScore("double", trialId, { successRate: 0.9 }),
        /already has scores/
      );
    });

    it("throws for unknown trial ID", () => {
      engine.createExperiment("t", [
        { name: "a", template: "A" },
        { name: "b", template: "B" },
      ]);

      assert.throws(
        () => engine.recordScore("t", 999, { successRate: 1 }),
        /not found/
      );
    });

    it("allows partial scores — records only provided dimensions", () => {
      engine.createExperiment("partial", [
        { name: "x", template: "X" },
        { name: "y", template: "Y" },
      ]);

      const { trialId } = engine.run("partial");
      const updated = engine.recordScore("partial", trialId, {
        successRate: 0.9,
      });

      assert.strictEqual(updated.scores.successRate, 0.9);
      assert.strictEqual(updated.scores.tokenEfficiency, undefined);
    });
  });

  // -----------------------------------------------------------------------
  // getResults
  // -----------------------------------------------------------------------

  describe("getResults", () => {
    it("computes per-variant statistics from scored trials", () => {
      engine.createExperiment("stats", [
        { name: "winner", template: "W" },
        { name: "loser", template: "L" },
      ]);

      populateBiasedTrials(engine, "stats", 60, "winner", 0.35);

      const results = engine.getResults("stats");
      assert.strictEqual(results.experiment, "stats");
      assert.strictEqual(results.totalTrials, 60);
      assert.strictEqual(results.scoredTrials, 60);

      // The biased variant should rank higher
      assert.strictEqual(results.variants[0].name, "winner");
      assert.ok(
        results.variants[0].compositeMean > results.variants[1].compositeMean,
        `Expected winner (${results.variants[0].compositeMean}) > loser (${results.variants[1].compositeMean})`
      );
    });

    it("includes pairwise comparisons", () => {
      engine.createExperiment("pair", [
        { name: "a", template: "A" },
        { name: "b", template: "B" },
        { name: "c", template: "C" },
      ]);

      populateBiasedTrials(engine, "pair", 60, "a", 0.25);

      const results = engine.getResults("pair");
      assert.ok(Array.isArray(results.pairwiseComparisons));
      // 3 variants => 3 pairwise comparisons
      assert.strictEqual(results.pairwiseComparisons.length, 3);
    });

    it("handles unscored trials gracefully", () => {
      engine.createExperiment("unscored", [
        { name: "v1", template: "T1" },
        { name: "v2", template: "T2" },
      ]);

      engine.run("unscored");
      engine.run("unscored");
      // No scores recorded

      const results = engine.getResults("unscored");
      assert.strictEqual(results.totalTrials, 2);
      assert.strictEqual(results.scoredTrials, 0);
      // Variants should have zero composite mean
      for (const v of results.variants) {
        assert.strictEqual(v.compositeMean, 0);
      }
    });

    it("throws for unknown experiment", () => {
      assert.throws(() => engine.getResults("nope"), /not found/);
    });
  });

  // -----------------------------------------------------------------------
  // getWinner
  // -----------------------------------------------------------------------

  describe("getWinner", () => {
    it("returns null when there are insufficient trials", () => {
      engine.createExperiment("early", [
        { name: "a", template: "A" },
        { name: "b", template: "B" },
      ]);

      // Only 2 trials recorded
      const { trialId: t1 } = engine.run("early");
      engine.recordScore("early", t1, { successRate: 0.8 });
      const { trialId: t2 } = engine.run("early");
      engine.recordScore("early", t2, { successRate: 0.5 });

      assert.strictEqual(engine.getWinner("early"), null);
    });

    it("returns null when no variant is statistically better", () => {
      engine.createExperiment("tie", [
        { name: "a", template: "A" },
        { name: "b", template: "B" },
      ]);

      // Both variants get very similar scores — should not produce a winner
      for (let i = 0; i < 30; i++) {
        const { trialId } = engine.run("tie");
        engine.recordScore("tie", trialId, {
          successRate: 0.7 + (Math.random() - 0.5) * 0.04,
          tokenEfficiency: 0.6 + (Math.random() - 0.5) * 0.04,
          userSatisfaction: 0.7 + (Math.random() - 0.5) * 0.04,
          toolAccuracy: 0.6 + (Math.random() - 0.5) * 0.04,
        });
      }

      const winner = engine.getWinner("tie");
      // With near-identical scores we should not get a definitive winner
      // (p-value will be above significance threshold)
      assert.strictEqual(winner, null);
    });

    it("identifies a winner when there is a clear gap with enough trials", () => {
      // Use an engine with a relaxed minimum-trial requirement
      const e2 = new ABTestEngine({ minTrialsPerVariant: 5, significanceLevel: 0.05 });
      e2.createExperiment("clear", [
        { name: "best", template: "B" },
        { name: "worst", template: "W" },
        { name: "middle", template: "M" },
      ]);

      populateBiasedTrials(e2, "clear", 300, "best", 0.4);

      const winner = e2.getWinner("clear");
      // With strong bias and many trials, should have a winner
      assert.ok(winner !== null, "Expected a winner to be declared");
      if (winner) {
        assert.strictEqual(winner.winner, "best");
        assert.strictEqual(winner.experiment, "clear");
        assert.ok(winner.compositeMean > 0);
        assert.ok(Array.isArray(winner.pValues));
      }
    });

    it("returns null when experiment not found", () => {
      assert.strictEqual(engine.getWinner("ghost"), null);
    });
  });

  // -----------------------------------------------------------------------
  // getAllExperiments
  // -----------------------------------------------------------------------

  describe("getAllExperiments", () => {
    it("returns empty array when no experiments exist", () => {
      const all = engine.getAllExperiments();
      assert.ok(Array.isArray(all));
      assert.strictEqual(all.length, 0);
    });

    it("returns summaries of all experiments", () => {
      engine.createExperiment("exp1", [
        { name: "v1", template: "T1" },
        { name: "v2", template: "T2" },
      ]);
      engine.createExperiment("exp2", [
        { name: "a", template: "A" },
        { name: "b", template: "B" },
        { name: "c", template: "C" },
      ]);

      const all = engine.getAllExperiments();
      assert.strictEqual(all.length, 2);

      const e1 = all.find((e) => e.name === "exp1");
      const e2 = all.find((e) => e.name === "exp2");

      assert.ok(e1);
      assert.strictEqual(e1.variantCount, 2);
      assert.ok(e2);
      assert.strictEqual(e2.variantCount, 3);
    });
  });

  // -----------------------------------------------------------------------
  // activate / deactivate
  // -----------------------------------------------------------------------

  describe("deactivateExperiment / reactivateExperiment", () => {
    it("deactivates an experiment so run() throws", () => {
      engine.createExperiment("d", [
        { name: "x", template: "X" },
        { name: "y", template: "Y" },
      ]);

      engine.deactivateExperiment("d");
      const all = engine.getAllExperiments();
      const exp = all.find((e) => e.name === "d");
      assert.strictEqual(exp.active, false);
    });

    it("reactivates a previously deactivated experiment", () => {
      engine.createExperiment("re", [
        { name: "a", template: "A" },
        { name: "b", template: "B" },
      ]);

      engine.deactivateExperiment("re");
      engine.reactivateExperiment("re");

      // Should now succeed
      const { trialId } = engine.run("re");
      assert.strictEqual(trialId, 1);
    });

    it("throws deactivating unknown experiment", () => {
      assert.throws(() => engine.deactivateExperiment("ghost"), /not found/);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe("edge cases", () => {
    it("handles zero-length template string", () => {
      const exp = engine.createExperiment("empty-tpl", [
        { name: "valid", template: "ok" },
        { name: "blank", template: "" },
      ]);
      assert.ok(exp);
      assert.strictEqual(exp.variants[1].template, "");
    });

    it("handles many variants", () => {
      const variants = [];
      for (let i = 0; i < 20; i++) {
        variants.push({ name: `v${i}`, template: `Template ${i}` });
      }
      engine.createExperiment("many", variants);

      // Run a few trials — should not crash
      for (let i = 0; i < 40; i++) {
        const { trialId } = engine.run("many");
        engine.recordScore("many", trialId, {
          successRate: Math.random(),
          tokenEfficiency: Math.random(),
        });
      }

      const results = engine.getResults("many");
      assert.strictEqual(results.variants.length, 20);
    });

    it("scoring ignores non-numeric values", () => {
      engine.createExperiment("bad-scores", [
        { name: "v1", template: "1" },
        { name: "v2", template: "2" },
      ]);

      const { trialId } = engine.run("bad-scores");
      engine.recordScore("bad-scores", trialId, {
        successRate: "high", // string, should be ignored
        tokenEfficiency: null,
        userSatisfaction: undefined,
        toolAccuracy: 0.5,
      });

      const results = engine.getResults("bad-scores");
      const variant = results.variants[0];
      // toolAccuracy dimension should have a value
      if (variant.name === "v1") {
        assert.ok(variant.dimensions.toolAccuracy.mean >= 0);
      }
    });

    it("handles empty string and null context in run()", () => {
      engine.createExperiment("ctx", [
        { name: "a", template: "A" },
        { name: "b", template: "B" },
      ]);

      // These should not throw
      const r1 = engine.run("ctx", null);
      const r2 = engine.run("ctx", undefined);
      const r3 = engine.run("ctx", {});
      const r4 = engine.run("ctx");

      assert.ok(r1.trialId);
      assert.ok(r2.trialId);
      assert.ok(r3.trialId);
      assert.ok(r4.trialId);
    });

    it("seeded engine produces deterministic trial sequences", () => {
      const e1 = new ABTestEngine();
      e1.createExperiment(
        "det",
        [
          { name: "a", template: "A" },
          { name: "b", template: "B" },
        ],
        { seed: 999 }
      );

      const e2 = new ABTestEngine();
      e2.createExperiment(
        "det",
        [
          { name: "a", template: "A" },
          { name: "b", template: "B" },
        ],
        { seed: 999 }
      );

      const seq1 = [];
      const seq2 = [];
      for (let i = 0; i < 20; i++) {
        seq1.push(e1.run("det").variant.name);
        seq2.push(e2.run("det").variant.name);
      }

      assert.deepStrictEqual(seq1, seq2);
    });
  });
});
