'use strict';

const matcher = require('./matcher');
const classifier = require('./classifier');

module.exports = {
  ...matcher,
  ...classifier,
};
