const config = require('./config');
const context = require('./context');
const fileContext = require('./file-context');
const memory = require('./memory');
const orchestration = require('./orchestration');
const basicRuntime = require('./runtime');
const { createAuthRefactorTeam } = require('./teams/auth-refactor');
const agentTeams = require('./teams/runtime');
const teamAgents = require('./teams/agents');
const teamTools = require('./teams/tools');
const { formatTeamPlan } = require('./formatters/team-plan');
const agentTeamFormatters = require('./formatters/agent-teams');

module.exports = {
  config,
  context,
  fileContext,
  memory,
  basicRuntime,
  ...orchestration,
  ...basicRuntime,
  ...agentTeams,
  ...teamAgents,
  ...teamTools,
  ...agentTeamFormatters,
  createAuthRefactorTeam,
  formatTeamPlan,
};
