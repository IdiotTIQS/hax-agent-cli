'use strict';

const { RoleManager, ROLE_PERMISSIONS, BUILT_IN_ROLES } = require('./roles');
const { PermissionEngine } = require('./permissions');
const { PolicyEngine } = require('./policy');

module.exports = {
  RoleManager,
  ROLE_PERMISSIONS,
  BUILT_IN_ROLES,
  PermissionEngine,
  PolicyEngine,
};
