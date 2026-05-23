'use strict';

const {
  generateMermaid,
  flowchartFromDependencies,
  sequenceFromMessages,
  classFromCode,
  stateFromLifecycle,
  erFromSchema,
  ganttFromTasks,
} = require('./mermaid-gen');

const {
  BOX,
  barChart,
  lineChart,
  pieChart,
  treeChart,
  tableChart,
  ganttChart,
} = require('./ascii-charts');

const {
  generateBarChart,
  generateLineChart,
  generatePieChart,
  generateFlowDiagram,
  generateArchitectureDiagram,
  generateHeatMap,
} = require('./svg-gen');

module.exports = {
  generateMermaid,
  flowchartFromDependencies,
  sequenceFromMessages,
  classFromCode,
  stateFromLifecycle,
  erFromSchema,
  ganttFromTasks,
  BOX,
  barChart,
  lineChart,
  pieChart,
  treeChart,
  tableChart,
  ganttChart,
  generateBarChart,
  generateLineChart,
  generatePieChart,
  generateFlowDiagram,
  generateArchitectureDiagram,
  generateHeatMap,
};
