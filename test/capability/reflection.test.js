"use strict";

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { ReflectionEngine } = require('../../src/capability/reflection');

function makeProfile(opts = {}) {
  return {
    availableTools: Array.isArray(opts.tools) ? opts.tools : [
      { name: 'file.read', description: 'Read file contents' },
      { name: 'file.write', description: 'Write file contents' },
      { name: 'file.glob', description: 'Find files by glob pattern' },
      { name: 'file.search', description: 'Search file contents with regex' },
      { name: 'shell.run', description: 'Execute shell command' },
      { name: 'web.fetch', description: 'Fetch content from a URL' },
      { name: 'web.search', description: 'Search the web' },
      { name: 'file.edit', description: 'Edit file content' },
    ],
    availableSkills: Array.isArray(opts.skills) ? opts.skills : [
      { name: 'code-review', description: 'Review code for issues' },
    ],
    plugins: opts.plugins || [],
    modelCapabilities: opts.models || [
      { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'anthropic' },
    ],
    permissionLevel: opts.permissionLevel || 'standard',
    resourceLimits: opts.resourceLimits || { maxConcurrentTasks: 4, maxTokensPerCall: null, timeoutMs: 120000 },
  };
}

function makeMinimalProfile() {
  return {
    availableTools: [],
    availableSkills: [],
    plugins: [],
    modelCapabilities: [],
    permissionLevel: 'standard',
    resourceLimits: {},
  };
}

describe('ReflectionEngine', () => {
  describe('constructor', () => {
    it('should accept an AgentProfile instance', () => {
      // Simulate what an AgentProfile instance would look like
      const mockProfile = {
        _snapshot: () => makeProfile(),
        availableTools: makeProfile().availableTools,
      };
      const engine = new ReflectionEngine(mockProfile);
      const result = engine.introspect();
      assert.ok(result.identity.toolCount > 0);
    });

    it('should accept a plain profile snapshot', () => {
      const engine = new ReflectionEngine(makeProfile());
      const result = engine.introspect();
      assert.ok(result.identity.toolCount > 0);
    });

    it('should handle null/undefined profile gracefully', () => {
      const engine = new ReflectionEngine(null);
      const result = engine.introspect();
      assert.strictEqual(result.identity.toolCount, 0);
      assert.strictEqual(result.identity.skillCount, 0);
    });
  });

  describe('introspect', () => {
    it('should report tool count and core capabilities', () => {
      const engine = new ReflectionEngine(makeProfile());
      const result = engine.introspect();

      assert.strictEqual(result.identity.toolCount, 8);
      assert.strictEqual(result.capabilities.canReadFiles, true);
      assert.strictEqual(result.capabilities.canWriteFiles, true);
      assert.strictEqual(result.capabilities.canExecuteCommands, true);
      assert.strictEqual(result.capabilities.canSearch, true);
      assert.strictEqual(result.capabilities.canAccessWeb, true);
    });

    it('should report false for missing capabilities', () => {
      const engine = new ReflectionEngine(makeMinimalProfile());
      const result = engine.introspect();

      assert.strictEqual(result.capabilities.canReadFiles, false);
      assert.strictEqual(result.capabilities.canWriteFiles, false);
      assert.strictEqual(result.capabilities.canExecuteCommands, false);
      assert.strictEqual(result.capabilities.canSearch, false);
      assert.strictEqual(result.capabilities.canAccessWeb, false);
    });

    it('should categorise tools into groups', () => {
      const engine = new ReflectionEngine(makeProfile());
      const result = engine.introspect();

      assert.ok(typeof result.toolCategories === 'object');
      assert.ok(result.toolCategories['file-io'] >= 1);
      assert.ok(result.toolCategories.search >= 1);
      assert.ok(result.toolCategories.web >= 1);
      assert.ok(result.toolCategories.execution >= 1);
    });

    it('should identify skill areas', () => {
      const engine = new ReflectionEngine(makeProfile({
        skills: [
          { name: 'code-review', description: 'Review' },
          { name: 'deployment', description: 'Deploy' },
          { name: 'security-audit', description: 'Audit security' },
        ],
      }));
      const result = engine.introspect();

      assert.ok(result.skillAreas.includes('review'));
      assert.ok(result.skillAreas.includes('deployment'));
      assert.ok(result.skillAreas.includes('security'));
    });

    it('should include resource limits in introspection', () => {
      const engine = new ReflectionEngine(makeProfile({ resourceLimits: { maxConcurrentTasks: 8, maxTokensPerCall: 200000 } }));
      const result = engine.introspect();

      assert.strictEqual(result.resourceLimits.maxConcurrentTasks, 8);
      assert.strictEqual(result.resourceLimits.maxTokensPerCall, 200000);
    });

    it('should generate a human-readable summary string', () => {
      const engine = new ReflectionEngine(makeProfile());
      const result = engine.introspect();

      assert.ok(typeof result.summary === 'string');
      assert.ok(result.summary.length > 0);
      assert.ok(result.summary.includes('tool'));
      assert.ok(result.summary.includes('skill'));
    });
  });

  describe('suggestImprovements', () => {
    it('should suggest missing fundamental tools', () => {
      const engine = new ReflectionEngine(makeMinimalProfile());
      const result = engine.suggestImprovements();

      assert.ok(result.count > 0);
      assert.ok(result.suggestions.some((s) => s.type === 'tool' && s.name === 'shell.run'));
      assert.ok(result.suggestions.some((s) => s.type === 'tool' && s.name === 'file.search'));
    });

    it('should suggest critical model gap when no model is configured', () => {
      const engine = new ReflectionEngine(makeMinimalProfile());
      const result = engine.suggestImprovements();

      assert.ok(result.suggestions.some((s) => s.priority === 'critical' && s.type === 'model'));
    });

    it('should suggest well-known plugins for missing areas', () => {
      const engine = new ReflectionEngine(makeProfile());
      const result = engine.suggestImprovements();

      assert.ok(result.suggestions.some((s) => s.type === 'plugin'));
      assert.ok(result.suggestions.some((s) => s.name === 'security-auditor'));
    });

    it('should suggest well-known skills for missing areas', () => {
      const engine = new ReflectionEngine(makeProfile());
      const result = engine.suggestImprovements();

      assert.ok(result.suggestions.some((s) => s.type === 'skill'));
      assert.ok(result.suggestions.some((s) => s.name === 'security-review'));
    });

    it('should order suggestions by priority (critical > high > medium > low)', () => {
      const engine = new ReflectionEngine(makeMinimalProfile());
      const result = engine.suggestImprovements();

      const priorities = result.suggestions.map((s) => s.priority);
      const order = { critical: 0, high: 1, medium: 2, low: 3 };

      for (let i = 1; i < priorities.length; i++) {
        assert.ok(order[priorities[i - 1]] <= order[priorities[i]],
          `Priority order broken: ${priorities[i - 1]} before ${priorities[i]}`);
      }
    });

    it('should suggest a fallback model when only one is available', () => {
      const engine = new ReflectionEngine(makeProfile({ models: [{ id: 'single-model' }] }));
      const result = engine.suggestImprovements();

      assert.ok(result.suggestions.some((s) => s.type === 'model' && s.priority === 'low'));
    });
  });

  describe('evaluateFitness', () => {
    it('should return 100 for a fully-covered implementation task', () => {
      const engine = new ReflectionEngine(makeProfile());
      const result = engine.evaluateFitness('read the source file and edit the function');

      assert.ok(result.score >= 70);
      assert.ok(result.matchedCategories.includes('file-io'));
    });

    it('should return lower score for partially covered tasks', () => {
      const engine = new ReflectionEngine(makeMinimalProfile());
      const result = engine.evaluateFitness('execute a shell command and deploy the application');

      assert.ok(result.score < 70);
      assert.ok(result.missingCategories.length > 0);
    });

    it('should return 0 for empty task', () => {
      const engine = new ReflectionEngine(makeProfile());
      const result = engine.evaluateFitness('');

      assert.strictEqual(result.score, 0);
    });

    it('should detect multiple task categories', () => {
      const engine = new ReflectionEngine(makeProfile());
      const result = engine.evaluateFitness('search the codebase, run tests, and fetch the API docs');

      assert.ok(result.matchedCategories.length >= 2);
    });

    it('should handle undefined task gracefully', () => {
      const engine = new ReflectionEngine(makeProfile());
      const result = engine.evaluateFitness(undefined);

      assert.strictEqual(result.score, 0);
    });
  });

  describe('identifyGaps', () => {
    it('should return specific recommendations for missing categories', () => {
      const engine = new ReflectionEngine(makeMinimalProfile());
      const result = engine.identifyGaps('execute a shell script and deploy');

      assert.ok(result.totalGaps > 0);
      assert.ok(result.gaps.some((g) => g.category === 'execution'));
      assert.ok(result.gaps.some((g) => g.recommendations.length > 0));
    });

    it('should include fitness score in the gaps report', () => {
      const engine = new ReflectionEngine(makeMinimalProfile());
      const result = engine.identifyGaps('read a file');

      assert.ok(typeof result.fitnessScore === 'number');
      assert.ok(result.fitnessScore >= 0 && result.fitnessScore <= 100);
    });

    it('should return zero gaps for a well-covered task', () => {
      const engine = new ReflectionEngine(makeProfile());
      const result = engine.identifyGaps('read the config and search for the endpoint');

      assert.strictEqual(result.gaps.length, 0);
    });
  });

  describe('planCapabilityGrowth', () => {
    it('should produce a phased growth plan', () => {
      const engine = new ReflectionEngine(makeMinimalProfile());
      const result = engine.planCapabilityGrowth();

      assert.ok(typeof result.summary === 'string');
      assert.strictEqual(result.phases.length, 3);
      assert.strictEqual(result.phases[0].phase, 1);
      assert.strictEqual(result.phases[1].phase, 2);
      assert.strictEqual(result.phases[2].phase, 3);
    });

    it('should place critical/high items in phase 1', () => {
      const engine = new ReflectionEngine(makeMinimalProfile());
      const result = engine.planCapabilityGrowth();

      const phase1 = result.phases[0].items;
      // Critical model gap + high tool gaps should be in phase 1
      assert.ok(phase1.some((s) => s.priority === 'critical' || s.priority === 'high'));
    });

    it('should handle already-well-equipped profile gracefully', () => {
      const engine = new ReflectionEngine(makeProfile());
      const result = engine.planCapabilityGrowth();

      // Should still produce a valid plan with phases
      assert.ok(result.phases.every((p) => Array.isArray(p.items)));
    });
  });

  describe('generateCapabilityReport', () => {
    it('should produce a multi-line human-readable report', () => {
      const engine = new ReflectionEngine(makeProfile());
      const report = engine.generateCapabilityReport();

      assert.ok(typeof report === 'string');
      assert.ok(report.includes('=== Agent Capability Report ==='));
      assert.ok(report.includes('-- Identity --'));
      assert.ok(report.includes('-- Core Capabilities --'));
      assert.ok(report.includes('-- Tool Categories --'));
      assert.ok(report.includes('-- Skill Areas --'));
      assert.ok(report.includes('-- Resource Limits --'));
      assert.ok(report.includes('-- Summary --'));
      assert.ok(report.includes('=== End of Report ==='));
    });

    it('should report correct tool and skill counts', () => {
      const engine = new ReflectionEngine(makeProfile({ tools: [{ name: 't1' }], skills: [{ name: 's1', description: 'd' }, { name: 's2', description: 'd' }] }));
      const report = engine.generateCapabilityReport();

      assert.ok(report.includes('Tools:        1'));
      assert.ok(report.includes('Skills:       2'));
    });

    it('should handle an empty profile report', () => {
      const engine = new ReflectionEngine(makeMinimalProfile());
      const report = engine.generateCapabilityReport();

      assert.ok(report.includes('=== Agent Capability Report ==='));
      assert.ok(report.includes('Tools:        0'));
      assert.ok(report.includes('Skills:       0'));
      assert.ok(report.includes('(none)'));
      assert.ok(report.includes('=== End of Report ==='));
    });
  });
});
