"use strict";
/** Swarm lockfile — re-exports from utils/file-lock. Ported from OpenHarness swarm/lockfile.py */
const { exclusiveFileLock, SwarmLockError, SwarmLockUnavailableError } = require("../utils/file-lock");
module.exports = { exclusiveFileLock, SwarmLockError, SwarmLockUnavailableError };
