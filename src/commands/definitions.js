"use strict";

const SLASH_COMMANDS = [
  { name: 'help', descriptionKey: 'cmd.help', description: 'Show available commands and shortcuts', aliases: ['h', '?'] },
  { name: 'exit', descriptionKey: 'cmd.exit', description: 'Exit the session', aliases: ['q', 'quit'] },
  { name: 'clear', descriptionKey: 'cmd.clear', description: 'Clear conversation and start fresh', aliases: ['c'] },
  { name: 'compact', descriptionKey: 'cmd.compact', description: 'Compact conversation to reduce context', aliases: [] },
  { name: 'tools', descriptionKey: 'cmd.tools', description: 'List available tools', aliases: ['t'] },
  { name: 'skills', descriptionKey: 'cmd.skills', description: 'List or manage skills', aliases: ['skill'], argHint: '[list|usage]' },
  { name: 'skillify', descriptionKey: 'cmd.skillify', description: 'Capture this session as a reusable skill', aliases: [], argHint: '[description]' },
  { name: 'goal', descriptionKey: 'cmd.goal', description: 'Set a persistent goal the assistant should keep pursuing', aliases: [], argHint: '[status|clear|<goal>]' },
  { name: 'agents', descriptionKey: 'cmd.agents', description: 'List available agents', aliases: ['a'] },
  { name: 'team', descriptionKey: 'cmd.team', description: 'Manage agent teams and teammates', aliases: ['teams'], argHint: '[new|spawn|task|run|status|send|inbox|agents]' },
  { name: 'models', descriptionKey: 'cmd.models', description: 'List available models', aliases: ['m'] },
  { name: 'model', descriptionKey: 'cmd.model', description: 'Switch the active model', aliases: [], argHint: '<model-id-or-number>' },
  { name: 'provider', descriptionKey: 'cmd.provider', description: 'Show or switch the AI provider', aliases: ['p'], argHint: '<anthropic|openai|google>' },
  { name: 'api-url', descriptionKey: 'cmd.apiUrl', description: 'Show or set the API base URL', aliases: [], argHint: '<base-url>' },
  { name: 'api-key', descriptionKey: 'cmd.apiKey', description: 'Show or set the API key', aliases: [], argHint: '<key>' },
  { name: 'language', descriptionKey: 'cmd.language', description: 'Show or switch the CLI language', aliases: ['lang', 'locale'], argHint: '<en|zh-CN|zh-TW|ru>' },
  { name: 'cost', descriptionKey: 'cmd.cost', description: 'Show token usage and cost for this session', aliases: [] },
  { name: 'context', descriptionKey: 'cmd.context', description: 'View or set context window/cache budget', aliases: ['cache'], argHint: '[status|window|reserve|chars-per-token|auto|on|off] [value]' },
  { name: 'sessions', descriptionKey: 'cmd.sessions', description: 'List previous sessions', aliases: ['s'] },
  { name: 'resume', descriptionKey: 'cmd.resume', description: 'Resume a previous session', aliases: ['r'], argHint: '<session-id>' },
  { name: 'config', descriptionKey: 'cmd.config', description: 'Show current configuration', aliases: [] },
  { name: 'doctor', descriptionKey: 'cmd.doctor', description: 'Run diagnostics and check setup', aliases: [] },
  { name: 'theme', descriptionKey: 'cmd.theme', description: 'Toggle color theme', aliases: [] },
  { name: 'vim', descriptionKey: 'cmd.vim', description: 'Toggle vim keybindings mode', aliases: [] },
  { name: 'memory', descriptionKey: 'cmd.memory', description: 'Manage agent memory', aliases: [], argHint: '[list|read|write|delete] [name]' },
  { name: 'permissions', descriptionKey: 'cmd.permissions', description: 'View or manage tool permission levels', aliases: ['perm'], argHint: '[status|mode <auto|ask|yolo>|reset]' },
  { name: 'update', descriptionKey: 'cmd.update', description: 'Check for CLI updates', aliases: [], argHint: '[install]' },
  { name: 'copy', descriptionKey: 'cmd.copy', description: 'Copy last AI response to clipboard', aliases: [] },
  { name: 'rename', descriptionKey: 'cmd.rename', description: 'Name the current session', aliases: ['name'], argHint: '<name>' },
  { name: 'status', descriptionKey: 'cmd.status', description: 'Show session summary (model, cost, tokens, git)', aliases: [] },
  { name: 'undo', descriptionKey: 'cmd.undo', description: 'Undo the last file operation', aliases: ['u'] },
  { name: 'redo', descriptionKey: 'cmd.redo', description: 'Redo the last undone file operation', aliases: [] },
  { name: 'export', descriptionKey: 'cmd.export', description: 'Export session transcript (md, json, text)', aliases: [], argHint: '[md|json|text]' },
  { name: 'health', descriptionKey: 'cmd.health', description: 'Show project health dashboard', aliases: [] },
  { name: 'metrics', descriptionKey: 'cmd.metrics', description: 'Show token usage and cost metrics', aliases: [] },
  { name: 'audit', descriptionKey: 'cmd.audit', description: 'Show security audit status', aliases: [] },
  { name: 'plugin', descriptionKey: 'cmd.plugin', description: 'Manage plugins (list, install, search, etc.)', aliases: ['plugins'], argHint: '[list|search|install|update|uninstall|info|enable|disable]' },
  { name: 'personality', descriptionKey: 'cmd.personality', description: 'Set agent personality, response style, and behavior modifiers', aliases: ['persona'], argHint: '[status|set|style|mode|reset] [name]' },
  { name: 'analytics', descriptionKey: 'cmd.analytics', description: 'Show conversation analytics and stats', aliases: ['stats'], argHint: '[tools|predict|anomalies]' },
  { name: 'report', descriptionKey: 'cmd.report', description: 'Generate session report', aliases: ['rpt'], argHint: '[weekly|export <md|json|text>]' },
];

const SKILLS_SUBCOMMANDS = ['list', 'usage'];
const PERMISSIONS_SUBCOMMANDS = ['status', 'mode', 'reset'];
const MEMORY_SUBCOMMANDS = ['list', 'read', 'write', 'delete', 'search'];
const CONTEXT_SUBCOMMANDS = ['status', 'window', 'reserve', 'chars-per-token', 'auto', 'on', 'off'];
const TEAM_SUBCOMMANDS = [
  'help', 'agents', 'list', 'new', 'create', 'plan',
  'spawn', 'add-agent', 'task', 'add-task', 'run',
  'status', 'show', 'send', 'inbox',
];
const PERSONALITY_SUBCOMMANDS = ['status', 'show', 'set', 'style', 'mode', 'reset'];

// Shared mutable state (theme and vim toggle)
let themeEnabled = true;
let vimMode = false;

function isThemeEnabled() { return themeEnabled; }
function isVimMode() { return vimMode; }
function setThemeEnabled(value) { themeEnabled = Boolean(value); }
function setVimMode(value) { vimMode = Boolean(value); }

module.exports = {
  SLASH_COMMANDS,
  SKILLS_SUBCOMMANDS,
  PERMISSIONS_SUBCOMMANDS,
  MEMORY_SUBCOMMANDS,
  CONTEXT_SUBCOMMANDS,
  TEAM_SUBCOMMANDS,
  PERSONALITY_SUBCOMMANDS,
  isThemeEnabled,
  isVimMode,
  setThemeEnabled,
  setVimMode,
};
