"use strict";

const { strict: assert } = require('node:assert');
const { describe, it } = require('node:test');

const {
  URGENT,
  DEEP_DIVE,
  PAIR_PROGRAMMING,
  CODE_REVIEW_MODE,
  ONBOARDING,
  DEBUGGING,
  ALL_MODIFIERS,
  applyModifier,
  stackModifiers,
  clearModifiers,
  activeModifiers,
  isValidModifier,
  getModifierByName,
} = require('../../src/personality/behavior-modifiers');

// ---------------------------------------------------------------------------
// Modifier shape validation
// ---------------------------------------------------------------------------

describe('Modifier shape validation', () => {
  for (const modifier of ALL_MODIFIERS) {
    it(`${modifier.name} has all required properties`, () => {
      assert.ok(typeof modifier.name === 'string' && modifier.name.length > 0, 'name must be non-empty string');
      assert.ok(typeof modifier.description === 'string' && modifier.description.length > 0, 'description must be non-empty');
      assert.ok(Array.isArray(modifier.instructions), 'instructions must be an array');
      assert.ok(modifier.instructions.length > 0, 'instructions must not be empty');
      assert.ok(typeof modifier.marker === 'string' && modifier.marker.length > 0, 'marker must be non-empty');
    });
  }

  it('all modifiers are frozen', () => {
    for (const modifier of ALL_MODIFIERS) {
      assert.ok(Object.isFrozen(modifier), `${modifier.name} should be frozen`);
    }
  });

  it('ALL_MODIFIERS contains exactly 6 modifiers', () => {
    assert.strictEqual(ALL_MODIFIERS.length, 6);
  });

  it('all modifier names are unique', () => {
    const names = ALL_MODIFIERS.map((m) => m.name);
    const unique = new Set(names);
    assert.strictEqual(unique.size, ALL_MODIFIERS.length, 'Modifier names must be unique');
  });
});

// ---------------------------------------------------------------------------
// isValidModifier
// ---------------------------------------------------------------------------

describe('isValidModifier', () => {
  it('returns true for all pre-built modifiers', () => {
    for (const modifier of ALL_MODIFIERS) {
      assert.ok(isValidModifier(modifier), `${modifier.name} should be valid`);
    }
  });

  it('returns false for null/undefined', () => {
    assert.strictEqual(isValidModifier(null), false);
    assert.strictEqual(isValidModifier(undefined), false);
  });

  it('returns false for incomplete objects', () => {
    assert.strictEqual(isValidModifier({ name: 'Test' }), false);
    assert.strictEqual(isValidModifier({ name: 'Test', description: 'Desc' }), false);
  });

  it('returns false when instructions is not an array', () => {
    assert.strictEqual(isValidModifier({
      name: 'Bad',
      description: 'Desc',
      instructions: 'not-an-array',
      marker: '[X]',
    }), false);
  });
});

// ---------------------------------------------------------------------------
// getModifierByName
// ---------------------------------------------------------------------------

describe('getModifierByName', () => {
  it('returns the correct modifier for exact name match', () => {
    assert.strictEqual(getModifierByName('Urgent'), URGENT);
    assert.strictEqual(getModifierByName('Debugging'), DEBUGGING);
  });

  it('performs case-insensitive matching', () => {
    assert.strictEqual(getModifierByName('URGENT'), URGENT);
    assert.strictEqual(getModifierByName('urgent'), URGENT);
    assert.strictEqual(getModifierByName('DeBuGgInG'), DEBUGGING);
  });

  it('returns null for unknown names', () => {
    assert.strictEqual(getModifierByName('Unknown'), null);
    assert.strictEqual(getModifierByName(''), null);
    assert.strictEqual(getModifierByName(null), null);
  });
});

// ---------------------------------------------------------------------------
// applyModifier
// ---------------------------------------------------------------------------

describe('applyModifier', () => {
  it('injects modifier instructions into a base prompt', () => {
    const base = 'You are a helpful assistant.';
    const result = applyModifier(base, URGENT);
    assert.ok(result.startsWith(base));
    assert.ok(result.includes(URGENT.name + ' Mode'));
    assert.ok(result.includes(URGENT.instructions[0]));
  });

  it('accepts a modifier name string instead of a modifier object', () => {
    const base = 'You are a helpful assistant.';
    const result = applyModifier(base, 'Deep Dive');
    assert.ok(result.includes(DEEP_DIVE.name + ' Mode'));
  });

  it('returns base prompt unchanged when modifier is invalid', () => {
    const base = 'You are a helpful assistant.';
    assert.strictEqual(applyModifier(base, null), base);
    assert.strictEqual(applyModifier(base, {}), base);
    assert.strictEqual(applyModifier(base, 'UnknownModifier'), base);
  });

  it('returns empty string for empty base prompt', () => {
    assert.strictEqual(applyModifier('', DEBUGGING), '');
  });

  it('wraps modifier instructions with start and end markers', () => {
    const result = applyModifier('Base.', URGENT);
    assert.ok(result.includes('---[modifier:'));
    assert.ok(result.includes(']---'));
    assert.ok(result.includes('---[modifier:END]---'));
  });

  it('includes all modifier instructions in the output', () => {
    const result = applyModifier('Base.', CODE_REVIEW_MODE);
    for (const instruction of CODE_REVIEW_MODE.instructions) {
      assert.ok(result.includes(instruction), `Output should include: "${instruction}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// stackModifiers
// ---------------------------------------------------------------------------

describe('stackModifiers', () => {
  it('returns an array of instruction blocks', () => {
    const blocks = stackModifiers([URGENT, DEBUGGING]);
    assert.ok(Array.isArray(blocks));
    assert.strictEqual(blocks.length, 2);
  });

  it('each block has start and end markers', () => {
    const blocks = stackModifiers([URGENT]);
    assert.strictEqual(blocks.length, 1);
    assert.ok(blocks[0].includes('---[modifier:'));
    assert.ok(blocks[0].includes('---[modifier:END]---'));
  });

  it('returns empty array for empty input', () => {
    assert.deepStrictEqual(stackModifiers([]), []);
  });

  it('returns empty array for non-array input', () => {
    assert.deepStrictEqual(stackModifiers(null), []);
    assert.deepStrictEqual(stackModifiers('not-array'), []);
  });

  it('filters out invalid modifiers', () => {
    const blocks = stackModifiers([URGENT, null, DEBUGGING, {}, 'PAIR_PROGRAMMING']);
    assert.strictEqual(blocks.length, 2);
    assert.ok(blocks[0].includes('Urgent'));
    assert.ok(blocks[1].includes('Debugging'));
  });

  it('all blocks can be joined and applied to a prompt', () => {
    const blocks = stackModifiers([URGENT, CODE_REVIEW_MODE]);
    const combined = ['Base prompt.', ...blocks].join('\n\n');
    assert.ok(combined.includes('Base prompt.'));
    assert.ok(combined.includes('Urgent Mode'));
    assert.ok(combined.includes('Code Review Mode Mode'));
  });
});

// ---------------------------------------------------------------------------
// clearModifiers
// ---------------------------------------------------------------------------

describe('clearModifiers', () => {
  it('removes all modifier blocks from a prompt', () => {
    const base = 'You are a helpful assistant.';
    const withModifier = applyModifier(base, URGENT);
    const cleaned = clearModifiers(withModifier);
    assert.strictEqual(cleaned, base);
  });

  it('removes multiple stacked modifiers', () => {
    const base = 'You are a helpful assistant.';
    let prompt = applyModifier(base, URGENT);
    prompt = applyModifier(prompt, DEBUGGING);
    const cleaned = clearModifiers(prompt);
    assert.strictEqual(cleaned, base);
  });

  it('returns empty string for empty input', () => {
    assert.strictEqual(clearModifiers(''), '');
    assert.strictEqual(clearModifiers(null), '');
  });

  it('leaves non-modifier content intact', () => {
    const prompt = [
      'You are a helpful assistant.',
      '',
      '# Role: Developer',
      '',
      'You write great code.',
    ].join('\n');

    const cleaned = clearModifiers(prompt);
    assert.ok(cleaned.includes('You are a helpful assistant.'));
    assert.ok(cleaned.includes('# Role: Developer'));
    assert.ok(cleaned.includes('You write great code.'));
  });

  it('cleans up excessive whitespace after removal', () => {
    const base = 'Line 1\n\nLine 2';
    // Apply and then clear a modifier
    let prompt = applyModifier(base, URGENT);
    prompt = clearModifiers(prompt);

    // Should not have triple+ newlines
    assert.ok(!prompt.includes('\n\n\n'), 'Should not have excessive whitespace');
  });
});

// ---------------------------------------------------------------------------
// activeModifiers
// ---------------------------------------------------------------------------

describe('activeModifiers', () => {
  it('returns an empty array for a prompt with no modifiers', () => {
    const result = activeModifiers('Just a plain prompt.');
    assert.deepStrictEqual(result, []);
  });

  it('returns empty array for empty/null input', () => {
    assert.deepStrictEqual(activeModifiers(''), []);
    assert.deepStrictEqual(activeModifiers(null), []);
  });

  it('lists a single active modifier', () => {
    const prompt = applyModifier('Base.', URGENT);
    const active = activeModifiers(prompt);
    assert.deepStrictEqual(active, ['Urgent']);
  });

  it('lists multiple active modifiers', () => {
    let prompt = applyModifier('Base.', URGENT);
    prompt = applyModifier(prompt, DEBUGGING);
    const active = activeModifiers(prompt);
    assert.ok(active.includes('Urgent'));
    assert.ok(active.includes('Debugging'));
    assert.strictEqual(active.length, 2);
  });

  it('returns empty array after clearModifiers', () => {
    let prompt = applyModifier('Base.', URGENT);
    prompt = applyModifier(prompt, DEBUGGING);
    prompt = clearModifiers(prompt);
    const active = activeModifiers(prompt);
    assert.deepStrictEqual(active, []);
  });
});

// ---------------------------------------------------------------------------
// Modifier content validation
// ---------------------------------------------------------------------------

describe('URGENT modifier', () => {
  it('emphasizes speed over completeness', () => {
    const combined = URGENT.instructions.join(' ');
    assert.ok(combined.toLowerCase().includes('time'));
    assert.ok(combined.toLowerCase().includes('speed') || combined.toLowerCase().includes('fast'));
  });

  it('mention skipping explanations', () => {
    const combined = URGENT.instructions.join(' ');
    assert.ok(combined.toLowerCase().includes('skip') || combined.toLowerCase().includes('omit'));
  });
});

describe('DEBUGGING modifier', () => {
  it('emphasizes systematic investigation', () => {
    const combined = DEBUGGING.instructions.join(' ');
    assert.ok(combined.toLowerCase().includes('reproduce') || combined.toLowerCase().includes('hypothesis'));
  });

  it('mentions changing one thing at a time', () => {
    const combined = DEBUGGING.instructions.join(' ');
    assert.ok(combined.toLowerCase().includes('one thing'));
  });
});

describe('ONBOARDING modifier', () => {
  it('mentions teaching and learning', () => {
    const combined = ONBOARDING.instructions.join(' ');
    assert.ok(combined.toLowerCase().includes('teach') || combined.toLowerCase().includes('learn'));
  });

  it('assumes reader is unfamiliar with the codebase', () => {
    const combined = ONBOARDING.instructions.join(' ');
    assert.ok(combined.toLowerCase().includes('unfamiliar') || combined.toLowerCase().includes('learning'));
  });
});
