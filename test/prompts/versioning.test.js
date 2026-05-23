"use strict";

const { strict: assert } = require("node:assert");
const { describe, it, beforeEach } = require("node:test");

const { PromptVersionControl } = require("../../src/prompts/versioning");

/**
 * Helper: a minimal prompt with a single-line change for diff testing.
 */
const BASE_PROMPT = "You are a helpful assistant.\nProvide accurate answers.\nBe concise.";

const MODIFIED_PROMPT =
  "You are an expert developer.\nProvide accurate answers with code examples.\nBe concise.\nUse modern best practices.";

describe("PromptVersionControl", () => {
  let pvc;

  beforeEach(() => {
    pvc = new PromptVersionControl();
  });

  // -----------------------------------------------------------------------
  // commit
  // -----------------------------------------------------------------------

  describe("commit", () => {
    it("saves a prompt and returns a version ID", () => {
      const id = pvc.commit(BASE_PROMPT, "Initial commit");
      assert.ok(typeof id === "string");
      assert.ok(id.length > 0);
    });

    it("throws when prompt is not a string", () => {
      assert.throws(
        () => pvc.commit(null, "message"),
        /prompt must be a string/
      );
      assert.throws(
        () => pvc.commit(123, "message"),
        /prompt must be a string/
      );
    });

    it("throws when message is empty or not a string", () => {
      assert.throws(
        () => pvc.commit(BASE_PROMPT, ""),
        /message must be a non-empty string/
      );
      assert.throws(
        () => pvc.commit(BASE_PROMPT, "   "),
        /message must be a non-empty string/
      );
    });

    it("stores parent reference for subsequent commits", () => {
      const v1 = pvc.commit(BASE_PROMPT, "First");
      const v2 = pvc.commit(MODIFIED_PROMPT, "Second");

      const entry1 = pvc.getVersion(v1);
      const entry2 = pvc.getVersion(v2);

      assert.strictEqual(entry1.parent, null);
      assert.strictEqual(entry2.parent, v1);
    });

    it("updates the current pointer", () => {
      assert.strictEqual(pvc.current, null);
      const v1 = pvc.commit(BASE_PROMPT, "First");
      assert.strictEqual(pvc.current, v1);
      const v2 = pvc.commit(MODIFIED_PROMPT, "Second");
      assert.strictEqual(pvc.current, v2);
    });

    it("attaches metadata to the version entry", () => {
      const id = pvc.commit(BASE_PROMPT, "With meta", {
        author: "alice",
        score: 0.85,
        tags: ["baseline"],
      });

      const entry = pvc.getVersion(id);
      assert.strictEqual(entry.meta.author, "alice");
      assert.strictEqual(entry.meta.score, 0.85);
      assert.deepStrictEqual(entry.meta.tags, ["baseline"]);
    });

    it("records a timestamp on commit", () => {
      const before = new Date().toISOString();
      const id = pvc.commit(BASE_PROMPT, "Timestamp test");
      const after = new Date().toISOString();
      const entry = pvc.getVersion(id);

      assert.ok(entry.timestamp >= before);
      assert.ok(entry.timestamp <= after);
    });
  });

  // -----------------------------------------------------------------------
  // diff
  // -----------------------------------------------------------------------

  describe("diff", () => {
    it("detects added, removed, and unchanged lines", () => {
      const v1 = pvc.commit("line one\nline two\nline three", "v1");
      const v2 = pvc.commit("line one\nline two modified\nline three\nline four", "v2");

      const result = pvc.diff(v1, v2);

      assert.ok(result.addedLines.includes("line four"));
      assert.ok(result.removedLines.includes("line two"));
      assert.ok(result.unchangedLines.includes("line one"));
      assert.ok(result.unchangedLines.includes("line three"));
    });

    it("reports no changes for identical prompts", () => {
      const v1 = pvc.commit(BASE_PROMPT, "First");
      const v2 = pvc.commit(BASE_PROMPT, "Second (same content)");

      const result = pvc.diff(v1, v2);

      assert.strictEqual(result.addedLines.length, 0);
      assert.strictEqual(result.removedLines.length, 0);
      assert.strictEqual(result.summary, "No changes between versions.");
    });

    it("classifies change magnitude", () => {
      const short = "one";
      const long = "one\ntwo\nthree\nfour\nfive\nsix";

      const v1 = pvc.commit(short, "Short");
      const v2 = pvc.commit(long, "Long");

      const result = pvc.diff(v1, v2);
      assert.ok(result.summary.includes("Major rewrite"));
    });

    it("includes chunk count in result", () => {
      const v1 = pvc.commit("a\nb\nc", "v1");
      const v2 = pvc.commit("a\nx\nc", "v2");

      const result = pvc.diff(v1, v2);
      assert.ok(result.chunkCount >= 1);
    });
  });

  // -----------------------------------------------------------------------
  // rollback
  // -----------------------------------------------------------------------

  describe("rollback", () => {
    it("sets the current pointer to the specified version", () => {
      const v1 = pvc.commit(BASE_PROMPT, "First");
      const v2 = pvc.commit(MODIFIED_PROMPT, "Second");

      assert.strictEqual(pvc.current, v2);

      const rolled = pvc.rollback(v1);
      assert.strictEqual(pvc.current, v1);
      assert.strictEqual(rolled, BASE_PROMPT);
    });

    it("returns the prompt content at the rolled-back version", () => {
      const v1 = pvc.commit(BASE_PROMPT, "First");
      pvc.commit(MODIFIED_PROMPT, "Second");

      const content = pvc.rollback(v1);
      assert.strictEqual(content, BASE_PROMPT);
    });

    it("throws when version does not exist", () => {
      assert.throws(
        () => pvc.rollback("nonexistent"),
        /not found/
      );
    });

    it("does not delete versions on rollback", () => {
      const v1 = pvc.commit(BASE_PROMPT, "First");
      pvc.commit(MODIFIED_PROMPT, "Second");
      pvc.rollback(v1);

      // v2 should still be accessible
      assert.strictEqual(pvc.getHistory().length, 2);
    });
  });

  // -----------------------------------------------------------------------
  // getHistory
  // -----------------------------------------------------------------------

  describe("getHistory", () => {
    it("returns an empty array with no commits", () => {
      assert.deepStrictEqual(pvc.getHistory(), []);
    });

    it("returns all versions in commit order", () => {
      const v1 = pvc.commit("A", "First");
      const v2 = pvc.commit("B", "Second");
      const v3 = pvc.commit("C", "Third");

      const history = pvc.getHistory();
      assert.strictEqual(history.length, 3);
      assert.strictEqual(history[0].id, v1);
      assert.strictEqual(history[1].id, v2);
      assert.strictEqual(history[2].id, v3);
    });

    it("includes message and timestamp in history entries", () => {
      pvc.commit(BASE_PROMPT, "My message");
      const history = pvc.getHistory();

      assert.strictEqual(history[0].message, "My message");
      assert.ok(typeof history[0].timestamp === "string");
    });
  });

  // -----------------------------------------------------------------------
  // getVersion
  // -----------------------------------------------------------------------

  describe("getVersion", () => {
    it("retrieves a version by ID", () => {
      const id = pvc.commit(BASE_PROMPT, "Test");
      const entry = pvc.getVersion(id);

      assert.strictEqual(entry.id, id);
      assert.strictEqual(entry.prompt, BASE_PROMPT);
      assert.strictEqual(entry.message, "Test");
    });

    it("throws for unknown version IDs", () => {
      assert.throws(
        () => pvc.getVersion("unknown-id"),
        /not found/
      );
    });
  });

  // -----------------------------------------------------------------------
  // comparePerformance
  // -----------------------------------------------------------------------

  describe("comparePerformance", () => {
    it("declares a winner when scores differ", () => {
      const v1 = pvc.commit("Prompt A", "A", { score: 0.7 });
      const v2 = pvc.commit("Prompt B", "B", { score: 0.9 });

      const result = pvc.comparePerformance(v1, v2);

      assert.strictEqual(result.winnerId, v2);
      assert.strictEqual(result.loserId, v1);
      assert.ok(Math.abs(result.delta - 0.2) < 1e-10, `delta ${result.delta} should be ~0.2`);
      assert.strictEqual(result.tie, false);
    });

    it("reports a tie when scores are equal", () => {
      const v1 = pvc.commit("Prompt A", "A", { score: 0.8 });
      const v2 = pvc.commit("Prompt B", "B", { score: 0.8 });

      const result = pvc.comparePerformance(v1, v2);

      assert.strictEqual(result.tie, true);
      assert.strictEqual(result.winner, null);
      assert.strictEqual(result.winnerId, null);
      assert.strictEqual(result.delta, 0);
    });

    it("accepts explicit scores map overriding meta.score", () => {
      const v1 = pvc.commit("Prompt A", "A", { score: 0.3 });
      const v2 = pvc.commit("Prompt B", "B");

      const result = pvc.comparePerformance(v1, v2, { [v2]: 0.5 });

      assert.strictEqual(result.winnerId, v2);
      assert.strictEqual(result.tie, false);
    });

    it("returns a reason when one or both versions lack a score", () => {
      const v1 = pvc.commit("Prompt A", "A");
      const v2 = pvc.commit("Prompt B", "B");

      const result = pvc.comparePerformance(v1, v2);

      assert.ok(result.reason);
      assert.ok(result.reason.includes("no score"));
    });
  });

  // -----------------------------------------------------------------------
  // tag
  // -----------------------------------------------------------------------

  describe("tag", () => {
    it("tags a version with a label", () => {
      const v1 = pvc.commit(BASE_PROMPT, "First");
      pvc.tag(v1, "production");

      assert.strictEqual(pvc.getTagged("production"), v1);
    });

    it("replaces tag when applied to a different version", () => {
      const v1 = pvc.commit("A", "First");
      const v2 = pvc.commit("B", "Second");

      pvc.tag(v1, "production");
      pvc.tag(v2, "production");

      assert.strictEqual(pvc.getTagged("production"), v2);
    });

    it("returns null for unknown tags", () => {
      assert.strictEqual(pvc.getTagged("nonexistent"), null);
    });

    it("returns a copy of all tags", () => {
      const v1 = pvc.commit(BASE_PROMPT, "First");
      pvc.tag(v1, "experiment");
      pvc.tag(v1, "baseline");

      const tags = pvc.getTags();
      assert.strictEqual(tags.size, 2);
      assert.strictEqual(tags.get("experiment"), v1);
      assert.strictEqual(tags.get("baseline"), v1);
    });

    it("throws when tagging a nonexistent version", () => {
      assert.throws(
        () => pvc.tag("nonexistent", "label"),
        /not found/
      );
    });

    it("is chainable", () => {
      const v1 = pvc.commit(BASE_PROMPT, "First");
      const result = pvc.tag(v1, "a").tag(v1, "b");
      assert.strictEqual(result, pvc);
    });
  });

  // -----------------------------------------------------------------------
  // count
  // -----------------------------------------------------------------------

  describe("count", () => {
    it("starts at zero", () => {
      assert.strictEqual(pvc.count, 0);
    });

    it("increments with each commit", () => {
      pvc.commit("A", "1");
      pvc.commit("B", "2");
      assert.strictEqual(pvc.count, 2);
    });
  });
});
