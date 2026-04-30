const assert = require('node:assert/strict');
const test = require('node:test');

const { createAuthRefactorTeam } = require('../src/teams/auth-refactor');

test('creates the auth refactor team with named agents and mission', () => {
  const team = createAuthRefactorTeam();

  assert.equal(team.name, 'auth-refactor');
  assert.match(team.mission, /authentication module/);
  assert.deepEqual(
    team.agents.map((agent) => agent.name),
    [
      'auth-architect',
      'token-specialist',
      'session-specialist',
      'identity-specialist',
      'security-reviewer',
      'test-engineer',
    ],
  );
});

test('keeps independent workstreams parallel until final merge', () => {
  const team = createAuthRefactorTeam();
  const taskById = new Map(team.tasks.map((task) => [task.id, task]));

  assert.deepEqual(
    team.tasks.filter((task) => task.parallel).map((task) => task.id),
    ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'],
  );
  assert.deepEqual(taskById.get('A5').dependsOn, ['A1']);
  assert.deepEqual(taskById.get('A6').dependsOn, ['A1']);
  assert.equal(taskById.get('A7').parallel, false);
  assert.deepEqual(taskById.get('A7').dependsOn, ['A2', 'A3', 'A4', 'A5', 'A6']);
});

test('includes validation for service tests, integration flows, and security review', () => {
  const team = createAuthRefactorTeam();

  assert.equal(team.validation.length, 3);
  assert.match(team.validation.join('\n'), /unit tests/);
  assert.match(team.validation.join('\n'), /integration tests/);
  assert.match(team.validation.join('\n'), /security review/);
});
