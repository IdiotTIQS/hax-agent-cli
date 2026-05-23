'use strict';

const {
  TemplateRegistry,
  PACKAGE_JSON_TPL,
  TSCONFIG_JSON_TPL,
  DOTENV_TPL,
  DOCKER_COMPOSE_TPL,
  MAKEFILE_TPL,
  GITHUB_ACTIONS_TPL,
  GITLAB_CI_TPL,
} = require('./templates');
const { ProjectGenerator, sanitizeName } = require('./project-gen');
const { FileGenerator, mergeVariables } = require('./file-gen');
const { ProjectComposer, buildDefaultParts, deepMerge } = require('./composer');
const { ProjectCustomizer, readJSON, writeJSON, parseEnvContent, serializeEnvContent } = require('./customizer');

module.exports = {
  TemplateRegistry,
  PACKAGE_JSON_TPL,
  TSCONFIG_JSON_TPL,
  DOTENV_TPL,
  DOCKER_COMPOSE_TPL,
  MAKEFILE_TPL,
  GITHUB_ACTIONS_TPL,
  GITLAB_CI_TPL,
  ProjectGenerator,
  sanitizeName,
  FileGenerator,
  mergeVariables,
  ProjectComposer,
  buildDefaultParts,
  deepMerge,
  ProjectCustomizer,
  readJSON,
  writeJSON,
  parseEnvContent,
  serializeEnvContent,
};
