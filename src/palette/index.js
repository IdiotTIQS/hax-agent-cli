'use strict';

const providers = require('./providers');
const search = require('./search');
const engine = require('./engine');

module.exports = {
  ...providers,
  ...search,
  ...engine,
};
