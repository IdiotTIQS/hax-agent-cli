/**
 * Tests for RoleManager — role definition, grant/revoke, queries, and
 * effective-permission resolution.
 */
"use strict";

const { describe, it, before, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { RoleManager } = require("../../src/rbac/roles");

describe("RoleManager", () => {
  let rm;

  beforeEach(() => {
    rm = new RoleManager();
  });

  describe("defineRole", () => {
    it("defines a new role with permissions", () => {
      rm.defineRole("EDITOR", ["file.read", "file.write"]);
      const roles = rm.listRoles();
      assert.ok(roles.includes("EDITOR"));
    });

    it("overwrites an existing role definition", () => {
      rm.defineRole("CUSTOM", ["a"]);
      rm.defineRole("CUSTOM", ["b", "c"]);
      // Should not throw; verify by getting effective permissions
      rm.grantRole("user1", "CUSTOM");
      const perms = rm.getEffectivePermissions("user1");
      assert.ok(perms.has("b"));
      assert.ok(perms.has("c"));
      assert.ok(!perms.has("a"));
    });

    it("accepts an empty permissions array", () => {
      rm.defineRole("EMPTY", []);
      rm.grantRole("user1", "EMPTY");
      const perms = rm.getEffectivePermissions("user1");
      assert.strictEqual(perms.size, 0);
    });
  });

  describe("grantRole", () => {
    it("assigns a role to a subject", () => {
      rm.grantRole("subjectA", "VIEWER");
      assert.deepStrictEqual(rm.getRoles("subjectA"), ["VIEWER"]);
    });

    it("throws when granting an unknown role", () => {
      assert.throws(
        () => rm.grantRole("subjectA", "NONEXISTENT"),
        /Unknown role/
      );
    });

    it("allows a subject to hold multiple roles", () => {
      rm.grantRole("subjectA", "VIEWER");
      rm.grantRole("subjectA", "DEVELOPER");
      const roles = rm.getRoles("subjectA");
      assert.strictEqual(roles.length, 2);
      assert.ok(roles.includes("VIEWER"));
      assert.ok(roles.includes("DEVELOPER"));
    });

    it("is idempotent — granting the same role twice does not duplicate", () => {
      rm.grantRole("subjectA", "VIEWER");
      rm.grantRole("subjectA", "VIEWER");
      assert.strictEqual(rm.getRoles("subjectA").length, 1);
    });
  });

  describe("revokeRole", () => {
    it("removes a role from a subject", () => {
      rm.grantRole("subjectA", "VIEWER");
      rm.revokeRole("subjectA", "VIEWER");
      assert.strictEqual(rm.getRoles("subjectA").length, 0);
    });

    it("is safe to call on a subject with no roles", () => {
      assert.doesNotThrow(() => rm.revokeRole("nobody", "VIEWER"));
    });

    it("only removes the specified role", () => {
      rm.grantRole("subjectA", "VIEWER");
      rm.grantRole("subjectA", "DEVELOPER");
      rm.revokeRole("subjectA", "VIEWER");
      assert.deepStrictEqual(rm.getRoles("subjectA"), ["DEVELOPER"]);
    });
  });

  describe("hasRole", () => {
    it("returns true when the subject holds the role", () => {
      rm.grantRole("subjectA", "AUDITOR");
      assert.strictEqual(rm.hasRole("subjectA", "AUDITOR"), true);
    });

    it("returns false when the subject does not hold the role", () => {
      assert.strictEqual(rm.hasRole("subjectA", "AUDITOR"), false);
    });

    it("returns false for unknown subject", () => {
      assert.strictEqual(rm.hasRole("ghost", "VIEWER"), false);
    });
  });

  describe("getEffectivePermissions", () => {
    it("returns an empty set for a subject with no roles", () => {
      const perms = rm.getEffectivePermissions("nobody");
      assert.strictEqual(perms.size, 0);
    });

    it("returns the union of all role permissions", () => {
      rm.grantRole("user1", "VIEWER");
      rm.grantRole("user1", "AUDITOR");
      const perms = rm.getEffectivePermissions("user1");
      assert.ok(perms.has("file.read"));
      assert.ok(perms.has("audit.read")); // from AUDITOR
      assert.ok(perms.has("audit.export")); // from AUDITOR
    });

    it("returns '*' wildcard for ADMIN role", () => {
      rm.grantRole("admin1", "ADMIN");
      rm.grantRole("admin1", "VIEWER");
      const perms = rm.getEffectivePermissions("admin1");
      assert.ok(perms.has("*"));
      assert.strictEqual(perms.size, 1); // short-circuits
    });
  });

  describe("built-in roles", () => {
    it("seeds all seven built-in roles on construction", () => {
      const roles = rm.listRoles();
      assert.ok(roles.includes("ADMIN"));
      assert.ok(roles.includes("OPERATOR"));
      assert.ok(roles.includes("DEVELOPER"));
      assert.ok(roles.includes("VIEWER"));
      assert.ok(roles.includes("AUDITOR"));
      assert.ok(roles.includes("AGENT"));
      assert.ok(roles.includes("RESTRICTED"));
    });

    it("RESTRICTED role grants only file.read", () => {
      rm.grantRole("subjectR", "RESTRICTED");
      const perms = rm.getEffectivePermissions("subjectR");
      assert.strictEqual(perms.size, 1);
      assert.ok(perms.has("file.read"));
    });
  });

  describe("getSubjectsWithRole", () => {
    it("returns all subjects that hold a given role", () => {
      rm.grantRole("alice", "VIEWER");
      rm.grantRole("bob", "VIEWER");
      rm.grantRole("carol", "DEVELOPER");
      const viewers = rm.getSubjectsWithRole("VIEWER");
      assert.deepStrictEqual(viewers.sort(), ["alice", "bob"]);
    });

    it("returns empty array when no subject holds the role", () => {
      assert.deepStrictEqual(rm.getSubjectsWithRole("VIEWER"), []);
    });
  });

  describe("clearRoles and reset", () => {
    it("clearRoles removes all assignments for a subject", () => {
      rm.grantRole("user1", "VIEWER");
      rm.grantRole("user1", "AUDITOR");
      rm.clearRoles("user1");
      assert.strictEqual(rm.getRoles("user1").length, 0);
    });

    it("reset clears all assignments but keeps built-in roles", () => {
      rm.grantRole("user1", "VIEWER");
      rm.defineRole("CUSTOM", ["x"]);
      rm.reset();
      assert.strictEqual(rm.getRoles("user1").length, 0);
      const roles = rm.listRoles();
      assert.ok(roles.includes("ADMIN"));
      assert.ok(!roles.includes("CUSTOM"));
    });
  });
});
