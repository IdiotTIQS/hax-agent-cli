"use strict";

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { CapabilityDiscovery } = require('../../src/capability/discovery');
const { ToolRegistry } = require('../../src/tools/registry');
const { PluginRegistry } = require('../../src/plugins');

function createMockTool(name, description, execute) {
  return {
    name,
    description: description || `Tool: ${name}`,
    inputSchema: { type: 'object', properties: {} },
    execute: execute || (() => ({ ok: true })),
  };
}

function createMockSkill(name, description) {
  return { name, description, source: 'mock', allowedTools: [], argNames: [], userInvocable: true };
}

function createMockPlugin(name, hooks) {
  return { name, version: '1.0.0', hooks: hooks || {} };
}

describe('CapabilityDiscovery', () => {
  describe('discoverTools', () => {
    it('should return empty catalog when no registry is provided', () => {
      const cd = new CapabilityDiscovery();
      const result = cd.discoverTools(null);
      assert.strictEqual(result.count, 0);
      assert.deepStrictEqual(result.tools, []);
    });

    it('should return empty catalog when registry has no list method', () => {
      const cd = new CapabilityDiscovery();
      const result = cd.discoverTools({});
      assert.strictEqual(result.count, 0);
    });

    it('should enumerate all tools from a populated registry', () => {
      const registry = new ToolRegistry();
      registry.register(createMockTool('file.read', 'Read files'));
      registry.register(createMockTool('file.write', 'Write files'));
      registry.register(createMockTool('shell.run', 'Execute shell commands'));

      const cd = new CapabilityDiscovery();
      const result = cd.discoverTools(registry);

      assert.strictEqual(result.count, 3);
      assert.strictEqual(result.tools.length, 3);
      assert.strictEqual(result.tools[0].name, 'file.read');
      assert.strictEqual(result.tools[1].name, 'file.write');
      assert.strictEqual(result.tools[2].name, 'shell.run');
    });

    it('should include tool descriptions and schemas', () => {
      const registry = new ToolRegistry();
      registry.register({
        name: 'web.fetch',
        description: 'Fetch web content',
        inputSchema: { type: 'object', properties: { url: { type: 'string' } } },
        execute: () => ({}),
      });

      const cd = new CapabilityDiscovery();
      const result = cd.discoverTools(registry);

      assert.strictEqual(result.tools[0].description, 'Fetch web content');
      assert.deepStrictEqual(result.tools[0].schema, {
        type: 'object',
        properties: { url: { type: 'string' } },
      });
    });

    it('should return empty tools array when registry list returns non-array', () => {
      const cd = new CapabilityDiscovery();
      const result = cd.discoverTools({ list: () => null });
      assert.strictEqual(result.count, 0);
      assert.deepStrictEqual(result.tools, []);
    });
  });

  describe('discoverSkills', () => {
    it('should return empty catalog for null/undefined', () => {
      const cd = new CapabilityDiscovery();
      const result = cd.discoverSkills(null);
      assert.strictEqual(result.count, 0);
      assert.deepStrictEqual(result.skills, []);
    });

    it('should discover skills from a plain array', () => {
      const cd = new CapabilityDiscovery();
      const skills = [
        createMockSkill('code-review', 'Reviews code'),
        createMockSkill('deployment', 'Handles deployment'),
      ];
      const result = cd.discoverSkills(skills);

      assert.strictEqual(result.count, 2);
      assert.strictEqual(result.skills[0].name, 'code-review');
      assert.strictEqual(result.skills[0].description, 'Reviews code');
      assert.strictEqual(result.skills[1].name, 'deployment');
    });

    it('should discover skills from an object with a list() method', () => {
      const cd = new CapabilityDiscovery();
      const registry = {
        list: () => [{ name: 'test-skill', description: 'A test skill' }],
      };
      const result = cd.discoverSkills(registry);

      assert.strictEqual(result.count, 1);
      assert.strictEqual(result.skills[0].name, 'test-skill');
    });

    it('should discover skills from an object with a .skills property', () => {
      const cd = new CapabilityDiscovery();
      const registry = {
        skills: {
          review: { name: 'review', description: 'Review code' },
          test: { name: 'test', description: 'Run tests' },
        },
      };
      const result = cd.discoverSkills(registry);

      assert.strictEqual(result.count, 2);
    });

    it('should deduplicate skills by name', () => {
      const cd = new CapabilityDiscovery();
      const skills = [
        createMockSkill('dupe', 'First'),
        createMockSkill('dupe', 'Second'),
        createMockSkill('unique', 'Only one'),
      ];
      const result = cd.discoverSkills(skills);

      assert.strictEqual(result.count, 2);
    });

    it('should include allowedTools and argNames in the catalog', () => {
      const cd = new CapabilityDiscovery();
      const skills = [{
        name: 'complex-skill',
        description: 'Complex',
        allowedTools: ['file.read', 'file.write'],
        argNames: ['input', 'output'],
        userInvocable: false,
      }];
      const result = cd.discoverSkills(skills);

      assert.strictEqual(result.skills[0].allowedTools.length, 2);
      assert.deepStrictEqual(result.skills[0].allowedTools, ['file.read', 'file.write']);
      assert.strictEqual(result.skills[0].argNames.length, 2);
      assert.strictEqual(result.skills[0].userInvocable, false);
    });
  });

  describe('discoverPlugins', () => {
    it('should return empty catalog for null/undefined', () => {
      const cd = new CapabilityDiscovery();
      const result = cd.discoverPlugins(null);
      assert.strictEqual(result.count, 0);
      assert.deepStrictEqual(result.plugins, []);
    });

    it('should enumerate registered plugins with their hooks', () => {
      const registry = new PluginRegistry();
      registry.register(createMockPlugin('logger', { beforeToolCall: () => {}, afterToolCall: () => {} }));
      registry.register(createMockPlugin('security-check', { beforeToolCall: () => {} }));

      const cd = new CapabilityDiscovery();
      const result = cd.discoverPlugins(registry);

      assert.strictEqual(result.count, 2);
      assert.strictEqual(result.plugins[0].name, 'logger');
      assert.strictEqual(result.plugins[0].hookCount, 2);
      assert.strictEqual(result.plugins[1].name, 'security-check');
      assert.strictEqual(result.plugins[1].hookCount, 1);
    });

    it('should include version and hook names', () => {
      const registry = new PluginRegistry();
      registry.register(createMockPlugin('test-plugin', { beforeChat: () => {} }));

      const cd = new CapabilityDiscovery();
      const result = cd.discoverPlugins(registry);

      assert.strictEqual(result.plugins[0].version, '1.0.0');
      assert.deepStrictEqual(result.plugins[0].hooks, ['beforeChat']);
    });
  });

  describe('discoverModels', () => {
    it('should return empty catalog for null/undefined', () => {
      const cd = new CapabilityDiscovery();
      const result = cd.discoverModels(null);
      assert.strictEqual(result.count, 0);
      assert.deepStrictEqual(result.models, []);
    });

    it('should discover models via listModels() method', () => {
      const cd = new CapabilityDiscovery();
      const provider = {
        name: 'anthropic',
        listModels: () => [
          { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
          { id: 'claude-haiku-4-20250514', name: 'Claude Haiku 4' },
        ],
      };
      const result = cd.discoverModels(provider);

      assert.strictEqual(result.count, 2);
      assert.strictEqual(result.models[0].id, 'claude-sonnet-4-20250514');
      assert.strictEqual(result.models[0].provider, 'anthropic');
    });

    it('should discover models from a static .models map', () => {
      const cd = new CapabilityDiscovery();
      const provider = {
        name: 'openai',
        models: {
          'gpt-4o': { name: 'GPT-4o', supportsStreaming: true, supportsTools: true },
          'gpt-4o-mini': { name: 'GPT-4o mini', supportsStreaming: true, supportsTools: true },
        },
      };
      const result = cd.discoverModels(provider);

      assert.strictEqual(result.count, 2);
    });

    it('should fall back to a single model from provider.model', () => {
      const cd = new CapabilityDiscovery();
      const provider = {
        name: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        maxTokens: 200000,
      };
      const result = cd.discoverModels(provider);

      assert.strictEqual(result.count, 1);
      assert.strictEqual(result.models[0].id, 'claude-sonnet-4-20250514');
      assert.strictEqual(result.models[0].maxTokens, 200000);
    });

    it('should include capability flags in model entries', () => {
      const cd = new CapabilityDiscovery();
      const provider = {
        listModels: () => [
          { id: 'vision-model', supportsImages: true, supportsStreaming: false },
        ],
      };
      const result = cd.discoverModels(provider);

      assert.strictEqual(result.models[0].supportsImages, true);
      assert.strictEqual(result.models[0].supportsStreaming, false);
      assert.strictEqual(result.models[0].supportsTools, true); // default
    });
  });

  describe('discoverAll', () => {
    it('should combine all four discovery results into one catalog', () => {
      const registry = new ToolRegistry();
      registry.register(createMockTool('file.read', 'Read files'));

      const pluginReg = new PluginRegistry();
      pluginReg.register(createMockPlugin('test-plugin'));

      const cd = new CapabilityDiscovery();
      const result = cd.discoverAll({
        toolRegistry: registry,
        skillRegistry: [createMockSkill('review', 'Review')],
        pluginRegistry: pluginReg,
        provider: { model: 'test-model' },
      });

      assert.ok(typeof result.timestamp === 'string');
      assert.strictEqual(result.tools.count, 1);
      assert.strictEqual(result.skills.count, 1);
      assert.strictEqual(result.plugins.count, 1);
      assert.strictEqual(result.models.count, 1);
      assert.strictEqual(result.totalCapabilities, 4);
    });

    it('should handle all options being null/undefined', () => {
      const cd = new CapabilityDiscovery();
      const result = cd.discoverAll({});
      assert.strictEqual(result.totalCapabilities, 0);
      assert.strictEqual(result.tools.count, 0);
      assert.strictEqual(result.skills.count, 0);
      assert.strictEqual(result.plugins.count, 0);
      assert.strictEqual(result.models.count, 0);
    });
  });
});
