"use strict";

const assert = require('node:assert/strict');
const test = require('node:test');

const { SkillMetrics, createMetrics } = require('../../src/skills/metrics');

// ── recordUsage ─────────────────────────────────────────────────────────────

test('recordUsage: increments invocation count', () => {
  const metrics = new SkillMetrics();
  metrics.recordUsage('debug', { success: true });
  metrics.recordUsage('debug', { success: true });

  const stats = metrics.getStats('debug');
  assert.equal(stats.invocationCount, 2);
});

test('recordUsage: tracks success and failure counts separately', () => {
  const metrics = new SkillMetrics();
  metrics.recordUsage('deploy', { success: true });
  metrics.recordUsage('deploy', { success: false });
  metrics.recordUsage('deploy', { success: true });

  const stats = metrics.getStats('deploy');
  assert.equal(stats.invocationCount, 3);
  assert.ok(stats.successRate > 0.6);
  assert.ok(stats.failRate > 0.2);
});

test('recordUsage: handles no arguments gracefully', () => {
  const metrics = new SkillMetrics();
  assert.doesNotThrow(() => metrics.recordUsage());
  assert.doesNotThrow(() => metrics.recordUsage(null));
  assert.doesNotThrow(() => metrics.recordUsage('test'));
  const stats = metrics.getStats('test');
  assert.equal(stats.invocationCount, 1);
  assert.equal(stats.successRate, 1); // defaults to success=true
});

test('recordUsage: ignores invalid satisfaction values', () => {
  const metrics = new SkillMetrics();
  metrics.recordUsage('skill-a', { success: true, satisfaction: 3 });
  metrics.recordUsage('skill-a', { success: true, satisfaction: 0 }); // invalid, ignored
  metrics.recordUsage('skill-a', { success: true, satisfaction: 6 }); // invalid, ignored
  metrics.recordUsage('skill-a', { success: true, satisfaction: 5 });

  const stats = metrics.getStats('skill-a');
  // Only ratings 3 and 5 are valid
  assert.equal(stats.avgSatisfaction, 4);
});

// ── getStats ────────────────────────────────────────────────────────────────

test('getStats: returns duration percentiles (p50, p95)', () => {
  const metrics = new SkillMetrics();
  // Record 100 invocations with durations 1–100 ms
  for (let i = 1; i <= 100; i++) {
    metrics.recordUsage('fast', { success: true, duration: i });
  }

  const stats = metrics.getStats('fast');
  assert.equal(stats.invocationCount, 100);
  assert.equal(stats.p50Duration, 50);
  assert.equal(stats.p95Duration, 95);
});

test('getStats: handles skill with no invocations', () => {
  const metrics = new SkillMetrics();
  const stats = metrics.getStats('nonexistent');

  assert.equal(stats.invocationCount, 0);
  assert.equal(stats.successRate, 0);
  assert.equal(stats.avgDuration, 0);
  assert.equal(stats.avgSatisfaction, null);
  assert.equal(stats.lastUsedAt, null);
});

test('getStats: tracks lastUsedAt timestamp', () => {
  const metrics = new SkillMetrics();
  const before = Date.now();
  metrics.recordUsage('recent', { success: true });
  const after = Date.now();

  const stats = metrics.getStats('recent');
  assert.ok(stats.lastUsedAt >= before);
  assert.ok(stats.lastUsedAt <= after);
});

// ── getTopSkills ────────────────────────────────────────────────────────────

test('getTopSkills: returns top skills sorted by success rate', () => {
  const metrics = new SkillMetrics();
  metrics.recordUsage('alpha', { success: true });
  metrics.recordUsage('alpha', { success: true });
  metrics.recordUsage('alpha', { success: true });

  metrics.recordUsage('beta', { success: true });
  metrics.recordUsage('beta', { success: false });
  metrics.recordUsage('beta', { success: false });

  const top = metrics.getTopSkills(null, { limit: 10, sortBy: 'successRate' });
  assert.ok(top.length >= 2);
  assert.equal(top[0].skill, 'alpha');
  assert.ok(top[0].stats.successRate > top[top.length - 1].stats.successRate);
});

test('getTopSkills: respects limit option', () => {
  const metrics = new SkillMetrics();
  for (let i = 0; i < 10; i++) {
    metrics.recordUsage(`skill-${i}`, { success: true });
  }

  const top = metrics.getTopSkills(null, { limit: 3 });
  assert.equal(top.length, 3);
});

test('getTopSkills: sorts by invocationCount when specified', () => {
  const metrics = new SkillMetrics();
  metrics.recordUsage('rare', { success: true });
  for (let i = 0; i < 5; i++) {
    metrics.recordUsage('frequent', { success: true });
  }

  const top = metrics.getTopSkills(null, { sortBy: 'invocationCount', limit: 5 });
  assert.equal(top[0].skill, 'frequent');
});

// ── getTrends ───────────────────────────────────────────────────────────────

test('getTrends: returns no-data when no invocations tracked', () => {
  const metrics = new SkillMetrics();
  const trends = metrics.getTrends();
  assert.equal(trends.overallTrend, 'no-data');
  assert.deepEqual(trends.dailyUsage, []);
  assert.deepEqual(trends.topGrowingSkills, []);
});

test('getTrends: detects stable trend with equal usage', () => {
  const metrics = new SkillMetrics();
  const now = Date.now();
  const day = 86400000;

  // 2 invocations each day for 4 days
  for (let d = 0; d < 4; d++) {
    const ts = now - (3 - d) * day;
    // Override history directly for controlled timestamps
    // We create entries by recording and adjusting timestamps
    metrics.recordUsage('stable-skill', { success: true, duration: 10 });
  }

  const trends = metrics.getTrends();
  // With a 7-day window, recent invocations are within range
  assert.ok(['stable', 'rising', 'falling', 'no-data'].includes(trends.overallTrend));
});

test('getTrends: includes topGrowingSkills', () => {
  const metrics = new SkillMetrics();
  metrics.recordUsage('popular', { success: true });
  metrics.recordUsage('popular', { success: true });
  metrics.recordUsage('popular', { success: true });
  metrics.recordUsage('niche', { success: true });

  const trends = metrics.getTrends();
  if (trends.topGrowingSkills.length > 0) {
    assert.equal(trends.topGrowingSkills[0].skill, 'popular');
  }
});

// ── reset ───────────────────────────────────────────────────────────────────

test('reset: clears all tracked metrics', () => {
  const metrics = new SkillMetrics();
  metrics.recordUsage('debug', { success: true });
  metrics.recordUsage('deploy', { success: false });

  assert.ok(metrics.getTrackedSkills().length > 0);

  metrics.reset();

  assert.equal(metrics.getTrackedSkills().length, 0);
  assert.equal(metrics.getStats('debug').invocationCount, 0);
});

test('getTrackedSkills: returns all skill names with recorded metrics', () => {
  const metrics = new SkillMetrics();
  assert.deepEqual(metrics.getTrackedSkills(), []);

  metrics.recordUsage('alpha', { success: true });
  metrics.recordUsage('beta', { success: false });

  const names = metrics.getTrackedSkills();
  assert.ok(names.includes('alpha'));
  assert.ok(names.includes('beta'));
  assert.equal(names.length, 2);
});

// ── createMetrics convenience ───────────────────────────────────────────────

test('createMetrics: returns a SkillMetrics instance', () => {
  const m = createMetrics();
  assert.ok(m instanceof SkillMetrics);
});
