"use strict";

const { strict: assert } = require('node:assert');
const { describe, it } = require('node:test');

const {
  SENIOR_DEVELOPER,
  CODE_REVIEWER,
  SECURITY_ENGINEER,
  TEST_ENGINEER,
  DEVOPS_ENGINEER,
  DATA_SCIENTIST,
  TECH_WRITER,
  ARCHITECT,
  DEBUGGER,
  PERFORMANCE_ENGINEER,
} = require('../../src/prompts/roles');

// Every role must have the required shape
const ALL_ROLES = [
  SENIOR_DEVELOPER,
  CODE_REVIEWER,
  SECURITY_ENGINEER,
  TEST_ENGINEER,
  DEVOPS_ENGINEER,
  DATA_SCIENTIST,
  TECH_WRITER,
  ARCHITECT,
  DEBUGGER,
  PERFORMANCE_ENGINEER,
];

describe('Role shape validation', () => {
  for (const role of ALL_ROLES) {
    it(`${role.name} has all required properties`, () => {
      assert.ok(typeof role.name === 'string' && role.name.length > 0, 'name must be a non-empty string');
      assert.ok(typeof role.description === 'string' && role.description.length > 0, 'description must be a non-empty string');
      assert.ok(typeof role.systemPrompt === 'string' && role.systemPrompt.length > 100, 'systemPrompt must be a substantial string');
      assert.ok(Array.isArray(role.recommendedTools), 'recommendedTools must be an array');
      assert.ok(role.recommendedTools.length > 0, 'recommendedTools must not be empty');
      assert.ok(typeof role.suggestedTemperature === 'number', 'suggestedTemperature must be a number');
      assert.ok(role.suggestedTemperature >= 0 && role.suggestedTemperature <= 1, 'suggestedTemperature must be between 0 and 1');
    });
  }

  it('all roles are frozen (immutable)', () => {
    for (const role of ALL_ROLES) {
      assert.ok(Object.isFrozen(role), `${role.name} should be frozen`);
    }
  });

  it('all role names are unique', () => {
    const names = ALL_ROLES.map((r) => r.name);
    const unique = new Set(names);
    assert.strictEqual(unique.size, ALL_ROLES.length, 'Role names must be unique');
  });
});

describe('SENIOR_DEVELOPER', () => {
  it('has development-focused prompt content', () => {
    assert.ok(SENIOR_DEVELOPER.systemPrompt.includes('SOLID'));
    assert.ok(SENIOR_DEVELOPER.systemPrompt.includes('Senior Software Engineer'));
  });

  it('recommends core file and shell tools', () => {
    assert.ok(SENIOR_DEVELOPER.recommendedTools.includes('file.read'));
    assert.ok(SENIOR_DEVELOPER.recommendedTools.includes('file.write'));
    assert.ok(SENIOR_DEVELOPER.recommendedTools.includes('shell.run'));
  });
});

describe('CODE_REVIEWER', () => {
  it('has review-focused prompt content', () => {
    assert.ok(CODE_REVIEWER.systemPrompt.includes('BLOCKER'));
    assert.ok(CODE_REVIEWER.systemPrompt.includes('Correctness'));
    assert.ok(CODE_REVIEWER.systemPrompt.includes('Security'));
  });

  it('does not recommend write tools (read-only role)', () => {
    assert.ok(!CODE_REVIEWER.recommendedTools.includes('file.write'));
  });

  it('has low suggested temperature for deterministic reviews', () => {
    assert.ok(CODE_REVIEWER.suggestedTemperature <= 0.3);
  });
});

describe('SECURITY_ENGINEER', () => {
  it('has security-focused prompt content', () => {
    assert.ok(SECURITY_ENGINEER.systemPrompt.includes('Injection'));
    assert.ok(SECURITY_ENGINEER.systemPrompt.includes('Defense in depth'));
  });

  it('has the lowest suggested temperature for deterministic analysis', () => {
    assert.strictEqual(SECURITY_ENGINEER.suggestedTemperature, 0.1);
  });

  it('does not include write tools', () => {
    assert.ok(!SECURITY_ENGINEER.recommendedTools.includes('file.write'));
  });
});

describe('TEST_ENGINEER', () => {
  it('has testing-focused prompt content', () => {
    assert.ok(TEST_ENGINEER.systemPrompt.includes('Arrange-Act-Assert'));
    assert.ok(TEST_ENGINEER.systemPrompt.includes('coverage'));
  });

  it('recommends write and shell tools for creating and running tests', () => {
    assert.ok(TEST_ENGINEER.recommendedTools.includes('file.write'));
    assert.ok(TEST_ENGINEER.recommendedTools.includes('shell.run'));
  });
});

describe('DEVOPS_ENGINEER', () => {
  it('has infrastructure-focused prompt content', () => {
    assert.ok(DEVOPS_ENGINEER.systemPrompt.includes('CI/CD'));
    assert.ok(DEVOPS_ENGINEER.systemPrompt.includes('Docker'));
    assert.ok(DEVOPS_ENGINEER.systemPrompt.includes('Monitoring'));
  });
});

describe('DATA_SCIENTIST', () => {
  it('has data science-focused prompt content', () => {
    assert.ok(DATA_SCIENTIST.systemPrompt.includes('machine learning'));
    assert.ok(DATA_SCIENTIST.systemPrompt.includes('Correlation'));
    assert.ok(DATA_SCIENTIST.systemPrompt.includes('Feature'));
  });
});

describe('TECH_WRITER', () => {
  it('has documentation-focused prompt content', () => {
    assert.ok(TECH_WRITER.systemPrompt.includes('documentation'));
    assert.ok(TECH_WRITER.systemPrompt.includes('API'));
    assert.ok(TECH_WRITER.systemPrompt.includes('example'));
  });

  it('has moderate temperature for creative writing', () => {
    assert.ok(TECH_WRITER.suggestedTemperature >= 0.3);
  });
});

describe('ARCHITECT', () => {
  it('has architecture-focused prompt content', () => {
    assert.ok(ARCHITECT.systemPrompt.includes('tradeoff'));
    assert.ok(ARCHITECT.systemPrompt.includes('Scalability'));
    assert.ok(ARCHITECT.systemPrompt.includes('Modularity'));
  });

  it('is read-only (no write tools)', () => {
    assert.ok(!ARCHITECT.recommendedTools.includes('file.write'));
  });
});

describe('DEBUGGER', () => {
  it('has debugging-focused prompt content', () => {
    assert.ok(DEBUGGER.systemPrompt.includes('scientific method'));
    assert.ok(DEBUGGER.systemPrompt.includes('reproduce'));
    assert.ok(DEBUGGER.systemPrompt.includes('root cause'));
  });

  it('has low temperature for precise analysis', () => {
    assert.strictEqual(DEBUGGER.suggestedTemperature, 0.1);
  });
});

describe('PERFORMANCE_ENGINEER', () => {
  it('has performance-focused prompt content', () => {
    assert.ok(PERFORMANCE_ENGINEER.systemPrompt.includes('bottleneck'));
    assert.ok(PERFORMANCE_ENGINEER.systemPrompt.includes('Profile'));
    assert.ok(PERFORMANCE_ENGINEER.systemPrompt.includes('Optimize'));
  });

  it('recommends shell.run for profiling commands', () => {
    assert.ok(PERFORMANCE_ENGINEER.recommendedTools.includes('shell.run'));
  });
});
