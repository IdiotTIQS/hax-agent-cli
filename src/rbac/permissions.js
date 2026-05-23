/**
 * PermissionEngine — permission definition, direct grants/revocations, and
 * effective-permission resolution that unifies direct grants with role-based
 * inheritance from a RoleManager.
 */
"use strict";

// ---------------------------------------------------------------------------
// PermissionEngine
// ---------------------------------------------------------------------------
class PermissionEngine {
  /**
   * @param {import('./roles').RoleManager} roleManager
   * @param {object} [options]
   * @param {boolean} [options.lenientWildcard=false]  if true, "*" wildcard in
   *        role permissions is treated as a literal match rather than a
   *        universal pass
   */
  constructor(roleManager, options = {}) {
    if (!roleManager) {
      throw new Error("PermissionEngine requires a RoleManager instance");
    }
    this._roleManager = roleManager;
    this._lenientWildcard = options.lenientWildcard || false;

    /** @type {Map<string, { scope: string, actions: string[] }>} */
    this._definitions = new Map();
    /** @type {Map<string, Set<string>>}  subject → set of directly granted permissions */
    this._grants = new Map();
    /** @type {Map<string, Set<string>>}  subject → set of explicitly revoked permissions */
    this._revocations = new Map();
  }

  /**
   * Define a named permission with a scope and allowed actions.
   * @param {string} name         e.g. "file.write"
   * @param {string} scope        e.g. "file", "shell", "system"
   * @param {string[]} actions    e.g. ["create", "update", "delete"]
   */
  definePermission(name, scope, actions) {
    this._definitions.set(name, { scope, actions: [...actions] });
  }

  /**
   * Grant a permission directly to a subject (bypassing roles).
   * @param {string} subject
   * @param {string} permission
   */
  grant(subject, permission) {
    let grants = this._grants.get(subject);
    if (!grants) {
      grants = new Set();
      this._grants.set(subject, grants);
    }
    grants.add(permission);

    // If an explicit revocation exists for this permission, remove it.
    const revocations = this._revocations.get(subject);
    if (revocations) {
      revocations.delete(permission);
    }
  }

  /**
   * Revoke a permission from a subject (explicit deny overrides grant and role).
   * @param {string} subject
   * @param {string} permission
   */
  revoke(subject, permission) {
    let revocations = this._revocations.get(subject);
    if (!revocations) {
      revocations = new Set();
      this._revocations.set(subject, revocations);
    }
    revocations.add(permission);

    // Remove from direct grants if present.
    const grants = this._grants.get(subject);
    if (grants) {
      grants.delete(permission);
    }
  }

  /**
   * Check whether a subject holds the given permission (for an optional resource).
   *
   * Resolution order:
   *   1. Explicit revocation  →  always false
   *   2. Direct grant         →  true
   *   3. Role-based grant     →  true (wildcard "*" also considered)
   *
   * When `resource` is provided, the resource's scope must match the
   * permission definition's scope.
   *
   * @param {string}  subject
   * @param {string}  permission   e.g. "file.write"
   * @param {object}  [resource]   optional resource descriptor, e.g. { path, scope, ... }
   * @returns {boolean}
   */
  check(subject, permission, resource) {
    // 1. Explicit revocation always wins
    const revocations = this._revocations.get(subject);
    if (revocations && revocations.has(permission)) {
      return false;
    }

    // 2. Check direct grant
    const grants = this._grants.get(subject);
    if (grants && grants.has(permission)) {
      return this._satisfiesResource(permission, resource);
    }

    // 3. Resolve via roles (through RoleManager)
    if (this._checkViaRoles(subject, permission)) {
      return this._satisfiesResource(permission, resource);
    }

    return false;
  }

  /**
   * Return true if the subject holds AT LEAST ONE of the listed permissions.
   * @param {string}   subject
   * @param {string[]} permissions
   * @param {object}   [resource]
   * @returns {boolean}
   */
  checkAny(subject, permissions, resource) {
    if (!Array.isArray(permissions) || permissions.length === 0) return false;
    for (const perm of permissions) {
      if (this.check(subject, perm, resource)) return true;
    }
    return false;
  }

  /**
   * Return true if the subject holds ALL of the listed permissions.
   * @param {string}   subject
   * @param {string[]} permissions
   * @param {object}   [resource]
   * @returns {boolean}
   */
  checkAll(subject, permissions, resource) {
    if (!Array.isArray(permissions) || permissions.length === 0) return false;
    for (const perm of permissions) {
      if (!this.check(subject, perm, resource)) return false;
    }
    return true;
  }

  /**
   * Return the full effective permission set for a subject (direct + role-based,
   * minus revocations).
   * @param {string} subject
   * @returns {Set<string>}
   */
  getEffectivePermissions(subject) {
    const effective = new Set();

    // Role-based
    const rolePerms = this._roleManager.getEffectivePermissions(subject);
    // If ADMIN wildcard is present, everything is allowed
    if (rolePerms.has("*")) {
      effective.add("*");
      return effective;
    }
    for (const p of rolePerms) effective.add(p);

    // Direct grants
    const grants = this._grants.get(subject);
    if (grants) {
      for (const p of grants) effective.add(p);
    }

    // Remove explicit revocations
    const revocations = this._revocations.get(subject);
    if (revocations) {
      for (const p of revocations) effective.delete(p);
    }

    return effective;
  }

  /**
   * Return a debug summary of why a subject does (or does not) have a permission.
   * @param {string}  subject
   * @param {string}  permission
   * @param {object}  [resource]
   * @returns {{ granted: boolean, path: string[], reason: string }}
   */
  explain(subject, permission, resource) {
    const path = [];

    // Revocation check
    const revocations = this._revocations.get(subject);
    if (revocations && revocations.has(permission)) {
      return {
        granted: false,
        path: ["explicit_deny"],
        reason: `Permission "${permission}" has been explicitly revoked for "${subject}".`,
      };
    }

    // Direct grant
    const grants = this._grants.get(subject);
    if (grants && grants.has(permission)) {
      const ok = this._satisfiesResource(permission, resource);
      if (ok) {
        return {
          granted: true,
          path: ["direct_grant"],
          reason: `Permission "${permission}" was directly granted to "${subject}".`,
        };
      }
      return {
        granted: false,
        path: ["direct_grant", "resource_mismatch"],
        reason: `Direct grant exists but resource constraint for "${permission}" was not satisfied.`,
      };
    }

    // Role-based
    const subjectRoles = this._roleManager.getRoles(subject);
    for (const role of subjectRoles) {
      const rolePerms = this._roleManager.getEffectivePermissions(subject);
      if (rolePerms.has("*") || rolePerms.has(permission)) {
        const ok = this._satisfiesResource(permission, resource);
        return {
          granted: ok,
          path: ok
            ? ["role_inheritance", role]
            : ["role_inheritance", role, "resource_mismatch"],
          reason: ok
            ? `Permission "${permission}" inherited from role "${role}".`
            : `Role "${role}" grants "${permission}" but resource constraint failed.`,
        };
      }
    }

    return {
      granted: false,
      path: ["implicit_deny"],
      reason: `No grant found for "${permission}" (not directly granted, not inherited from any role).`,
    };
  }

  /**
   * Grant multiple permissions at once.
   * @param {string}   subject
   * @param {string[]} permissions
   */
  grantMany(subject, permissions) {
    for (const perm of permissions) {
      this.grant(subject, perm);
    }
  }

  /**
   * Revoke multiple permissions at once.
   * @param {string}   subject
   * @param {string[]} permissions
   */
  revokeMany(subject, permissions) {
    for (const perm of permissions) {
      this.revoke(subject, perm);
    }
  }

  /**
   * Remove all grants and revocations for a subject.
   * @param {string} subject
   */
  clearSubject(subject) {
    this._grants.delete(subject);
    this._revocations.delete(subject);
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * @param {string} subject
   * @param {string} permission
   * @returns {boolean}
   */
  _checkViaRoles(subject, permission) {
    const rolePerms = this._roleManager.getEffectivePermissions(subject);
    // ADMIN wildcard
    if (rolePerms.has("*")) return true;
    return rolePerms.has(permission);
  }

  /**
   * Verify a resource descriptor against a permission definition scope.
   * When no resource is provided the check passes (scope-agnostic mode).
   * @param {string} permission
   * @param {object} [resource]
   * @returns {boolean}
   */
  _satisfiesResource(permission, resource) {
    if (!resource) return true;

    const def = this._definitions.get(permission);
    if (!def) return true; // no definition → no scope constraint

    const resourceScope = resource.scope;
    if (!resourceScope) return true; // unknown scope → pass through

    return def.scope === resourceScope;
  }
}

module.exports = { PermissionEngine };
