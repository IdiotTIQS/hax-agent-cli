'use strict';

const capture = require('./capture');
const fixtureGen = require('./fixture-gen');
const playback = require('./playback');

module.exports = {
  ...capture,
  ...fixtureGen,
  ...playback,
};
