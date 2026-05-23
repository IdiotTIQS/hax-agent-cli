/**
 * Tests for PolicyEngine — ABAC rule evaluation, conflict resolution
 * (explicit deny > explicit allow > implicit deny), rule explanation,
 * and policy-set merging.
 */
"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { PolicyEngine } = require("../../src/rbac/policy");

describe("PolicyEngine", () => {
  let pe;

  beforeEach(() => {
    pe = new PolicyEngine();
  });

  describe("addRule", () => {
    it("adds a valid allow rule", () => {
      pe.addRule({
        effect: "allow",
        subjects: ["alice"],
        actions: ["file.read"],
      });
      assert.strictEqual(pe.ruleCount, 1);
    });

    it("adds a valid deny rule", () => {
      pe.addRule({
        effect: "deny",
        subjects: ["bob"],
        actions: ["file.delete"],
      });
      assert.strictEqual(pe.ruleCount, 1);
    });

    it("throws for invalid effect", () => {
      assert.throws(
        () => pe.addRule({ effect: "maybe" }),
        /must be "allow" or "deny"/
      );
    });
  });

  describe("evaluate — basic matching", () => {
    it("allows when an allow rule matches", () => {
      pe.addRule({
        effect: "allow",
        subjects: ["alice"],
        actions: ["file.read"],
      });
      const result = pe.evaluate("alice", "file.read");
      assert.strictEqual(result.allowed, true);
    });

    it("denies when a deny rule matches", () => {
      pe.addRule({
        effect: "deny",
        subjects: ["bob"],
        actions: ["file.delete"],
      });
      const result = pe.evaluate("bob", "file.delete");
      assert.strictEqual(result.allowed, false);
    });

    it("returns implicit deny when no rule matches", () => {
      const result = pe.evaluate("ghost", "file.read");
      assert.strictEqual(result.allowed, false);
      assert.ok(result.reason.includes("Implicit deny"));
    });
  });

  describe("evaluate — wildcards", () => {
    it("wildcard subject '*' matches any subject", () => {
      pe.addRule({ effect: "allow", subjects: "*", actions: ["file.read"] });
      assert.strictEqual(pe.evaluate("anyone", "file.read").allowed, true);
    });

    it("wildcard action '*' matches any action", () => {
      pe.addRule({ effect: "allow", subjects: ["alice"], actions: "*" });
      assert.strictEqual(pe.evaluate("alice", "anything").allowed, true);
    });

    it("wildcard in array matches any value", () => {
      pe.addRule({
        effect: "allow",
        subjects: ["alice", "*"],
        actions: ["file.read"],
      });
      assert.strictEqual(pe.evaluate("bob", "file.read").allowed, true);
    });

    it("undefined subjects/actions match everything", () => {
      pe.addRule({ effect: "allow" });
      assert.strictEqual(pe.evaluate("anyone", "anything").allowed, true);
    });
  });

  describe("evaluate — conflict resolution", () => {
    it("explicit deny overrides explicit allow (same priority)", () => {
      pe.addRule({ effect: "allow", subjects: ["alice"], actions: ["file.write"] });
      pe.addRule({ effect: "deny", subjects: ["alice"], actions: ["file.write"] });
      const result = pe.evaluate("alice", "file.write");
      assert.strictEqual(result.allowed, false);
    });

    it("higher-priority allow does not override deny at same level", () => {
      pe.addRule({
        effect: "allow",
        subjects: ["alice"],
        actions: ["file.write"],
        priority: 100,
      });
      pe.addRule({
        effect: "deny",
        subjects: ["alice"],
        actions: ["file.write"],
        priority: 100,
      });
      const result = pe.evaluate("alice", "file.write");
      assert.strictEqual(result.allowed, false); // deny wins at same priority
    });

    it("higher-priority deny overrides lower-priority allow", () => {
      pe.addRule({ effect: "allow", subjects: ["alice"], actions: ["x"], priority: 10 });
      pe.addRule({ effect: "deny", subjects: ["alice"], actions: ["x"], priority: 20 });
      const result = pe.evaluate("alice", "x");
      assert.strictEqual(result.allowed, false);
    });
  });

  describe("evaluate — conditions", () => {
    it("applies condition functions to filter rules", () => {
      pe.addRule({
        effect: "allow",
        subjects: ["alice"],
        actions: ["file.write"],
        conditions: [
          (subject, action, resource, context) => context?.timeOfDay === "business",
        ],
      });
      assert.strictEqual(
        pe.evaluate("alice", "file.write", null, { timeOfDay: "business" }).allowed,
        true
      );
      assert.strictEqual(
        pe.evaluate("alice", "file.write", null, { timeOfDay: "night" }).allowed,
        false
      );
    });

    it("requires all conditions to pass", () => {
      pe.addRule({
        effect: "allow",
        subjects: ["alice"],
        actions: ["x"],
        conditions: [
          () => true,
          (s, a, r, ctx) => ctx?.flag === true,
        ],
      });
      assert.strictEqual(pe.evaluate("alice", "x", null, { flag: true }).allowed, true);
      assert.strictEqual(pe.evaluate("alice", "x", null, { flag: false }).allowed, false);
    });

    it("applies conditions to deny rules as well", () => {
      pe.addRule({
        effect: "deny",
        subjects: ["alice"],
        actions: ["x"],
        conditions: [(s, a, r, ctx) => ctx?.block === true],
      });
      // Allow rule also exists for alice
      pe.addRule({ effect: "allow", subjects: ["alice"], actions: ["x"] });

      assert.strictEqual(
        pe.evaluate("alice", "x", null, { block: true }).allowed,
        false // deny triggers
      );
      assert.strictEqual(
        pe.evaluate("alice", "x", null, { block: false }).allowed,
        true // deny condition fails, allow wins
      );
    });
  });

  describe("evaluate — resources", () => {
    it("matches resource type", () => {
      pe.addRule({
        effect: "allow",
        subjects: ["alice"],
        actions: ["file.read"],
        resources: ["document"],
      });
      assert.strictEqual(
        pe.evaluate("alice", "file.read", { type: "document" }).allowed,
        true
      );
      assert.strictEqual(
        pe.evaluate("alice", "file.read", { type: "image" }).allowed,
        false
      );
    });

    it("matches resource with wildcard", () => {
      pe.addRule({
        effect: "allow",
        subjects: ["alice"],
        actions: ["file.read"],
        resources: "*",
      });
      assert.strictEqual(
        pe.evaluate("alice", "file.read", { type: "anything" }).allowed,
        true
      );
    });
  });

  describe("getApplicableRules", () => {
    it("returns rules that match subject and action (ignoring conditions)", () => {
      pe.addRule({ effect: "allow", subjects: ["alice"], actions: ["x"] });
      pe.addRule({ effect: "deny", subjects: ["bob"], actions: ["x"] });
      pe.addRule({ effect: "allow", subjects: ["alice"], actions: ["y"] });

      const rules = pe.getApplicableRules("alice", "x");
      assert.strictEqual(rules.length, 1);
      assert.strictEqual(rules[0].effect, "allow");
    });

    it("returns empty array when no rules match", () => {
      pe.addRule({ effect: "allow", subjects: ["alice"], actions: ["x"] });
      assert.strictEqual(pe.getApplicableRules("bob", "y").length, 0);
    });
  });

  describe("explain", () => {
    it("includes a trace of all evaluated rules", () => {
      pe.addRule({
        effect: "allow",
        subjects: ["alice"],
        actions: ["file.read"],
        description: "Alice can read files",
      });
      pe.addRule({
        effect: "deny",
        subjects: ["alice"],
        actions: ["file.read"],
        conditions: [(s, a, r, ctx) => ctx?.blocked === true],
        description: "Blocked in certain contexts",
      });

      const explanation = pe.explain("alice", "file.read", null, { blocked: false });
      assert.strictEqual(explanation.allowed, true);
      assert.ok(explanation.trace.length > 0);

      // The deny rule should appear in trace with conditionsSatisfied: false
      const denyTrace = explanation.trace.find((t) => t.effect === "deny");
      assert.ok(denyTrace);
      assert.strictEqual(denyTrace.conditionsSatisfied, false);
    });

    it("reports correct applicable count", () => {
      pe.addRule({ effect: "allow", subjects: ["alice"], actions: ["x"] });
      pe.addRule({ effect: "allow", subjects: ["alice"], actions: ["x"] });
      const explanation = pe.explain("alice", "x");
      assert.strictEqual(explanation.applicableCount, 2);
    });
  });

  describe("combinePolicies", () => {
    it("merges rules from another PolicyEngine", () => {
      const other = new PolicyEngine();
      other.addRule({ effect: "allow", subjects: ["alice"], actions: ["x"] });

      pe.addRule({ effect: "deny", subjects: ["bob"], actions: ["x"] });
      pe.combinePolicies([other]);

      assert.strictEqual(pe.ruleCount, 2);
      assert.strictEqual(pe.evaluate("alice", "x").allowed, true);
      assert.strictEqual(pe.evaluate("bob", "x").allowed, false);
    });

    it("merges plain rule arrays", () => {
      const rules = [
        { effect: "allow", subjects: ["alice"], actions: ["x"] },
        { effect: "deny", subjects: ["bob"], actions: ["x"] },
      ];

      pe.combinePolicies([rules]);
      assert.strictEqual(pe.ruleCount, 2);
    });

    it("throws for invalid policy argument", () => {
      assert.throws(
        () => pe.combinePolicies([{ not: "valid" }]),
        /combinePolicies expects/
      );
    });
  });

  describe("clearRules", () => {
    it("removes all rules", () => {
      pe.addRule({ effect: "allow" });
      pe.addRule({ effect: "deny" });
      pe.clearRules();
      assert.strictEqual(pe.ruleCount, 0);
      // After clearing, evaluate returns implicit deny
      assert.strictEqual(pe.evaluate("anyone", "anything").allowed, false);
    });
  });

  describe("getRules", () => {
    it("returns a shallow copy of the rules array", () => {
      pe.addRule({ effect: "allow", subjects: ["alice"] });
      const copy = pe.getRules();
      assert.strictEqual(copy.length, 1);
      copy.pop();
      assert.strictEqual(pe.ruleCount, 1); // original unchanged
    });
  });
});
