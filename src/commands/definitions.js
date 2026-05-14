"use strict";

const SLASH_COMMANDS = [
  { name: 'help', descriptionKey: 'cmd.help', description: 'Show available commands and shortcuts', aliases: ['h', '?'] },
  { name: 'exit', descriptionKey: 'cmd.exit', description: 'Exit the session', aliases: ['q', 'quit'] },
  { name: 'clear', descriptionKey: 'cmd.clear', description: 'Clear conversation and start fresh', aliases: ['c'] },
  { name: 'compact', descriptionKey: 'cmd.compact', description: 'Compact conversation to reduce context', aliases: [] },
  { name: 'tools', descriptionKey: 'cmd.tools', description: 'List available tools', aliases: ['t'] },
  { name: 'skills', descriptionKey: 'cmd.skills', description: 'List or manage skills', aliases: ['skill'], argHint: '[list|usage]' },
  { name: 'skillify', descriptionKey: 'cmd.skillify', description: 'Capture this session as a reusable skill', aliases: [], argHint: '[description]' },
  { name: 'agents', descriptionKey: 'cmd.agents', description: 'List available agents', aliases: ['a'] },
  { name: 'team', descriptionKey: 'cmd.team', description: 'Manage agent teams and teammates', aliases: ['teams'], argHint: '[new|spawn|task|run|status|send|inbox|agents]' },
  { name: 'models', descriptionKey: 'cmd.models', description: 'List available models', aliases: ['m'] },
  { name: 'model', descriptionKey: 'cmd.model', description: 'Switch the active model', aliases: [], argHint: '<model-id-or-number>' },
  { name: 'provider', descriptionKey: 'cmd.provider', description: 'Show or switch the AI provider', aliases: ['p'], argHint: '<anthropic|openai|google>' },
  { name: 'api-url', descriptionKey: 'cmd.apiUrl', description: 'Show or set the API base URL', aliases: [], argHint: '<base-url>' },
  { name: 'api-key', descriptionKey: 'cmd.apiKey', description: 'Show or set the API key', aliases: [], argHint: '<key>' },
  { name: 'language', descriptionKey: 'cmd.language', description: 'Show or switch the CLI language', aliases: ['lang', 'locale'], argHint: '<en|zh-CN|zh-TW|ru>' },
  { name: 'cost', descriptionKey: 'cmd.cost', description: 'Show token usage and cost for this session', aliases: [] },
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
];

const SKILLS_SUBCOMMANDS = ['list', 'usage'];
const PERMISSIONS_SUBCOMMANDS = ['status', 'mode', 'reset'];
const MEMORY_SUBCOMMANDS = ['list', 'read', 'write', 'delete', 'search'];
const TEAM_SUBCOMMANDS = [
  'help', 'agents', 'list', 'new', 'create', 'spawn', 'add-agent',
  'task', 'add-task', 'run', 'status', 'show', 'send', 'inbox',
];

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
  TEAM_SUBCOMMANDS,
  isThemeEnabled,
  isVimMode,
  setThemeEnabled,
  setVimMode,
};
