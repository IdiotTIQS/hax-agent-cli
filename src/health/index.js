'use strict';

const scorer = require('./scorer');
const debtTracker = require('./debt-tracker');
const recommendations = require('./recommendations');
const visualizer = require('./visualizer');
const monitor = require('./monitor');

module.exports = {
  ...scorer,
  ...debtTracker,
  ...recommendations,
  ...visualizer,
  ...monitor,
};
