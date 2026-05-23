"use strict";

const { strict: assert } = require("node:assert");
const { describe, it } = require("node:test");

const { PromptOptimizer, Strategy } = require("../../src/prompts/optimizer");
const { ABTestEngine } = require("../../src/prompts/ab-test");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Make a synthetic history array to drive improvement suggestions.
 */
function makeHistory(count, bias) {
  const records = [];
  const factor = bias !== undefined ? bias : 0.7;
  for (let i = 0; i < count; i++) {
    records.push({
      context: { userId: `u${i}`, language: "JavaScript" },
      scores: {
        successRate: factor + (Math.random() - 0.5) * 0.2,
        tokenEfficiency: 0.5 + Math.random() * 0.3,
        userSatisfaction: factor + (Math.random() - 0.5) * 0.15,
        toolAccuracy: 0.6 + Math.random() * 0.2,
      },
      templateText: "template text here",
    });
  }
  return records;
}

/**
 * A deliberately verbose template string used across tests.
 */
const VERBOSE_TEMPLATE = [
  "# Task: Example Task",
  "",
  "In order to complete this task, you must perform the following actions in the appropriate manner.",
  "",
  "## Instructions",
  "",
  "It is important to note that due to the fact that this is a complex task, you should make sure that you handle errors appropriately when necessary and if possible, try to be as efficient as you can.",
  "",
  "Due to the fact that the system is distributed, with regard to state management you need to be careful and in the event that something goes wrong you should have a fallback strategy.",
  "",
  "At this point in time we require the majority of operations to complete within a timeout, and a number of services must be checked for health.",
  "",
  "## Output Format",
  "",
  "Output must be a valid JSON object with the appropriate fields.",
  "",
  "The following steps should be taken:",
  "- Step 1: Do the thing",
  "- Step 2: Validate the thing",
  "- Step 3: Report the thing",
  "",
  "",
  "",
  "",
  "",
].join("\n");

/**
 * A very long template (>2000 chars) guaranteed to trigger heuristic suggestions.
 */
const LONG_TEMPLATE = (() => {
  const base = [
    "# Task: Comprehensive System Audit",
    "",
    "You are an AI assistant tasked with performing a thorough review of the entire system.",
    "",
    "## Context",
    "",
    "The system consists of multiple interconnected modules that must be examined carefully.",
  ];
  // Pad to >2000 chars with repetitive content
  while (base.join("\n").length < 2200) {
    base.push(
      "- Analyze module behavior under various conditions including edge cases, error paths, and concurrency scenarios with particular attention to thread safety and resource cleanup procedures."
    );
  }
  return base.join("\n");
})();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PromptOptimizer", () => {
  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  describe("constructor", () => {
    it("creates an instance with default options", () => {
      const opt = new PromptOptimizer();
      assert.ok(opt instanceof PromptOptimizer);
      assert.ok(opt.getAbEngine() instanceof ABTestEngine);
    });

    it("accepts a custom ABTestEngine", () => {
      const ab = new ABTestEngine({ significanceLevel: 0.01 });
      const opt = new PromptOptimizer({ abEngine: ab });
      assert.strictEqual(opt.getAbEngine(), ab);
    });

    it("accepts a custom minImprovementThreshold", () => {
      const opt = new PromptOptimizer({ minImprovementThreshold: 0.1 });
      // We verify indirectly by not crashing; threshold is internal
      const suggestions = opt.suggestImprovements("a prompt", []);
      assert.ok(Array.isArray(suggestions));
    });

    it("accepts a subset of enabled strategies", () => {
      const opt = new PromptOptimizer({
        enabledStrategies: [Strategy.SHORTEN, Strategy.CLARIFY],
      });

      // Supply history so strategy methods are actually invoked
      const suggestions = opt.suggestImprovements(VERBOSE_TEMPLATE, makeHistory(10));
      const strategies = new Set(suggestions.map((s) => s.strategy));

      // Should only produce SHORTEN and CLARIFY suggestions
      for (const s of strategies) {
        assert.ok(
          s === Strategy.SHORTEN || s === Strategy.CLARIFY,
          `Unexpected strategy: ${s}`
        );
      }
    });
  });

  // -----------------------------------------------------------------------
  // suggestImprovements
  // -----------------------------------------------------------------------

  describe("suggestImprovements", () => {
    it("returns heuristic suggestions when no history is provided", () => {
      const opt = new PromptOptimizer();
      // Use a template >2000 chars to trigger the length-based heuristic
      const suggestions = opt.suggestImprovements(LONG_TEMPLATE, []);

      assert.ok(Array.isArray(suggestions));
      assert.ok(suggestions.length > 0, "Should have at least one suggestion");
    });

    it("returns suggestions sorted by estimated improvement (descending)", () => {
      const opt = new PromptOptimizer();
      const suggestions = opt.suggestImprovements(
        VERBOSE_TEMPLATE,
        makeHistory(20)
      );

      assert.ok(suggestions.length > 0);
      for (let i = 1; i < suggestions.length; i++) {
        assert.ok(
          suggestions[i - 1].estimatedImprovement >= suggestions[i].estimatedImprovement,
          `Suggestion at index ${i - 1} (${suggestions[i - 1].estimatedImprovement}) ` +
            `should be >= index ${i} (${suggestions[i].estimatedImprovement})`
        );
      }
    });

    it("detects and suggests shortening verbose phrases", () => {
      const opt = new PromptOptimizer({ enabledStrategies: [Strategy.SHORTEN] });
      // Supply history so strategy methods are invoked
      const suggestions = opt.suggestImprovements(VERBOSE_TEMPLATE, makeHistory(10));

      const shortenSuggestions = suggestions.filter(
        (s) => s.strategy === Strategy.SHORTEN
      );
      assert.ok(shortenSuggestions.length > 0, "Expected at least one SHORTEN suggestion");

      // At least one suggestion should have a concrete after-text
      const withAfter = shortenSuggestions.filter((s) => s.after !== s.before);
      assert.ok(withAfter.length > 0, "Expected at least one suggestion with concrete changes");
    });

    it("detects ambiguous language and suggests clarification", () => {
      const ambiguousTemplate = "You should handle errors appropriately and when possible, take the reasonable action.";
      const opt = new PromptOptimizer({ enabledStrategies: [Strategy.CLARIFY] });
      // Supply history so the CLARIFY strategy method is invoked
      const suggestions = opt.suggestImprovements(ambiguousTemplate, makeHistory(5));

      const clarifySuggestions = suggestions.filter(
        (s) => s.strategy === Strategy.CLARIFY
      );
      assert.ok(clarifySuggestions.length > 0, "Expected CLARIFY suggestions for ambiguous template");
    });

    it("identifies sections needing examples", () => {
      const noExampleTemplate = [
        "# Task: Something",
        "",
        "## Output Format",
        "",
        "The response must include a status field and a data field.",
        "",
        "## Rules",
        "- Rule A: Always validate input",
        "- Rule B: Never trust user data",
        "- Rule C: Always log errors",
      ].join("\n");

      const opt = new PromptOptimizer({ enabledStrategies: [Strategy.ADD_EXAMPLES] });
      // Supply history so the ADD_EXAMPLES strategy method is invoked
      const suggestions = opt.suggestImprovements(noExampleTemplate, makeHistory(5));

      const exampleSuggestions = suggestions.filter(
        (s) => s.strategy === Strategy.ADD_EXAMPLES
      );
      assert.ok(exampleSuggestions.length > 0, "Expected ADD_EXAMPLES suggestion for format section without examples");
    });

    it("suggests restructuring for long sections without sub-headings", () => {
      // Build a template with one very long section
      const longSection = [
        "# Task: Long Analysis",
        "",
        "## Detailed Process",
        "",
      ];

      // Add 30+ lines of body content without sub-headings
      for (let i = 1; i <= 35; i++) {
        longSection.push(`- Step ${i}: Execute operation number ${i} with precise care and attention to detail. Validate all inputs, check all outputs, and log every significant event.`);
      }

      const opt = new PromptOptimizer({ enabledStrategies: [Strategy.RESTRUCTURE] });
      // Supply history so the RESTRUCTURE strategy method is invoked
      const suggestions = opt.suggestImprovements(longSection.join("\n"), makeHistory(5));

      const restructureSuggestions = suggestions.filter(
        (s) => s.strategy === Strategy.RESTRUCTURE
      );
      assert.ok(restructureSuggestions.length > 0, "Expected RESTRUCTURE suggestion for long section");
    });

    it("suggests specialization for generic role descriptions", () => {
      const genericTemplate = "# Task: Review\n\nYou are an AI assistant. Your goal is to help. Review the provided code and give feedback.";
      const opt = new PromptOptimizer({ enabledStrategies: [Strategy.SPECIALIZE] });
      // Supply history so the SPECIALIZE strategy method is invoked
      const suggestions = opt.suggestImprovements(genericTemplate, makeHistory(5, 0.6));

      const specializeSuggestions = suggestions.filter(
        (s) => s.strategy === Strategy.SPECIALIZE
      );
      assert.ok(specializeSuggestions.length > 0, "Expected SPECIALIZE suggestions for generic role description");
    });

    it("handles a function template argument", () => {
      const templateFn = (ctx) => {
        return `# Task for ${ctx.language || "code"}\n\nIt is important to note that you should handle errors appropriately.`;
      };

      const opt = new PromptOptimizer();
      const suggestions = opt.suggestImprovements(templateFn, [], {
        context: { language: "Python" },
      });

      assert.ok(Array.isArray(suggestions));
      // At least one suggestion should reference the resolved text
      assert.ok(suggestions.length > 0);
    });

    it("handles string template without crashing", () => {
      const opt = new PromptOptimizer();
      const suggestions = opt.suggestImprovements("A simple prompt.", []);
      assert.ok(Array.isArray(suggestions));
    });
  });

  // -----------------------------------------------------------------------
  // autoTune
  // -----------------------------------------------------------------------

  describe("autoTune", () => {
    it("iteratively refines a template and returns tuning history", () => {
      const opt = new PromptOptimizer({
        enabledStrategies: [Strategy.SHORTEN],
        minImprovementThreshold: 0.001,
      });

      const result = opt.autoTune(VERBOSE_TEMPLATE, 3);

      assert.ok(typeof result.original === "string");
      assert.ok(typeof result.optimized === "string");
      assert.ok(result.iterations >= 0);
      assert.ok(Array.isArray(result.history));
      assert.ok(result.originalLength > 0);
      assert.ok(result.optimizedLength > 0);

      // If any iterations ran, verify reduction
      if (result.iterations > 0) {
        assert.ok(
          result.optimizedLength <= result.originalLength,
          "Optimized template should not be longer than original"
        );
      }
    });

    it("stops early when no improvement meets threshold", () => {
      const opt = new PromptOptimizer({
        enabledStrategies: [Strategy.SHORTEN],
        minImprovementThreshold: 0.99, // impossibly high
      });

      const result = opt.autoTune("A short prompt.", 5);
      assert.strictEqual(result.iterations, 0);
      assert.strictEqual(result.original, result.optimized);
    });

    it("caps iterations at 20 even when higher value is passed", () => {
      const opt = new PromptOptimizer();
      // autoTune should clamp to 20 internally
      const result = opt.autoTune(VERBOSE_TEMPLATE, 100);
      assert.ok(result.iterations <= 20);
      assert.ok(result.history.length <= 20);
    });

    it("includes length reduction statistics in result", () => {
      const opt = new PromptOptimizer({
        enabledStrategies: [Strategy.SHORTEN],
        minImprovementThreshold: 0.001,
      });

      const result = opt.autoTune(VERBOSE_TEMPLATE, 3);

      assert.ok(typeof result.originalLength === "number");
      assert.ok(typeof result.optimizedLength === "number");
      assert.ok(typeof result.lengthReduction === "number");
      assert.ok(typeof result.lengthReductionPercent === "number");
      assert.ok(result.lengthReductionPercent >= 0);
    });
  });

  // -----------------------------------------------------------------------
  // compareVariants
  // -----------------------------------------------------------------------

  describe("compareVariants", () => {
    it("produces structural comparison between two prompt variants", () => {
      const opt = new PromptOptimizer();

      const variantA = { name: "Short", template: "# Short\n\nJust one section." };
      const variantB = {
        name: "Long",
        template: [
          "# Long\n\n",
          "## Section 1\nSome content here.\n",
          "- Bullet 1\n- Bullet 2\n",
          "## Section 2\nMore content.\n",
          "```\ncode block\n```\n",
        ].join("\n"),
      };

      const comp = opt.compareVariants(variantA, variantB);

      assert.strictEqual(comp.variantA.name, "Short");
      assert.strictEqual(comp.variantB.name, "Long");

      // Structural metrics
      assert.ok(typeof comp.structural.totalLines.a === "number");
      assert.ok(typeof comp.structural.totalLines.b === "number");
      assert.ok(typeof comp.structural.headingCount.a === "number");
      assert.ok(typeof comp.structural.headingCount.b === "number");

      // Longer variant should have more headings
      assert.ok(
        comp.structural.headingCount.b > comp.structural.headingCount.a,
        "Long variant should have more headings"
      );
    });

    it("produces content comparison with Jaccard similarity and readability", () => {
      const opt = new PromptOptimizer();

      const variantA = { name: "A", template: "The quick brown fox jumps over the lazy dog." };
      const variantB = { name: "B", template: "The quick brown fox jumps over the lazy cat. Additionally, more text here." };

      const comp = opt.compareVariants(variantA, variantB);

      assert.ok(typeof comp.content.jaccardSimilarity === "number");
      assert.ok(comp.content.jaccardSimilarity > 0, "Variants share words, so similarity should be positive");
      assert.ok(typeof comp.content.readability.a === "number");
      assert.ok(typeof comp.content.readability.b === "number");
      assert.ok(Array.isArray(comp.content.uniqueToA));
      assert.ok(Array.isArray(comp.content.uniqueToB));
    });

    it("includes score comparison when both variants have score arrays", () => {
      const opt = new PromptOptimizer();

      const variantA = {
        name: "A",
        template: "Template A",
        scores: [
          { successRate: 0.8, tokenEfficiency: 0.5 },
          { successRate: 0.7, tokenEfficiency: 0.6 },
        ],
      };
      const variantB = {
        name: "B",
        template: "Template B",
        scores: [
          { successRate: 0.9, tokenEfficiency: 0.7 },
          { successRate: 0.85, tokenEfficiency: 0.75 },
        ],
      };

      const comp = opt.compareVariants(variantA, variantB);

      assert.ok(comp.scores !== null, "Score comparison should be present");
      assert.ok(typeof comp.scores.successRate.meanA === "number");
      assert.ok(typeof comp.scores.successRate.meanB === "number");
      assert.ok(typeof comp.scores.successRate.delta === "number");
    });

    it("omits score comparison when one variant lacks scores", () => {
      const opt = new PromptOptimizer();

      const variantA = {
        name: "A",
        template: "Template A",
        scores: [{ successRate: 0.8 }],
      };
      const variantB = {
        name: "B",
        template: "Template B",
        // No scores
      };

      const comp = opt.compareVariants(variantA, variantB);
      assert.strictEqual(comp.scores, null);
    });
  });

  // -----------------------------------------------------------------------
  // getBestVariant
  // -----------------------------------------------------------------------

  describe("getBestVariant", () => {
    it("returns the top-ranked variant from a results-like object", () => {
      const opt = new PromptOptimizer();
      const results = {
        experiment: "demo",
        variants: [
          {
            name: "winner",
            compositeMean: 0.85,
            trials: 30,
            dimensions: {
              successRate: { mean: 0.88 },
              tokenEfficiency: { mean: 0.72 },
            },
          },
          {
            name: "loser",
            compositeMean: 0.62,
            trials: 28,
            dimensions: {
              successRate: { mean: 0.60 },
              tokenEfficiency: { mean: 0.55 },
            },
          },
        ],
      };

      const best = opt.getBestVariant(results);
      assert.strictEqual(best.name, "winner");
      assert.strictEqual(best.compositeMean, 0.85);
      assert.strictEqual(best.trials, 30);
    });

    it("delegates to ABTestEngine when given an experiment name string", () => {
      const ab = new ABTestEngine();
      ab.createExperiment("test-exp", [
        { name: "gold", template: "Gold template" },
        { name: "silver", template: "Silver template" },
      ]);

      // Assign high scores whenever "gold" is selected, low for "silver"
      for (let i = 0; i < 100; i++) {
        const { variant, trialId } = ab.run("test-exp");
        if (variant.name === "gold") {
          ab.recordScore("test-exp", trialId, {
            successRate: 0.9,
            tokenEfficiency: 0.8,
            userSatisfaction: 0.85,
            toolAccuracy: 0.75,
          });
        } else {
          ab.recordScore("test-exp", trialId, {
            successRate: 0.45,
            tokenEfficiency: 0.4,
            userSatisfaction: 0.45,
            toolAccuracy: 0.4,
          });
        }
      }

      const opt = new PromptOptimizer({ abEngine: ab });
      const best = opt.getBestVariant("test-exp");
      assert.strictEqual(best.name, "gold");
    });

    it("returns null for non-existent experiment name", () => {
      const opt = new PromptOptimizer();
      assert.strictEqual(opt.getBestVariant("no-such-exp"), null);
    });

    it("returns null for a results object with no variants", () => {
      const opt = new PromptOptimizer();
      assert.strictEqual(opt.getBestVariant({ variants: [] }), null);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases & Strategy enum
  // -----------------------------------------------------------------------

  describe("edge cases", () => {
    it("Strategy enum is frozen and contains all expected values", () => {
      assert.ok(Object.isFrozen(Strategy));
      assert.strictEqual(Strategy.SHORTEN, "shorten");
      assert.strictEqual(Strategy.CLARIFY, "clarify");
      assert.strictEqual(Strategy.ADD_EXAMPLES, "add_examples");
      assert.strictEqual(Strategy.RESTRUCTURE, "restructure");
      assert.strictEqual(Strategy.SPECIALIZE, "specialize");
    });

    it("handles undefined/null template gracefully", () => {
      const opt = new PromptOptimizer();
      // These should not throw
      const s1 = opt.suggestImprovements(null, []);
      const s2 = opt.suggestImprovements(undefined, []);
      assert.ok(Array.isArray(s1));
      assert.ok(Array.isArray(s2));
    });

    it("handles empty history arrays", () => {
      const opt = new PromptOptimizer();
      const suggestions = opt.suggestImprovements("A basic prompt.", []);
      assert.ok(Array.isArray(suggestions));
    });

    it("deduplicates suggestions with identical strategy+description", () => {
      const opt = new PromptOptimizer({ enabledStrategies: [Strategy.SHORTEN] });
      // Supply history so strategy methods run
      const suggestions = opt.suggestImprovements(VERBOSE_TEMPLATE, makeHistory(10));

      const keys = suggestions.map((s) => `${s.strategy}|${s.description}`);
      const uniqueKeys = new Set(keys);
      assert.strictEqual(
        keys.length,
        uniqueKeys.size,
        "All suggestions should be unique by strategy+description"
      );
    });

    it("handles template functions that throw", () => {
      const badFn = () => {
        throw new Error("boom");
      };
      const opt = new PromptOptimizer();
      // Should not throw — should fall back to String representation
      const suggestions = opt.suggestImprovements(badFn, []);
      assert.ok(Array.isArray(suggestions));
    });
  });
});
