'use strict';

const router = require('./router');
const compressor = require('./compressor');

module.exports = {
  ...router,
  ...compressor,
};
