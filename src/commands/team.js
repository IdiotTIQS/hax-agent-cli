const { loadAgentDefinitions } = require('../teams/agents');
const { createTeamRuntime } = require('../teams/runtime');
const { createLocalToolRegistry } = require('../tools');
const {
  formatAgentList,
  formatMessages,
  formatRunResult,
  formatTeamList,
  formatTeamSnapshot,
} = require('../formatters/agent-teams');

function createCliTeamRuntime(settings) {
  return createTeamRuntime({
    settings,
    projectRoot: settings.projectRoot || process.cwd(),
    toolRegistryFactory: () => createLocalToolRegistry({
      root: settings.projectRoot || process.cwd(),
      shellPolicy: settings.tools?.shell,
    }),
  });
}

async function executeTeamCommand(runtime, subCommand, args, context = {}) {
  switch (subCommand) {
    case 'help': return formatTeamUsage();
    case 'agents':
      return formatAgentList(loadAgentDefinitions({
        projectRoot: context.settings?.projectRoot || process.cwd(),
        settings: context.settings,
      }));
    case 'list': return formatTeamList(runtime.listTeams());
    case 'new':
    case 'create': {
      const options = parseTeamOptions(args);
      const members = parseMembersOption(options.members || options.member);
      const result = runtime.createTeam({
        name: options.name || options._[0] || 'default',
        mission: options.mission || options._.slice(1).join(' '),
        members,
      });
      return formatTeamSnapshot(result.team);
    }
    case 'spawn':
    case 'add-agent': {
      const options = parseTeamOptions(args);
      runtime.loadOrCreateTeam({ name: options.team || options.t || 'default' });
      const member = runtime.addMember({
        agentType: options.type || options.agent || options._[0] || 'general-purpose',
        name: options.name || options._[1],
        model: options.model,
      });
      return `Spawned ${member.name} (${member.agentType}) in team ${runtime.snapshot().teamName}.\n\n${formatTeamSnapshot(runtime.snapshot())}`;
    }
    case 'task':
    case 'add-task': {
      const options = parseTeamOptions(args);
      runtime.loadOrCreateTeam({ name: options.team || options.t || 'default' });
      const title = options.title || options._.join(' ');
      const task = runtime.addTask({
        title,
        prompt: options.prompt || title,
        owner: options.owner,
        agentType: options.type || options.agent,
        deliverable: options.deliverable,
        dependsOn: options.depends || options.dependsOn,
        parallel: options.parallel !== 'false',
      });
      return `Added task ${task.id}.\n\n${formatTeamSnapshot(runtime.snapshot())}`;
    }
    case 'run': {
      const options = parseTeamOptions(args);
      runtime.loadOrCreateTeam({ name: options.team || options.t || 'default' });
      const result = await runtime.run({
        concurrency: options.concurrency,
        maxToolTurns: options.maxToolTurns,
      });
      return formatRunResult(result);
    }
    case 'status':
    case 'show': {
      const options = parseTeamOptions(args);
      const snapshot = runtime.loadTeam(options.team || options.t || options._[0] || 'default');
      return formatTeamSnapshot(snapshot);
    }
    case 'send': {
      const options = parseTeamOptions(args);
      runtime.loadTeam(options.team || options.t || 'default');
      const message = runtime.sendMessage({
        to: options.to || options._[0],
        body: options.message || options._.slice(1).join(' '),
      });
      return formatMessages([message]);
    }
    case 'inbox': {
      const options = parseTeamOptions(args);
      runtime.loadTeam(options.team || options.t || 'default');
      const messages = runtime.drainMessages(options.agent || options._[0] || 'lead');
      return formatMessages(messages);
    }
    default:
      throw new Error(`Unknown team command: ${subCommand}.\n${formatTeamUsage()}`);
  }
}

function formatTeamUsage() {
  return [
    'Usage: hax-agent team <command> [options]',
    '',
    'Commands:',
    '  team agents                         List available agent types',
    '  team list                           List saved teams',
    '  team new <name> --mission <text>     Create a team state file',
    '  team spawn <agent-type> [name]       Add a teammate to a team',
    '  team task <title> --owner <agent>    Add a task to the team board',
    '  team run --team <name>               Run ready tasks with teammates',
    '  team status [name]                   Show roster, task board, and progress',
    '  team send <agent> <message>          Send a mailbox message',
    '  team inbox <agent>                   Read unread mailbox messages',
  ].join('\n');
}

function parseTeamOptions(args) {
  const options = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      options._.push(arg);
      continue;
    }
    const [rawKey, inlineValue] = arg.slice(2).split('=');
    const key = rawKey.replace(/-([a-z])/g, (_match, char) => char.toUpperCase());
    const value = inlineValue !== undefined
      ? inlineValue
      : args[index + 1] && !args[index + 1].startsWith('--') ? args[++index] : 'true';
    options[key] = value;
  }
  return options;
}

function parseMembersOption(value) {
  if (!value) return [];
  return String(value).split(',').map((item) => {
    const [agentType, name] = item.split(':');
    return { agentType, name };
  }).filter((member) => member.agentType);
}

module.exports = {
  createCliTeamRuntime,
  executeTeamCommand,
};
