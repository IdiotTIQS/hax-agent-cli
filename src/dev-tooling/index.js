'use strict';

const {
  initProject,
  verifyProject,
  getProjectInfo,
  HAX_DIR,
  DEFAULT_CONFIG,
} = require('./project-init');

const {
  validatePlugin,
  validateSkill,
  validateAgentDef,
  validateConfig,
  CONFIG_SCHEMA,
} = require('./validator');

const {
  scaffoldPlugin,
  scaffoldSkill,
  scaffoldTool,
  scaffoldAgent,
  scaffoldTest,
} = require('./scaffold');

module.exports = {
  initProject,
  verifyProject,
  getProjectInfo,
  HAX_DIR,
  DEFAULT_CONFIG,
  validatePlugin,
  validateSkill,
  validateAgentDef,
  validateConfig,
  CONFIG_SCHEMA,
  scaffoldPlugin,
  scaffoldSkill,
  scaffoldTool,
  scaffoldAgent,
  scaffoldTest,
};
