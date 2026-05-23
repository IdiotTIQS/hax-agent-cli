'use strict';

const alerting = require('./alerting');
const detector = require('./detector');
const rootCause = require('./root-cause');

module.exports = {
  ...alerting,
  ...detector,
  ...rootCause,
};
