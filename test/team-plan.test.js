const assert = require('node:assert/strict');
const test = require('node:test');

const { formatTeamPlan } = require('../src/formatters/team-plan');
const { createAuthRefactorTeam } = require('../src/teams/auth-refactor');

test('formats the auth refactor plan into CLI-readable sections', () => {
  const output = formatTeamPlan(createAuthRefactorTeam());

  assert.match(output, /^Team: auth-refactor\nMission: /);
  assert.match(output, /\nAgents:\n- auth-architect: /);
  assert.match(output, /\nParallel Workstreams:\n- A1 \[parallel\] Map current auth contracts/);
  assert.match(output, /\nValidation:\n- Run unit tests/);
});

test('renders missing dependencies as none and listed dependencies by id', () => {
  const output = formatTeamPlan(createAuthRefactorTeam());

  assert.match(output, /- A1 \[parallel\] Map current auth contracts\n  owner: auth-architect\n  depends on: none/);
  assert.match(output, /- A7 \[sequential\] Merge compatible boundaries\n  owner: auth-architect\n  depends on: A2, A3, A4, A5, A6/);
});
