"use strict";

const { strict: assert } = require('node:assert');
const { describe, it } = require('node:test');

const {
  CONCISE,
  EXPLANATORY,
  TUTORIAL,
  ANALYTICAL,
  CONVERSATIONAL,
  TECHNICAL,
  ALL_STYLES,
  applyStyle,
  detectStyle,
  styleDiff,
  isValidStyle,
  getStyleByName,
} = require('../../src/personality/response-styles');

// ---------------------------------------------------------------------------
// Style shape validation
// ---------------------------------------------------------------------------

describe('ResponseStyle shape validation', () => {
  for (const style of ALL_STYLES) {
    it(`${style.name} has all required properties`, () => {
      assert.ok(typeof style.name === 'string' && style.name.length > 0, 'name must be non-empty string');
      assert.ok(typeof style.description === 'string' && style.description.length > 0, 'description must be non-empty');
      assert.ok(typeof style.tone === 'string' && style.tone.length > 0, 'tone must be non-empty');
      assert.ok(typeof style.sentenceStructure === 'string' && style.sentenceStructure.length > 0, 'sentenceStructure must be non-empty');
      assert.ok(Array.isArray(style.formattingPreferences), 'formattingPreferences must be an array');
      assert.ok(style.formattingPreferences.length > 0, 'formattingPreferences must not be empty');
      assert.ok(typeof style.exampleSignature === 'string' && style.exampleSignature.length > 0, 'exampleSignature must be non-empty');
    });
  }

  it('all styles are frozen', () => {
    for (const style of ALL_STYLES) {
      assert.ok(Object.isFrozen(style), `${style.name} should be frozen`);
    }
  });

  it('ALL_STYLES contains exactly 6 styles', () => {
    assert.strictEqual(ALL_STYLES.length, 6);
  });

  it('all style names are unique', () => {
    const names = ALL_STYLES.map((s) => s.name);
    const unique = new Set(names);
    assert.strictEqual(unique.size, ALL_STYLES.length, 'Style names must be unique');
  });
});

// ---------------------------------------------------------------------------
// isValidStyle
// ---------------------------------------------------------------------------

describe('isValidStyle', () => {
  it('returns true for all pre-built styles', () => {
    for (const style of ALL_STYLES) {
      assert.ok(isValidStyle(style), `${style.name} should be valid`);
    }
  });

  it('returns false for null/undefined', () => {
    assert.strictEqual(isValidStyle(null), false);
    assert.strictEqual(isValidStyle(undefined), false);
  });

  it('returns false for incomplete objects', () => {
    assert.strictEqual(isValidStyle({ name: 'Test' }), false);
    assert.strictEqual(isValidStyle({ name: 'Test', description: 'Desc' }), false);
  });

  it('returns false when formattingPreferences is not an array', () => {
    assert.strictEqual(isValidStyle({
      name: 'Bad',
      description: 'Desc',
      tone: 'Tone',
      sentenceStructure: 'SS',
      formattingPreferences: 'not-an-array',
    }), false);
  });
});

// ---------------------------------------------------------------------------
// getStyleByName
// ---------------------------------------------------------------------------

describe('getStyleByName', () => {
  it('returns the correct style for exact name match', () => {
    assert.strictEqual(getStyleByName('Concise'), CONCISE);
    assert.strictEqual(getStyleByName('Explanatory'), EXPLANATORY);
  });

  it('performs case-insensitive matching', () => {
    assert.strictEqual(getStyleByName('CONCISE'), CONCISE);
    assert.strictEqual(getStyleByName('concise'), CONCISE);
    assert.strictEqual(getStyleByName('CoNcIsE'), CONCISE);
  });

  it('returns null for unknown names', () => {
    assert.strictEqual(getStyleByName('Unknown'), null);
    assert.strictEqual(getStyleByName(''), null);
    assert.strictEqual(getStyleByName(null), null);
  });
});

// ---------------------------------------------------------------------------
// applyStyle
// ---------------------------------------------------------------------------

describe('applyStyle', () => {
  it('injects style instructions into a base prompt', () => {
    const base = 'You are a helpful assistant.';
    const result = applyStyle(base, CONCISE);
    assert.ok(result.startsWith(base));
    assert.ok(result.includes('Response Style'));
    assert.ok(result.includes(CONCISE.name));
    assert.ok(result.includes(CONCISE.tone));
    assert.ok(result.includes(CONCISE.sentenceStructure));
  });

  it('accepts a style name string instead of a style object', () => {
    const base = 'You are a helpful assistant.';
    const result = applyStyle(base, 'Explanatory');
    assert.ok(result.includes(EXPLANATORY.name));
    assert.ok(result.includes(EXPLANATORY.tone));
  });

  it('returns base prompt unchanged when style is invalid', () => {
    const base = 'You are a helpful assistant.';
    assert.strictEqual(applyStyle(base, null), base);
    assert.strictEqual(applyStyle(base, {}), base);
    assert.strictEqual(applyStyle(base, 'UnknownStyle'), base);
  });

  it('returns empty string for empty base prompt', () => {
    assert.strictEqual(applyStyle('', CONCISE), '');
  });

  it('includes all formatting preferences in the output', () => {
    const result = applyStyle('Base.', TUTORIAL);
    for (const pref of TUTORIAL.formattingPreferences) {
      assert.ok(result.includes(pref), `Output should include preference: "${pref}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// detectStyle
// ---------------------------------------------------------------------------

describe('detectStyle', () => {
  it('detects concise text from short, direct responses', () => {
    const result = detectStyle('Yes. The bug was a null pointer. Fixed in line 42.');
    assert.ok(result !== null);
    assert.strictEqual(result.style.name, 'Concise');
  });

  it('detects explanatory text from reasoned responses', () => {
    const text = [
      '## Analysis',
      '',
      'The issue occurs because the cache is not invalidated after writes.',
      'Therefore, stale data is returned on subsequent reads.',
      '',
      '### Alternatives Considered',
      '- Write-through cache: adds latency',
      '- TTL-based invalidation: simpler but less precise',
      '',
      'I recommend implementing write-through because it guarantees consistency.',
    ].join('\n');
    const result = detectStyle(text);
    assert.ok(result !== null);
    assert.strictEqual(result.style.name, 'Explanatory');
  });

  it('detects tutorial text from step-by-step instructions', () => {
    const text = [
      'First, install the package:',
      '```bash',
      'npm install my-package',
      '```',
      '',
      'Next, create a configuration file:',
      '```js',
      'module.exports = { port: 3000 };',
      '```',
      '',
      'Now try running the server and observe the output.',
      'You should see "Server listening on port 3000".',
    ].join('\n');
    const result = detectStyle(text);
    assert.ok(result !== null);
    assert.strictEqual(result.style.name, 'Tutorial');
  });

  it('detects analytical text from data-heavy responses', () => {
    const text = [
      'The API response time decreased by 45% after the optimization.',
      'Compared to the baseline of 230ms, we now average 127ms.',
      '',
      '| Metric    | Before | After | Change  |',
      '|-----------|--------|-------|---------|',
      '| p50       | 210ms  | 98ms  | -53%    |',
      '| p99       | 890ms  | 340ms | -62%    |',
      '',
      'Conclusion: The caching layer significantly improved performance.',
      'Recommendation: Monitor p99 latency for the next week to confirm stability.',
    ].join('\n');
    const result = detectStyle(text);
    assert.ok(result !== null);
    assert.strictEqual(result.style.name, 'Analytical');
  });

  it('detects conversational text from informal dialogue', () => {
    const text = [
      "Hey! That's a great question. I think we have a few options here.",
      "What do you think about going with option B? It's simpler and we can always refactor later.",
      "Let me know if you want to explore this more!",
    ].join('\n');
    const result = detectStyle(text);
    assert.ok(result !== null);
    assert.strictEqual(result.style.name, 'Conversational');
  });

  it('detects technical text from code-heavy responses', () => {
    const text = [
      'The `UserService` class implements the `IAuthProvider` interface:',
      '',
      '```typescript',
      'interface IAuthProvider {',
      '  authenticate(token: string): Promise<User>;',
      '  refreshToken(userId: string): Promise<string>;',
      '}',
      '```',
      '',
      'The algorithm has O(n log n) complexity and uses the RSA-2048 key format.',
      'The middleware serializes the request body before passing it to the next handler.',
    ].join('\n');
    const result = detectStyle(text);
    assert.ok(result !== null);
    assert.strictEqual(result.style.name, 'Technical');
  });

  it('returns null for empty text', () => {
    assert.strictEqual(detectStyle(''), null);
    assert.strictEqual(detectStyle('   '), null);
    assert.strictEqual(detectStyle(null), null);
  });

  it('includes a confidence score in the result', () => {
    const result = detectStyle('The function returns a number.');
    assert.ok(result !== null);
    assert.ok(typeof result.confidence === 'number');
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
  });

  it('can distinguish between similar-length but different style texts', () => {
    const conciseText = 'Fixed. Null check added on line 42.';

    // Clearly explanatory with headers, bullets, and logical connectors
    const explanatoryText = [
      '## Root Cause',
      '',
      'The issue occurs because the cache is not invalidated after writes.',
      'Therefore, stale data is returned on subsequent reads.',
      '',
      '## Alternatives',
      '- Write-through cache: adds latency but guarantees consistency',
      '- TTL-based invalidation: simpler but less precise',
      '',
      'I recommend the write-through approach because correctness is more important here.',
    ].join('\n');

    const conciseResult = detectStyle(conciseText);
    const explanatoryResult = detectStyle(explanatoryText);

    assert.ok(conciseResult !== null);
    assert.ok(explanatoryResult !== null);
    // They should be detected as different styles
    assert.notStrictEqual(conciseResult.style.name, explanatoryResult.style.name);
  });
});

// ---------------------------------------------------------------------------
// styleDiff
// ---------------------------------------------------------------------------

describe('styleDiff', () => {
  it('returns sameStyle=true for two texts of the same style', () => {
    const diff = styleDiff('Yes.', 'No.');
    assert.ok(diff.sameStyle);
  });

  it('returns sameStyle=false for different style texts', () => {
    const conciseText = 'Done.';
    // Clearly tutorial: numbered steps, code blocks, instructional language, expected output
    const tutorialText = [
      'First, install the dependency:',
      '',
      '```bash',
      'npm install lodash',
      '```',
      '',
      'Next, import it in your file:',
      '',
      '```js',
      "const _ = require('lodash');",
      '```',
      '',
      'Now run the server. You should see "Server started on port 3000" in the console.',
      '',
      'Finally, verify the endpoint works by opening http://localhost:3000/health.',
      '',
      'Common mistake: forgetting to install the package before importing it.',
    ].join('\n');

    const diff = styleDiff(conciseText, tutorialText);
    assert.strictEqual(diff.sameStyle, false);
    assert.ok(diff.a !== null);
    assert.ok(diff.b !== null);
    assert.notStrictEqual(diff.a.style.name, diff.b.style.name);
  });

  it('returns a human-readable summary string', () => {
    const diff = styleDiff('Done.', 'Let me explain this in detail because there are several factors to consider.');
    assert.ok(typeof diff.summary === 'string');
    assert.ok(diff.summary.length > 0);
  });

  it('handles unclassifiable text gracefully', () => {
    const diff = styleDiff('', '');
    assert.ok(diff.summary.includes('Neither text'));
  });

  it('includes confidenceDelta in the result', () => {
    const diff = styleDiff('Yes.', 'Let me walk you through this step by step.');
    assert.ok(typeof diff.confidenceDelta === 'number');
  });
});
