'use strict';

const { APIAdapter, ChainAdapter, AutoAdapter } = require('./adapter');
const { DeprecationManager, LEVELS } = require('./deprecation');
const { PolyfillRegistry, BUILTIN_POLYFILLS } = require('./polyfill');

module.exports = {
  APIAdapter,
  ChainAdapter,
  AutoAdapter,
  DeprecationManager,
  LEVELS,
  PolyfillRegistry,
  BUILTIN_POLYFILLS,
};
