'use strict';

const lockfile = require('./lockfile');
const semver = require('./semver');
const upgrade = require('./upgrade');

module.exports = {
  ...lockfile,
  ...semver,
  ...upgrade,
};
