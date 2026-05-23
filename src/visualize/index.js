'use strict';

const { DecisionTreeRenderer, ANSI: DT_ANSI, BOX: DT_BOX } = require('./decision-tree');
const { FlowRenderer, ANSI: FL_ANSI, BOX: FL_BOX } = require('./flow');

module.exports = {
  DecisionTreeRenderer,
  FlowRenderer,
};
