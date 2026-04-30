const { createAgentTeam } = require('../orchestration');

function createAuthRefactorTeam() {
  return createAgentTeam({
    name: 'auth-refactor',
    mission: 'Refactor the authentication module with isolated, parallel agent workstreams.',
    agents: [
      {
        name: 'auth-architect',
        role: 'Owns module boundaries, public interfaces, and sequencing constraints.',
      },
      {
        name: 'token-specialist',
        role: 'Refactors token issuing, verification, refresh, and revocation logic.',
      },
      {
        name: 'session-specialist',
        role: 'Refactors session persistence, cookie policy, and logout behavior.',
      },
      {
        name: 'identity-specialist',
        role: 'Refactors password, MFA, OAuth, and account lookup flows.',
      },
      {
        name: 'security-reviewer',
        role: 'Reviews trust boundaries, secrets handling, and regression risks.',
      },
      {
        name: 'test-engineer',
        role: 'Builds integration and regression coverage across the refactor.',
      },
    ],
    tasks: [
      {
        id: 'A1',
        owner: 'auth-architect',
        title: 'Map current auth contracts',
        parallel: true,
        dependsOn: [],
        deliverable: 'A contract map covering routes, middleware, services, storage, and external providers.',
      },
      {
        id: 'A2',
        owner: 'token-specialist',
        title: 'Isolate token lifecycle',
        parallel: true,
        dependsOn: [],
        deliverable: 'A token service boundary with tests for issue, verify, refresh, revoke, and expiry paths.',
      },
      {
        id: 'A3',
        owner: 'session-specialist',
        title: 'Isolate session lifecycle',
        parallel: true,
        dependsOn: [],
        deliverable: 'A session service boundary with cookie, persistence, logout, and invalidation coverage.',
      },
      {
        id: 'A4',
        owner: 'identity-specialist',
        title: 'Normalize identity flows',
        parallel: true,
        dependsOn: [],
        deliverable: 'A normalized identity API for credential, MFA, OAuth, and account lookup behavior.',
      },
      {
        id: 'A5',
        owner: 'security-reviewer',
        title: 'Review auth threat model',
        parallel: true,
        dependsOn: ['A1'],
        deliverable: 'A risk checklist covering injection, fixation, replay, CSRF, secret exposure, and privilege boundaries.',
      },
      {
        id: 'A6',
        owner: 'test-engineer',
        title: 'Build regression test matrix',
        parallel: true,
        dependsOn: ['A1'],
        deliverable: 'A test matrix for success paths, failure paths, expired credentials, concurrent sessions, and provider errors.',
      },
      {
        id: 'A7',
        owner: 'auth-architect',
        title: 'Merge compatible boundaries',
        parallel: false,
        dependsOn: ['A2', 'A3', 'A4', 'A5', 'A6'],
        deliverable: 'A final integration pass that removes duplicated auth logic and preserves public behavior.',
      },
    ],
    validation: [
      'Run unit tests for each extracted auth service.',
      'Run integration tests for login, refresh, logout, password reset, MFA, and OAuth callbacks.',
      'Run a security review before merging the final integration task.',
    ],
  });
}

module.exports = { createAuthRefactorTeam };
