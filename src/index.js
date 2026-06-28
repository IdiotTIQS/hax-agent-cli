"use strict";
module.exports = {
  // Original core
  engine: require("./engine/agent"),
  tools: require("./tools/registry"),
  api: require("./api/provider"),
  config: require("./config/settings"),
  skills: require("./skills/registry"),
  memory: require("./memory/store"),
  tui: require("./tui/index"),
  commands: require("./commands/registry"),

  // New core
  state: require("./state/app-state"),
  platforms: require("./platforms"),
  paths: require("./config/paths"),
  vim: require("./vim/transitions"),
  outputStyles: require("./output-styles/loader"),

  // API layer (full parity)
  api_full: {
    provider: require("./api/provider"),
    retry: require("./api/retry"),
    usage: require("./api/usage"),
    registry: require("./api/registry"),
    codexClient: require("./api/codex-client"),
    copilotAuth: require("./api/copilot-auth"),
    copilotClient: require("./api/copilot-client"),
  },

  // Engine (full parity)
  engine_full: {
    agent: require("./engine/agent"),
    query: require("./engine/query"),
    costTracker: require("./engine/cost-tracker"),
    streamEvents: require("./engine/stream-events"),
  },

  // Swarm (8/10 files)
  swarm: {
    types: require("./swarm/types"),
    mailbox: require("./swarm/mailbox"),
    registry: require("./swarm/registry"),
    teamLifecycle: require("./swarm/team-lifecycle"),
    inProcess: require("./swarm/in-process"),
    subprocessBackend: require("./swarm/subprocess-backend"),
    lockfile: require("./swarm/lockfile"),
    spawnUtils: require("./swarm/spawn-utils"),
    worktree: require("./swarm/worktree"),
    permissionSync: require("./swarm/permission-sync"),
  },

  // Tasks (4/5 files)
  tasks: {
    types: require("./tasks/types"),
    manager: require("./tasks/manager"),
    localAgentTask: require("./tasks/local-agent-task"),
    stopTask: require("./tasks/stop-task"),
  },

  // Sandbox (5/5 files — 100%)
  sandbox: {
    session: require("./sandbox/session"),
    adapter: require("./sandbox/adapter"),
    crossPlatform: require("./sandbox/cross-platform"),
    pathValidator: require("./sandbox/path-validator"),
    dockerBackend: require("./sandbox/docker-backend"),
    dockerImage: require("./sandbox/docker-image"),
  },

  // Keybindings (4/4 files — 100%)
  keybindings: {
    loader: require("./keybindings/loader"),
    parser: require("./keybindings/parser"),
    resolver: require("./keybindings/resolver"),
    defaultBindings: require("./keybindings/default-bindings"),
  },

  // Utils (5/5 files — 100%)
  utils: {
    fileLock: require("./utils/file-lock"),
    fs: require("./utils/fs-utils"),
    networkGuard: require("./utils/network-guard"),
    shell: require("./utils/shell-utils"),
    helpers: require("./utils/helpers"),
  },

  // Bridge (4/4 files — 100%)
  bridge: {
    types: require("./bridge/types"),
    manager: require("./bridge/manager"),
    sessionRunner: require("./bridge/session-runner"),
    workSecret: require("./bridge/work-secret"),
  },

  // Auth (4/4 files — 100%)
  auth: {
    manager: require("./auth/manager"),
    storage: require("./auth/storage"),
    external: require("./auth/external"),
    flows: require("./auth/flows"),
  },

  // Channels (14/14 files — 100%)
  channels: {
    adapter: require("./channels/adapter"),
    base: require("./channels/base"),
    manager: require("./channels/impl/manager"),
    bus_events: require("./channels/bus/events"),
    bus_queue: require("./channels/bus/queue"),
    telegram: require("./channels/impl/telegram"),
    slack: require("./channels/impl/slack"),
    discord: require("./channels/impl/discord"),
    feishu: require("./channels/impl/feishu"),
    wechat: require("./channels/impl/wechat"),
    dingtalk: require("./channels/impl/dingtalk"),
    email: require("./channels/impl/email"),
    qq: require("./channels/impl/qq"),
    matrix: require("./channels/impl/matrix"),
    whatsapp: require("./channels/impl/whatsapp"),
    mochat: require("./channels/impl/mochat"),
  },

  // Autopilot (2/2 files — 100%)
  autopilot: {
    types: require("./autopilot/types"),
    service: require("./autopilot/service"),
  },

  // Coordinator (2/2 files — 100%)
  coordinator: {
    agentDefinitions: require("./coordinator/agent-definitions"),
    coordinatorMode: require("./coordinator/coordinator-mode"),
  },

  // Voice (3/3 files — 100%)
  voice: {
    keyterms: require("./voice/keyterms"),
    voiceMode: require("./voice/voice-mode"),
    streamStt: require("./voice/stream-stt"),
  },

  // Memory (full parity)
  memory_full: {
    store: require("./memory/store"),
    compact: require("./memory/compact"),
    agent: require("./memory/agent"),
    memdir: require("./memory/memdir"),
    migrate: require("./memory/migrate"),
    paths: require("./memory/paths"),
    relevance: require("./memory/relevance"),
    scan: require("./memory/scan"),
    search: require("./memory/search"),
    team: require("./memory/team"),
    usage: require("./memory/usage"),
  },

  // Hooks (full parity)
  hooks_full: {
    registry: require("./hooks/registry"),
    hotReload: require("./hooks/hot-reload"),
    loader: require("./hooks/loader"),
    schemas: require("./hooks/schemas"),
  },

  // Plugins (full parity)
  plugins_full: {
    registry: require("./plugins/registry"),
    installer: require("./plugins/installer"),
    schema: require("./plugins/schema"),
    types: require("./plugins/types"),
    bundled: require("./plugins/bundled"),
  },

  // Skills (full parity)
  skills_full: {
    registry: require("./skills/registry"),
    types: require("./skills/types"),
    frontmatter: require("./skills/_frontmatter"),
    bundled: require("./skills/bundled"),
  },

  // Prompts (full parity)
  prompts_full: {
    manager: require("./prompts/manager"),
    claudemd: require("./prompts/claudemd"),
    context: require("./prompts/context"),
    environment: require("./prompts/environment"),
    systemPrompt: require("./prompts/system-prompt"),
  },

  // Personalization (full parity)
  personalization_full: {
    personalization: require("./personalization/personalization"),
    rules: require("./personalization/rules"),
    sessionHook: require("./personalization/session-hook"),
  },

  // Services (full parity)
  services_full: {
    lsp: require("./services/lsp"),
    mcp: require("./services/mcp"),
    autodream: require("./services/autodream"),
    memoryExtract: require("./services/memory-extract"),
    personalization: require("./services/personalization"),
    sessionMemory: require("./services/session-memory"),
    cron: require("./services/cron"),
    cronScheduler: require("./services/cron-scheduler"),
    sessionBackend: require("./services/session-backend"),
    sessionStorage: require("./services/session-storage"),
    tokenEstimation: require("./services/token-estimation"),
    toolOutputs: require("./services/tool-outputs"),
    oauth: require("./services/oauth"),
  },
};
