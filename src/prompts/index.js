'use strict';

const { ABTestEngine } = require('./ab-test');
const { buildSystemPrompt, withRole, withContext, withConstraints, withOutputFormat } = require('./builder');
const { PromptEvolution } = require('./evolution');
const { PromptOptimizer, Strategy } = require('./optimizer');
const { SENIOR_DEVELOPER, CODE_REVIEWER, SECURITY_ENGINEER, TEST_ENGINEER, DEVOPS_ENGINEER, DATA_SCIENTIST, TECH_WRITER, ARCHITECT, DEBUGGER, PERFORMANCE_ENGINEER } = require('./roles');
const { CODE_REVIEW, REFACTOR_PLAN, BUG_INVESTIGATION, TEST_GENERATION, DOCUMENTATION, SECURITY_AUDIT, ARCHITECTURE_REVIEW, PERFORMANCE_ANALYSIS, DEPENDENCY_UPDATE, API_DESIGN } = require('./templates');
const { PromptVersionControl } = require('./versioning');

module.exports = {
  ABTestEngine,
  buildSystemPrompt,
  withRole,
  withContext,
  withConstraints,
  withOutputFormat,
  PromptEvolution,
  PromptOptimizer,
  Strategy,
  SENIOR_DEVELOPER,
  CODE_REVIEWER,
  SECURITY_ENGINEER,
  TEST_ENGINEER,
  DEVOPS_ENGINEER,
  DATA_SCIENTIST,
  TECH_WRITER,
  ARCHITECT,
  DEBUGGER,
  PERFORMANCE_ENGINEER,
  CODE_REVIEW,
  REFACTOR_PLAN,
  BUG_INVESTIGATION,
  TEST_GENERATION,
  DOCUMENTATION,
  SECURITY_AUDIT,
  ARCHITECTURE_REVIEW,
  PERFORMANCE_ANALYSIS,
  DEPENDENCY_UPDATE,
  API_DESIGN,
  PromptVersionControl,
};
