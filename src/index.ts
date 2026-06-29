// src/index.js — Library barrel (ESM).
// Each require() is now a top-level static import so the module graph resolves
// correctly under "type":"module".  The default export preserves the EXACT
// nested shape the test suite expects: `import api from '../src/index.js'`
// then `api.engine.Session`, `api.tools.ToolRegistry`, etc.

import * as engineAgent from "./engine/agent.js";
import * as toolsRegistry from "./tools/registry.js";
import * as apiProvider from "./api/provider.js";
import * as configSettings from "./config/settings.js";
import * as skillsRegistry from "./skills/registry.js";
import * as memoryStore from "./memory/store.js";
import * as commandsRegistry from "./commands/registry.js";

// New core
import * as stateAppState from "./state/app-state.js";
import * as platformsMod from "./platforms.js";
import * as configPaths from "./config/paths.js";
import * as vimTransitions from "./vim/transitions.js";
import * as outputStylesLoader from "./output-styles/loader.js";

// API layer (full parity)
import * as apiRetry from "./api/retry.js";
import * as apiUsage from "./api/usage.js";
import * as apiRegistry from "./api/registry.js";
import * as apiCodexClient from "./api/codex-client.js";
import * as apiCopilotAuth from "./api/copilot-auth.js";
import * as apiCopilotClient from "./api/copilot-client.js";

// Engine (full parity)
import * as engineQuery from "./engine/query.js";
import * as engineCostTracker from "./engine/cost-tracker.js";
import * as engineStreamEvents from "./engine/stream-events.js";

// Swarm
import * as swarmTypes from "./swarm/types.js";
import * as swarmMailbox from "./swarm/mailbox.js";
import * as swarmRegistry from "./swarm/registry.js";
import * as swarmTeamLifecycle from "./swarm/team-lifecycle.js";
import * as swarmInProcess from "./swarm/in-process.js";
import * as swarmSubprocessBackend from "./swarm/subprocess-backend.js";
import * as swarmLockfile from "./swarm/lockfile.js";
import * as swarmSpawnUtils from "./swarm/spawn-utils.js";
import * as swarmWorktree from "./swarm/worktree.js";
import * as swarmPermissionSync from "./swarm/permission-sync.js";

// Tasks
import * as tasksTypes from "./tasks/types.js";
import * as tasksManager from "./tasks/manager.js";
import * as tasksLocalAgentTask from "./tasks/local-agent-task.js";
import * as tasksStopTask from "./tasks/stop-task.js";

// Sandbox
import * as sandboxSession from "./sandbox/session.js";
import * as sandboxAdapter from "./sandbox/adapter.js";
import * as sandboxCrossPlatform from "./sandbox/cross-platform.js";
import * as sandboxPathValidator from "./sandbox/path-validator.js";
import * as sandboxDockerBackend from "./sandbox/docker-backend.js";
import * as sandboxDockerImage from "./sandbox/docker-image.js";

// Keybindings
import * as keybindingsLoader from "./keybindings/loader.js";
import * as keybindingsParser from "./keybindings/parser.js";
import * as keybindingsResolver from "./keybindings/resolver.js";
import * as keybindingsDefaultBindings from "./keybindings/default-bindings.js";

// Utils
import * as utilsFileLock from "./utils/file-lock.js";
import * as utilsFs from "./utils/fs-utils.js";
import * as utilsNetworkGuard from "./utils/network-guard.js";
import * as utilsShell from "./utils/shell-utils.js";
import * as utilsHelpers from "./utils/helpers.js";

// Bridge
import * as bridgeTypes from "./bridge/types.js";
import * as bridgeManager from "./bridge/manager.js";
import * as bridgeSessionRunner from "./bridge/session-runner.js";
import * as bridgeWorkSecret from "./bridge/work-secret.js";

// Auth
import * as authManager from "./auth/manager.js";
import * as authStorage from "./auth/storage.js";
import * as authExternal from "./auth/external.js";
import * as authFlows from "./auth/flows.js";

// Channels
import * as channelsAdapter from "./channels/adapter.js";
import * as channelsBase from "./channels/base.js";
import * as channelsImplManager from "./channels/impl/manager.js";
import * as channelsBusEvents from "./channels/bus/events.js";
import * as channelsBusQueue from "./channels/bus/queue.js";
import * as channelsTelegram from "./channels/impl/telegram.js";
import * as channelsSlack from "./channels/impl/slack.js";
import * as channelsDiscord from "./channels/impl/discord.js";
import * as channelsFeishu from "./channels/impl/feishu.js";
import * as channelsWechat from "./channels/impl/wechat.js";
import * as channelsDingtalk from "./channels/impl/dingtalk.js";
import * as channelsEmail from "./channels/impl/email.js";
import * as channelsQq from "./channels/impl/qq.js";
import * as channelsMatrix from "./channels/impl/matrix.js";
import * as channelsWhatsapp from "./channels/impl/whatsapp.js";
import * as channelsMochat from "./channels/impl/mochat.js";

// Autopilot
import * as autopilotTypes from "./autopilot/types.js";
import * as autopilotService from "./autopilot/service.js";

// Coordinator
import * as coordinatorAgentDefinitions from "./coordinator/agent-definitions.js";
import * as coordinatorCoordinatorMode from "./coordinator/coordinator-mode.js";

// Voice
import * as voiceKeyterms from "./voice/keyterms.js";
import * as voiceVoiceMode from "./voice/voice-mode.js";
import * as voiceStreamStt from "./voice/stream-stt.js";

// Memory (full parity)
import * as memoryCompact from "./memory/compact.js";
import * as memoryAgent from "./memory/agent.js";
import * as memoryMemdir from "./memory/memdir.js";
import * as memoryMigrate from "./memory/migrate.js";
import * as memoryPaths from "./memory/paths.js";
import * as memoryRelevance from "./memory/relevance.js";
import * as memoryScan from "./memory/scan.js";
import * as memorySearch from "./memory/search.js";
import * as memoryTeam from "./memory/team.js";
import * as memoryUsage from "./memory/usage.js";

// Hooks (full parity)
import * as hooksRegistry from "./hooks/registry.js";
import * as hooksHotReload from "./hooks/hot-reload.js";
import * as hooksLoader from "./hooks/loader.js";
import * as hooksSchemas from "./hooks/schemas.js";

// Plugins (full parity)
import * as pluginsRegistry from "./plugins/registry.js";
import * as pluginsInstaller from "./plugins/installer.js";
import * as pluginsSchema from "./plugins/schema.js";
import * as pluginsTypes from "./plugins/types.js";
import * as pluginsBundled from "./plugins/bundled/index.js";

// Skills (full parity)
import * as skillsTypes from "./skills/types.js";
import * as skillsFrontmatter from "./skills/_frontmatter.js";
import * as skillsBundled from "./skills/bundled/index.js";

// Prompts (full parity)
import * as promptsManager from "./prompts/manager.js";
import * as promptsClaudemd from "./prompts/claudemd.js";
import * as promptsContext from "./prompts/context.js";
import * as promptsEnvironment from "./prompts/environment.js";
import * as promptsSystemPrompt from "./prompts/system-prompt.js";

// Personalization (full parity)
import * as personalizationPersonalization from "./personalization/personalization.js";
import * as personalizationRules from "./personalization/rules.js";
import * as personalizationSessionHook from "./personalization/session-hook.js";

// Services (full parity)
import * as servicesLsp from "./services/lsp.js";
import * as servicesMcp from "./services/mcp.js";
import * as servicesAutodream from "./services/autodream.js";
import * as servicesMemoryExtract from "./services/memory-extract.js";
import * as servicesPersonalization from "./services/personalization.js";
import * as servicesSessionMemory from "./services/session-memory.js";
import * as servicesCron from "./services/cron.js";
import * as servicesCronScheduler from "./services/cron-scheduler.js";
import * as servicesSessionBackend from "./services/session-backend.js";
import * as servicesSessionStorage from "./services/session-storage.js";
import * as servicesTokenEstimation from "./services/token-estimation.js";
import * as servicesToolOutputs from "./services/tool-outputs.js";
import * as servicesOauth from "./services/oauth/index.js";

export default {
  // Original core
  engine: engineAgent,
  tools: toolsRegistry,
  api: apiProvider,
  config: configSettings,
  skills: skillsRegistry,
  memory: memoryStore,
  // NOTE: `tui` namespace removed in F6 (breaking export change) — src/tui/index.ts was dead code.
  commands: commandsRegistry,

  // New core
  state: stateAppState,
  platforms: platformsMod,
  paths: configPaths,
  vim: vimTransitions,
  outputStyles: outputStylesLoader,

  // API layer (full parity)
  api_full: {
    provider: apiProvider,
    retry: apiRetry,
    usage: apiUsage,
    registry: apiRegistry,
    codexClient: apiCodexClient,
    copilotAuth: apiCopilotAuth,
    copilotClient: apiCopilotClient,
  },

  // Engine (full parity)
  engine_full: {
    agent: engineAgent,
    query: engineQuery,
    costTracker: engineCostTracker,
    streamEvents: engineStreamEvents,
  },

  // Swarm
  swarm: {
    types: swarmTypes,
    mailbox: swarmMailbox,
    registry: swarmRegistry,
    teamLifecycle: swarmTeamLifecycle,
    inProcess: swarmInProcess,
    subprocessBackend: swarmSubprocessBackend,
    lockfile: swarmLockfile,
    spawnUtils: swarmSpawnUtils,
    worktree: swarmWorktree,
    permissionSync: swarmPermissionSync,
  },

  // Tasks
  tasks: {
    types: tasksTypes,
    manager: tasksManager,
    localAgentTask: tasksLocalAgentTask,
    stopTask: tasksStopTask,
  },

  // Sandbox
  sandbox: {
    session: sandboxSession,
    adapter: sandboxAdapter,
    crossPlatform: sandboxCrossPlatform,
    pathValidator: sandboxPathValidator,
    dockerBackend: sandboxDockerBackend,
    dockerImage: sandboxDockerImage,
  },

  // Keybindings
  keybindings: {
    loader: keybindingsLoader,
    parser: keybindingsParser,
    resolver: keybindingsResolver,
    defaultBindings: keybindingsDefaultBindings,
  },

  // Utils
  utils: {
    fileLock: utilsFileLock,
    fs: utilsFs,
    networkGuard: utilsNetworkGuard,
    shell: utilsShell,
    helpers: utilsHelpers,
  },

  // Bridge
  bridge: {
    types: bridgeTypes,
    manager: bridgeManager,
    sessionRunner: bridgeSessionRunner,
    workSecret: bridgeWorkSecret,
  },

  // Auth
  auth: {
    manager: authManager,
    storage: authStorage,
    external: authExternal,
    flows: authFlows,
  },

  // Channels
  channels: {
    adapter: channelsAdapter,
    base: channelsBase,
    manager: channelsImplManager,
    bus_events: channelsBusEvents,
    bus_queue: channelsBusQueue,
    telegram: channelsTelegram,
    slack: channelsSlack,
    discord: channelsDiscord,
    feishu: channelsFeishu,
    wechat: channelsWechat,
    dingtalk: channelsDingtalk,
    email: channelsEmail,
    qq: channelsQq,
    matrix: channelsMatrix,
    whatsapp: channelsWhatsapp,
    mochat: channelsMochat,
  },

  // Autopilot
  autopilot: {
    types: autopilotTypes,
    service: autopilotService,
  },

  // Coordinator
  coordinator: {
    agentDefinitions: coordinatorAgentDefinitions,
    coordinatorMode: coordinatorCoordinatorMode,
  },

  // Voice
  voice: {
    keyterms: voiceKeyterms,
    voiceMode: voiceVoiceMode,
    streamStt: voiceStreamStt,
  },

  // Memory (full parity)
  memory_full: {
    store: memoryStore,
    compact: memoryCompact,
    agent: memoryAgent,
    memdir: memoryMemdir,
    migrate: memoryMigrate,
    paths: memoryPaths,
    relevance: memoryRelevance,
    scan: memoryScan,
    search: memorySearch,
    team: memoryTeam,
    usage: memoryUsage,
  },

  // Hooks (full parity)
  hooks_full: {
    registry: hooksRegistry,
    hotReload: hooksHotReload,
    loader: hooksLoader,
    schemas: hooksSchemas,
  },

  // Plugins (full parity)
  plugins_full: {
    registry: pluginsRegistry,
    installer: pluginsInstaller,
    schema: pluginsSchema,
    types: pluginsTypes,
    bundled: pluginsBundled,
  },

  // Skills (full parity)
  skills_full: {
    registry: skillsRegistry,
    types: skillsTypes,
    frontmatter: skillsFrontmatter,
    bundled: skillsBundled,
  },

  // Prompts (full parity)
  prompts_full: {
    manager: promptsManager,
    claudemd: promptsClaudemd,
    context: promptsContext,
    environment: promptsEnvironment,
    systemPrompt: promptsSystemPrompt,
  },

  // Personalization (full parity)
  personalization_full: {
    personalization: personalizationPersonalization,
    rules: personalizationRules,
    sessionHook: personalizationSessionHook,
  },

  // Services (full parity)
  services_full: {
    lsp: servicesLsp,
    mcp: servicesMcp,
    autodream: servicesAutodream,
    memoryExtract: servicesMemoryExtract,
    personalization: servicesPersonalization,
    sessionMemory: servicesSessionMemory,
    cron: servicesCron,
    cronScheduler: servicesCronScheduler,
    sessionBackend: servicesSessionBackend,
    sessionStorage: servicesSessionStorage,
    tokenEstimation: servicesTokenEstimation,
    toolOutputs: servicesToolOutputs,
    oauth: servicesOauth,
  },
};
