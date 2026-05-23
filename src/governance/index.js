'use strict';

const policyEngine = require('./policy-engine');
const auditor = require('./auditor');

module.exports = {
  ...policyEngine,
  ...auditor,
};
