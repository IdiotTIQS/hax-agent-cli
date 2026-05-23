/**
 * RoleManager — role definition, subject-to-role assignment, and role queries.
 *
 * Pre-built roles ship with curated permission sets:
 *   ADMIN      — unrestricted access
 *   OPERATOR   — system-operations and tool management
 *   DEVELOPER  — code read/write, test execution, configuration
 *   VIEWER     — read-only access across all tools
 *   AUDITOR    — read + audit-log access
 *   AGENT      — agent-specific permissions (read, write, shell-sandbox)
 *   RESTRICTED — minimal permissions, mostly denied by default
 */
"use strict";

// ---------------------------------------------------------------------------
// Pre-built permission sets for each role
// ---------------------------------------------------------------------------
const ROLE_PERMISSIONS = Object.freeze({
  ADMIN: Object.freeze([
    "*",
  ]),

  OPERATOR: Object.freeze([
    "shell.run",
    "file.read",
    "file.write",
    "file.edit",
    "file.delete",
    "file.glob",
    "file.search",
    "system.manage",
    "system.monitor",
    "user.manage",
    "rbac.manage",
  ]),

  DEVELOPER: Object.freeze([
    "file.read",
    "file.write",
    "file.edit",
    "file.delete",
    "file.glob",
    "file.search",
    "shell.run.safe",
    "test.execute",
    "config.read",
    "config.write",
  ]),

  VIEWER: Object.freeze([
    "file.read",
    "file.glob",
    "file.search",
    "config.read",
  ]),

  AUDITOR: Object.freeze([
    "file.read",
    "file.glob",
    "file.search",
    "config.read",
    "audit.read",
    "audit.export",
  ]),

  AGENT: Object.freeze([
    "file.read",
    "file.write",
    "file.edit",
    "file.glob",
    "file.search",
    "shell.run.safe",
    "web.fetch",
    "web.search",
    "conversation.read",
    "conversation.write",
    "agent.delegate",
  ]),

  RESTRICTED: Object.freeze([
    "file.read",
  ]),
});

const BUILT_IN_ROLES = Object.keys(ROLE_PERMISSIONS);

// ---------------------------------------------------------------------------
// RoleManager
// ---------------------------------------------------------------------------
class RoleManager {
  constructor() {
    /** @type {Map<string, Set<string>>}  role name → set of permission strings */
    this._roles = new Map();
    /** @type {Map<string, Set<string>>}  subject id → set of role names */
    this._subjects = new Map();

    // Seed built-in roles
    for (const [name, perms] of Object.entries(ROLE_PERMISSIONS)) {
      this._roles.set(name, new Set(perms));
    }
  }

  /**
   * Define (or redefine) a named role with an optional set of permissions.
   * If the role already exists its permissions are replaced.
   * @param {string} name
   * @param {string[]} [permissions]
   */
  defineRole(name, permissions) {
    this._roles.set(name, new Set(permissions || []));
  }

  /**
   * Assign a role to a subject.
   * @param {string} subject  subject identifier
   * @param {string} role     role name
   */
  grantRole(subject, role) {
    if (!this._roles.has(role)) {
      throw new Error(`Unknown role: ${role}`);
    }
    let roles = this._subjects.get(subject);
    if (!roles) {
      roles = new Set();
      this._subjects.set(subject, roles);
    }
    roles.add(role);
  }

  /**
   * Remove a role from a subject.
   * @param {string} subject
   * @param {string} role
   */
  revokeRole(subject, role) {
    const roles = this._subjects.get(subject);
    if (roles) {
      roles.delete(role);
      if (roles.size === 0) {
        this._subjects.delete(subject);
      }
    }
  }

  /**
   * Return an array of role names assigned to a subject.
   * @param {string} subject
   * @returns {string[]}
   */
  getRoles(subject) {
    const roles = this._subjects.get(subject);
    return roles ? [...roles] : [];
  }

  /**
   * Check whether a subject holds a specific role.
   * @param {string} subject
   * @param {string} role
   * @returns {boolean}
   */
  hasRole(subject, role) {
    const roles = this._subjects.get(subject);
    return roles ? roles.has(role) : false;
  }

  /**
   * Collect the effective permission set for a subject by unioning the
   * permissions of all assigned roles.
   * @param {string} subject
   * @returns {Set<string>}
   */
  getEffectivePermissions(subject) {
    const permissions = new Set();
    const roles = this._subjects.get(subject);
    if (!roles) return permissions;

    for (const role of roles) {
      // ADMIN wildcard
      if (role === "ADMIN") {
        permissions.add("*");
        return permissions;
      }
      const rolePerms = this._roles.get(role);
      if (rolePerms) {
        for (const perm of rolePerms) {
          permissions.add(perm);
        }
      }
    }
    return permissions;
  }

  /**
   * Return all subjects that hold a given role.
   * @param {string} role
   * @returns {string[]}
   */
  getSubjectsWithRole(role) {
    const result = [];
    for (const [subject, roles] of this._subjects) {
      if (roles.has(role)) {
        result.push(subject);
      }
    }
    return result;
  }

  /**
   * Return an array of all known role names (built-in + user-defined).
   * @returns {string[]}
   */
  listRoles() {
    return [...this._roles.keys()];
  }

  /**
   * Remove all role assignments for a subject.
   * @param {string} subject
   */
  clearRoles(subject) {
    this._subjects.delete(subject);
  }

  /**
   * Reset the manager to its initial state (built-in roles only, no assignments).
   */
  reset() {
    this._roles.clear();
    this._subjects.clear();
    for (const [name, perms] of Object.entries(ROLE_PERMISSIONS)) {
      this._roles.set(name, new Set(perms));
    }
  }
}

module.exports = {
  RoleManager,
  ROLE_PERMISSIONS,
  BUILT_IN_ROLES,
};
