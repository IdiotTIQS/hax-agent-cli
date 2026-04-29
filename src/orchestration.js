const TaskStatus = Object.freeze({
  pending: 'pending',
  inProgress: 'in_progress',
  completed: 'completed',
  failed: 'failed',
});

const AgentStatus = Object.freeze({
  idle: 'idle',
  busy: 'busy',
  offline: 'offline',
});

function createAgentTeam(input) {
  requireString(input.name, 'team.name');

  const agents = (input.agents || []).map(createSubagent);
  const tasks = (input.tasks || []).map(createTask);

  return {
    name: input.name,
    mission: input.mission || '',
    agents,
    tasks,
    validation: [...(input.validation || [])],
    board: new TaskBoard(tasks),
    registry: new AgentRegistry(agents),
    router: new MessageRouter(agents.map((agent) => agent.name)),
  };
}

function createSubagent(input) {
  requireString(input.name, 'agent.name');
  requireString(input.role, 'agent.role');

  return {
    name: input.name,
    role: input.role,
    capabilities: [...(input.capabilities || [])],
    status: input.status || AgentStatus.idle,
    currentTaskId: input.currentTaskId || null,
    metadata: { ...(input.metadata || {}) },
  };
}

function createTask(input) {
  requireString(input.id, 'task.id');
  requireString(input.title, 'task.title');

  return {
    id: input.id,
    title: input.title,
    owner: input.owner || null,
    parallel: input.parallel !== false,
    dependsOn: [...(input.dependsOn || [])],
    deliverable: input.deliverable || '',
    status: input.status || TaskStatus.pending,
    result: input.result || null,
    error: input.error || null,
    startedAt: input.startedAt || null,
    completedAt: input.completedAt || null,
    metadata: { ...(input.metadata || {}) },
  };
}

class TaskBoard {
  constructor(tasks) {
    this.tasks = new Map();
    (tasks || []).forEach((task) => this.addTask(task));
  }

  addTask(input) {
    const task = createTask(input);

    if (this.tasks.has(task.id)) {
      throw new Error(`Duplicate task id: ${task.id}`);
    }

    this.tasks.set(task.id, task);
    return cloneTask(task);
  }

  getTask(taskId) {
    const task = this.tasks.get(taskId);

    if (!task) {
      throw new Error(`Unknown task: ${taskId}`);
    }

    return cloneTask(task);
  }

  listTasks() {
    return Array.from(this.tasks.values()).map(cloneTask);
  }

  getReadyTasks() {
    return this.listTasks().filter((task) => task.status === TaskStatus.pending && this.dependenciesComplete(task));
  }

  getBlockedTasks() {
    return this.listTasks().filter((task) => task.status === TaskStatus.pending && !this.dependenciesComplete(task));
  }

  dependenciesComplete(task) {
    return task.dependsOn.every((dependencyId) => {
      const dependency = this.tasks.get(dependencyId);
      return dependency && dependency.status === TaskStatus.completed;
    });
  }

  startTask(taskId, owner) {
    const task = this.mutableTask(taskId);

    if (task.status !== TaskStatus.pending) {
      throw new Error(`Task ${taskId} cannot start from ${task.status}`);
    }

    if (!this.dependenciesComplete(task)) {
      throw new Error(`Task ${taskId} has incomplete dependencies`);
    }

    task.status = TaskStatus.inProgress;
    task.owner = owner || task.owner;
    task.startedAt = new Date().toISOString();
    task.error = null;

    return cloneTask(task);
  }

  completeTask(taskId, result) {
    const task = this.mutableTask(taskId);

    if (task.status !== TaskStatus.inProgress) {
      throw new Error(`Task ${taskId} cannot complete from ${task.status}`);
    }

    task.status = TaskStatus.completed;
    task.result = result || null;
    task.completedAt = new Date().toISOString();
    task.error = null;

    return cloneTask(task);
  }

  failTask(taskId, error) {
    const task = this.mutableTask(taskId);

    if (task.status !== TaskStatus.inProgress) {
      throw new Error(`Task ${taskId} cannot fail from ${task.status}`);
    }

    task.status = TaskStatus.failed;
    task.error = normalizeError(error);
    task.completedAt = new Date().toISOString();

    return cloneTask(task);
  }

  getProgress() {
    return createProgressState(this.listTasks());
  }

  mutableTask(taskId) {
    const task = this.tasks.get(taskId);

    if (!task) {
      throw new Error(`Unknown task: ${taskId}`);
    }

    return task;
  }
}

class AgentRegistry {
  constructor(agents) {
    this.agents = new Map();
    (agents || []).forEach((agent) => this.addAgent(agent));
  }

  addAgent(input) {
    const agent = createSubagent(input);

    if (this.agents.has(agent.name)) {
      throw new Error(`Duplicate agent: ${agent.name}`);
    }

    this.agents.set(agent.name, agent);
    return cloneAgent(agent);
  }

  getAgent(name) {
    const agent = this.agents.get(name);

    if (!agent) {
      throw new Error(`Unknown agent: ${name}`);
    }

    return cloneAgent(agent);
  }

  listAgents() {
    return Array.from(this.agents.values()).map(cloneAgent);
  }

  getAvailableAgents() {
    return this.listAgents().filter((agent) => agent.status === AgentStatus.idle);
  }

  assignTask(agentName, taskId) {
    const agent = this.mutableAgent(agentName);

    if (agent.status !== AgentStatus.idle) {
      throw new Error(`Agent ${agentName} is ${agent.status}`);
    }

    agent.status = AgentStatus.busy;
    agent.currentTaskId = taskId;

    return cloneAgent(agent);
  }

  releaseAgent(agentName) {
    const agent = this.mutableAgent(agentName);

    agent.status = AgentStatus.idle;
    agent.currentTaskId = null;

    return cloneAgent(agent);
  }

  setOffline(agentName) {
    const agent = this.mutableAgent(agentName);

    agent.status = AgentStatus.offline;
    agent.currentTaskId = null;

    return cloneAgent(agent);
  }

  mutableAgent(name) {
    const agent = this.agents.get(name);

    if (!agent) {
      throw new Error(`Unknown agent: ${name}`);
    }

    return agent;
  }
}

class MessageRouter {
  constructor(agentNames) {
    this.sequence = 0;
    this.inboxes = new Map();
    this.messages = [];
    (agentNames || []).forEach((agentName) => this.registerAgent(agentName));
  }

  registerAgent(agentName) {
    requireString(agentName, 'agentName');

    if (!this.inboxes.has(agentName)) {
      this.inboxes.set(agentName, []);
    }
  }

  send(input) {
    requireString(input.from, 'message.from');
    requireString(input.to, 'message.to');

    this.registerAgent(input.from);
    this.registerAgent(input.to);

    const message = {
      id: `msg-${++this.sequence}`,
      from: input.from,
      to: input.to,
      type: input.type || 'message',
      taskId: input.taskId || null,
      body: input.body || '',
      createdAt: new Date().toISOString(),
    };

    this.messages.push(message);
    this.inboxes.get(message.to).push(message);

    return cloneMessage(message);
  }

  broadcast(input) {
    requireString(input.from, 'message.from');

    return (input.to || [])
      .filter((agentName) => agentName !== input.from)
      .map((agentName) => this.send({ ...input, to: agentName }));
  }

  drain(agentName) {
    this.registerAgent(agentName);

    const messages = this.inboxes.get(agentName).map(cloneMessage);
    this.inboxes.set(agentName, []);

    return messages;
  }

  history(filter) {
    const criteria = filter || {};

    return this.messages
      .filter((message) => !criteria.agent || message.from === criteria.agent || message.to === criteria.agent)
      .filter((message) => !criteria.taskId || message.taskId === criteria.taskId)
      .map(cloneMessage);
  }
}

async function executeParallel(items, worker, options) {
  if (typeof worker !== 'function') {
    throw new Error('worker must be a function');
  }

  const queue = [...(items || [])];
  const concurrency = Math.max(1, Math.min(options && options.concurrency ? options.concurrency : queue.length || 1, queue.length || 1));
  const results = [];
  let cursor = 0;

  async function runNext() {
    const index = cursor++;

    if (index >= queue.length) {
      return;
    }

    const item = queue[index];

    try {
      results[index] = { status: 'fulfilled', value: await worker(item, index) };
    } catch (error) {
      results[index] = { status: 'rejected', reason: normalizeError(error) };
    }

    await runNext();
  }

  await Promise.all(Array.from({ length: concurrency }, runNext));

  return results;
}

async function executeReadyTasks(board, registry, workersByAgent, options) {
  const readyTasks = board.getReadyTasks();

  return executeParallel(
    readyTasks,
    async (task) => {
      const worker = workersByAgent && workersByAgent[task.owner];

      if (typeof worker !== 'function') {
        throw new Error(`No worker registered for ${task.owner}`);
      }

      registry.assignTask(task.owner, task.id);
      board.startTask(task.id, task.owner);

      try {
        const result = await worker(task);
        const completedTask = board.completeTask(task.id, result);
        registry.releaseAgent(task.owner);
        return { task: completedTask, result };
      } catch (error) {
        const failedTask = board.failTask(task.id, error);
        registry.releaseAgent(task.owner);
        throw { task: failedTask, error: normalizeError(error) };
      }
    },
    options,
  );
}

function createProgressState(tasks) {
  const counts = {
    [TaskStatus.pending]: 0,
    [TaskStatus.inProgress]: 0,
    [TaskStatus.completed]: 0,
    [TaskStatus.failed]: 0,
  };

  (tasks || []).forEach((task) => {
    counts[task.status] = (counts[task.status] || 0) + 1;
  });

  const total = (tasks || []).length;
  const completed = counts[TaskStatus.completed];
  const failed = counts[TaskStatus.failed];

  return {
    total,
    completed,
    failed,
    active: counts[TaskStatus.inProgress],
    pending: counts[TaskStatus.pending],
    percentComplete: total === 0 ? 100 : Math.round((completed / total) * 100),
    counts,
  };
}

function cloneTask(task) {
  return {
    ...task,
    dependsOn: [...task.dependsOn],
    metadata: { ...task.metadata },
  };
}

function cloneAgent(agent) {
  return {
    ...agent,
    capabilities: [...agent.capabilities],
    metadata: { ...agent.metadata },
  };
}

function cloneMessage(message) {
  return { ...message };
}

function normalizeError(error) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }

  return error;
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
}

module.exports = {
  AgentRegistry,
  AgentStatus,
  MessageRouter,
  TaskBoard,
  TaskStatus,
  createAgentTeam,
  createProgressState,
  createSubagent,
  createTask,
  executeParallel,
  executeReadyTasks,
};
