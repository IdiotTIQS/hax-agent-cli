'use strict';

const detect = require('./detect');
const paths = require('./paths');
const env = require('./env');

module.exports = {
  ...detect,
  ...paths,
  ...env,
};
