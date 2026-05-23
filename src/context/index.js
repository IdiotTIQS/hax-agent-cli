'use strict';

const { ContextInjector } = require('./injector');
const { ContextSelector, CONTEXT_SOURCES, RELEVANCE_WEIGHTS } = require('./selector');
const {
  CODE_REVIEW_CONTEXT,
  BUG_FIX_CONTEXT,
  FEATURE_CONTEXT,
  REFACTOR_CONTEXT,
  EXPLAIN_CONTEXT,
  DEPLOY_CONTEXT,
  getTemplate,
  listTemplates,
  detectTemplate,
  buildTemplateContext,
} = require('./templates');

module.exports = {
  ContextInjector,
  ContextSelector,
  CONTEXT_SOURCES,
  RELEVANCE_WEIGHTS,
  CODE_REVIEW_CONTEXT,
  BUG_FIX_CONTEXT,
  FEATURE_CONTEXT,
  REFACTOR_CONTEXT,
  EXPLAIN_CONTEXT,
  DEPLOY_CONTEXT,
  getTemplate,
  listTemplates,
  detectTemplate,
  buildTemplateContext,
};
