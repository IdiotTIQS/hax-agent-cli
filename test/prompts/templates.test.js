"use strict";

const { strict: assert } = require('node:assert');
const { describe, it } = require('node:test');

const {
  CODE_REVIEW,
  REFACTOR_PLAN,
  BUG_INVESTIGATION,
  TEST_GENERATION,
  DOCUMENTATION,
  SECURITY_AUDIT,
  ARCHITECTURE_REVIEW,
  PERFORMANCE_ANALYSIS,
  DEPENDENCY_UPDATE,
  API_DESIGN,
} = require('../../src/prompts/templates');

describe('CODE_REVIEW', () => {
  it('returns a non-empty string with default context', () => {
    const result = CODE_REVIEW();
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 100);
  });

  it('includes file names when provided', () => {
    const result = CODE_REVIEW({ files: ['src/app.js', 'src/utils.js'] });
    assert.ok(result.includes('src/app.js'));
    assert.ok(result.includes('src/utils.js'));
  });

  it('includes focus areas when provided', () => {
    const result = CODE_REVIEW({ focus: 'authentication and session management' });
    assert.ok(result.includes('authentication and session management'));
  });

  it('includes language when provided', () => {
    const result = CODE_REVIEW({ language: 'TypeScript' });
    assert.ok(result.includes('TypeScript'));
  });

  it('contains severity classification section', () => {
    const result = CODE_REVIEW();
    assert.ok(result.includes('BLOCKER'));
    assert.ok(result.includes('Severity'));
  });

  it('contains review dimensions for all categories', () => {
    const result = CODE_REVIEW();
    assert.ok(result.includes('Correctness'));
    assert.ok(result.includes('Security'));
    assert.ok(result.includes('Performance'));
    assert.ok(result.includes('Maintainability'));
  });
});

describe('REFACTOR_PLAN', () => {
  it('returns a non-empty string', () => {
    const result = REFACTOR_PLAN();
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 100);
  });

  it('includes the target in the output', () => {
    const result = REFACTOR_PLAN({ target: 'src/auth/login.js' });
    assert.ok(result.includes('src/auth/login.js'));
  });

  it('includes refactoring goals when provided', () => {
    const result = REFACTOR_PLAN({ goals: 'reduce coupling and improve testability' });
    assert.ok(result.includes('reduce coupling and improve testability'));
  });

  it('includes constraints when provided', () => {
    const result = REFACTOR_PLAN({ constraints: 'Must maintain backward compatibility with v1 API' });
    assert.ok(result.includes('Must maintain backward compatibility with v1 API'));
  });

  it('includes risk mitigation guidance', () => {
    const result = REFACTOR_PLAN();
    assert.ok(result.includes('Risk Mitigation') || result.includes('risk'));
  });
});

describe('BUG_INVESTIGATION', () => {
  it('returns a non-empty string', () => {
    const result = BUG_INVESTIGATION();
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 100);
  });

  it('includes symptoms in the output', () => {
    const result = BUG_INVESTIGATION({ symptoms: 'App crashes when clicking Save on empty form' });
    assert.ok(result.includes('App crashes when clicking Save on empty form'));
  });

  it('includes environment details when provided', () => {
    const result = BUG_INVESTIGATION({ environment: 'Node.js 20, Windows 11, Chrome 120' });
    assert.ok(result.includes('Node.js 20'));
    assert.ok(result.includes('Windows 11'));
  });

  it('includes reproduction steps when provided', () => {
    const result = BUG_INVESTIGATION({ reproduction: '1. Open app\n2. Click Save\n3. Observe crash' });
    assert.ok(result.includes('Open app'));
  });

  it('includes all investigation phases', () => {
    const result = BUG_INVESTIGATION();
    assert.ok(result.includes('Information Gathering'));
    assert.ok(result.includes('Hypothesis'));
    assert.ok(result.includes('Root Cause'));
  });
});

describe('TEST_GENERATION', () => {
  it('returns a non-empty string', () => {
    const result = TEST_GENERATION();
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 100);
  });

  it('includes target in generated prompt', () => {
    const result = TEST_GENERATION({ target: 'UserService class' });
    assert.ok(result.includes('UserService class'));
  });

  it('includes test framework when provided', () => {
    const result = TEST_GENERATION({ framework: 'Jest' });
    assert.ok(result.includes('Jest'));
  });

  it('includes all test categories', () => {
    const result = TEST_GENERATION();
    assert.ok(result.includes('Happy Path'));
    assert.ok(result.includes('Edge Case'));
    assert.ok(result.includes('Error Path'));
    assert.ok(result.includes('Integration'));
    assert.ok(result.includes('Regression'));
  });
});

describe('DOCUMENTATION', () => {
  it('returns a non-empty string', () => {
    const result = DOCUMENTATION();
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 100);
  });

  it('includes target in generated prompt', () => {
    const result = DOCUMENTATION({ target: 'the PaymentModule API' });
    assert.ok(result.includes('PaymentModule API'));
  });

  it('includes audience when provided', () => {
    const result = DOCUMENTATION({ audience: 'API consumers' });
    assert.ok(result.includes('API consumers'));
  });

  it('includes format specification', () => {
    const result = DOCUMENTATION({ format: 'JSDoc' });
    assert.ok(result.includes('JSDoc'));
  });

  it('contains documentation structure sections', () => {
    const result = DOCUMENTATION();
    assert.ok(result.includes('Overview'));
    assert.ok(result.includes('Quick Start'));
    assert.ok(result.includes('API Reference'));
  });
});

describe('SECURITY_AUDIT', () => {
  it('returns a non-empty string', () => {
    const result = SECURITY_AUDIT();
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 100);
  });

  it('includes target in the audit prompt', () => {
    const result = SECURITY_AUDIT({ target: 'the payment processing module' });
    assert.ok(result.includes('payment processing module'));
  });

  it('includes threat model when provided', () => {
    const result = SECURITY_AUDIT({ threatModel: 'External attacker with authenticated user access' });
    assert.ok(result.includes('authenticated user access'));
  });

  it('includes all vulnerability categories', () => {
    const result = SECURITY_AUDIT();
    assert.ok(result.includes('Injection'));
    assert.ok(result.includes('Authentication'));
    assert.ok(result.includes('Authorization'));
    assert.ok(result.includes('Cryptography'));
    assert.ok(result.includes('Dependency'));
  });

  it('includes output format with severity classification', () => {
    const result = SECURITY_AUDIT();
    assert.ok(result.includes('Critical'));
    assert.ok(result.includes('Executive Summary'));
  });
});

describe('ARCHITECTURE_REVIEW', () => {
  it('returns a non-empty string', () => {
    const result = ARCHITECTURE_REVIEW();
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 100);
  });

  it('includes target system description', () => {
    const result = ARCHITECTURE_REVIEW({ target: 'the microservices platform' });
    assert.ok(result.includes('microservices platform'));
  });

  it('includes quality attributes when provided', () => {
    const result = ARCHITECTURE_REVIEW({ qualityAttributes: 'scalability, fault tolerance' });
    assert.ok(result.includes('scalability'));
    assert.ok(result.includes('fault tolerance'));
  });

  it('contains all review dimensions', () => {
    const result = ARCHITECTURE_REVIEW();
    assert.ok(result.includes('Modularity'));
    assert.ok(result.includes('Abstraction'));
    assert.ok(result.includes('Data Flow'));
    assert.ok(result.includes('Security Architecture'));
  });
});

describe('PERFORMANCE_ANALYSIS', () => {
  it('returns a non-empty string', () => {
    const result = PERFORMANCE_ANALYSIS();
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 100);
  });

  it('includes target code reference', () => {
    const result = PERFORMANCE_ANALYSIS({ target: 'the image processing pipeline' });
    assert.ok(result.includes('image processing pipeline'));
  });

  it('includes profiling data reference when provided', () => {
    const result = PERFORMANCE_ANALYSIS({ profileData: 'CPU profile from Chrome DevTools' });
    assert.ok(result.includes('Chrome DevTools'));
  });

  it('contains all analysis dimensions', () => {
    const result = PERFORMANCE_ANALYSIS();
    assert.ok(result.includes('Algorithmic'));
    assert.ok(result.includes('Memory'));
    assert.ok(result.includes('I/O'));
    assert.ok(result.includes('Concurrency'));
  });
});

describe('DEPENDENCY_UPDATE', () => {
  it('returns a non-empty string', () => {
    const result = DEPENDENCY_UPDATE();
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 100);
  });

  it('includes package name when provided', () => {
    const result = DEPENDENCY_UPDATE({ packageName: 'express' });
    assert.ok(result.includes('express'));
  });

  it('includes version range when provided', () => {
    const result = DEPENDENCY_UPDATE({ fromVersion: '4.18.0', toVersion: '5.0.0' });
    assert.ok(result.includes('4.18.0'));
    assert.ok(result.includes('5.0.0'));
  });

  it('includes changelog context when provided', () => {
    const result = DEPENDENCY_UPDATE({ changelog: 'Major: removed deprecated APIs, new middleware signature' });
    assert.ok(result.includes('removed deprecated APIs'));
  });

  it('contains migration and risk sections', () => {
    const result = DEPENDENCY_UPDATE();
    assert.ok(result.includes('Migration'));
    assert.ok(result.includes('Risk'));
  });
});

describe('API_DESIGN', () => {
  it('returns a non-empty string', () => {
    const result = API_DESIGN();
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 100);
  });

  it('defaults to REST style', () => {
    const result = API_DESIGN();
    assert.ok(result.includes('REST'));
  });

  it('includes domain when provided', () => {
    const result = API_DESIGN({ domain: 'e-commerce order management' });
    assert.ok(result.includes('e-commerce order management'));
  });

  it('supports GraphQL style', () => {
    const result = API_DESIGN({ style: 'GraphQL' });
    assert.ok(result.includes('GRAPHQL'));
    assert.ok(result.includes('GraphQL-Specific Design'));
    assert.ok(result.includes('DataLoader'));
  });

  it('includes design deliverables sections', () => {
    const result = API_DESIGN();
    assert.ok(result.includes('Resource Model'));
    assert.ok(result.includes('Endpoint Design'));
    assert.ok(result.includes('Error Handling'));
    assert.ok(result.includes('Pagination'));
    assert.ok(result.includes('Security'));
  });

  it('includes auth details when provided', () => {
    const result = API_DESIGN({ auth: 'OAuth 2.0 with PKCE' });
    assert.ok(result.includes('OAuth 2.0'));
    assert.ok(result.includes('PKCE'));
  });
});
