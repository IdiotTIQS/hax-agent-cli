"use strict";

const { strict: assert } = require('node:assert');
const { describe, it } = require('node:test');

const {
  buildSystemPrompt,
  withRole,
  withContext,
  withConstraints,
  withOutputFormat,
} = require('../../src/prompts/builder');

// Sample data for tests
const SAMPLE_ROLE = Object.freeze({
  name: 'Test Specialist',
  description: 'Expert at writing and running tests.',
  systemPrompt: 'You are a test specialist. Write comprehensive tests.',
});

describe('buildSystemPrompt', () => {
  it('returns the base prompt when no layers are provided', () => {
    const result = buildSystemPrompt('You are a helpful assistant.');
    assert.strictEqual(result, 'You are a helpful assistant.');
  });

  it('joins multiple string layers with default separator', () => {
    const result = buildSystemPrompt(
      'Base prompt.',
      'Layer one.',
      'Layer two.',
    );
    assert.ok(result.includes('Base prompt.'));
    assert.ok(result.includes('Layer one.'));
    assert.ok(result.includes('Layer two.'));
  });

  it('skips null and undefined layers', () => {
    const result = buildSystemPrompt('Base.', null, 'Layer 1.', undefined, false);
    assert.ok(result.includes('Base.'));
    assert.ok(result.includes('Layer 1.'));
    // Should not have null/undefined artifacts
    assert.ok(!result.includes('null'));
    assert.ok(!result.includes('undefined'));
  });

  it('evaluates function layers with no arguments', () => {
    const result = buildSystemPrompt(
      'Base.',
      () => 'Generated layer.',
    );
    assert.ok(result.includes('Base.'));
    assert.ok(result.includes('Generated layer.'));
  });

  it('skips function layers that return falsy values', () => {
    const result = buildSystemPrompt(
      'Base.',
      () => null,
      () => 'Only valid layer.',
    );
    assert.ok(result.includes('Base.'));
    assert.ok(result.includes('Only valid layer.'));
    // Should contain only two parts
    const parts = result.split('\n\n');
    assert.strictEqual(parts.length, 2);
  });

  it('flattens nested arrays', () => {
    const result = buildSystemPrompt('Base.', ['A', ['B', 'C']]);
    assert.ok(result.includes('A'));
    assert.ok(result.includes('B'));
    assert.ok(result.includes('C'));
  });

  it('returns empty string for all-falsy inputs', () => {
    const result = buildSystemPrompt(null, undefined, false);
    assert.strictEqual(result, '');
  });
});

describe('withRole', () => {
  it('returns original prompt when role is null', () => {
    const result = withRole('Base prompt.', null);
    assert.strictEqual(result, 'Base prompt.');
  });

  it('returns original prompt when role has no systemPrompt', () => {
    const result = withRole('Base prompt.', { name: 'Empty' });
    assert.strictEqual(result, 'Base prompt.');
  });

  it('injects role name and system prompt', () => {
    const result = withRole('You are an assistant.', SAMPLE_ROLE);
    assert.ok(result.includes('You are an assistant.'));
    assert.ok(result.includes('Test Specialist'));
    assert.ok(result.includes('You are a test specialist.'));
  });

  it('includes role description when available', () => {
    const result = withRole('Base.', SAMPLE_ROLE);
    assert.ok(result.includes('Expert at writing and running tests.'));
  });

  it('does not duplicate content when role is applied once', () => {
    const result = withRole('Base.', SAMPLE_ROLE);
    const firstIndex = result.indexOf('Test Specialist');
    const lastIndex = result.lastIndexOf('Test Specialist');
    assert.strictEqual(firstIndex, lastIndex);
  });
});

describe('withContext', () => {
  it('returns original prompt when context is empty', () => {
    const result = withContext('Base prompt.', {});
    assert.strictEqual(result, 'Base prompt.');
  });

  it('returns original prompt when context is null', () => {
    const result = withContext('Base prompt.', null);
    assert.strictEqual(result, 'Base prompt.');
  });

  it('includes project root in output', () => {
    const result = withContext('Base.', { projectRoot: '/home/user/project' });
    assert.ok(result.includes('/home/user/project'));
  });

  it('includes git branch when provided', () => {
    const result = withContext('Base.', { gitBranch: 'feature/login' });
    assert.ok(result.includes('feature/login'));
  });

  it('includes git status when provided', () => {
    const result = withContext('Base.', { gitStatus: 'M src/app.js\n?? new-file.js' });
    assert.ok(result.includes('src/app.js'));
    assert.ok(result.includes('new-file.js'));
  });

  it('includes relevant files when provided', () => {
    const result = withContext('Base.', {
      relevantFiles: ['src/auth.js', 'test/auth.test.js'],
    });
    assert.ok(result.includes('src/auth.js'));
    assert.ok(result.includes('test/auth.test.js'));
  });

  it('includes package.json information when provided', () => {
    const result = withContext('Base.', {
      packageJson: {
        name: 'my-app',
        version: '2.0.0',
        dependencies: { express: '^4.18.0' },
        devDependencies: { jest: '^29.0.0' },
      },
    });
    assert.ok(result.includes('my-app'));
    assert.ok(result.includes('2.0.0'));
    assert.ok(result.includes('express'));
    assert.ok(result.includes('jest'));
  });

  it('includes file tree when provided', () => {
    const result = withContext('Base.', { fileTree: 'src/\n  index.js\n  utils.js' });
    assert.ok(result.includes('index.js'));
    assert.ok(result.includes('utils.js'));
  });

  it('does not add context section when only projectRoot is empty', () => {
    const result = withContext('Base.', { projectRoot: '' });
    assert.strictEqual(result, 'Base.');
  });
});

describe('withConstraints', () => {
  it('returns original prompt when constraints is empty', () => {
    const result = withConstraints('Base prompt.', {});
    assert.strictEqual(result, 'Base prompt.');
  });

  it('returns original prompt when constraints is null', () => {
    const result = withConstraints('Base prompt.', null);
    assert.strictEqual(result, 'Base prompt.');
  });

  it('includes max turns constraint', () => {
    const result = withConstraints('Base.', { maxTurns: 10 });
    assert.ok(result.includes('10 conversation turns'));
  });

  it('includes read-only mode constraint', () => {
    const result = withConstraints('Base.', { readOnly: true });
    assert.ok(result.includes('READ-ONLY MODE'));
    assert.ok(result.includes('cannot modify'));
  });

  it('includes allowed tools list', () => {
    const result = withConstraints('Base.', { allowedTools: ['file.read', 'file.glob'] });
    assert.ok(result.includes('file.read'));
    assert.ok(result.includes('file.glob'));
    assert.ok(result.includes('Allowed tools'));
  });

  it('includes disallowed tools list', () => {
    const result = withConstraints('Base.', { disallowedTools: ['shell.run'] });
    assert.ok(result.includes('shell.run'));
    assert.ok(result.includes('Do NOT use'));
  });

  it('includes limited paths', () => {
    const result = withConstraints('Base.', { limitedPaths: ['src/', 'test/'] });
    assert.ok(result.includes('src/'));
    assert.ok(result.includes('test/'));
  });

  it('includes custom constraint text', () => {
    const result = withConstraints('Base.', { custom: 'Do not use external APIs.' });
    assert.ok(result.includes('Do not use external APIs.'));
  });

  it('includes time limit when specified', () => {
    const result = withConstraints('Base.', { timeLimit: '5 minutes' });
    assert.ok(result.includes('5 minutes'));
  });

  it('ignores zero or negative maxTurns', () => {
    const resultZero = withConstraints('Base.', { maxTurns: 0 });
    const resultNeg = withConstraints('Base.', { maxTurns: -1 });
    assert.strictEqual(resultZero, 'Base.');
    assert.strictEqual(resultNeg, 'Base.');
  });
});

describe('withOutputFormat', () => {
  it('returns original prompt when format is null', () => {
    const result = withOutputFormat('Base prompt.', null);
    assert.strictEqual(result, 'Base prompt.');
  });

  it('returns original prompt when format is undefined', () => {
    const result = withOutputFormat('Base prompt.');
    assert.strictEqual(result, 'Base prompt.');
  });

  it('accepts string shorthand for format type', () => {
    const result = withOutputFormat('Base.', 'json');
    assert.ok(result.includes('JSON'));
    assert.ok(result.includes('JSON.parse'));
  });

  it('generates JSON format with schema when provided', () => {
    const result = withOutputFormat('Base.', {
      type: 'json',
      schema: '{ "name": "string", "age": "number" }',
    });
    assert.ok(result.includes('JSON'));
    assert.ok(result.includes('name'));
    assert.ok(result.includes('age'));
  });

  it('generates markdown format instructions', () => {
    const result = withOutputFormat('Base.', { type: 'markdown' });
    assert.ok(result.includes('Markdown'));
    assert.ok(result.includes('headers'));
    assert.ok(result.includes('code fences'));
  });

  it('generates text format instructions', () => {
    const result = withOutputFormat('Base.', { type: 'text' });
    assert.ok(result.includes('plain text'));
    assert.ok(result.includes('Do not use markdown'));
  });

  it('generates code format with language', () => {
    const result = withOutputFormat('Base.', { type: 'code', language: 'javascript' });
    assert.ok(result.includes('javascript'));
    assert.ok(result.includes('complete and ready'));
  });

  it('generates structured format with sections', () => {
    const result = withOutputFormat('Base.', {
      type: 'structured',
      sections: ['Problem', 'Analysis', 'Solution'],
    });
    assert.ok(result.includes('Problem'));
    assert.ok(result.includes('Analysis'));
    assert.ok(result.includes('Solution'));
  });
});
