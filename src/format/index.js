'use strict';

const {
  highlightJs,
  highlightJson,
  highlightMarkdown,
  highlightDiff,
  highlightShell,
  highlightXml,
} = require('./syntax');
const {
  prettifyJson,
  prettifyXml,
  formatCodeBlock,
  formatTable,
  formatList,
  formatKeyValue,
  truncate,
} = require('./pretty');
const { FormatPipeline } = require('./pipeline');

module.exports = {
  highlightJs,
  highlightJson,
  highlightMarkdown,
  highlightDiff,
  highlightShell,
  highlightXml,
  prettifyJson,
  prettifyXml,
  formatCodeBlock,
  formatTable,
  formatList,
  formatKeyValue,
  truncate,
  FormatPipeline,
};
