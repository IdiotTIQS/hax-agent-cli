'use strict';

const config = require('./config');
const context = require('./context');
const contextModules = require('./context/index');
const fileContext = require('./file-context');
const memory = require('./memory');
const orchestration = require('./orchestration');
const basicRuntime = require('./runtime');
const { createAuthRefactorTeam } = require('./teams/auth-refactor');
const agentTeams = require('./teams/runtime');
const teamAgents = require('./teams/agents');
const teamTools = require('./teams/tools');
const { formatTeamPlan } = require('./teams/team-plan-formatter');
const agentTeamFormatters = require('./teams/agent-teams-formatter');
const collab = require('./collab');
const coordination = require('./coordination');
const debate = require('./debate');
const handoff = require('./handoff');
const ownership = require('./ownership');
const { UndoStack } = require('./undo-stack');
const { PluginRegistry, PLUGIN_HOOK_NAMES, PluginIndex, PluginHotSwap, PluginIsolate, DependencyGraph, satisfies, PluginRepository } = require('./plugins/index');
const { validatePlugin, assertValidPlugin, formatPluginValidationResult } = require('./plugin-validator');
const { PluginMarketplace, MarketplaceCurator, TASK_KEYWORDS } = require('./marketplace/index');
const { runBatchMode } = require('./batch');
const { exportSessionToMarkdown, exportSessionToJson, exportSessionToText } = require('./export');
const { createRetryableTool } = require('./tool-retry');
const { persistGoal, restoreGoal } = require('./goal-persistence');
const { compactMessages, buildCompactionPrompt, buildCompactMessages } = require('./context-compaction');
const tokens = require('./tokens');
const preserve = require('./preserve');
const optimizer = require('./optimizer');
const { getPreset, listPresets, applyPreset } = require('./config-presets');
const { summarizeSession, listSummaries, getSessionTimeline } = require('./session-summary');
const codegen = require('./codegen');
const diagram = require('./diagram');
const diff = require('./diff');
const review = require('./review');
const testing = require('./testing');
const devTooling = require('./dev-tooling');
const hotreload = require('./hotreload');
const health = require('./health');
const logs = require('./logs');
const notify = require('./notify');
const quota = require('./quota');
const resilience = require('./resilience');
const watcher = require('./watcher');
const state = require('./state');
const streaming = require('./streaming');
const recorder = require('./recorder');
const replay = require('./replay');
const branches = require('./branches');
const bridge = require('./bridge');
const strategy = require('./strategy');
const improvement = require('./improvement');
const goals = require('./goals');
const workflow = require('./workflow');
const gateway = require('./gateway');
const injection = require('./injection');
const safety = require('./safety');
const sandbox = require('./sandbox');
const security = require('./security');
const rbac = require('./rbac');
const trust = require('./trust');
const compliance = require('./compliance');
const ci = require('./ci');
const contracts = require('./contracts');
const migration = require('./migration');
const semver = require('./semver');
const versioning = require('./versioning');
const governance = require('./governance');
const platform = require('./platform');
const consolidation = require('./consolidation');
const quality = require('./quality');
const sim = require('./sim');
const reinforcement = require('./reinforcement');
const regression = require('./regression');
const protocol = require('./protocol');
const patterns = require('./patterns');
const palette = require('./palette');
const models = require('./models');
const resources = require('./resources');
const analytics = require('./analytics');
const intel = require('./intel');
const nlp = require('./nlp');
const explain = require('./explain');
const prediction = require('./prediction');
const similarity = require('./similarity');
const multimodal = require('./multimodal');
const extraction = require('./extraction');
const search = require('./search');
const data = require('./data');
const compatCore = require('./compat');
const conversationCore = require('./conversation');
const dashboardCore = require('./dashboard');
const docsCore = require('./docs');
const integrationsCore = require('./integrations');
const isolateCore = require('./isolate');
const personalityCore = require('./personality');
const promptsCore = require('./prompts');
const pruningCore = require('./pruning');
const timeCore = require('./time');
const workspaceCore = require('./workspace');
const { createAgent } = require('./hub');

// Advanced Features & Utilities
const artifacts = require('./artifact');
const generator = require('./generator');
const graph = require('./graph');
const synthesis = require('./synthesis');
const visualize = require('./visualize');
const planner = require('./planner');
const tasks = require('./tasks');
const tutorial = require('./tutorial');
const training = require('./training');
const benchmark = require('./benchmark');
const cache = require('./cache');
const capability = require('./capability');
const catalog = require('./catalog');
const cliUtils = require('./cli-utils');
const errors = require('./shared/errors');
const files = require('./files');
const format = require('./format');
const deps = require('./deps');
const shared = require('./shared');
// utils/ merged into shared/ — serialization re-exports via shared/index.js
const events = require('./events');

module.exports = {
  config,
  context,
  fileContext,
  memory,
  basicRuntime,
  ...orchestration,
  ...basicRuntime,
  ...agentTeams,
  ...teamAgents,
  ...teamTools,
  ...agentTeamFormatters,
  ...collab,
  ...coordination,
  ...debate,
  ...handoff,
  ...ownership,
  ...codegen,
  ...diagram,
  ...diff,
  ...review,
  ...testing,
  ...devTooling,
  ...hotreload,
  ...health,
  ...logs,
  ...notify,
  ...quota,
  ...resilience,
  ...watcher,
  ...state,
  ...streaming,
  ...recorder,
  ...replay,
  ...tokens,
  ...contextModules,
  ...preserve,
  ...optimizer,
  ...branches,
  ...bridge,
  ...strategy,
  ...improvement,
  ...goals,
  ...workflow,
  ...gateway,
  ...sandbox,
  ...injection,
  ...safety,
  ...security,
  ...rbac,
  ...trust,
  ...compliance,
  ...ci,
  ...contracts,
  ...migration,
  ...semver,
  ...versioning,
  ...governance,
  ...platform,
  ...consolidation,
  ...quality,
  ...sim,
  ...reinforcement,
  ...regression,
  ...protocol,
  ...patterns,
  ...palette,
  ...models,
  ...resources,
  ...analytics,
  ...intel,
  ...nlp,
  ...explain,
  ...prediction,
  ...similarity,
  ...multimodal,
  ...extraction,
  ...search,
  ...data,

  // Advanced Features & Utilities
  ...artifacts,
  ...generator,
  ...graph,
  ...synthesis,
  ...visualize,
  ...planner,
  ...tasks,
  ...tutorial,
  ...training,
  ...benchmark,
  ...cache,
  ...capability,
  ...catalog,
  ...cliUtils,
  ...errors,
  ...files,
  ...format,
  ...deps,
  ...shared,
  ...events,

  ...compatCore,
  ...conversationCore,
  ...dashboardCore,
  ...docsCore,
  ...integrationsCore,
  ...isolateCore,
  ...personalityCore,
  ...promptsCore,
  ...pruningCore,
  ...timeCore,
  ...workspaceCore,
  createAuthRefactorTeam,
  formatTeamPlan,
  UndoStack,
  PluginRegistry,
  PLUGIN_HOOK_NAMES,
  PluginIndex,
  PluginHotSwap,
  PluginIsolate,
  DependencyGraph,
  satisfies,
  PluginRepository,
  validatePlugin,
  assertValidPlugin,
  formatPluginValidationResult,
  PluginMarketplace,
  MarketplaceCurator,
  TASK_KEYWORDS,
  runBatchMode,
  exportSessionToMarkdown,
  exportSessionToJson,
  exportSessionToText,
  createRetryableTool,
  persistGoal,
  restoreGoal,
  compactMessages,
  buildCompactionPrompt,
  buildCompactMessages,
  getPreset,
  listPresets,
  applyPreset,
  summarizeSession,
  listSummaries,
  getSessionTimeline,
  createAgent,
};
