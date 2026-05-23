'use strict';

const engine = require('./engine');
const diffAnalyzer = require('./diff-analyzer');

module.exports = {
  ...engine,
  ...diffAnalyzer,
};
