"use strict";

const { strict: assert } = require('node:assert');
const { describe, it, beforeEach } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const {
  generateTeamPlan,
  decomposeGoalFallback,
  validatePlan,
  formatGeneratedPlan,
  isLLMAvailable,
  parseLLMResponse,
} = require('../src/teams/planner');
const { loadAgentDefinitions } = require('../src/teams/agents');
const { createTeamRuntime } = require('../src/teams/runtime');
const { formatTeamPlan } = require('../src/formatters/team-plan');

function getAvailableAgentTypes() {
  const defs = loadAgentDefinitions({ projectRoot: process.cwd() });
  return defs.activeAgents.map((a) => a.agentType);
}

function mockProvider() {
  return { name: 'mock', apiKey: null, model: 'mock' };
}

function llmProvider(jsonResponse) {
  return {
    name: 'anthropic',
    apiKey: 'sk-test',
    model: 'claude-sonnet-4-20250514',
    stream: async function* () {
      for (const ch of (jsonResponse || '{}')) {
        yield { type: 'text', delta: ch };
      }
    },
  };
}

describe('isLLMAvailable', () => {
  it('returns false for null', () => {
    assert.strictEqual(isLLMAvailable(null), false);
  });

  it('returns false for mock provider', () => {
    assert.strictEqual(isLLMAvailable({ name: 'mock', apiKey: null }), false);
  });

  it('returns false for provider without apiKey', () => {
    assert.strictEqual(isLLMAvailable({ name: 'anthropic', apiKey: null }), false);
  });

  it('returns true for provider with apiKey', () => {
    assert.strictEqual(isLLMAvailable({ name: 'anthropic', apiKey: 'sk-123' }), true);
  });
});

describe('generateTeamPlan', () => {
  it('rejects empty goal', async () => {
    await assert.rejects(
      () => generateTeamPlan({ goal: '', provider: mockProvider() }),
      /Goal description is required/,
    );
  });

  it('produces pattern-based plan when no LLM available', async () => {
    const result = await generateTeamPlan({
      goal: 'build a login page with password reset',
      provider: mockProvider(),
    });

    assert.strictEqual(result.source, 'pattern');
    assert.ok(result.plan.tasks.length > 0);
    assert.ok(result.plan.members.length > 0);
    assert.ok(result.planText.length > 0);
  });

  it('uses LLM when real provider with apiKey is available', async () => {
    const json = JSON.stringify({
      name: 'login-builder',
      mission: 'Build login page',
      members: [{ agentType: 'implementer', name: 'ui-builder', role: 'Build UI' }],
      tasks: [{
        id: 'T1', title: 'Build page', owner: 'ui-builder', prompt: 'Build it',
        dependsOn: [], deliverable: 'Login page', agentType: 'implementer', parallel: true,
      }],
    });

    const result = await generateTeamPlan({
      goal: 'build a login page',
      provider: llmProvider(json),
    });

    assert.strictEqual(result.source, 'llm');
    assert.strictEqual(result.plan.name, 'login-builder');
  });

  it('falls back to pattern if LLM stream throws', async () => {
    const bad = {
      name: 'anthropic',
      apiKey: 'sk-test',
      stream: async function* () { throw new Error('Connection refused'); },
    };

    const result = await generateTeamPlan({ goal: 'refactor user service', provider: bad });
    assert.strictEqual(result.source, 'pattern');
  });
});

describe('decomposeGoalFallback', () => {
  const defs = loadAgentDefinitions({ projectRoot: process.cwd() });
  const types = defs.activeAgents.map((a) => a.agentType);

  it('always produces at least 1 member and 1 task', () => {
    const plan = decomposeGoalFallback('do stuff', types, defs);
    assert.ok(plan.members.length >= 1);
    assert.ok(plan.tasks.length >= 1);
  });

  it('includes explorer for exploration goals', () => {
    const plan = decomposeGoalFallback('explore the auth module and map dependencies', types, defs);
    const agentTypes = plan.members.map((m) => m.agentType);
    assert.ok(agentTypes.includes('explore'));
  });

  it('includes planner for design/architecture goals', () => {
    const plan = decomposeGoalFallback('design a new payment microservice architecture', types, defs);
    const agentTypes = plan.members.map((m) => m.agentType);
    assert.ok(agentTypes.includes('planner'));
  });

  it('includes implementer for build/code goals', () => {
    const plan = decomposeGoalFallback('implement a rate limiter middleware for express', types, defs);
    const agentTypes = plan.members.map((m) => m.agentType);
    assert.ok(agentTypes.includes('implementer'));
  });

  it('includes security-reviewer for security audit goals', () => {
    const plan = decomposeGoalFallback('audit the authentication module for security vulnerabilities', types, defs);
    const agentTypes = plan.members.map((m) => m.agentType);
    assert.ok(agentTypes.includes('security-reviewer'));
  });

  it('includes test-runner for testing goals', () => {
    const plan = decomposeGoalFallback('add test coverage for the payment processing module', types, defs);
    const agentTypes = plan.members.map((m) => m.agentType);
    assert.ok(agentTypes.includes('test-runner'));
  });

  it('includes docs-writer for documentation goals', () => {
    const plan = decomposeGoalFallback('update the README with new API usage instructions', types, defs);
    const agentTypes = plan.members.map((m) => m.agentType);
    assert.ok(agentTypes.includes('docs-writer'));
  });

  it('chains implementation tasks after planning when both present', () => {
    const plan = decomposeGoalFallback('design and implement a caching layer', types, defs);
    const implTask = plan.tasks.find((t) => t.agentType === 'implementer');
    const plannerTask = plan.tasks.find((t) => t.agentType === 'planner');
    if (implTask && plannerTask) {
      assert.ok(implTask.dependsOn.includes(plannerTask.id),
        `Expected ${implTask.id} to depend on ${plannerTask.id}`);
    }
  });
});

describe('validatePlan', () => {
  const defs = loadAgentDefinitions({ projectRoot: process.cwd() });

  it('passes through valid plan unchanged', () => {
    const plan = {
      name: 'test',
      mission: 'Test',
      members: [{ agentType: 'general-purpose', name: 'worker', role: 'Works' }],
      tasks: [{ id: 'T1', title: 'X', owner: 'worker', prompt: '', dependsOn: [], deliverable: '', agentType: 'general-purpose', parallel: true }],
    };
    const validated = validatePlan(plan, defs);
    assert.strictEqual(validated.members[0].agentType, 'general-purpose');
    assert.strictEqual(validated.tasks[0].owner, 'worker');
  });

  it('maps unknown agent types to closest known', () => {
    const plan = {
      name: 'test',
      mission: 'Test',
      members: [{ agentType: 'tester-person', name: 'tester', role: 'Tests' }],
      tasks: [],
    };
    const validated = validatePlan(plan, defs);
    assert.strictEqual(validated.members[0].agentType, 'test-runner');
  });

  it('reassigns task owners not in team to first member', () => {
    const plan = {
      name: 'test',
      mission: 'Test',
      members: [{ agentType: 'implementer', name: 'coder', role: 'Codes' }],
      tasks: [{ id: 'T1', title: 'X', owner: 'ghost-worker', prompt: '', dependsOn: [], deliverable: '', agentType: 'implementer', parallel: true }],
    };
    const validated = validatePlan(plan, defs);
    assert.strictEqual(validated.tasks[0].owner, 'coder');
  });

  it('fixes invalid task agent types from owner member', () => {
    const plan = {
      name: 'test',
      mission: 'Test',
      members: [{ agentType: 'implementer', name: 'coder', role: 'Codes' }],
      tasks: [{ id: 'T1', title: 'X', owner: 'coder', prompt: '', dependsOn: [], deliverable: '', agentType: 'bad-type', parallel: true }],
    };
    const validated = validatePlan(plan, defs);
    assert.strictEqual(validated.tasks[0].agentType, 'implementer');
  });
});

describe('parseLLMResponse', () => {
  it('parses plain JSON', () => {
    const json = JSON.stringify({
      name: 'test-team',
      mission: 'do stuff',
      members: [{ agentType: 'general-purpose', name: 'helper', role: 'help' }],
      tasks: [{ id: 'T1', title: 'X', owner: 'helper', dependsOn: [], agentType: 'general-purpose' }],
    });
    const plan = parseLLMResponse(json, 'goal text', ['general-purpose'], {});
    assert.strictEqual(plan.name, 'test-team');
  });

  it('strips markdown json code fences', () => {
    const json = JSON.stringify({
      name: 'test-team',
      mission: 'do',
      members: [{ agentType: 'general-purpose', name: 'helper', role: 'help' }],
      tasks: [{ id: 'T1', title: 'X', owner: 'helper', dependsOn: [], agentType: 'general-purpose' }],
    });
    const response = 'Here is your plan:\n```json\n' + json + '\n```\nHope that works!';
    const plan = parseLLMResponse(response, 'goal', ['general-purpose'], {});
    assert.strictEqual(plan.name, 'test-team');
  });

  it('normalizes names to kebab-case', () => {
    const json = JSON.stringify({
      name: 'My Cool Team',
      mission: 'do',
      members: [{ agentType: 'General-Purpose', name: 'Helper Bot', role: 'Helps' }],
      tasks: [],
    });
    const plan = parseLLMResponse(json, 'goal', ['general-purpose'], {});
    assert.strictEqual(plan.name, 'my-cool-team');
    assert.strictEqual(plan.members[0].name, 'helper-bot');
    assert.strictEqual(plan.members[0].agentType, 'general-purpose');
  });

  it('handles trailing commas in JSON', () => {
    const bad = '{"name":"test","mission":"x","members":[{"agentType":"general-purpose","name":"x","role":"x"},],"tasks":[],}';
    const plan = parseLLMResponse(bad, 'goal', ['general-purpose'], {});
    assert.strictEqual(plan.name, 'test');
    assert.strictEqual(plan.members.length, 1);
  });
});

describe('formatGeneratedPlan', () => {
  it('produces readable text with members and tasks', () => {
    const plan = {
      name: 'test-team',
      mission: 'Do things',
      members: [
        { agentType: 'explore', name: 'explorer', role: 'Maps codebase' },
        { agentType: 'implementer', name: 'coder', role: 'Builds features' },
      ],
      tasks: [
        { id: 'T1', title: 'Explore', owner: 'explorer', agentType: 'explore', dependsOn: [], deliverable: 'Map', parallel: true },
        { id: 'T2', title: 'Build', owner: 'coder', agentType: 'implementer', dependsOn: ['T1'], deliverable: 'Code', parallel: false },
      ],
    };
    const text = formatGeneratedPlan(plan);
    assert.ok(text.includes('test-team'));
    assert.ok(text.includes('explorer (explore)'));
    assert.ok(text.includes('coder (implementer)'));
    assert.ok(text.includes('T1'));
    assert.ok(text.includes('T2'));
    assert.ok(text.includes('depends on: T1'));
  });
});

describe('formatTeamPlan (updated formatter)', () => {
  it('formats plan objects from the planner', () => {
    const plan = {
      name: 'scraper-team',
      mission: 'Build a web scraper',
      members: [{ name: 'crawler', agentType: 'implementer', role: 'Builds crawler' }],
      tasks: [{ id: 'T1', title: 'Build', owner: 'crawler', agentType: 'implementer', dependsOn: [], deliverable: 'Module', parallel: true }],
    };
    const text = formatTeamPlan(plan);
    assert.ok(text.includes('scraper-team'));
    assert.ok(text.includes('crawler'));
    assert.ok(text.includes('T1'));
    assert.ok(text.includes('(implementer)'));
  });
});

describe('TeamRuntime integration with generated plans', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hax-plan-test-'));
  });

  it('creates a TeamRuntime from a pattern-generated plan', () => {
    try {
      const plan = decomposeGoalFallback(
        'build a web scraper that monitors prices',
        getAvailableAgentTypes(),
        loadAgentDefinitions({ projectRoot: tmpDir }),
      );

      const rt = createTeamRuntime({
        settings: { projectRoot: tmpDir },
        projectRoot: tmpDir,
      });

      const result = rt.createTeam({
        name: plan.name,
        mission: plan.mission,
        members: plan.members,
      });

      assert.ok(result.team);
      assert.strictEqual(result.team.teamName, plan.name);
      assert.ok(result.team.members.length > 0);

      for (const task of plan.tasks) {
        const created = rt.addTask({
          title: task.title,
          prompt: task.prompt,
          owner: task.owner,
          agentType: task.agentType,
          dependsOn: task.dependsOn,
          deliverable: task.deliverable,
          parallel: task.parallel,
        });
        assert.ok(created.id);
      }

      const snap = rt.snapshot();
      assert.strictEqual(snap.tasks.length, plan.tasks.length);

      const stateFile = path.join(tmpDir, '.hax-agent', 'teams', `${plan.name}.json`);
      assert.ok(fs.existsSync(stateFile), `Expected state file at ${stateFile}`);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* ok */ }
    }
  });

  it('dependencies are valid and progress starts at zero', () => {
    try {
      const plan = decomposeGoalFallback(
        'design, implement, and test a rate limiter for the API',
        getAvailableAgentTypes(),
        loadAgentDefinitions({ projectRoot: tmpDir }),
      );

      const rt = createTeamRuntime({
        settings: { projectRoot: tmpDir },
        projectRoot: tmpDir,
      });

      rt.createTeam({ name: plan.name, mission: plan.mission, members: plan.members });

      for (const task of plan.tasks) {
        rt.addTask({
          title: task.title,
          prompt: task.prompt,
          owner: task.owner,
          agentType: task.agentType,
          dependsOn: task.dependsOn,
          deliverable: task.deliverable,
          parallel: task.parallel,
        });
      }

      const snap = rt.snapshot();
      assert.ok(snap.progress.total > 0, 'Should have at least one task');
      assert.strictEqual(snap.progress.completed, 0, 'No tasks have run yet');

      // Every dependency must exist in the task list
      for (const task of snap.tasks) {
        for (const depId of task.dependsOn) {
          const dep = snap.tasks.find((t) => t.id === depId);
          assert.ok(dep, `Missing dependency ${depId} referenced by ${task.id}`);
        }
      }
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* ok */ }
    }
  });
});
