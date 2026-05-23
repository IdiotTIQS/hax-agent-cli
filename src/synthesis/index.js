'use strict';

const { OutcomeMerger, ExtractedPoint, MERGE_STRATEGIES } = require('./merger');
const { OutcomeQuality, QUALITY_DIMENSIONS, MINIMUM_VIABLE_SCORE } = require('./quality');

module.exports = {
  OutcomeMerger,
  ExtractedPoint,
  MERGE_STRATEGIES,
  OutcomeQuality,
  QUALITY_DIMENSIONS,
  MINIMUM_VIABLE_SCORE,
};
