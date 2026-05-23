'use strict';

const optimizer = require('./optimizer');
const adapter = require('./adapter');

module.exports = {
  ...optimizer,
  ...adapter,
};
