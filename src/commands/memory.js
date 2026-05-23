const {
  deleteMemory,
  listMemories,
  readMemory,
  searchMemories,
  writeMemory,
} = require('../memory');
const { ANSI, THEME } = require('../renderer');

function parseMemoryArgs(args) {
  const flags = { namespace: null, tag: null };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--namespace' && i + 1 < args.length) {
      flags.namespace = args[++i];
    } else if (args[i] === '--tag' && i + 1 < args.length) {
      flags.tag = args[++i];
    } else {
      positional.push(args[i]);
    }
  }
  return { flags, positional };
}

function handleMemoryCommand(args, { screen, session, onUnknownSubcommand } = {}) {
  const [subCommand, ...subArgs] = args;

  switch (subCommand) {
    case 'list':
    case undefined:
      showMemoryList(subArgs, { screen, session });
      break;
    case 'read':
      readStoredMemory(subArgs, { screen, session });
      break;
    case 'write':
      writeStoredMemory(subArgs, { screen, session });
      break;
    case 'delete':
      deleteStoredMemory(subArgs, { screen, session });
      break;
    case 'search':
      searchStoredMemory(subArgs, { screen, session });
      break;
    default:
      if (typeof onUnknownSubcommand === 'function') {
        onUnknownSubcommand(subCommand);
      }
  }
}

function formatMemoryMeta(mem) {
  const parts = [];
  if (mem.namespace && mem.namespace !== 'default') {
    parts.push(`${THEME.dim}@${mem.namespace}${ANSI.reset || ''}`);
  }
  if (mem.tags && mem.tags.length > 0) {
    parts.push(mem.tags.map((t) => `${THEME.dim}#${t}${ANSI.reset || ''}`).join(' '));
  }
  return parts.length > 0 ? ' ' + parts.join(' ') : '';
}

function showMemoryList(args, { screen, session }) {
  const { flags } = parseMemoryArgs(args);
  const opts = { ...session.settings, ...(flags.namespace && { namespace: flags.namespace }) };
  const memories = listMemories(opts);

  if (flags.namespace) {
    const filtered = memories.filter((m) => (m.namespace || 'default') === flags.namespace);
    showMemoryTable(screen, filtered, flags);
    return;
  }
  showMemoryTable(screen, memories, flags);
}

function showMemoryTable(screen, memories, flags) {
  const tagFilter = flags.tag ? flags.tag.toLowerCase() : null;
  const filtered = tagFilter
    ? memories.filter((m) => (m.tags || []).some((t) => t.toLowerCase() === tagFilter))
    : memories;

  if (filtered.length === 0) {
    const hint = flags.namespace ? ` in namespace "${flags.namespace}"` : '';
    screen.write(`${THEME.dim}No memories stored${hint}.${ANSI.reset || ''}\n`);
    return;
  }

  const label = flags.namespace ? `Memories @${flags.namespace}` : 'Memories';
  screen.write(`\n${THEME.heading}${label} (${filtered.length})${ANSI.reset || ''}\n`);
  for (const mem of filtered) {
    const date = mem.updatedAt ? new Date(mem.updatedAt).toLocaleDateString() : '';
    screen.write(`  ${THEME.accent}${mem.name}${ANSI.reset || ''}${formatMemoryMeta(mem)} ${THEME.dim}${date}${ANSI.reset || ''}\n`);
  }
  screen.write('\n');
}

function readStoredMemory(args, { screen, session }) {
  const { flags, positional } = parseMemoryArgs(args);
  const [name] = positional;
  if (!name) {
    screen.write(`${THEME.dim}Usage: /memory read [--namespace <ns>] <name>${ANSI.reset || ''}\n`);
    return;
  }

  const opts = { ...session.settings };
  if (flags.namespace) opts.namespace = flags.namespace;

  const mem = readMemory(name, opts);
  if (!mem) {
    screen.write(`${THEME.warning}Memory not found: ${name}${ANSI.reset || ''}\n`);
    return;
  }

  screen.write(`${THEME.heading}${mem.name}${ANSI.reset || ''}${formatMemoryMeta(mem)}\n${mem.content}\n\n`);
}

function writeStoredMemory(args, { screen, session }) {
  const { flags, positional } = parseMemoryArgs(args);
  const [name, ...contentParts] = positional;
  if (!name || contentParts.length === 0) {
    screen.write(`${THEME.dim}Usage: /memory write [--namespace <ns>] [--tag <tag>] <name> <content>${ANSI.reset || ''}\n`);
    return;
  }

  const opts = { ...session.settings };
  if (flags.namespace) opts.namespace = flags.namespace;
  if (flags.tag) opts.tags = [flags.tag];

  writeMemory(name, contentParts.join(' '), opts);
  const ns = flags.namespace ? ` @${flags.namespace}` : '';
  screen.write(`${THEME.success}Memory saved: ${name}${ns}${ANSI.reset || ''}\n`);
}

function deleteStoredMemory(args, { screen, session }) {
  const { flags, positional } = parseMemoryArgs(args);
  const [name] = positional;
  if (!name) {
    screen.write(`${THEME.dim}Usage: /memory delete [--namespace <ns>] <name>${ANSI.reset || ''}\n`);
    return;
  }

  const opts = { ...session.settings };
  if (flags.namespace) opts.namespace = flags.namespace;

  const deleted = deleteMemory(name, opts);
  screen.write(deleted
    ? `${THEME.success}Memory deleted: ${name}${ANSI.reset || ''}\n`
    : `${THEME.warning}Memory not found: ${name}${ANSI.reset || ''}\n`);
}

function searchStoredMemory(args, { screen, session }) {
  const { flags, positional } = parseMemoryArgs(args);
  const query = positional.join(' ');
  if (!query.trim()) {
    screen.write(`${THEME.dim}Usage: /memory search [--namespace <ns>] [--tag <tag>] <keyword>${ANSI.reset || ''}\n`);
    return;
  }

  const opts = { ...session.settings };
  if (flags.namespace) opts.namespace = flags.namespace;
  if (flags.tag) opts.tag = flags.tag;

  const results = searchMemories(query, opts);
  if (results.length === 0) {
    screen.write(`${THEME.dim}No memories match "${query}".${ANSI.reset || ''}\n`);
    return;
  }

  screen.write(`\n${THEME.heading}Search results for "${query}" (${results.length})${ANSI.reset || ''}\n`);
  for (const mem of results) {
    const content = mem.content || '';
    const score = mem.score ? ` ${THEME.dim}(${mem.score})${ANSI.reset || ''}` : '';
    screen.write(`  ${THEME.accent}${mem.name}${ANSI.reset || ''}${formatMemoryMeta(mem)}${score} ${THEME.dim}${content.slice(0, 80)}${content.length > 80 ? '...' : ''}${ANSI.reset || ''}\n`);
  }
  screen.write(`${THEME.dim}  Run /memory read <name> to see full content.${ANSI.reset || ''}\n\n`);
}

module.exports = {
  handleMemoryCommand,
};
