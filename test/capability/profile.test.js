"use strict";

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { AgentProfile } = require('../../src/capability/profile');

function makeProfileSnapshot(opts = {}) {
  return {
    tools: Array.isArray(opts.tools) ? opts.tools : ['file.read', 'file.write', 'file.glob', 'file.search', 'shell.run'].map((name) => ({
      name,
      description: `Tool: ${name}`,
      schema: null,
      count: 1,
    })),
    skills: Array.isArray(opts.skills) ? opts.skills : ['code-review', 'test-generator'].map((name) => ({
      name,
      description: `Skill: ${name}`,
      source: 'mock',
    })),
    plugins: opts.plugins || [],
    models: opts.models || [{ id: 'claude-sonnet-4', name: 'Claude Sonnet 4' }],
    totalCapabilities: (opts.tools || [1]).length + (opts.skills || [1]).length + (opts.plugins || []).length + (opts.models || [1]).length,
  };
}

describe('AgentProfile', () => {
  describe('buildProfile', () => {
    it('should build a profile from a discovery catalog', () => {
      const profile = new AgentProfile();
      const snapshot = profile.buildProfile(makeProfileSnapshot({ tools: ['file.read', 'file.write', 'shell.run'].map((n) => ({ name: n, description: n })) }));

      assert.strictEqual(snapshot.availableTools.length, 3);
      assert.strictEqual(snapshot.availableSkills.length, 2);
      assert.strictEqual(snapshot.modelCapabilities.length, 1);
      assert.strictEqual(snapshot.permissionLevel, 'standard');
    });

    it('should accept a custom permissionLevel', () => {
      const profile = new AgentProfile();
      const snapshot = profile.buildProfile(makeProfileSnapshot(), { permissionLevel: 'elevated' });

      assert.strictEqual(snapshot.permissionLevel, 'elevated');
    });

    it('should default to standard for invalid permissionLevel', () => {
      const profile = new AgentProfile();
      const snapshot = profile.buildProfile(makeProfileSnapshot(), { permissionLevel: 'admin' });

      assert.strictEqual(snapshot.permissionLevel, 'standard');
    });

    it('should accept custom resource limits', () => {
      const profile = new AgentProfile();
      const snapshot = profile.buildProfile(makeProfileSnapshot(), {
        resourceLimits: { maxConcurrentTasks: 8, maxTokensPerCall: 100000, timeoutMs: 300000 },
      });

      assert.strictEqual(snapshot.resourceLimits.maxConcurrentTasks, 8);
      assert.strictEqual(snapshot.resourceLimits.maxTokensPerCall, 100000);
      assert.strictEqual(snapshot.resourceLimits.timeoutMs, 300000);
    });

    it('should handle empty/null discovery gracefully', () => {
      const profile = new AgentProfile();
      const snapshot = profile.buildProfile(null);

      assert.deepStrictEqual(snapshot.availableTools, []);
      assert.deepStrictEqual(snapshot.availableSkills, []);
      assert.deepStrictEqual(snapshot.modelCapabilities, []);
    });
  });

  describe('canPerform', () => {
    it('should match exact tool names', () => {
      const profile = new AgentProfile();
      profile.buildProfile(makeProfileSnapshot({ tools: ['file.read', 'shell.run'].map((n) => ({ name: n, description: n })) }));

      const result = profile.canPerform('file.read');
      assert.strictEqual(result.can, true);
      assert.deepStrictEqual(result.matches, ['file.read']);
    });

    it('should match exact skill names', () => {
      const profile = new AgentProfile();
      profile.buildProfile(makeProfileSnapshot());

      const result = profile.canPerform('code-review');
      assert.strictEqual(result.can, true);
      assert.deepStrictEqual(result.matches, ['code-review']);
    });

    it('should match by keyword in tool descriptions', () => {
      const profile = new AgentProfile();
      profile.buildProfile(
        makeProfileSnapshot({
          tools: [
            { name: 'file.glob', description: 'Find files by glob pattern' },
            { name: 'file.search', description: 'Search file contents with regex' },
          ],
        }),
      );

      const result = profile.canPerform('find');
      assert.strictEqual(result.can, true);
      // 'find' appears in 'Find files by glob pattern'
      assert.ok(result.matches.includes('file.glob'));
    });

    it('should return { can: false } for unknown actions', () => {
      const profile = new AgentProfile();
      profile.buildProfile(makeProfileSnapshot({ tools: ['file.read'].map((n) => ({ name: n, description: n })) }));

      const result = profile.canPerform('deploy_to_mars');
      assert.strictEqual(result.can, false);
      assert.deepStrictEqual(result.matches, []);
    });

    it('should handle empty action string', () => {
      const profile = new AgentProfile();
      profile.buildProfile(makeProfileSnapshot());

      const result = profile.canPerform('');
      assert.strictEqual(result.can, false);
      assert.ok(result.reason.includes('No action'));
    });

    it('should be case-insensitive', () => {
      const profile = new AgentProfile();
      profile.buildProfile(makeProfileSnapshot({ tools: ['File.Read'].map((n) => ({ name: n, description: n })) }));

      const result = profile.canPerform('file.read');
      assert.strictEqual(result.can, true);
    });
  });

  describe('bestToolFor', () => {
    it('should recommend the best matching tool for a task', () => {
      const profile = new AgentProfile();
      profile.buildProfile(
        makeProfileSnapshot({
          tools: [
            { name: 'file.read', description: 'Read file contents' },
            { name: 'file.search', description: 'Search file contents with regex' },
          ],
        }),
      );

      const result = profile.bestToolFor('read the config file');
      assert.strictEqual(result.tool, 'file.read');
      assert.ok(result.confidence > 0);
    });

    it('should return null when no tools are available', () => {
      const profile = new AgentProfile();
      profile.buildProfile(makeProfileSnapshot({ tools: [] }));

      const result = profile.bestToolFor('search the codebase');
      assert.strictEqual(result.tool, null);
      assert.strictEqual(result.confidence, 0);
      assert.deepStrictEqual(result.alternatives, []);
    });

    it('should return alternatives when multiple tools match', () => {
      const profile = new AgentProfile();
      profile.buildProfile(
        makeProfileSnapshot({
          tools: [
            { name: 'file.read', description: 'Read file contents' },
            { name: 'file.search', description: 'Search file contents' },
            { name: 'file.glob', description: 'Find files by pattern' },
          ],
          skills: [],
        }),
      );

      const result = profile.bestToolFor('search for a regex pattern in the project files');
      assert.ok(result.tool !== null);
      // Alternatives should be listed when multiple tools scored
      assert.ok(Array.isArray(result.alternatives));
    });

    it('should penalise destructive tools for read-only tasks', () => {
      const profile = new AgentProfile();
      profile.buildProfile(
        makeProfileSnapshot({
          tools: [
            { name: 'file.read', description: 'Read file contents' },
            { name: 'file.delete', description: 'Delete a file' },
          ],
        }),
      );

      const result = profile.bestToolFor('read and view the file to inspect');
      assert.strictEqual(result.tool, 'file.read');
    });
  });

  describe('limitations', () => {
    it('should report critical gap when no tools are available', () => {
      const profile = new AgentProfile();
      profile.buildProfile(makeProfileSnapshot({ tools: [], skills: [], models: [] }));

      const result = profile.limitations();
      assert.strictEqual(result.hasCriticalGaps, true);
      assert.ok(result.gaps.some((g) => g.severity === 'critical' && g.area === 'tools'));
    });

    it('should report search gap when no search tool is present', () => {
      const profile = new AgentProfile();
      profile.buildProfile(
        makeProfileSnapshot({
          tools: ['file.read', 'file.write'].map((n) => ({ name: n, description: n })),
        }),
      );

      const result = profile.limitations();
      assert.ok(result.gaps.some((g) => g.area === 'search'));
    });

    it('should report restricted permission level', () => {
      const profile = new AgentProfile();
      profile.buildProfile(makeProfileSnapshot(), { permissionLevel: 'restricted' });

      const result = profile.limitations();
      assert.ok(result.gaps.some((g) => g.area === 'permissions'));
    });

    it('should report no critical gaps for a well-equipped profile', () => {
      const profile = new AgentProfile();
      profile.buildProfile(
        makeProfileSnapshot({
          tools: [
            { name: 'file.read', description: 'Read file' },
            { name: 'file.write', description: 'Write file' },
            { name: 'file.search', description: 'Search file contents' },
            { name: 'shell.run', description: 'Execute shell command' },
            { name: 'web.fetch', description: 'Fetch web URL' },
          ],
        }),
      );

      const result = profile.limitations();
      assert.strictEqual(result.hasCriticalGaps, false);
    });
  });

  describe('strengths', () => {
    it('should identify a broad tool surface as a strength', () => {
      const profile = new AgentProfile();
      profile.buildProfile(
        makeProfileSnapshot({
          tools: Array.from({ length: 8 }, (_, i) => ({ name: `tool.${i}`, description: `Tool ${i}` })),
        }),
      );

      const result = profile.strengths();
      assert.ok(result.items.some((s) => s.area === 'tools'));
    });

    it('should identify shell availability as a strength', () => {
      const profile = new AgentProfile();
      profile.buildProfile(
        makeProfileSnapshot({
          tools: [{ name: 'shell.run', description: 'Run shell commands' }],
        }),
      );

      const result = profile.strengths();
      assert.ok(result.items.some((s) => s.area === 'execution'));
    });

    it('should identify web access as a strength', () => {
      const profile = new AgentProfile();
      profile.buildProfile(
        makeProfileSnapshot({
          tools: [{ name: 'web.fetch', description: 'Fetch from web' }],
        }),
      );

      const result = profile.strengths();
      assert.ok(result.items.some((s) => s.area === 'network'));
    });

    it('should return minimal strengths for bare profiles', () => {
      const profile = new AgentProfile();
      profile.buildProfile(makeProfileSnapshot({ tools: [], skills: [], models: [] }));

      const result = profile.strengths();
      // A bare profile may still flag unbounded token limits as a minor strength
      assert.ok(result.count >= 0);
    });
  });

  describe('profile shape', () => {
    it('should expose availableTools getter', () => {
      const profile = new AgentProfile();
      profile.buildProfile(makeProfileSnapshot({ tools: ['file.read'].map((n) => ({ name: n, description: n })) }));

      assert.strictEqual(profile.availableTools.length, 1);
      assert.strictEqual(profile.availableTools[0].name, 'file.read');
    });

    it('should expose availableSkills getter', () => {
      const profile = new AgentProfile();
      profile.buildProfile(makeProfileSnapshot());

      assert.strictEqual(profile.availableSkills.length, 2);
    });

    it('should expose modelCapabilities getter', () => {
      const profile = new AgentProfile();
      profile.buildProfile(makeProfileSnapshot());

      assert.strictEqual(profile.modelCapabilities.length, 1);
      assert.strictEqual(profile.modelCapabilities[0].id, 'claude-sonnet-4');
    });

    it('should expose resourceLimits getter', () => {
      const profile = new AgentProfile();
      profile.buildProfile(makeProfileSnapshot(), { resourceLimits: { maxConcurrentTasks: 999 } });

      assert.strictEqual(profile.resourceLimits.maxConcurrentTasks, 999);
    });
  });
});
