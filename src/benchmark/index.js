'use strict';

const { Benchmark, computeStats, percentile } = require('./runner');
const {
  benchmarkToolExecution,
  benchmarkTokenEstimation,
  benchmarkFileOperations,
  benchmarkMessageProcessing,
  benchmarkContextBudget,
} = require('./scenarios');
const {
  formatAsText,
  formatAsMarkdown,
  formatAsJson,
  formatComparison,
  detectRegression,
} = require('./reporter');

module.exports = {
  Benchmark,
  computeStats,
  percentile,
  benchmarkToolExecution,
  benchmarkTokenEstimation,
  benchmarkFileOperations,
  benchmarkMessageProcessing,
  benchmarkContextBudget,
  formatAsText,
  formatAsMarkdown,
  formatAsJson,
  formatComparison,
  detectRegression,
};
