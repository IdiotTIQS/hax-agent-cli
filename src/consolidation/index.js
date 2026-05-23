'use strict';

const analyzer = require('./analyzer');
const migrationGuide = require('./migration-guide');
const report = require('./report');

module.exports = {
  ...analyzer,
  ...migrationGuide,
  ...report,
};
