const fs = require('node:fs');
const path = require('node:path');
const { createAgentTeam } = require('../orchestration');
const { createProvider } = require('../providers');
const { ToolRegistry } = require('../tools');
const { loadAgentDefinitions } = require('./agents');

const TEAM_STATE_VERSION = 1;
const DEFAULT_TEAM_NAME = 'default';
const DEFAULT_CONCURRENCY = 4;

class TeamRuntime {
  constructor(options = {}) {
    this.settings = options.settings || {};
    this.projectRoot = path.resolve(options.projectRoot || this.settings.projectRoot || process.cwd());
    this.providerFactory = options.providerFactory || createProvider;
    this.toolRegistryFactory = options.toolRegistryFactory;
    this.stateDirectory = options.stateDirectory || path.join(this.projectRoot, '.hax-agent', 'teams');
    this.agentDefinitions = options.agentDefinitions || loadAgentDefinitions({ projectRoot: this.projectRoot, settings: this.settings });
    this.provider = options.provider || null;
    this.team = null;
    this.state = null;
  }

  createTeam(input = {}) {
    const teamName = normalizeName(input.name || DEFAULT_TEAM_NAME);
    const mission = String(input.mission || '').trim() || 'Coordinate specialized Hax agents on this project.';
    const leadAgentId = input.leadAgentId || `lead@${teamName}`;
    const roster = [];

    this.state = {
      version: TEAM_STATE_VERSION,
      teamName,
      mission,
      leadAgentId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      members: [],
      tasks: [],
      messages: [],
      runs: [],
      nextTaskNumber: 1,
      nextMessageNumber: 1,
    };

    for (const member of input.members || []) {
      roster.push(this.addMember(member));
    }

    this.rebuildTeam();
    this.save();

    return { team: this.snapshot(), members: roster };
  }

  loadTeam(teamName = DEFAULT_TEAM_NAME) {
    const filePath = this.getStatePath(teamName);
    const loaded = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    this.state = normalizeState(loaded);
    this.rebuildTeam();
    return this.snapshot();
  }

  loadOrCreateTeam(input = {}) {
    const teamName = normalizeName(input.name || DEFAULT_TEAM_NAME);

    if (fs.existsSync(this.getStatePath(teamName))) {
      this.loadTeam(teamName);
      return { team: this.snapshot(), created: false };
    }

    this.createTeam(input);
    return { team: this.snapshot(), created: true };
  }

  listTeams() {
    try {
      const entries = fs.readdirSync(this.stateDirectory, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => {
          const filePath = path.join(this.stateDirectory, entry.name);
          try {
            const state = normalizeState(JSON.parse(fs.readFileSync(filePath, 'utf8')));
            return {
              name: state.teamName,
              mission: state.mission,
              members: state.members.length,
              tasks: state.tasks.length,
              updatedAt: state.updatedAt,
            };
          } catch (error) {
            return {
              name: path.basename(entry.name, '.json'),
              mission: '',
              members: 0,
              tasks: 0,
              updatedAt: null,
              error: error.message || String(error),
            };
          }
        })
        .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  addMember(input = {}) {
    this.requireState();

    const agentType = normalizeName(input.agentType || input.type || input.subagentType || 'general-purpose');
    const definition = this.findAgentDefinition(agentType);
    const baseName = normalizeName(input.name || definition.name || agentType);
    const name = this.createUniqueMemberName(baseName);
    const now = new Date().toISOString();
    const member = {
      id: `${name}@${this.state.teamName}`,
      name,
      agentType: definition.agentType,
      role: input.role || definition.role || definition.whenToUse || '',
      prompt: input.prompt || definition.prompt || '',
      model: input.model || definition.model,
      tools: input.tools ? normalizeList(input.tools) : [...definition.tools],
      color: input.color || definition.color,
      status: 'idle',
      currentTaskId: null,
      spawnedAt: now,
      updatedAt: now,
      metadata: {
        source: definition.source,
        whenToUse: definition.whenToUse,
        filePath: definition.filePath,
      },
    };

    this.state.members.push(member);
    this.touch();
    this.rebuildTeam();
    this.save();
    this.recordMessage({ from: 'system', to: member.name, type: 'spawned', body: `Spawned ${member.name} as ${member.agentType}.` });

    return clone(member);
  }

  addTask(input = {}) {
    this.requireState();
    const title = String(input.title || '').trim();

    if (!title) {
      throw new Error('Task title is required.');
    }

    const owner = input.owner ? this.resolveMemberName(input.owner) : this.pickOwner(input.agentType || input.type, title);
    const task = {
      id: input.id || `T${this.state.nextTaskNumber++}`,
      title,
      owner,
      prompt: String(input.prompt || input.title || '').trim(),
      deliverable: String(input.deliverable || '').trim(),
      dependsOn: normalizeList(input.dependsOn || input.depends_on),
      parallel: input.parallel !== false,
      status: 'pending',
      result: null,
      error: null,
      startedAt: null,
      completedAt: null,
      metadata: {
        agentType: input.agentType || input.type || null,
      },
    };

    this.state.tasks.push(task);
    this.touch();
    this.rebuildTeam();
    this.save();

    return clone(task);
  }

  async run(options = {}) {
    this.requireState();
    this.rebuildTeam();

    const concurrency = normalizeConcurrency(options.concurrency, DEFAULT_CONCURRENCY);
    const events = [];
    const run = {
      id: `run-${Date.now().toString(36)}`,
      startedAt: new Date().toISOString(),
      completedAt: null,
      concurrency,
      status: 'running',
      results: [],
    };

    this.state.runs.push(run);
    this.save();

    while (true) {
      const ready = this.getReadyStateTasks();
      if (ready.length === 0) {
        break;
      }

      const batch = ready.slice(0, concurrency);
      const settled = await Promise.all(batch.map((task) => this.runTask(task, options).then(
        (result) => ({ status: 'fulfilled', taskId: task.id, result }),
        (error) => ({ status: 'rejected', taskId: task.id, error: serializeError(error) }),
      )));

      for (const result of settled) {
        events.push(result);
        run.results.push(result);
      }

      this.save();
    }

    run.completedAt = new Date().toISOString();
    run.status = this.state.tasks.some((task) => task.status === 'failed') ? 'failed' : 'completed';
    this.touch();
    this.save();

    return {
      run: clone(run),
      progress: this.getProgress(),
      events,
      blocked: this.getBlockedStateTasks(),
    };
  }

  async runTask(task, options = {}) {
    const member = this.getMember(task.owner);
    const startedAt = new Date().toISOString();
    task.status = 'in_progress';
    task.startedAt = startedAt;
    task.error = null;
    member.status = 'busy';
    member.currentTaskId = task.id;
    member.updatedAt = startedAt;
    this.recordMessage({ from: 'lead', to: member.name, type: 'task', taskId: task.id, body: task.prompt || task.title }, { save: false });
    this.save();

    try {
      const result = await this.invokeMember(member, task, options);
      const completedAt = new Date().toISOString();
      task.status = 'completed';
      task.result = result;
      task.completedAt = completedAt;
      member.status = 'idle';
      member.currentTaskId = null;
      member.updatedAt = completedAt;
      this.recordMessage({ from: member.name, to: 'lead', type: 'result', taskId: task.id, body: result.content || String(result) }, { save: false });
      return clone(task);
    } catch (error) {
      const completedAt = new Date().toISOString();
      task.status = 'failed';
      task.error = serializeError(error);
      task.completedAt = completedAt;
      member.status = 'idle';
      member.currentTaskId = null;
      member.updatedAt = completedAt;
      this.recordMessage({ from: member.name, to: 'lead', type: 'error', taskId: task.id, body: task.error.message }, { save: false });
      throw error;
    } finally {
      this.touch();
      this.rebuildTeam();
      this.save();
    }
  }

  async invokeMember(member, task, options = {}) {
    const provider = this.createProvider(member, options);
    const toolRegistry = this.createScopedToolRegistry(member, options);
    const messages = [
      { role: 'user', content: this.createMemberPrompt(member, task) },
    ];
    let content = '';
    let usage = null;
    const toolEvents = [];

    for await (const chunk of provider.stream({
      messages,
      model: member.model || provider.model,
      system: this.createMemberSystemPrompt(member),
      toolRegistry,
      maxToolTurns: options.maxToolTurns || member.maxTurns || this.settings.agent?.maxTurns || 20,
    })) {
      if (chunk.type === 'text') {
        content += chunk.delta;
      } else if (chunk.type === 'usage') {
        usage = chunk;
      } else if (chunk.type === 'tool_start' || chunk.type === 'tool_result' || chunk.type === 'tool_limit') {
        toolEvents.push(chunk);
      }
    }

    return {
      content: content.trim(),
      usage,
      toolEvents,
      model: provider.model,
      agent: member.name,
      agentType: member.agentType,
    };
  }

  sendMessage(input = {}) {
    this.requireState();
    const to = this.resolveMessageTarget(input.to || input.name || input.agent);
    const message = this.recordMessage({
      from: input.from || 'lead',
      to,
      type: input.type || 'message',
      taskId: input.taskId || null,
      body: String(input.body || input.message || '').trim(),
    });

    return message;
  }

  drainMessages(agentName) {
    this.requireState();
    const name = this.resolveMessageTarget(agentName);
    const messages = this.state.messages.filter((message) => message.to === name && !message.readAt);
    const now = new Date().toISOString();

    for (const message of messages) {
      message.readAt = now;
    }

    this.touch();
    this.save();
    return messages.map(clone);
  }

  getProgress() {
    this.requireState();
    const counts = { pending: 0, in_progress: 0, completed: 0, failed: 0 };

    for (const task of this.state.tasks) {
      counts[task.status] = (counts[task.status] || 0) + 1;
    }

    const total = this.state.tasks.length;
    return {
      total,
      completed: counts.completed,
      failed: counts.failed,
      active: counts.in_progress,
      pending: counts.pending,
      percentComplete: total === 0 ? 100 : Math.round((counts.completed / total) * 100),
      counts,
    };
  }

  snapshot() {
    this.requireState();
    return {
      teamName: this.state.teamName,
      mission: this.state.mission,
      leadAgentId: this.state.leadAgentId,
      createdAt: this.state.createdAt,
      updatedAt: this.state.updatedAt,
      members: this.state.members.map(clone),
      tasks: this.state.tasks.map(clone),
      messages: this.state.messages.map(clone),
      runs: this.state.runs.map(clone),
      progress: this.getProgress(),
      path: this.getStatePath(this.state.teamName),
    };
  }

  rebuildTeam() {
    if (!this.state) {
      this.team = null;
      return;
    }

    this.team = createAgentTeam({
      name: this.state.teamName,
      mission: this.state.mission,
      agents: this.state.members.map((member) => ({
        name: member.name,
        role: member.role,
        capabilities: member.tools,
        status: member.status === 'busy' ? 'busy' : 'idle',
        currentTaskId: member.currentTaskId,
        metadata: {
          id: member.id,
          agentType: member.agentType,
          color: member.color,
        },
      })),
      tasks: this.state.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        owner: task.owner,
        parallel: task.parallel,
        dependsOn: task.dependsOn,
        deliverable: task.deliverable,
        status: task.status,
        result: task.result,
        error: task.error,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        metadata: task.metadata,
      })),
      validation: [],
    });
  }

  createProvider(member, options = {}) {
    if (options.provider) {
      return options.provider;
    }

    if (this.provider) {
      return this.provider;
    }

    return this.providerFactory({
      ...(this.settings.agent || {}),
      model: member.model || this.settings.agent?.model,
    }, process.env);
  }

  createScopedToolRegistry(member, options = {}) {
    const baseRegistry = options.toolRegistry || (typeof this.toolRegistryFactory === 'function'
      ? this.toolRegistryFactory(member)
      : null);

    if (!baseRegistry || member.tools.length === 0) {
      return baseRegistry;
    }

    const scoped = new ToolRegistry({ root: this.projectRoot });
    const allowed = new Set(member.tools);
    const disallowed = new Set(normalizeList(member.disallowedTools));

    for (const tool of baseRegistry.list()) {
      if (allowed.has(tool.name) && !disallowed.has(tool.name)) {
        scoped.register({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          execute: (args, context) => baseRegistry.execute(tool.name, args, context).then((result) => {
            if (result.ok) {
              return result.data;
            }
            const error = new Error(result.error?.message || `Tool failed: ${tool.name}`);
            error.code = result.error?.code;
            error.details = result.error?.details;
            throw error;
          }),
        });
      }
    }

    return scoped;
  }

  createMemberSystemPrompt(member) {
    return [
      `You are ${member.name}, a teammate in the Hax Agent team "${this.state.teamName}".`,
      `Role: ${member.role || member.agentType}.`,
      member.metadata?.whenToUse ? `When to use this agent: ${member.metadata.whenToUse}.` : '',
      '',
      member.prompt,
      '',
      'Team operating rules:',
      '- Work as an independent specialist and keep the team mission in view.',
      '- Use only the tools available to you.',
      '- Return concrete findings, files changed, validation performed, blockers, and recommended next steps.',
      '- Never expose secrets or credentials.',
    ].filter(Boolean).join('\n');
  }

  createMemberPrompt(member, task) {
    const dependencies = task.dependsOn.length > 0
      ? task.dependsOn.map((id) => this.state.tasks.find((candidate) => candidate.id === id)).filter(Boolean)
      : [];
    const dependencySummary = dependencies.length > 0
      ? dependencies.map((dependency) => `- ${dependency.id}: ${dependency.title}\n${formatTaskResult(dependency.result)}`).join('\n')
      : 'None';

    return [
      `Team mission: ${this.state.mission}`,
      `Your teammate identity: ${member.name} (${member.agentType})`,
      `Task ${task.id}: ${task.title}`,
      task.deliverable ? `Expected deliverable: ${task.deliverable}` : '',
      '',
      'Task prompt:',
      task.prompt || task.title,
      '',
      'Completed dependency context:',
      dependencySummary,
    ].filter(Boolean).join('\n');
  }

  getReadyStateTasks() {
    return this.state.tasks.filter((task) => task.status === 'pending' && task.dependsOn.every((id) => {
      const dependency = this.state.tasks.find((candidate) => candidate.id === id);
      return dependency && dependency.status === 'completed';
    }));
  }

  getBlockedStateTasks() {
    return this.state.tasks.filter((task) => task.status === 'pending' && !task.dependsOn.every((id) => {
      const dependency = this.state.tasks.find((candidate) => candidate.id === id);
      return dependency && dependency.status === 'completed';
    }));
  }

  pickOwner(agentType, title) {
    if (agentType) {
      const normalizedType = normalizeName(agentType);
      const typedMember = this.state.members.find((member) => member.agentType === normalizedType || member.name === normalizedType);
      if (typedMember) {
        return typedMember.name;
      }
    }

    if (this.state.members.length === 0) {
      this.addMember({ agentType: inferAgentType(title), name: inferAgentType(title) });
    }

    const idleMember = this.state.members.find((member) => member.status === 'idle');
    return (idleMember || this.state.members[0]).name;
  }

  findAgentDefinition(agentType) {
    const normalizedType = normalizeName(agentType);
    const definition = this.agentDefinitions.activeAgents.find((agent) => agent.agentType === normalizedType || agent.name === normalizedType);

    if (!definition) {
      const available = this.agentDefinitions.activeAgents.map((agent) => agent.agentType).join(', ');
      throw new Error(`Unknown agent type: ${agentType}. Available agents: ${available}`);
    }

    return definition;
  }

  getMember(name) {
    const memberName = this.resolveMemberName(name);
    return this.state.members.find((member) => member.name === memberName);
  }

  resolveMemberName(name) {
    const normalized = normalizeName(name);
    const member = this.state.members.find((candidate) => candidate.name === normalized || candidate.id === name || candidate.agentType === normalized);

    if (!member) {
      throw new Error(`Unknown team member: ${name}`);
    }

    return member.name;
  }

  resolveMessageTarget(name) {
    if (name === 'lead' || name === 'system') {
      return name;
    }

    return this.resolveMemberName(name);
  }

  createUniqueMemberName(baseName) {
    let candidate = normalizeName(baseName || 'agent');
    let suffix = 2;
    const existing = new Set(this.state.members.map((member) => member.name));

    while (existing.has(candidate)) {
      candidate = `${baseName}-${suffix++}`;
    }

    return candidate;
  }

  recordMessage(input, options = {}) {
    const message = {
      id: `msg-${this.state.nextMessageNumber++}`,
      from: input.from,
      to: input.to,
      type: input.type || 'message',
      taskId: input.taskId || null,
      body: input.body || '',
      createdAt: new Date().toISOString(),
      readAt: null,
    };

    this.state.messages.push(message);
    this.touch();

    if (options.save !== false) {
      this.save();
    }

    return clone(message);
  }

  touch() {
    if (this.state) {
      this.state.updatedAt = new Date().toISOString();
    }
  }

  save() {
    this.requireState();
    fs.mkdirSync(this.stateDirectory, { recursive: true });
    fs.writeFileSync(this.getStatePath(this.state.teamName), `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
  }

  getStatePath(teamName) {
    return path.join(this.stateDirectory, `${normalizeName(teamName || DEFAULT_TEAM_NAME)}.json`);
  }

  requireState() {
    if (!this.state) {
      throw new Error('No active team. Create or load a team first.');
    }
  }
}

function createTeamRuntime(options) {
  return new TeamRuntime(options);
}

function normalizeState(input) {
  const state = input && typeof input === 'object' ? input : {};

  return {
    version: state.version || TEAM_STATE_VERSION,
    teamName: normalizeName(state.teamName || state.name || DEFAULT_TEAM_NAME),
    mission: String(state.mission || '').trim(),
    leadAgentId: state.leadAgentId || `lead@${normalizeName(state.teamName || DEFAULT_TEAM_NAME)}`,
    createdAt: state.createdAt || new Date().toISOString(),
    updatedAt: state.updatedAt || new Date().toISOString(),
    members: Array.isArray(state.members) ? state.members.map(normalizeMember) : [],
    tasks: Array.isArray(state.tasks) ? state.tasks.map(normalizeTask) : [],
    messages: Array.isArray(state.messages) ? state.messages.map(normalizeMessage) : [],
    runs: Array.isArray(state.runs) ? state.runs : [],
    nextTaskNumber: state.nextTaskNumber || inferNextNumber(state.tasks, 'T'),
    nextMessageNumber: state.nextMessageNumber || inferNextNumber(state.messages, 'msg-'),
  };
}

function normalizeMember(member) {
  return {
    id: member.id,
    name: normalizeName(member.name),
    agentType: normalizeName(member.agentType || member.type || 'general-purpose'),
    role: member.role || '',
    prompt: member.prompt || '',
    model: member.model,
    tools: normalizeList(member.tools),
    color: member.color,
    status: ['idle', 'busy', 'offline'].includes(member.status) ? member.status : 'idle',
    currentTaskId: member.currentTaskId || null,
    spawnedAt: member.spawnedAt || new Date().toISOString(),
    updatedAt: member.updatedAt || new Date().toISOString(),
    metadata: member.metadata && typeof member.metadata === 'object' ? member.metadata : {},
  };
}

function normalizeTask(task) {
  return {
    id: String(task.id || '').trim(),
    title: String(task.title || '').trim(),
    owner: task.owner ? normalizeName(task.owner) : null,
    prompt: String(task.prompt || task.title || '').trim(),
    deliverable: String(task.deliverable || '').trim(),
    dependsOn: normalizeList(task.dependsOn || task.depends_on),
    parallel: task.parallel !== false,
    status: ['pending', 'in_progress', 'completed', 'failed'].includes(task.status) ? task.status : 'pending',
    result: task.result || null,
    error: task.error || null,
    startedAt: task.startedAt || null,
    completedAt: task.completedAt || null,
    metadata: task.metadata && typeof task.metadata === 'object' ? task.metadata : {},
  };
}

function normalizeMessage(message) {
  return {
    id: message.id,
    from: message.from,
    to: message.to,
    type: message.type || 'message',
    taskId: message.taskId || null,
    body: message.body || '',
    createdAt: message.createdAt || new Date().toISOString(),
    readAt: message.readAt || null,
  };
}

function inferNextNumber(items, prefix) {
  const numbers = (items || [])
    .map((item) => String(item.id || '').startsWith(prefix) ? Number(String(item.id).slice(prefix.length)) : 0)
    .filter((value) => Number.isSafeInteger(value));

  return Math.max(0, ...numbers) + 1;
}

function inferAgentType(title) {
  const text = String(title || '').toLowerCase();

  if (/test|verify|lint|typecheck|build/.test(text)) {
    return 'test-runner';
  }
  if (/review|audit|risk|bug/.test(text)) {
    return 'reviewer';
  }
  if (/security|auth|token|permission|secret/.test(text)) {
    return 'security-reviewer';
  }
  if (/doc|readme|usage/.test(text)) {
    return 'docs-writer';
  }
  if (/plan|design|architecture/.test(text)) {
    return 'planner';
  }
  if (/explore|inspect|map|find/.test(text)) {
    return 'explore';
  }

  return 'implementer';
}

function formatTaskResult(result) {
  if (!result) {
    return 'No result recorded.';
  }

  if (typeof result === 'string') {
    return result;
  }

  return result.content || JSON.stringify(result, null, 2);
}

function normalizeConcurrency(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeList(value) {
  if (value === undefined || value === null || value === '') {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

function serializeError(error) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack, code: error.code };
  }

  if (error && typeof error === 'object') {
    return clone(error);
  }

  return { name: 'Error', message: String(error || 'Unknown error') };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  DEFAULT_TEAM_NAME,
  TeamRuntime,
  createTeamRuntime,
};
