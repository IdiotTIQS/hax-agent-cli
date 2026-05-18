const {
  deleteMemory,
  listMemories,
  readMemory,
  searchMemories,
  writeMemory,
} = require('../memory');
const { ANSI, THEME } = require('../renderer');

function handleMemoryCommand(args, { screen, session, onUnknownSubcommand } = {}) {
  const [subCommand, ...subArgs] = args;

  switch (subCommand) {
    case 'list':
    case undefined:
      showMemoryList(screen, session);
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

function showMemoryList(screen, session) {
  const memories = listMemories(session.settings);
  if (memories.length === 0) {
    screen.write(`${THEME.dim}No memories stored.${ANSI.reset || ''}\n`);
    return;
  }

  screen.write(`\n${THEME.heading}Memories${ANSI.reset || ''}\n`);
  for (const mem of memories) {
    screen.write(`  ${THEME.accent}${mem.name}${ANSI.reset || ''} ${THEME.dim}${mem.updatedAt ? new Date(mem.updatedAt).toLocaleDateString() : ''}${ANSI.reset || ''}\n`);
  }
  screen.write('\n');
}

function readStoredMemory(args, { screen, session }) {
  const [name] = args;
  if (!name) {
    screen.write(`${THEME.dim}Usage: /memory read <name>${ANSI.reset || ''}\n`);
    return;
  }

  const mem = readMemory(name, session.settings);
  if (!mem) {
    screen.write(`${THEME.warning}Memory not found: ${name}${ANSI.reset || ''}\n`);
    return;
  }

  screen.write(`${THEME.heading}${mem.name}${ANSI.reset || ''}\n${mem.content}\n\n`);
}

function writeStoredMemory(args, { screen, session }) {
  const [name, ...contentParts] = args;
  if (!name || contentParts.length === 0) {
    screen.write(`${THEME.dim}Usage: /memory write <name> <content>${ANSI.reset || ''}\n`);
    return;
  }

  writeMemory(name, contentParts.join(' '), session.settings);
  screen.write(`${THEME.success}Memory saved: ${name}${ANSI.reset || ''}\n`);
}

function deleteStoredMemory(args, { screen, session }) {
  const [name] = args;
  if (!name) {
    screen.write(`${THEME.dim}Usage: /memory delete <name>${ANSI.reset || ''}\n`);
    return;
  }

  const deleted = deleteMemory(name, session.settings);
  screen.write(deleted
    ? `${THEME.success}Memory deleted: ${name}${ANSI.reset || ''}\n`
    : `${THEME.warning}Memory not found: ${name}${ANSI.reset || ''}\n`);
}

function searchStoredMemory(args, { screen, session }) {
  const query = args.join(' ');
  if (!query.trim()) {
    screen.write(`${THEME.dim}Usage: /memory search <keyword>${ANSI.reset || ''}\n`);
    return;
  }

  const results = searchMemories(query, session.settings);
  if (results.length === 0) {
    screen.write(`${THEME.dim}No memories match "${query}".${ANSI.reset || ''}\n`);
    return;
  }

  screen.write(`\n${THEME.heading}Search results for "${query}" (${results.length})${ANSI.reset || ''}\n`);
  for (const mem of results) {
    const content = mem.content || '';
    screen.write(`  ${THEME.accent}${mem.name}${ANSI.reset || ''} ${THEME.dim}${content.slice(0, 80)}${content.length > 80 ? '...' : ''}${ANSI.reset || ''}\n`);
  }
  screen.write(`${THEME.dim}  Run /memory read <name> to see full content.${ANSI.reset || ''}\n\n`);
}

module.exports = {
  handleMemoryCommand,
};
