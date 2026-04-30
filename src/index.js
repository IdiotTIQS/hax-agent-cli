const config = require('./config');
const context = require('./context');
const memory = require('./memory');
const orchestration = require('./orchestration');
const runtime = require('./runtime');
const { createAuthRefactorTeam } = require('./teams/auth-refactor');
const agentTeams = require('./teams/runtime');
const teamAgents = require('./teams/agents');
const teamTools = require('./teams/tools');
const { formatTeamPlan } = require('./formatters/team-plan');
const agentTeamFormatters = require('./formatters/agent-teams');

module.exports = {
  config,
  context,
  memory,
  ...orchestration,
  ...runtime,
  ...agentTeams,
  ...teamAgents,
  ...teamTools,
  ...agentTeamFormatters,
  createAuthRefactorTeam,
  formatTeamPlan,
};
