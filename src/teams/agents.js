const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BUILT_IN_AGENTS = Object.freeze([
  {
    agentType: 'general-purpose',
    name: 'general-purpose',
    role: 'General teammate for broad coding tasks and follow-up work.',
    whenToUse: 'Use when no more specialized teammate is a better fit.',
    tools: ['file.read', 'file.glob', 'file.search', 'shell.run', 'file.write'],
    color: 'magenta',
    prompt: [
      'You are a general-purpose coding teammate in an agent team.',
      'Work independently, inspect the codebase before changing it, and return a concise result with files touched, risks, and validation notes.',
    ].join('\n'),
  },
  {
    agentType: 'explore',
    name: 'explore',
    role: 'Maps code paths, dependencies, conventions, and hidden constraints.',
    whenToUse: 'Use before implementation when the relevant files or architecture are unclear.',
    tools: ['file.read', 'file.glob', 'file.search', 'shell.run'],
    color: 'cyan',
    prompt: [
      'You are an exploration specialist in an agent team.',
      'Do not modify files. Find the relevant code paths, explain how they connect, identify risks, and hand back concrete implementation guidance.',
    ].join('\n'),
  },
  {
    agentType: 'planner',
    name: 'planner',
    role: 'Turns ambiguous goals into sequenced engineering plans.',
    whenToUse: 'Use when a task needs decomposition, ordering, or trade-off analysis.',
    tools: ['file.read', 'file.glob', 'file.search'],
    color: 'blue',
    prompt: [
      'You are a planning specialist in an agent team.',
      'Produce a practical plan with dependencies, expected deliverables, validation strategy, and places where the lead should make decisions.',
    ].join('\n'),
  },
  {
    agentType: 'implementer',
    name: 'implementer',
    role: 'Makes focused code changes following existing project conventions.',
    whenToUse: 'Use when the desired change is understood and ready to implement.',
    tools: ['file.read', 'file.glob', 'file.search', 'shell.run', 'file.write'],
    color: 'green',
    prompt: [
      'You are an implementation specialist in an agent team.',
      'Make focused changes only after reading surrounding context. Preserve style, avoid unnecessary dependencies, and summarize exactly what changed.',
    ].join('\n'),
  },
  {
    agentType: 'reviewer',
    name: 'reviewer',
    role: 'Reviews code for regressions, correctness, maintainability, and UX issues.',
    whenToUse: 'Use after implementation or before risky changes.',
    tools: ['file.read', 'file.glob', 'file.search', 'shell.run'],
    color: 'yellow',
    prompt: [
      'You are a code review specialist in an agent team.',
      'Do not modify files. Review the implementation, call out concrete issues by file and behavior, and distinguish blockers from nice-to-haves.',
    ].join('\n'),
  },
  {
    agentType: 'test-runner',
    name: 'test-runner',
    role: 'Finds and runs the right validation commands, then explains failures.',
    whenToUse: 'Use when changes need verification or test failures need triage.',
    tools: ['file.read', 'file.glob', 'file.search', 'shell.run'],
    color: 'red',
    prompt: [
      'You are a validation specialist in an agent team.',
      'Inspect project scripts before running commands. Run the narrowest useful checks first, report exact commands, and explain any failures without masking unrelated issues.',
    ].join('\n'),
  },
  {
    agentType: 'security-reviewer',
    name: 'security-reviewer',
    role: 'Reviews trust boundaries, secret handling, permissions, and unsafe execution.',
    whenToUse: 'Use for authentication, authorization, shell execution, file access, and user-controlled input changes.',
    tools: ['file.read', 'file.glob', 'file.search'],
    color: 'red',
    prompt: [
      'You are a security review specialist in an agent team.',
      'Do not modify files. Look for realistic vulnerabilities, unsafe defaults, secret exposure, injection risks, and permission boundary regressions.',
    ].join('\n'),
  },
  {
    agentType: 'docs-writer',
    name: 'docs-writer',
    role: 'Updates user-facing docs, usage notes, and release-style explanations.',
    whenToUse: 'Use when behavior changes need clear documentation or examples.',
    tools: ['file.read', 'file.glob', 'file.search', 'file.write'],
    color: 'white',
    prompt: [
      'You are a documentation specialist in an agent team.',
      'Update existing documentation only when appropriate. Keep examples accurate, concise, and aligned with the project style.',
    ].join('\n'),
  },
]);

function loadAgentDefinitions(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || options.settings?.projectRoot || process.cwd());
  const directories = getAgentDirectories(projectRoot, options);
  const allAgents = [...BUILT_IN_AGENTS.map((agent) => normalizeAgentDefinition(agent, { source: 'built-in' }))];
  const failedFiles = [];

  for (const directory of directories) {
    for (const filePath of listMarkdownFiles(directory.path)) {
      try {
        const agent = parseAgentFile(filePath, directory.source);
        if (agent) {
          allAgents.push(agent);
        }
      } catch (error) {
        failedFiles.push({ path: filePath, error: error.message || String(error) });
      }
    }
  }

  return {
    activeAgents: getActiveAgents(allAgents),
    allAgents,
    failedFiles,
    directories,
  };
}

function getAgentDirectories(projectRoot, options = {}) {
  const extraDirectories = Array.isArray(options.directories) ? options.directories : [];
  const homeDirectory = options.homeDirectory || os.homedir();

  return [
    { source: 'user', path: path.join(homeDirectory, '.hax-agent', 'agents') },
    { source: 'project', path: path.join(projectRoot, '.hax-agent', 'agents') },
    { source: 'claude-project', path: path.join(projectRoot, '.claude', 'agents') },
    ...extraDirectories.map((directory) => ({ source: directory.source || 'custom', path: path.resolve(directory.path || directory) })),
  ];
}

function getActiveAgents(allAgents) {
  const byType = new Map();

  for (const agent of allAgents) {
    byType.set(agent.agentType, agent);
  }

  return Array.from(byType.values());
}

function parseAgentFile(filePath, source) {
  const content = fs.readFileSync(filePath, 'utf8');
  const parsed = parseFrontmatter(content);
  const fileName = path.basename(filePath, path.extname(filePath));
  const name = normalizeName(parsed.frontmatter.name || fileName);

  if (!name) {
    throw new Error('Agent name is required');
  }

  const prompt = parsed.body.trim();
  if (!prompt) {
    throw new Error('Agent prompt body is required');
  }

  return normalizeAgentDefinition({
    agentType: name,
    name,
    role: parsed.frontmatter.role || parsed.frontmatter.description || '',
    whenToUse: parsed.frontmatter.description || parsed.frontmatter.whenToUse || parsed.frontmatter.when_to_use || '',
    tools: parseList(parsed.frontmatter.tools),
    disallowedTools: parseList(parsed.frontmatter.disallowedTools || parsed.frontmatter.disallowed_tools),
    model: parseOptionalString(parsed.frontmatter.model),
    color: parseOptionalString(parsed.frontmatter.color),
    background: parseBoolean(parsed.frontmatter.background),
    maxTurns: parsePositiveInteger(parsed.frontmatter.maxTurns || parsed.frontmatter.max_turns),
    prompt,
    filename: fileName,
    filePath,
    source,
  });
}

function normalizeAgentDefinition(input, defaults = {}) {
  const agentType = normalizeName(input.agentType || input.name);

  if (!agentType) {
    throw new Error('Agent type is required');
  }

  const prompt = String(input.prompt || '').trim();

  return Object.freeze({
    agentType,
    name: normalizeName(input.name) || agentType,
    role: String(input.role || input.whenToUse || '').trim(),
    whenToUse: String(input.whenToUse || input.description || input.role || '').trim(),
    tools: Object.freeze(parseList(input.tools)),
    disallowedTools: Object.freeze(parseList(input.disallowedTools)),
    model: parseOptionalString(input.model),
    color: parseOptionalString(input.color),
    background: input.background === true,
    maxTurns: Number.isSafeInteger(input.maxTurns) && input.maxTurns > 0 ? input.maxTurns : undefined,
    prompt,
    filename: input.filename,
    filePath: input.filePath,
    source: input.source || defaults.source || 'custom',
  });
}

function parseFrontmatter(content) {
  const normalized = String(content || '').replace(/^\uFEFF/, '');

  if (!normalized.startsWith('---\n') && !normalized.startsWith('---\r\n')) {
    return { frontmatter: {}, body: normalized };
  }

  const lines = normalized.split(/\r?\n/);
  const frontmatterLines = [];
  let endIndex = -1;

  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') {
      endIndex = index;
      break;
    }
    frontmatterLines.push(lines[index]);
  }

  if (endIndex === -1) {
    return { frontmatter: {}, body: normalized };
  }

  return {
    frontmatter: parseFrontmatterLines(frontmatterLines),
    body: lines.slice(endIndex + 1).join('\n'),
  };
}

function parseFrontmatterLines(lines) {
  const data = {};
  let currentKey = null;

  for (const line of lines) {
    if (/^\s+-\s+/.test(line) && currentKey) {
      const existing = Array.isArray(data[currentKey]) ? data[currentKey] : [];
      existing.push(line.replace(/^\s+-\s+/, '').trim());
      data[currentKey] = existing;
      continue;
    }

    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }

    currentKey = match[1];
    data[currentKey] = parseFrontmatterValue(match[2]);
  }

  return data;
}

function parseFrontmatterValue(value) {
  const trimmed = String(value || '').trim();

  if (!trimmed) {
    return '';
  }

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }

  if (/^(true|false)$/i.test(trimmed)) {
    return trimmed.toLowerCase() === 'true';
  }

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  return trimmed;
}

function listMarkdownFiles(directoryPath) {
  try {
    const stats = fs.statSync(directoryPath);
    if (!stats.isDirectory()) {
      return [];
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const files = [];
  const entries = fs.readdirSync(directoryPath, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(entryPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(entryPath);
    }
  }

  return files;
}

function parseList(value) {
  if (value === undefined || value === null || value === '') {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function parseOptionalString(value) {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

function parseBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value === undefined || value === null || value === '') {
    return false;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

module.exports = {
  BUILT_IN_AGENTS,
  getActiveAgents,
  loadAgentDefinitions,
  normalizeAgentDefinition,
  parseAgentFile,
  parseFrontmatter,
};
