'use strict';

const { StrategyRegistry, STRATEGY_CATEGORIES, DEFAULT_STRATEGIES } = require('./registry');
const { StrategyEngine, SCORE_THRESHOLD, ADAPT_DECAY_FACTOR, MEASURE_WEIGHTS } = require('./engine');
const { STRATEGY_LIBRARY, getStrategy, getStrategiesByType, getStrategyNames } = require('./library');

module.exports = {
  StrategyRegistry,
  STRATEGY_CATEGORIES,
  DEFAULT_STRATEGIES,
  StrategyEngine,
  SCORE_THRESHOLD,
  ADAPT_DECAY_FACTOR,
  MEASURE_WEIGHTS,
  STRATEGY_LIBRARY,
  getStrategy,
  getStrategiesByType,
  getStrategyNames,
};
