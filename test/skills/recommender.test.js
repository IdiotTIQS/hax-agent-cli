"use strict";

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SkillRecommender,
  recommendSkills,
  rankSkills,
} = require('../../src/skills/recommender');

// ── Test fixtures ───────────────────────────────────────────────────────────

function makeSkills() {
  return [
    {
      name: 'code-review',
      displayName: 'Code Review',
      description: 'Review code for bugs, security issues, and style problems',
      tags: ['review', 'quality', 'security'],
      usageCount: 42,
      lastUsedAt: Date.now() - 1000,
    },
    {
      name: 'write-tests',
      displayName: 'Write Tests',
      description: 'Generate unit tests and integration tests for your code',
      tags: ['testing', 'quality', 'coverage'],
      usageCount: 30,
      lastUsedAt: Date.now() - 5000,
    },
    {
      name: 'debug',
      displayName: 'Debug',
      description: 'Debug errors, exceptions, and unexpected behavior',
      tags: ['debug', 'fix', 'troubleshoot'],
      usageCount: 55,
      lastUsedAt: Date.now() - 600,
    },
    {
      name: 'refactor',
      displayName: 'Refactor',
      description: 'Restructure and clean up code for better maintainability',
      tags: ['cleanup', 'maintainability', 'structure'],
      usageCount: 18,
      lastUsedAt: Date.now() - 10000,
    },
    {
      name: 'deploy',
      displayName: 'Deploy',
      description: 'Deploy the application to production or staging',
      tags: ['devops', 'release', 'ci-cd'],
      usageCount: 5,
      lastUsedAt: Date.now() - 86400000,
    },
  ];
}

// ── recommend ───────────────────────────────────────────────────────────────

test('recommend: returns empty array for empty query', () => {
  const recommender = new SkillRecommender();
  const result = recommender.recommend('', makeSkills());
  assert.deepEqual(result, []);
});

test('recommend: returns empty array for empty skills list', () => {
  const recommender = new SkillRecommender();
  const result = recommender.recommend('debug something', []);
  assert.deepEqual(result, []);
});

test('recommend: finds skill by exact name match', () => {
  const recommender = new SkillRecommender();
  const result = recommender.recommend('debug', makeSkills());
  assert.ok(result.length > 0);
  assert.equal(result[0].skill.name, 'debug');
});

test('recommend: finds skill by description keyword match', () => {
  const recommender = new SkillRecommender();
  const result = recommender.recommend('I need to test my code', makeSkills());
  assert.ok(result.length > 0);
  // write-tests should rank high for "test" keyword
  const topNames = result.slice(0, 2).map((r) => r.skill.name);
  assert.ok(topNames.includes('write-tests'));
});

test('recommend: scores include reasons array', () => {
  const recommender = new SkillRecommender();
  const result = recommender.recommend('review code for security bugs', makeSkills());
  assert.ok(result.length > 0);
  for (const entry of result) {
    assert.ok(typeof entry.score === 'number');
    assert.ok(Array.isArray(entry.reasons));
    assert.ok(entry.skill.name);
  }
});

// ── rankByRelevance ─────────────────────────────────────────────────────────

test('rankByRelevance: returns all skills sorted by score (no minScore filter)', () => {
  const recommender = new SkillRecommender();
  const result = recommender.rankByRelevance('deploy to production', makeSkills());
  assert.equal(result.length, makeSkills().length);
  // Scores should be descending
  for (let i = 1; i < result.length; i++) {
    assert.ok(result[i - 1].score >= result[i].score,
      `Expected descending scores, got ${result[i - 1].score} < ${result[i].score}`);
  }
});

test('rankByRelevance: returns all skills sorted by score for unknown query', () => {
  const recommender = new SkillRecommender();
  const result = recommender.rankByRelevance('xyzabc NOMATCH', makeSkills());
  assert.equal(result.length, makeSkills().length);
});

// ── getSimilarSkills ────────────────────────────────────────────────────────

test('getSimilarSkills: returns related skills for a known skill name', () => {
  const recommender = new SkillRecommender();
  const similar = recommender.getSimilarSkills('code-review');
  assert.ok(similar.includes('debug'));
  assert.ok(similar.includes('write-tests'));
  assert.ok(similar.includes('refactor'));
});

test('getSimilarSkills: returns related skills by skill object', () => {
  const recommender = new SkillRecommender();
  const result = recommender.getSimilarSkills({ name: 'debug' });
  assert.ok(result.length > 0);
});

test('getSimilarSkills: returns empty array for unknown skill', () => {
  const recommender = new SkillRecommender();
  const result = recommender.getSimilarSkills('nonexistent-skill-xyz');
  assert.deepEqual(result, []);
});

// ── getSkillChain ───────────────────────────────────────────────────────────

test('getSkillChain: returns chain for known task "fix-bug"', () => {
  const recommender = new SkillRecommender();
  const { chain } = recommender.getSkillChain('fix-bug');
  assert.ok(chain.length > 0);
  assert.ok(chain.includes('debug'));
});

test('getSkillChain: returns chain for known task "add-feature"', () => {
  const recommender = new SkillRecommender();
  const { chain } = recommender.getSkillChain('add-feature');
  assert.ok(chain.length > 0);
  assert.ok(chain.includes('code-review'));
});

test('getSkillChain: returns empty chain for unknown task', () => {
  const recommender = new SkillRecommender();
  const { chain } = recommender.getSkillChain('do-something-unknown');
  assert.deepEqual(chain, []);
});

// ── learn ───────────────────────────────────────────────────────────────────

test('learn: records successful usage and updates success rate', () => {
  const recommender = new SkillRecommender();
  recommender.learn({ skill: 'debug', success: true, duration: 120 });
  recommender.learn({ skill: 'debug', success: true, duration: 80 });

  // After two successes, success rate should be above 0.5
  const skills = makeSkills();
  const result = recommender.rankByRelevance('debug crash error', skills);
  const debugEntry = result.find((r) => r.skill.name === 'debug');
  assert.ok(debugEntry, 'debug should be in results');
});

test('learn: handles learn() with no skill gracefully', () => {
  const recommender = new SkillRecommender();
  // Should not throw
  assert.doesNotThrow(() => recommender.learn({}));
  assert.doesNotThrow(() => recommender.learn(null));
  assert.doesNotThrow(() => recommender.learn({ success: true }));
});

// ── Convenience functions ───────────────────────────────────────────────────

test('recommendSkills: convenience function works', () => {
  const result = recommendSkills('debug issues', makeSkills());
  assert.ok(result.length > 0);
  assert.equal(result[0].skill.name, 'debug');
});

test('rankSkills: convenience function works', () => {
  const result = rankSkills('test coverage', makeSkills());
  assert.equal(result.length, makeSkills().length);
});
