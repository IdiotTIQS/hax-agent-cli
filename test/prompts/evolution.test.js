"use strict";

const { strict: assert } = require("node:assert");
const { describe, it, beforeEach } = require("node:test");

const { PromptEvolution } = require("../../src/prompts/evolution");

const SEED_PROMPT = [
  "# Task: Code Review",
  "You are a code reviewer.",
  "## Instructions",
  "Review code for bugs.",
  "## Output",
  "Provide findings.",
].join("\n");

describe("PromptEvolution", () => {
  let evolver;

  beforeEach(() => {
    evolver = new PromptEvolution({ seed: SEED_PROMPT });
  });

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  describe("constructor", () => {
    it("stores the seed prompt", () => {
      assert.strictEqual(evolver.seed, SEED_PROMPT);
    });

    it("has sensible defaults", () => {
      assert.ok(evolver.populationSize >= 2);
      assert.ok(evolver.survivors >= 1);
      assert.ok(evolver.mutationRate > 0 && evolver.mutationRate <= 1);
    });

    it("accepts custom configuration", () => {
      const custom = new PromptEvolution({
        seed: "Custom seed",
        populationSize: 10,
        survivors: 3,
        mutationRate: 0.6,
        strategies: ["rephrase", "simplify"],
      });

      assert.strictEqual(custom.seed, "Custom seed");
      assert.strictEqual(custom.populationSize, 10);
      assert.strictEqual(custom.survivors, 3);
      assert.strictEqual(custom.mutationRate, 0.6);
    });
  });

  // -----------------------------------------------------------------------
  // mutate
  // -----------------------------------------------------------------------

  describe("mutate", () => {
    it("throws for non-string input", () => {
      assert.throws(
        () => evolver.mutate(null, "rephrase"),
        /prompt must be a string/
      );
    });

    it("throws for unknown strategy", () => {
      assert.throws(
        () => evolver.mutate("Hello", "nonexistent"),
        /unknown strategy/
      );
    });

    describe("rephrase", () => {
      it("produces a different string", () => {
        const result = evolver.mutate(SEED_PROMPT, "rephrase");
        assert.notStrictEqual(result, SEED_PROMPT);
      });

      it("still contains the original heading", () => {
        const result = evolver.mutate(SEED_PROMPT, "rephrase");
        assert.ok(result.includes("Task: Code Review"));
      });
    });

    describe("restructure", () => {
      it("produces a different ordering of sections", () => {
        const result = evolver.mutate(SEED_PROMPT, "restructure");
        // Should still contain the same lines, possibly reordered
        assert.ok(result.includes("Code Review"));
      });

      it("returns the prompt unchanged when there are fewer than two headings", () => {
        const flat = "Just a plain prompt with no headings.";
        const result = evolver.mutate(flat, "restructure");
        assert.strictEqual(result, flat);
      });
    });

    describe("addDetail", () => {
      it("appends additional content", () => {
        const result = evolver.mutate(SEED_PROMPT, "addDetail");
        assert.ok(result.length > SEED_PROMPT.length);
        assert.ok(result.startsWith(SEED_PROMPT));
      });
    });

    describe("simplify", () => {
      it("removes decorative separators", () => {
        const withDecor = "Hello\n---\nWorld\n***\nEnd";
        const result = evolver.mutate(withDecor, "simplify");
        assert.ok(!result.includes("---"));
        assert.ok(!result.includes("***"));
      });

      it("compacts runs of blank lines", () => {
        const withGaps = "Line 1\n\n\n\nLine 2";
        const result = evolver.mutate(withGaps, "simplify");
        const blankCount = (result.match(/\n\n/g) || []).length;
        // One blank line means \nLine 1\n\nLine 2\n  (one double newline)
        assert.ok(blankCount <= 1);
      });
    });

    describe("specialize", () => {
      it("injects domain-specific instructions", () => {
        const result = evolver.mutate(SEED_PROMPT, "specialize");
        assert.ok(result.includes("Domain Specialization"));
        // Should include one of the known domains
        const knownDomains = ["React", "Python backend", "DevOps", "SQL databases", "REST APIs", "security auditing"];
        const found = knownDomains.some((d) => result.includes(d));
        assert.ok(found);
      });
    });
  });

  // -----------------------------------------------------------------------
  // select
  // -----------------------------------------------------------------------

  describe("select", () => {
    it("returns the best-scoring prompts", () => {
      const population = ["A", "B", "C", "D"];
      const scores = [0.1, 0.9, 0.5, 0.3];

      const result = evolver.select(population, scores, 2);

      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].prompt, "B");
      assert.strictEqual(result[0].score, 0.9);
      assert.strictEqual(result[0].rank, 1);
      assert.strictEqual(result[1].prompt, "C");
      assert.strictEqual(result[1].score, 0.5);
      assert.strictEqual(result[1].rank, 2);
    });

    it("throws when arrays have different lengths", () => {
      assert.throws(
        () => evolver.select(["A", "B"], [0.5]),
        /must match/
      );
    });

    it("returns at least one survivor even when topN is 0", () => {
      const result = evolver.select(["A", "B", "C"], [0.3, 0.7, 0.5], 0);
      assert.ok(result.length >= 1);
    });

    it("handles ties by preserving input order", () => {
      // sort is stable in modern Node
      const result = evolver.select(["X", "Y"], [0.5, 0.5], 2);
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].prompt, "X");
      assert.strictEqual(result[1].prompt, "Y");
    });
  });

  // -----------------------------------------------------------------------
  // breed
  // -----------------------------------------------------------------------

  describe("breed", () => {
    it("combines two parents into a child", () => {
      const parentA = "First part\n# Middle\nEnd A";
      const parentB = "Start B\n# Divide\nLast part";

      const child = evolver.breed(parentA, parentB);

      // Child should contain content from both parents
      assert.ok(typeof child === "string");
      assert.ok(child.length > 0);
    });

    it("throws when a parent is not a string", () => {
      assert.throws(
        () => evolver.breed(null, "valid"),
        /both parents must be strings/
      );
      assert.throws(
        () => evolver.breed("valid", 123),
        /both parents must be strings/
      );
    });

    it("splits on heading boundaries for structured prompts", () => {
      const parentA = [
        "# Section 1",
        "Content A1",
        "## Sub 1a",
        "Content A2",
        "# Section 2",
        "Content A3",
      ].join("\n");

      const parentB = [
        "# Section X",
        "Content B1",
        "# Section Y",
        "Content B2",
      ].join("\n");

      const child = evolver.breed(parentA, parentB);

      // Should contain at least parts of each parent
      assert.ok(child.length > 0);
      assert.notStrictEqual(child, parentA);
      assert.notStrictEqual(child, parentB);
    });
  });

  // -----------------------------------------------------------------------
  // evolve
  // -----------------------------------------------------------------------

  describe("evolve", () => {
    it("returns a string after evolution", async () => {
      // Simple evaluator: longer prompts score slightly higher
      const evaluator = async (prompt) => prompt.length;

      const result = await evolver.evolve(3, evaluator);

      assert.ok(typeof result === "string");
      assert.ok(result.length > 0);
    });

    it("throws for invalid generations", async () => {
      await assert.rejects(
        () => evolver.evolve(0, async () => 1),
        /generations must be a positive integer/
      );
    });

    it("throws for non-function evaluator", async () => {
      await assert.rejects(
        () => evolver.evolve(3, "not a function"),
        /evaluator must be a function/
      );
    });

    it("preserves lineage records during evolution", async () => {
      const evaluator = async (prompt) => prompt.length;

      await evolver.evolve(2, evaluator);

      const allLineage = evolver.getAllLineage();
      assert.ok(allLineage.size > 0);

      // Seed should have generation 0
      const seedEntry = evolver.getLineage(SEED_PROMPT);
      assert.ok(seedEntry);
      assert.strictEqual(seedEntry.generation, 0);
      assert.deepStrictEqual(seedEntry.parents, []);
    });
  });

  // -----------------------------------------------------------------------
  // getLineage
  // -----------------------------------------------------------------------

  describe("getLineage", () => {
    it("returns null for an unknown prompt", () => {
      assert.strictEqual(evolver.getLineage("unknown prompt"), null);
    });

    it("returns lineage with parents and generation", async () => {
      const evaluator = async (prompt) => prompt.length;
      await evolver.evolve(2, evaluator);

      const seedInfo = evolver.getLineage(SEED_PROMPT);
      assert.ok(seedInfo);
      assert.ok(Array.isArray(seedInfo.parents));
      assert.strictEqual(seedInfo.generation, 0);
      assert.strictEqual(seedInfo.prompt, SEED_PROMPT);
    });
  });
});
