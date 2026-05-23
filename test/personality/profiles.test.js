"use strict";

const { strict: assert } = require('node:assert');
const { describe, it } = require('node:test');

const {
  PRECISE,
  BALANCED,
  CREATIVE,
  AUDITOR,
  MENTOR,
  EXPLORER,
  SURGEON,
  SHERLOCK,
  ALL_PROFILES,
  DIMENSION_KEYS,
  DIMENSION_LABELS,
  applyProfile,
  blendProfiles,
  profileToPrompt,
  createProfile,
  profileDistance,
  isValidProfile,
  isValidDimension,
  clampDimension,
} = require('../../src/personality/profiles');

// ---------------------------------------------------------------------------
// Profile shape validation
// ---------------------------------------------------------------------------

describe('Profile shape validation', () => {
  for (const profile of ALL_PROFILES) {
    it(`${profile.name} has all required dimensions with valid values`, () => {
      assert.ok(typeof profile.name === 'string' && profile.name.length > 0, 'name must be a non-empty string');
      assert.ok(typeof profile.description === 'string' && profile.description.length > 0, 'description must be non-empty');

      for (const key of DIMENSION_KEYS) {
        assert.ok(
          typeof profile[key] === 'number' && profile[key] >= 1 && profile[key] <= 5,
          `${key} must be a number between 1 and 5, got ${profile[key]}`
        );
      }
    });
  }

  it('all profiles are frozen (immutable)', () => {
    for (const profile of ALL_PROFILES) {
      assert.ok(Object.isFrozen(profile), `${profile.name} should be frozen`);
    }
  });

  it('all profile names are unique', () => {
    const names = ALL_PROFILES.map((p) => p.name);
    const unique = new Set(names);
    assert.strictEqual(unique.size, ALL_PROFILES.length, 'Profile names must be unique');
  });

  it('ALL_PROFILES contains exactly 8 profiles', () => {
    assert.strictEqual(ALL_PROFILES.length, 8);
  });
});

// ---------------------------------------------------------------------------
// Dimension helpers
// ---------------------------------------------------------------------------

describe('isValidDimension', () => {
  it('returns true for integers 1-5', () => {
    for (let i = 1; i <= 5; i++) {
      assert.ok(isValidDimension(i), `isValidDimension(${i}) should be true`);
    }
  });

  it('returns false for values outside 1-5', () => {
    assert.strictEqual(isValidDimension(0), false);
    assert.strictEqual(isValidDimension(6), false);
    assert.strictEqual(isValidDimension(-1), false);
    assert.strictEqual(isValidDimension(99), false);
  });

  it('returns false for non-integer numbers', () => {
    assert.strictEqual(isValidDimension(2.5), false);
    assert.strictEqual(isValidDimension(3.14), false);
  });

  it('returns false for non-numbers', () => {
    assert.strictEqual(isValidDimension('3'), false);
    assert.strictEqual(isValidDimension(null), false);
    assert.strictEqual(isValidDimension(undefined), false);
    assert.strictEqual(isValidDimension({}), false);
  });
});

describe('isValidProfile', () => {
  it('returns true for valid profiles', () => {
    assert.ok(isValidProfile(BALANCED));
    assert.ok(isValidProfile(PRECISE));
  });

  it('returns false for null/undefined', () => {
    assert.strictEqual(isValidProfile(null), false);
    assert.strictEqual(isValidProfile(undefined), false);
  });

  it('returns false for objects missing dimensions', () => {
    assert.strictEqual(isValidProfile({ name: 'Test' }), false);
    assert.strictEqual(isValidProfile({ verbosity: 3 }), false);
  });

  it('returns false for objects with invalid dimension values', () => {
    assert.strictEqual(isValidProfile({
      verbosity: 6, riskTolerance: 3, creativity: 3, formality: 3, autonomy: 3,
    }), false);
  });
});

describe('clampDimension', () => {
  it('clamps values below 1 to 1', () => {
    assert.strictEqual(clampDimension(0), 1);
    assert.strictEqual(clampDimension(-5), 1);
  });

  it('clamps values above 5 to 5', () => {
    assert.strictEqual(clampDimension(6), 5);
    assert.strictEqual(clampDimension(100), 5);
  });

  it('rounds fractional values before clamping', () => {
    assert.strictEqual(clampDimension(2.3), 2);
    assert.strictEqual(clampDimension(2.7), 3);
  });
});

// ---------------------------------------------------------------------------
// Pre-built profiles — behavioral alignment
// ---------------------------------------------------------------------------

describe('PRECISE profile', () => {
  it('is maximally concise (verbosity 1)', () => {
    assert.strictEqual(PRECISE.verbosity, 1);
  });

  it('is risk-averse', () => {
    assert.strictEqual(PRECISE.riskTolerance, 1);
  });

  it('is low creativity', () => {
    assert.strictEqual(PRECISE.creativity, 1);
  });
});

describe('CREATIVE profile', () => {
  it('has maximum creativity', () => {
    assert.strictEqual(CREATIVE.creativity, 5);
  });

  it('is more verbose than PRECISE', () => {
    assert.ok(CREATIVE.verbosity > PRECISE.verbosity);
  });

  it('has higher risk tolerance than AUDITOR', () => {
    assert.ok(CREATIVE.riskTolerance > AUDITOR.riskTolerance);
  });
});

describe('AUDITOR profile', () => {
  it('has maximum formality', () => {
    assert.strictEqual(AUDITOR.formality, 5);
  });

  it('is risk-averse', () => {
    assert.strictEqual(AUDITOR.riskTolerance, 1);
  });

  it('has high autonomy', () => {
    assert.strictEqual(AUDITOR.autonomy, 5);
  });
});

describe('SURGEON profile', () => {
  it('is concise (verbosity 1)', () => {
    assert.strictEqual(SURGEON.verbosity, 1);
  });

  it('has high autonomy', () => {
    assert.strictEqual(SURGEON.autonomy, 5);
  });

  it('has moderate risk tolerance', () => {
    assert.ok(SURGEON.riskTolerance >= 2 && SURGEON.riskTolerance <= 4);
  });
});

describe('SHERLOCK profile', () => {
  it('has moderate verbosity for investigative work', () => {
    assert.strictEqual(SHERLOCK.verbosity, 3);
  });

  it('has high autonomy for independent investigation', () => {
    assert.strictEqual(SHERLOCK.autonomy, 5);
  });

  it('has above-average formality', () => {
    assert.ok(SHERLOCK.formality >= 3);
  });
});

// ---------------------------------------------------------------------------
// applyProfile
// ---------------------------------------------------------------------------

describe('applyProfile', () => {
  it('injects behavior instructions into a base prompt', () => {
    const base = 'You are a helpful assistant.';
    const result = applyProfile(base, PRECISE);
    assert.ok(result.startsWith(base));
    assert.ok(result.includes('Personality & Behavioral Guidelines'));
    assert.ok(result.includes(PRECISE.name));
  });

  it('returns the base prompt unchanged when profile is invalid', () => {
    const base = 'You are a helpful assistant.';
    assert.strictEqual(applyProfile(base, null), base);
    assert.strictEqual(applyProfile(base, {}), base);
    assert.strictEqual(applyProfile(base, { name: 'Bad' }), base);
  });

  it('returns empty string for empty base prompt', () => {
    assert.strictEqual(applyProfile('', BALANCED), '');
  });

  it('includes all five dimensions in the output', () => {
    const result = applyProfile('Base.', BALANCED);
    for (const label of Object.values(DIMENSION_LABELS)) {
      assert.ok(result.includes(label), `Output should mention ${label}`);
    }
  });

  it('includes dimension bar visualization', () => {
    const result = applyProfile('Base.', PRECISE);
    assert.ok(result.includes('█'), 'Output should include filled bar characters');
    assert.ok(result.includes('░'), 'Output should include empty bar characters');
  });
});

// ---------------------------------------------------------------------------
// blendProfiles
// ---------------------------------------------------------------------------

describe('blendProfiles', () => {
  it('returns profileA at ratio 0', () => {
    const blended = blendProfiles(PRECISE, CREATIVE, 0);
    assert.ok(blended !== null);
    for (const key of DIMENSION_KEYS) {
      assert.strictEqual(blended[key], PRECISE[key], `${key} should match profileA`);
    }
  });

  it('returns profileB at ratio 1', () => {
    const blended = blendProfiles(PRECISE, CREATIVE, 1);
    assert.ok(blended !== null);
    for (const key of DIMENSION_KEYS) {
      assert.strictEqual(blended[key], CREATIVE[key], `${key} should match profileB`);
    }
  });

  it('produces a midpoint blend at ratio 0.5', () => {
    const blended = blendProfiles(PRECISE, CREATIVE, 0.5);
    assert.ok(blended !== null);
    // PRECISE.verbosity=1, CREATIVE.verbosity=4 → blended=Math.round(2.5)=3
    assert.strictEqual(blended.verbosity, 3);
  });

  it('returns null when either profile is invalid', () => {
    assert.strictEqual(blendProfiles(null, BALANCED, 0.5), null);
    assert.strictEqual(blendProfiles(BALANCED, null, 0.5), null);
    assert.strictEqual(blendProfiles({}, BALANCED, 0.5), null);
  });

  it('defaults ratio to 0.5 when not provided', () => {
    const blended = blendProfiles(PRECISE, CREATIVE);
    assert.ok(blended !== null);
    // Should be same as ratio 0.5
    const explicitHalf = blendProfiles(PRECISE, CREATIVE, 0.5);
    for (const key of DIMENSION_KEYS) {
      assert.strictEqual(blended[key], explicitHalf[key], `${key} should match with default and explicit 0.5`);
    }
  });

  it('clamps ratio outside [0,1]', () => {
    const blendedBelow = blendProfiles(PRECISE, CREATIVE, -0.5);
    const blendedAbove = blendProfiles(PRECISE, CREATIVE, 1.5);
    for (const key of DIMENSION_KEYS) {
      assert.strictEqual(blendedBelow[key], PRECISE[key], `${key}: ratio -0.5 clamps to 0`);
      assert.strictEqual(blendedAbove[key], CREATIVE[key], `${key}: ratio 1.5 clamps to 1`);
    }
  });

  it('sets a descriptive name for the blended profile', () => {
    const blended = blendProfiles(PRECISE, CREATIVE, 0.3);
    assert.ok(blended.name.includes('Blend'));
    assert.ok(blended.name.includes(PRECISE.name));
    assert.ok(blended.name.includes(CREATIVE.name));
  });
});

// ---------------------------------------------------------------------------
// profileToPrompt
// ---------------------------------------------------------------------------

describe('profileToPrompt', () => {
  it('generates a formatted behavior block', () => {
    const result = profileToPrompt(BALANCED);
    assert.ok(result.includes('# Personality & Behavioral Guidelines'));
    assert.ok(result.includes(BALANCED.name));
  });

  it('returns empty string for invalid profile', () => {
    assert.strictEqual(profileToPrompt(null), '');
    assert.strictEqual(profileToPrompt({}), '');
  });

  it('includes all five dimension sections', () => {
    const result = profileToPrompt(BALANCED);
    for (const label of Object.values(DIMENSION_LABELS)) {
      assert.ok(result.includes(`## ${label}`), `Output should have a section for ${label}`);
    }
  });

  it('includes dimension scores in the output', () => {
    const result = profileToPrompt(BALANCED);
    for (const key of DIMENSION_KEYS) {
      const value = BALANCED[key];
      assert.ok(result.includes(`(${value}/5)`), `Output should show score ${value}/5 for ${key}`);
    }
  });
});

// ---------------------------------------------------------------------------
// createProfile
// ---------------------------------------------------------------------------

describe('createProfile', () => {
  it('creates a profile from partial dimensions', () => {
    const custom = createProfile({
      name: 'TestBot',
      description: 'A test profile.',
      verbosity: 5,
      riskTolerance: 1,
    });
    assert.ok(custom !== null);
    assert.strictEqual(custom.name, 'TestBot');
    assert.strictEqual(custom.description, 'A test profile.');
    assert.strictEqual(custom.verbosity, 5);
    assert.strictEqual(custom.riskTolerance, 1);
  });

  it('fills missing dimensions with BALANCED defaults', () => {
    const custom = createProfile({
      verbosity: 5,
    });
    assert.strictEqual(custom.verbosity, 5);
    assert.strictEqual(custom.riskTolerance, BALANCED.riskTolerance);
    assert.strictEqual(custom.creativity, BALANCED.creativity);
    assert.strictEqual(custom.formality, BALANCED.formality);
    assert.strictEqual(custom.autonomy, BALANCED.autonomy);
  });

  it('returns null for non-object input', () => {
    assert.strictEqual(createProfile(null), null);
    assert.strictEqual(createProfile('string'), null);
  });

  it('defaults name to "Custom" when not provided', () => {
    const custom = createProfile({ verbosity: 2 });
    assert.strictEqual(custom.name, 'Custom');
  });

  it('clamps out-of-range values to BALANCED defaults (not applied, checked by isValidDimension)', () => {
    const custom = createProfile({ verbosity: 99 });
    // 99 is not a valid dimension, so BALANCED default is used
    assert.strictEqual(custom.verbosity, BALANCED.verbosity);
  });
});

// ---------------------------------------------------------------------------
// profileDistance
// ---------------------------------------------------------------------------

describe('profileDistance', () => {
  it('returns 0 for identical profiles', () => {
    assert.strictEqual(profileDistance(BALANCED, BALANCED), 0);
  });

  it('returns a positive number for different profiles', () => {
    const dist = profileDistance(PRECISE, CREATIVE);
    assert.ok(dist > 0, `Distance between PRECISE and CREATIVE should be > 0, got ${dist}`);
  });

  it('returns -1 for invalid profiles', () => {
    assert.strictEqual(profileDistance(null, BALANCED), -1);
    assert.strictEqual(profileDistance(BALANCED, null), -1);
  });

  it('is symmetric', () => {
    const distAB = profileDistance(PRECISE, CREATIVE);
    const distBA = profileDistance(CREATIVE, PRECISE);
    assert.strictEqual(distAB, distBA);
  });

  it('returns larger distance for more different profiles', () => {
    // PRECISE(1,1,1,4,4) vs CREATIVE(4,4,5,2,4) — quite different
    // PRECISE(1,1,1,4,4) vs SURGEON(1,3,2,3,5) — more similar
    const distPreciseCreative = profileDistance(PRECISE, CREATIVE);
    const distPreciseSurgeon = profileDistance(PRECISE, SURGEON);
    assert.ok(distPreciseCreative > distPreciseSurgeon,
      `PRECISE-CREATIVE (${distPreciseCreative}) should be > PRECISE-SURGEON (${distPreciseSurgeon})`);
  });

  it('computes correct distance for known values', () => {
    // BALANCED is (3,3,3,3,3)
    // PRECISE is (1,1,1,4,4)
    // distance = sqrt((3-1)^2 + (3-1)^2 + (3-1)^2 + (3-4)^2 + (3-4)^2)
    //          = sqrt(4+4+4+1+1) = sqrt(14) ≈ 3.742
    const dist = profileDistance(BALANCED, PRECISE);
    assert.ok(Math.abs(dist - Math.sqrt(14)) < 0.001, `Expected ~${Math.sqrt(14)}, got ${dist}`);
  });
});

// ---------------------------------------------------------------------------
// DIMENSION constants
// ---------------------------------------------------------------------------

describe('DIMENSION constants', () => {
  it('DIMENSION_KEYS contains all five dimensions', () => {
    assert.deepStrictEqual(DIMENSION_KEYS, [
      'verbosity',
      'riskTolerance',
      'creativity',
      'formality',
      'autonomy',
    ]);
  });

  it('DIMENSION_LABELS maps each key to a human-readable label', () => {
    for (const key of DIMENSION_KEYS) {
      assert.ok(typeof DIMENSION_LABELS[key] === 'string');
      assert.ok(DIMENSION_LABELS[key].length > 0);
    }
  });

  it('DIMENSION_KEYS and DIMENSION_LABELS are frozen', () => {
    assert.ok(Object.isFrozen(DIMENSION_KEYS));
    assert.ok(Object.isFrozen(DIMENSION_LABELS));
  });
});
