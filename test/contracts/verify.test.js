"use strict";

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  ContractVerifier,
  COMPLIANCE_THRESHOLDS,
  VIOLATION_TYPE,
} = require('../../src/contracts/verify');

const reviewerAgent = {
  name: 'reviewer',
  agentType: 'code-review',
  role: 'Code reviewer',
  tools: ['file.read', 'file.glob', 'file.search', 'shell.run'],
  permissions: ['read', 'analyze', 'comment'],
  models: ['claude-sonnet-4', 'claude-opus-4'],
  timeout: 30000,
};

const reviewContract = {
  name: 'code-review',
  version: '1.0.0',
  input: { type: 'object', properties: { files: { type: 'array' } } },
  output: { type: 'object', properties: { findings: { type: 'array' } } },
  requirements: {
    tools: ['file.read', 'file.glob', 'file.search'],
    permissions: ['read', 'analyze'],
    models: ['claude-sonnet-4'],
  },
  guarantees: {
    deliverables: ['review report'],
    qualityLevel: 'thorough',
  },
  timeout: 45000,
  retry: { maxAttempts: 3, backoff: 'exponential' },
};

describe('ContractVerifier - checkTools', () => {
  it('should pass when all required tools are available', () => {
    const verifier = new ContractVerifier();
    const result = verifier.checkTools(
      ['file.read', 'file.glob'],
      ['file.read', 'file.glob', 'file.search']
    );

    assert.strictEqual(result.pass, true);
    assert.deepStrictEqual(result.missing, []);
    assert.strictEqual(result.coverage, 100);
  });

  it('should report missing tools', () => {
    const verifier = new ContractVerifier();
    const result = verifier.checkTools(
      ['file.read', 'file.glob', 'file.search'],
      ['file.read']
    );

    assert.strictEqual(result.pass, false);
    assert.ok(result.missing.includes('file.glob'));
    assert.ok(result.missing.includes('file.search'));
    assert.ok(result.coverage < 100);
  });

  it('should return 100% coverage when no tools required', () => {
    const verifier = new ContractVerifier();
    const result = verifier.checkTools([], ['file.read']);

    assert.strictEqual(result.pass, true);
    assert.strictEqual(result.coverage, 100);
  });

  it('should throw when arguments are not arrays', () => {
    const verifier = new ContractVerifier();
    assert.throws(() => verifier.checkTools('not-array', []), {
      message: /required tools must be an array/,
    });
    assert.throws(() => verifier.checkTools([], 'not-array'), {
      message: /available tools must be an array/,
    });
  });
});

describe('ContractVerifier - checkPermissions', () => {
  it('should pass when all required permissions are granted', () => {
    const verifier = new ContractVerifier();
    const result = verifier.checkPermissions(
      ['read', 'analyze'],
      ['read', 'analyze', 'comment']
    );

    assert.strictEqual(result.pass, true);
    assert.deepStrictEqual(result.missing, []);
  });

  it('should report missing permissions', () => {
    const verifier = new ContractVerifier();
    const result = verifier.checkPermissions(
      ['read', 'analyze', 'comment'],
      ['read']
    );

    assert.strictEqual(result.pass, false);
    assert.ok(result.missing.includes('analyze'));
    assert.ok(result.missing.includes('comment'));
  });
});

describe('ContractVerifier - checkModel', () => {
  it('should pass when required model is available', () => {
    const verifier = new ContractVerifier();
    const result = verifier.checkModel(
      ['claude-sonnet-4'],
      ['claude-sonnet-4', 'gpt-4']
    );

    assert.strictEqual(result.pass, true);
    assert.strictEqual(result.matches.length, 1);
  });

  it('should match wildcard model patterns', () => {
    const verifier = new ContractVerifier();
    const result = verifier.checkModel(
      ['claude*'],
      ['claude-sonnet-4', 'gpt-4']
    );

    assert.strictEqual(result.pass, true);
    assert.ok(result.matches.some((m) => m.required === 'claude*'));
  });

  it('should report missing models', () => {
    const verifier = new ContractVerifier();
    const result = verifier.checkModel(
      ['claude-sonnet-4', 'gpt-4'],
      ['gemini-pro']
    );

    assert.strictEqual(result.pass, false);
    assert.strictEqual(result.missing.length, 2);
  });
});

describe('ContractVerifier - verifyCompliance', () => {
  it('should return compliant for a fully matching agent', () => {
    const verifier = new ContractVerifier();
    const report = verifier.verifyCompliance(reviewerAgent, reviewContract);

    assert.strictEqual(report.compliant, true);
    assert.strictEqual(report.violations.length, 0);
    assert.strictEqual(report.score, 100);
  });

  it('should detect missing tool violations', () => {
    const verifier = new ContractVerifier();
    const agent = {
      ...reviewerAgent,
      tools: ['file.read'],
    };

    const report = verifier.verifyCompliance(agent, reviewContract);
    assert.strictEqual(report.compliant, false);
    assert.ok(report.violations.some((v) => v.type === VIOLATION_TYPE.MISSING_TOOL));
    assert.ok(report.score < 100);
  });

  it('should detect missing model violations', () => {
    const verifier = new ContractVerifier();
    const agent = {
      ...reviewerAgent,
      models: ['gemini-pro'],
    };

    const report = verifier.verifyCompliance(agent, reviewContract);
    assert.strictEqual(report.compliant, false);
    assert.ok(report.violations.some((v) => v.type === VIOLATION_TYPE.MISSING_MODEL));
  });

  it('should warn on role mismatch in strict mode', () => {
    const verifier = new ContractVerifier({ strictMode: true });
    const agent = {
      ...reviewerAgent,
      agentType: 'general-purpose',
      role: 'General assistant',
    };

    const report = verifier.verifyCompliance(agent, reviewContract);
    assert.ok(report.warnings.some((w) => w.type === VIOLATION_TYPE.ROLE_MISMATCH));
  });
});

describe('ContractVerifier - generateComplianceReport', () => {
  it('should generate a detailed report with recommendations', () => {
    const verifier = new ContractVerifier({ verbose: true });
    const report = verifier.generateComplianceReport(reviewerAgent, reviewContract);

    assert.ok(report.summary);
    assert.strictEqual(report.summary.compliant, true);
    assert.strictEqual(typeof report.summary.score, 'number');
    assert.ok(Array.isArray(report.recommendations));
    assert.ok(report.details);
    assert.ok(report.details.checks);
    assert.ok(report.metadata);
    assert.ok(report.metadata.agent);
    assert.ok(report.metadata.contract);
  });

  it('should recommend adding missing tools', () => {
    const verifier = new ContractVerifier();
    const agent = {
      ...reviewerAgent,
      tools: ['file.read'],
    };

    const report = verifier.generateComplianceReport(agent, reviewContract);
    assert.strictEqual(report.summary.compliant, false);
    assert.ok(report.recommendations.some((r) => r.includes('missing tools')));
  });
});
