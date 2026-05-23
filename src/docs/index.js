'use strict';

const { DocBrowser, SECTION, wordWrap, clipText } = require('./browser');
const { COMMANDS_DOCS, TOOLS_DOCS, PLUGINS_DOCS, CONFIG_DOCS, API_DOCS, EXAMPLES } = require('./content');
const { buildSearchIndex, search, fuzzyMatch, getSuggestions, tokenize, levenshteinDistance } = require('./search');

module.exports = {
  DocBrowser,
  SECTION,
  wordWrap,
  clipText,
  COMMANDS_DOCS,
  TOOLS_DOCS,
  PLUGINS_DOCS,
  CONFIG_DOCS,
  API_DOCS,
  EXAMPLES,
  buildSearchIndex,
  search,
  fuzzyMatch,
  getSuggestions,
  tokenize,
  levenshteinDistance,
};
