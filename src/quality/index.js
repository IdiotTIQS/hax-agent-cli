'use strict';

const gates = require('./gates');
const reporter = require('./reporter');
const autoFix = require('./auto-fix');

module.exports = {
  ...gates,
  ...reporter,
  ...autoFix,
};
