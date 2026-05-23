'use strict';

const channels = require('./channels');
const manager = require('./manager');
const triggers = require('./triggers');
const aggregator = require('./aggregator');
const rulesEngine = require('./rules-engine');

module.exports = {
  ...channels,
  ...manager,
  ...triggers,
  ...aggregator,
  ...rulesEngine,
};
