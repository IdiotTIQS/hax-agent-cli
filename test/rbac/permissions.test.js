/**
 * Tests for PermissionEngine — permission definition, direct grants/revocations,
 * role-based inheritance, check / checkAny / checkAll, resource-scope matching,
 * and explain.
 */
"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { RoleManager } = require("../../src/rbac/roles");
const { PermissionEngine } = require("../../src/rbac/permissions");

describe("PermissionEngine", () => {
  let rm;
  let engine;

  beforeEach(() => {
    rm = new RoleManager();
    engine = new PermissionEngine(rm);
  });

  describe("constructor", () => {
    it("throws without a RoleManager instance", () => {
      assert.throws(
        () => new PermissionEngine(null),
        /RoleManager instance/
      );
    });
  });

  describe("definePermission", () => {
    it("stores a permission definition with scope and actions", () => {
      engine.definePermission("file.write", "file", ["create", "update", "delete"]);
      // Resource scope matching should work after definition
      rm.grantRole("u", "DEVELOPER");
      // Without a resource, check is scope-agnostic
      assert.strictEqual(engine.check("u", "file.write"), true);
    });
  });

  describe("grant / check", () => {
    it("grants a permission directly and check returns true", () => {
      engine.grant("user1", "custom.action");
      assert.strictEqual(engine.check("user1", "custom.action"), true);
    });

    it("returns false for ungranted permission", () => {
      assert.strictEqual(engine.check("user1", "nonexistent"), false);
    });

    it("explicit revocation overrides a direct grant", () => {
      engine.grant("user1", "file.write");
      engine.revoke("user1", "file.write");
      assert.strictEqual(engine.check("user1", "file.write"), false);
    });
  });

  describe("check — role-based inheritance", () => {
    it("resolves permission through a role when no direct grant exists", () => {
      rm.grantRole("dev1", "DEVELOPER");
      assert.strictEqual(engine.check("dev1", "file.read"), true);
    });

    it("resolves permission through multiple roles (union)", () => {
      rm.grantRole("hybrid", "VIEWER");
      rm.grantRole("hybrid", "AUDITOR");
      assert.strictEqual(engine.check("hybrid", "file.read"), true);
      assert.strictEqual(engine.check("hybrid", "audit.export"), true);
    });

    it("ADMIN has access to everything via wildcard", () => {
      rm.grantRole("super", "ADMIN");
      assert.strictEqual(engine.check("super", "any.custom.permission"), true);
    });

    it("RESTRICTED can only access file.read", () => {
      rm.grantRole("guest", "RESTRICTED");
      assert.strictEqual(engine.check("guest", "file.read"), true);
      assert.strictEqual(engine.check("guest", "file.write"), false);
    });

    it("revocation overrides role-based grant", () => {
      rm.grantRole("dev1", "DEVELOPER");
      engine.revoke("dev1", "file.read");
      assert.strictEqual(engine.check("dev1", "file.read"), false);
    });
  });

  describe("check — resource scope", () => {
    it("respects scope when resource provided", () => {
      engine.definePermission("file.write", "file", ["create"]);
      rm.grantRole("dev1", "DEVELOPER");

      // Resource scope matches permission scope
      assert.strictEqual(
        engine.check("dev1", "file.write", { scope: "file", path: "/tmp/a" }),
        true
      );
    });

    it("denies when resource scope mismatches permission scope", () => {
      engine.definePermission("file.write", "file", ["create"]);
      engine.grant("user1", "file.write");

      assert.strictEqual(
        engine.check("user1", "file.write", { scope: "shell" }),
        false
      );
    });

    it("passes through when resource is undefined", () => {
      engine.grant("user1", "file.write");
      assert.strictEqual(engine.check("user1", "file.write"), true);
    });

    it("passes through when permission has no definition", () => {
      engine.grant("user1", "custom.thing");
      assert.strictEqual(
        engine.check("user1", "custom.thing", { scope: "anything" }),
        true
      );
    });
  });

  describe("checkAny", () => {
    it("returns true when at least one permission is held", () => {
      engine.grant("user1", "perm.a");
      assert.strictEqual(engine.checkAny("user1", ["perm.a", "perm.b", "perm.c"]), true);
    });

    it("returns false when none of the permissions are held", () => {
      assert.strictEqual(engine.checkAny("user1", ["perm.a", "perm.b"]), false);
    });

    it("returns false for an empty permissions array", () => {
      engine.grant("user1", "perm.a");
      assert.strictEqual(engine.checkAny("user1", []), false);
    });

    it("accounts for revocations", () => {
      engine.grant("user1", "perm.a");
      engine.revoke("user1", "perm.a");
      assert.strictEqual(engine.checkAny("user1", ["perm.a"]), false);
    });
  });

  describe("checkAll", () => {
    it("returns true when all permissions are held", () => {
      engine.grant("user1", "perm.a");
      engine.grant("user1", "perm.b");
      assert.strictEqual(engine.checkAll("user1", ["perm.a", "perm.b"]), true);
    });

    it("returns false when any permission is missing", () => {
      engine.grant("user1", "perm.a");
      assert.strictEqual(engine.checkAll("user1", ["perm.a", "perm.b"]), false);
    });

    it("returns false for an empty permissions array", () => {
      assert.strictEqual(engine.checkAll("user1", []), false);
    });
  });

  describe("explain", () => {
    it("reports explicit_deny for revoked permission", () => {
      engine.grant("user1", "file.write");
      engine.revoke("user1", "file.write");
      const explanation = engine.explain("user1", "file.write");
      assert.strictEqual(explanation.granted, false);
      assert.deepStrictEqual(explanation.path, ["explicit_deny"]);
    });

    it("reports direct_grant for directly granted permission", () => {
      engine.grant("user1", "file.write");
      const explanation = engine.explain("user1", "file.write");
      assert.strictEqual(explanation.granted, true);
      assert.ok(explanation.path.includes("direct_grant"));
    });

    it("reports role_inheritance for role-based permission", () => {
      rm.grantRole("dev1", "DEVELOPER");
      const explanation = engine.explain("dev1", "file.read");
      assert.strictEqual(explanation.granted, true);
      assert.ok(explanation.path.includes("role_inheritance"));
      assert.ok(explanation.path.includes("DEVELOPER"));
    });

    it("reports implicit_deny for unknown permission", () => {
      const explanation = engine.explain("ghost", "nothing");
      assert.strictEqual(explanation.granted, false);
      assert.ok(explanation.path.includes("implicit_deny"));
    });
  });

  describe("grantMany / revokeMany", () => {
    it("grants multiple permissions at once", () => {
      engine.grantMany("user1", ["a", "b", "c"]);
      assert.strictEqual(engine.check("user1", "a"), true);
      assert.strictEqual(engine.check("user1", "b"), true);
      assert.strictEqual(engine.check("user1", "c"), true);
    });

    it("revokes multiple permissions at once", () => {
      engine.grantMany("user1", ["a", "b", "c"]);
      engine.revokeMany("user1", ["a", "b"]);
      assert.strictEqual(engine.check("user1", "a"), false);
      assert.strictEqual(engine.check("user1", "b"), false);
      assert.strictEqual(engine.check("user1", "c"), true);
    });
  });

  describe("clearSubject", () => {
    it("removes all grants and revocations", () => {
      engine.grant("user1", "a");
      engine.revoke("user1", "b");
      engine.clearSubject("user1");
      assert.strictEqual(engine.check("user1", "a"), false);
      assert.strictEqual(engine.check("user1", "b"), false);
    });
  });

  describe("getEffectivePermissions", () => {
    it("merges direct grants with role-based permissions, minus revocations", () => {
      rm.grantRole("hybrid", "VIEWER");    // file.read, file.glob, file.search, config.read
      engine.grant("hybrid", "extra.permission");
      engine.revoke("hybrid", "config.read");

      const perms = engine.getEffectivePermissions("hybrid");
      assert.ok(perms.has("file.read"));
      assert.ok(perms.has("extra.permission"));
      assert.ok(!perms.has("config.read"));
    });

    it("returns wildcard for ADMIN", () => {
      rm.grantRole("super", "ADMIN");
      engine.grant("super", "extra");
      const perms = engine.getEffectivePermissions("super");
      assert.ok(perms.has("*"));
      assert.strictEqual(perms.size, 1);
    });
  });
});
