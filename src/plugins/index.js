'use strict';

const { PluginRegistry, PLUGIN_HOOK_NAMES } = require('../plugins');
const { PluginIndex } = require('./indexer');
const { PluginHotSwap } = require('./hotswap');
const { PluginIsolate } = require('./isolate');
const { DependencyGraph, satisfies } = require('./dependency');
const { PluginRepository } = require('./repository');

module.exports = {
  PluginRegistry,
  PLUGIN_HOOK_NAMES,
  PluginIndex,
  PluginHotSwap,
  PluginIsolate,
  DependencyGraph,
  satisfies,
  PluginRepository,
};
