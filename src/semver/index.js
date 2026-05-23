'use strict';

const analyzer = require('./analyzer');
const changelog = require('./changelog');
const constraints = require('./constraints');

module.exports = {
  ...analyzer,
  ...changelog,
  ...constraints,
};
