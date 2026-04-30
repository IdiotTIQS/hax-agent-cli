const { createTeamRuntime } = require('./runtime');

function registerAgentTeamTools(registry, options = {}) {
  const settings = options.settings || {};
  const projectRoot = options.projectRoot || settings.projectRoot || process.cwd();
  const runtimeFactory = options.runtimeFactory || (() => createTeamRuntime({
    settings,
    projectRoot,
    toolRegistryFactory: options.toolRegistryFactory,
  }));

  registry
    .register(createTeamStatusTool(runtimeFactory))
    .register(createTeamSpawnTool(runtimeFactory))
    .register(createTeamTaskTool(runtimeFactory))
    .register(createTeamRunTool(runtimeFactory))
    .register(createTeamSendTool(runtimeFactory));

  return registry;
}

function createTeamStatusTool(runtimeFactory) {
  return {
    name: 'agent.team.status',
    description: 'Show an agent team roster, task board, mailbox, and progress state.',
    inputSchema: {
      type: 'object',
      properties: {
        team_name: { type: 'string', default: 'default' },
      },
    },
    execute(args) {
      const runtime = runtimeFactory();
      const snapshot = runtime.loadOrCreateTeam({ name: args.team_name || 'default' }).team;
      return compactSnapshot(snapshot);
    },
  };
}

function createTeamSpawnTool(runtimeFactory) {
  return {
    name: 'agent.spawn',
    description: 'Spawn a named teammate in an agent team. The teammate becomes addressable by agent.send and can own tasks.',
    inputSchema: {
      type: 'object',
      required: ['name', 'prompt'],
      properties: {
        name: { type: 'string' },
        prompt: { type: 'string' },
        team_name: { type: 'string', default: 'default' },
        subagent_type: { type: 'string', default: 'general-purpose' },
        model: { type: 'string' },
        run_now: { type: 'boolean', default: false },
      },
    },
    async execute(args) {
      const runtime = runtimeFactory();
      runtime.loadOrCreateTeam({ name: args.team_name || 'default' });
      const member = runtime.addMember({
        name: args.name,
        agentType: args.subagent_type || 'general-purpose',
        model: args.model,
      });
      const task = runtime.addTask({
        title: `${member.name}: ${args.prompt}`,
        prompt: args.prompt,
        owner: member.name,
      });
      const result = {
        status: 'teammate_spawned',
        team_name: runtime.snapshot().teamName,
        teammate_id: member.id,
        agent_id: member.id,
        name: member.name,
        agent_type: member.agentType,
        model: member.model,
        task_id: task.id,
        prompt: args.prompt,
      };

      if (args.run_now === true) {
        result.run = await runtime.run({ concurrency: 1 });
      }

      return result;
    },
  };
}

function createTeamTaskTool(runtimeFactory) {
  return {
    name: 'agent.task',
    description: 'Add a task to an agent team board and assign it to a teammate or agent type.',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string' },
        prompt: { type: 'string' },
        team_name: { type: 'string', default: 'default' },
        owner: { type: 'string' },
        subagent_type: { type: 'string' },
        depends_on: { type: 'array', items: { type: 'string' }, default: [] },
        deliverable: { type: 'string' },
      },
    },
    execute(args) {
      const runtime = runtimeFactory();
      runtime.loadOrCreateTeam({ name: args.team_name || 'default' });
      const task = runtime.addTask({
        title: args.title,
        prompt: args.prompt || args.title,
        owner: args.owner,
        agentType: args.subagent_type,
        dependsOn: args.depends_on || [],
        deliverable: args.deliverable,
      });
      return { status: 'task_added', team_name: runtime.snapshot().teamName, task };
    },
  };
}

function createTeamRunTool(runtimeFactory) {
  return {
    name: 'agent.team.run',
    description: 'Run all currently ready tasks on an agent team board with bounded parallelism.',
    inputSchema: {
      type: 'object',
      properties: {
        team_name: { type: 'string', default: 'default' },
        concurrency: { type: 'number', default: 4 },
        max_tool_turns: { type: 'number' },
      },
    },
    async execute(args) {
      const runtime = runtimeFactory();
      runtime.loadOrCreateTeam({ name: args.team_name || 'default' });
      return runtime.run({ concurrency: args.concurrency, maxToolTurns: args.max_tool_turns });
    },
  };
}

function createTeamSendTool(runtimeFactory) {
  return {
    name: 'agent.send',
    description: 'Send a mailbox message to a teammate by name or agent id.',
    inputSchema: {
      type: 'object',
      required: ['to', 'message'],
      properties: {
        to: { type: 'string' },
        message: { type: 'string' },
        team_name: { type: 'string', default: 'default' },
      },
    },
    execute(args) {
      const runtime = runtimeFactory();
      runtime.loadTeam(args.team_name || 'default');
      return runtime.sendMessage({ to: args.to, body: args.message });
    },
  };
}

function compactSnapshot(snapshot) {
  return {
    teamName: snapshot.teamName,
    mission: snapshot.mission,
    members: snapshot.members.map((member) => ({
      id: member.id,
      name: member.name,
      agentType: member.agentType,
      status: member.status,
      currentTaskId: member.currentTaskId,
    })),
    tasks: snapshot.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      owner: task.owner,
      status: task.status,
      dependsOn: task.dependsOn,
    })),
    progress: snapshot.progress,
    path: snapshot.path,
  };
}

module.exports = {
  registerAgentTeamTools,
};
