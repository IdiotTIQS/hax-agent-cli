'use strict';

const { BranchManager } = require('./manager');
const { BranchMerger, STRATEGIES } = require('./merge');
const { BranchComparison } = require('./comparison');

module.exports = {
  BranchManager,
  BranchMerger,
  STRATEGIES,
  BranchComparison,
};
