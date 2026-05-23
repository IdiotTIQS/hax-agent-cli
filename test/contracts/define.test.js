"use strict";

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  AgentContract,
  CONTRACT_STATES,
  define,
  validate,
  getInterface,
  getRequirements,
  getGuarantees,
} = require('../../src/contracts/define');

const sampleContract = {
  name: 'code-review',
  version: '1.0.0',
  input: {
    type: 'object',
    properties: {
      files: { type: 'array', items: { type: 'string' } },
      focus: { type: 'string' },
    },
    required: ['files'],
  },
  output: {
    type: 'object',
    properties: {
      findings: { type: 'array' },
      summary: { type: 'string' },
    },
  },
  requirements: {
    tools: ['file.read', 'file.glob', 'file.search'],
    permissions: ['read', 'analyze'],
    models: ['claude-sonnet-4'],
  },
  guarantees: {
    deliverables: ['review report', 'severity classification'],
    qualityLevel: 'thorough',
    slos: { maxResponseTime: '30s' },
  },
  timeout: 45000,
  retry: {
    maxAttempts: 3,
    backoff: 'exponential',
  },
};

describe('AgentContract - define', () => {
  it('should create a contract with all fields', () => {
    const contract = define(sampleContract);

    assert.ok(contract instanceof AgentContract);
    assert.ok(typeof contract.id === 'string');
    assert.ok(contract.id.startsWith('contract-'));
    assert.strictEqual(contract.state, CONTRACT_STATES.DRAFT);
    assert.strictEqual(contract.contract.name, 'code-review');
    assert.strictEqual(contract.contract.version, '1.0.0');
    assert.ok(typeof contract.createdAt === 'string');
    assert.ok(typeof contract.updatedAt === 'string');
  });

  it('should throw if contract is null or not an object', () => {
    assert.throws(() => define(null), {
      message: 'Contract must be a non-null object',
    });
    assert.throws(() => define(undefined), {
      message: 'Contract must be a non-null object',
    });
    assert.throws(() => define('not-an-object'), {
      message: 'Contract must be a non-null object',
    });
  });

  it('should throw if required fields are missing', () => {
    assert.throws(() => define({}), {
      message: /missing required field/,
    });

    assert.throws(() => define({ name: 'test' }), {
      message: /missing required field/,
    });
  });

  it('should fill in default values for optional fields', () => {
    const minimal = define({
      name: 'minimal',
      version: '1.0.0',
      input: { type: 'string' },
      output: { type: 'string' },
    });

    assert.strictEqual(minimal.contract.timeout, 30000);
    assert.strictEqual(minimal.contract.retry.maxAttempts, 3);
    assert.strictEqual(minimal.contract.retry.backoff, 'exponential');
    assert.deepStrictEqual(minimal.contract.requirements.tools, []);
    assert.deepStrictEqual(minimal.contract.requirements.permissions, []);
  });
});

describe('AgentContract - validate', () => {
  it('should report valid when agent meets all requirements', () => {
    const agent = {
      name: 'reviewer',
      agentType: 'code-review',
      tools: ['file.read', 'file.glob', 'file.search'],
      permissions: ['read', 'analyze'],
      models: ['claude-sonnet-4'],
    };

    const result = validate(agent, sampleContract);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.issues.length, 0);
  });

  it('should report invalid when agent is missing tools', () => {
    const agent = {
      name: 'reviewer',
      agentType: 'code-review',
      tools: ['file.read'],
      permissions: ['read', 'analyze'],
      models: ['claude-sonnet-4'],
    };

    const result = validate(agent, sampleContract);
    assert.strictEqual(result.valid, false);
    const toolIssue = result.issues.find((i) => i.type === 'tools');
    assert.ok(toolIssue);
    assert.strictEqual(toolIssue.severity, 'error');
    assert.ok(toolIssue.missing.includes('file.glob'));
    assert.ok(toolIssue.missing.includes('file.search'));
  });

  it('should report invalid when agent is missing permissions', () => {
    const agent = {
      name: 'reviewer',
      agentType: 'code-review',
      tools: ['file.read', 'file.glob', 'file.search'],
      permissions: ['read'],
      models: ['claude-sonnet-4'],
    };

    const result = validate(agent, sampleContract);
    assert.strictEqual(result.valid, false);
    const permIssue = result.issues.find((i) => i.type === 'permissions');
    assert.ok(permIssue);
    assert.ok(permIssue.missing.includes('analyze'));
  });

  it('should report invalid when agent is missing models', () => {
    const agent = {
      name: 'reviewer',
      agentType: 'code-review',
      tools: ['file.read', 'file.glob', 'file.search'],
      permissions: ['read', 'analyze'],
      models: [],
    };

    const result = validate(agent, sampleContract);
    assert.strictEqual(result.valid, false);
    const modelIssue = result.issues.find((i) => i.type === 'models');
    assert.ok(modelIssue);
    assert.ok(modelIssue.missing.includes('claude-sonnet-4'));
  });

  it('should issue a warning when agent role does not match contract name', () => {
    const agent = {
      name: 'generic-agent',
      agentType: 'general-purpose',
      tools: ['file.read', 'file.glob', 'file.search'],
      permissions: ['read', 'analyze'],
      models: ['claude-sonnet-4'],
    };

    const result = validate(agent, sampleContract);
    const roleIssue = result.issues.find((i) => i.type === 'role');
    assert.ok(roleIssue);
    assert.strictEqual(roleIssue.severity, 'warning');
  });
});

describe('AgentContract - getInterface', () => {
  it('should return input and output schemas from the contract', () => {
    const iface = getInterface(sampleContract);
    assert.ok(typeof iface.input === 'object');
    assert.ok(typeof iface.output === 'object');
    assert.strictEqual(iface.input.type, 'object');
    assert.strictEqual(iface.output.type, 'object');
  });

  it('should return empty objects for missing input/output', () => {
    const minimal = {
      name: 'test',
      version: '1.0.0',
      input: {},
      output: {},
      requirements: {},
    };
    const iface = getInterface(minimal);
    assert.deepStrictEqual(iface.input, {});
    assert.deepStrictEqual(iface.output, {});
  });
});

describe('AgentContract - getRequirements', () => {
  it('should return normalized requirements', () => {
    const reqs = getRequirements(sampleContract);
    assert.deepStrictEqual(reqs.tools, ['file.read', 'file.glob', 'file.search']);
    assert.deepStrictEqual(reqs.permissions, ['read', 'analyze']);
    assert.deepStrictEqual(reqs.models, ['claude-sonnet-4']);
    assert.deepStrictEqual(reqs.resources, []);
    assert.deepStrictEqual(reqs.dependencies, []);
  });

  it('should return empty arrays when no requirements specified', () => {
    const minimal = {
      name: 'test',
      version: '1.0.0',
      input: {},
      output: {},
    };
    const reqs = getRequirements(minimal);
    assert.deepStrictEqual(reqs.tools, []);
    assert.deepStrictEqual(reqs.permissions, []);
    assert.deepStrictEqual(reqs.models, []);
  });
});

describe('AgentContract - getGuarantees', () => {
  it('should return normalized guarantees', () => {
    const g = getGuarantees(sampleContract);
    assert.deepStrictEqual(g.deliverables, ['review report', 'severity classification']);
    assert.strictEqual(g.qualityLevel, 'thorough');
    assert.deepStrictEqual(g.slos, { maxResponseTime: '30s' });
    assert.deepStrictEqual(g.constraints, []);
  });

  it('should return defaults when no guarantees specified', () => {
    const minimal = {
      name: 'test',
      version: '1.0.0',
      input: {},
      output: {},
    };
    const g = getGuarantees(minimal);
    assert.deepStrictEqual(g.deliverables, []);
    assert.strictEqual(g.qualityLevel, 'standard');
    assert.deepStrictEqual(g.slos, {});
  });
});
