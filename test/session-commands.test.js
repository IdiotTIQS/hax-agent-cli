"use strict";

const { describe, it } = require('node:test');
const assert = require('node:assert');

// --------------- session.js ---------------

const { InputHistory, CostTracker, Session } = require('../src/session');

describe('InputHistory', () => {
  it('adds entries and deduplicates consecutive duplicates', () => {
    const history = new InputHistory(10);
    history.add('hello');
    history.add('hello');
    assert.strictEqual(history.entries.length, 1);
    assert.strictEqual(history.entries[0], 'hello');
  });

  it('trims whitespace and ignores empty entries', () => {
    const history = new InputHistory(10);
    history.add('  ');
    history.add('');
    assert.strictEqual(history.entries.length, 0);
  });

  it('respects maxSize', () => {
    const history = new InputHistory(3);
    history.add('a');
    history.add('b');
    history.add('c');
    history.add('d');
    assert.strictEqual(history.entries.length, 3);
    assert.strictEqual(history.entries[0], 'd');
    assert.strictEqual(history.entries[2], 'b');
  });

  it('navigates up and down through history', () => {
    const history = new InputHistory(10);
    history.add('c');
    history.add('b');
    history.add('a');

    const result1 = history.up(''); // a
    assert.strictEqual(result1, 'a');
    const result2 = history.up(''); // b
    assert.strictEqual(result2, 'b');
    const result3 = history.up(''); // c
    assert.strictEqual(result3, 'c');
    // At end, stays on oldest
    const result4 = history.up('');
    assert.strictEqual(result4, 'c');
    // Down back
    const result5 = history.down('');
    assert.strictEqual(result5, 'b');
    const result6 = history.down('');
    assert.strictEqual(result6, 'a');
    const result7 = history.down(''); // back to partial
    assert.strictEqual(result7, '');
  });

  it('preserves partial input when navigating', () => {
    const history = new InputHistory(10);
    history.add('hello world');
    history.add('hello there');

    const upResult = history.up('hel');
    assert.strictEqual(upResult, 'hello there');
    // One down returns to the saved partial
    const downResult = history.down('');
    assert.strictEqual(downResult, 'hel');
  });

  it('search returns matching entries', () => {
    const history = new InputHistory(20);
    history.add('npm test');
    history.add('node src/cli.js');
    history.add('git push');
    history.add('/help');

    const results = history.search('npm');
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0], 'npm test');
  });

  it('search is case-insensitive', () => {
    const history = new InputHistory(20);
    history.add('Hello World');
    const results = history.search('hello');
    assert.strictEqual(results.length, 1);
  });

  it('search returns empty array for empty query', () => {
    const history = new InputHistory(20);
    history.add('test');
    assert.deepStrictEqual(history.search(''), []);
  });

  it('rsearch finds first match for interactive search', () => {
    const history = new InputHistory(20);
    history.add('npm test');
    history.add('node src/index.js');
    history.add('git push');

    const result = history.rsearch('npm');
    assert.ok(result);
    assert.strictEqual(result.match, 'npm test');
    assert.strictEqual(result.query, 'npm');
  });

  it('rsearch returns null for no match', () => {
    const history = new InputHistory(20);
    history.add('npm test');
    assert.strictEqual(history.rsearch('xyz'), null);
  });

  it('reset clears navigation state', () => {
    const history = new InputHistory(10);
    history.add('test');
    history.up('');
    history.reset();
    assert.strictEqual(history.index, -1);
    assert.strictEqual(history.partial, '');
  });
});

describe('CostTracker', () => {
  it('tracks token usage from Anthropic-style usage format', () => {
    const tracker = new CostTracker();
    tracker.addUsage({
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 200,
      cache_read_input_tokens: 300,
    }, 'claude-sonnet-4-20250514');
    assert.strictEqual(tracker.inputTokens, 100);
    assert.strictEqual(tracker.outputTokens, 50);
    assert.strictEqual(tracker.cacheCreationTokens, 200);
    assert.strictEqual(tracker.cacheReadTokens, 300);
    assert.strictEqual(tracker.turnCount, 1);
  });

  it('handles camelCase input tokens format', () => {
    const tracker = new CostTracker();
    tracker.addUsage({ inputTokens: 200, outputTokens: 100 }, 'gpt-4o');
    assert.strictEqual(tracker.inputTokens, 200);
    assert.strictEqual(tracker.outputTokens, 100);
  });

  it('handles OpenAI prompt_tokens/completion_tokens format', () => {
    const tracker = new CostTracker();
    tracker.addUsage({ prompt_tokens: 300, completion_tokens: 150 }, 'gpt-4o');
    assert.strictEqual(tracker.inputTokens, 300);
    assert.strictEqual(tracker.outputTokens, 150);
  });

  it('getCost returns 0 for unknown model', () => {
    const tracker = new CostTracker();
    tracker.addUsage({ input_tokens: 1000, output_tokens: 500 }, 'claude-sonnet-4-20250514');
    const cost = tracker.getCost('unknown-model-xyz');
    assert.strictEqual(cost, 0);
  });

  it('getCost calculates correct cost for exact model match', () => {
    const tracker = new CostTracker();
    tracker.addUsage({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, 'claude-sonnet-4-20250514');
    const cost = tracker.getCost('claude-sonnet-4-20250514');
    assert.strictEqual(cost, 18); // $3 input + $15 output
  });

  it('getPricing falls back by model family pattern', () => {
    const tracker = new CostTracker();
    
    const sonnetPrice = tracker.getPricing('claude-sonnet-4-7-any-variant');
    assert.ok(sonnetPrice);
    assert.strictEqual(sonnetPrice.input, 3.0);

    const opusPrice = tracker.getPricing('claude-opus-4-9-custom');
    assert.ok(opusPrice);
    assert.strictEqual(opusPrice.input, 15.0);

    const haikuPrice = tracker.getPricing('claude-haiku-4-latest');
    assert.ok(haikuPrice);
    assert.strictEqual(haikuPrice.input, 0.8);

    const gpt4oPrice = tracker.getPricing('gpt-4o-special-version');
    assert.ok(gpt4oPrice);
    assert.strictEqual(gpt4oPrice.output, 10.0);
  });

  it('formatSummary returns readable statistics', () => {
    const tracker = new CostTracker();
    tracker.addUsage({ input_tokens: 5000, output_tokens: 1000 }, 'gpt-4o');
    const summary = tracker.formatSummary('gpt-4o');
    assert.ok(summary.includes('Session Statistics'));
    assert.ok(summary.includes('Input tokens'));
    assert.ok(summary.includes('Output tokens'));
    assert.ok(summary.includes('Estimated cost'));
    assert.ok(summary.includes('Turns'));
  });

  it('trackToolCall increments toolCallCount', () => {
    const tracker = new CostTracker();
    tracker.addToolCall();
    tracker.addToolCall();
    assert.strictEqual(tracker.toolCallCount, 2);
  });
});

describe('Session', () => {
  it('creates session with defaults', () => {
    const session = new Session({ provider: { name: 'mock', model: 'mock-local' } });
    assert.ok(session.id);
    assert.strictEqual(session.messages.length, 0);
    assert.strictEqual(session.shouldExit, false);
    assert.ok(session.costTracker instanceof CostTracker);
  });

  it('getElapsedTime returns time string', () => {
    const session = new Session({ provider: { name: 'mock' } });
    const elapsed = session.getElapsedTime();
    assert.ok(typeof elapsed === 'string');
    assert.ok(elapsed.endsWith('s'));
  });

  it('getStatusLine returns non-empty string', () => {
    const session = new Session({
      provider: { name: 'mock', model: 'mock-local' },
      settings: {},
    });
    const statusLine = session.getStatusLine();
    assert.ok(typeof statusLine === 'string');
    assert.ok(statusLine.length > 0);
    assert.ok(statusLine.includes('mock'));
  });

  it('tracks modified files', () => {
    const session = new Session({ provider: { name: 'mock' } });
    session.modifiedFiles.add('src/cli.js');
    session.modifiedFiles.add('src/config.js');
    assert.strictEqual(session.modifiedFiles.size, 2);
    assert.ok(session.modifiedFiles.has('src/cli.js'));
  });
});

// --------------- command-suggestions.js ---------------

const { editDistance, suggestCommand } = require('../src/command-suggestions');

describe('editDistance', () => {
  it('returns 0 for identical strings', () => {
    assert.strictEqual(editDistance('hello', 'hello'), 0);
  });

  it('returns 1 for single character substitution', () => {
    assert.strictEqual(editDistance('hello', 'hallo'), 1);
  });

  it('handles transpositions (Damerau-Levenshtein)', () => {
    // "ab" -> "ba" is 1 with transposition
    assert.strictEqual(editDistance('ab', 'ba'), 1);
  });

  it('handles empty strings', () => {
    assert.strictEqual(editDistance('', ''), 0);
    assert.strictEqual(editDistance('', 'abc'), 3);
    assert.strictEqual(editDistance('abc', ''), 3);
  });

  it('is case-insensitive', () => {
    assert.strictEqual(editDistance('Hello', 'HELLO'), 0);
  });

  it('handles missing characters (deletion)', () => {
    assert.strictEqual(editDistance('hello', 'helo'), 1);
  });

  it('handles extra characters (insertion)', () => {
    assert.strictEqual(editDistance('helo', 'hello'), 1);
  });
});

describe('suggestCommand', () => {
  const candidates = ['help', 'exit', 'clear', 'tools', 'config', 'models'];

  it('returns null for empty input', () => {
    assert.strictEqual(suggestCommand('', candidates), null);
  });

  it('returns exact match for perfect input', () => {
    assert.strictEqual(suggestCommand('help', candidates), 'help');
  });

  it('suggests close match for typo', () => {
    const result = suggestCommand('hlep', candidates);
    assert.strictEqual(result, 'help');
  });

  it('returns null for completely different command', () => {
    const result = suggestCommand('xyzabc', candidates);
    assert.strictEqual(result, null);
  });

  it('strips leading slash', () => {
    assert.strictEqual(suggestCommand('/help', candidates), 'help');
    assert.strictEqual(suggestCommand('/hlep', candidates), 'help');
  });

  it('works with object candidates', () => {
    const objectCandidates = [
      { match: 'hello', suggest: 'hello' },
      { match: 'hallo', suggest: 'hello' },
    ];
    assert.strictEqual(suggestCommand('helo', objectCandidates), 'hello');
  });

  it('works with mixed string and object candidates', () => {
    const mixed = [
      'help',
      { match: 'doctor', suggest: 'doctor' },
      'exit',
    ];
    assert.strictEqual(suggestCommand('doctro', mixed), 'doctor');
  });

  it('prefers shorter suggestion when distances are equal', () => {
    const candidates = ['model', 'models'];
    const result = suggestCommand('model', candidates);
    assert.strictEqual(result, 'model');
  });

  it('works with hep -> help (edit distance 1)', () => {
    assert.strictEqual(suggestCommand('hep', ['help', 'exit', 'clear']), 'help');
  });
});
