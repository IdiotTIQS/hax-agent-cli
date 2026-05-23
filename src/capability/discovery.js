"use strict";

/**
 * CapabilityDiscovery — enumerates the full capability landscape of the agent:
 *   - registered tools
 *   - loaded skills
 *   - active plugins
 *   - available AI models
 *
 * Purpose: give agents a structured answer to "what can I do right now?"
 */

class CapabilityDiscovery {
  /**
   * Enumerate every tool registered in the ToolRegistry.
   *
   * @param {object} toolRegistry — ToolRegistry instance (must expose `.list()`)
   * @returns {object} structured tool catalog
   */
  discoverTools(toolRegistry) {
    if (!toolRegistry || typeof toolRegistry.list !== 'function') {
      return { count: 0, tools: [] };
    }

    const raw = toolRegistry.list();
    if (!Array.isArray(raw)) {
      return { count: 0, tools: [] };
    }

    const tools = raw.map((tool) => ({
      name: tool.name,
      description: tool.description || '',
      schema: tool.inputSchema || null,
    }));

    return {
      count: tools.length,
      tools,
    };
  }

  /**
   * Enumerate every loaded skill.
   *
   * @param {object} skillRegistry — an object with a `list()` method, or a plain array of skill descriptors
   * @returns {object} structured skill catalog
   */
  discoverSkills(skillRegistry) {
    const skills = [];
    let seen = new Set();

    const raw = this._resolveSkillList(skillRegistry);

    for (const entry of raw) {
      const name = entry.name || entry.displayName || entry.agentType || '';
      if (!name || seen.has(name)) continue;
      seen.add(name);

      skills.push({
        name,
        displayName: entry.displayName || name,
        description: entry.description || entry.role || entry.whenToUse || '',
        source: entry.source || 'unknown',
        allowedTools: Array.isArray(entry.allowedTools) ? [...entry.allowedTools] : [],
        argNames: entry.argNames ? [...entry.argNames] : [],
        userInvocable: entry.userInvocable !== false,
      });
    }

    return {
      count: skills.length,
      skills,
    };
  }

  /**
   * Enumerate active plugins from a PluginRegistry.
   *
   * @param {object} pluginRegistry — PluginRegistry instance (must expose `.list()`)
   * @returns {object} structured plugin catalog
   */
  discoverPlugins(pluginRegistry) {
    if (!pluginRegistry || typeof pluginRegistry.list !== 'function') {
      return { count: 0, plugins: [] };
    }

    const raw = pluginRegistry.list();
    if (!Array.isArray(raw)) {
      return { count: 0, plugins: [] };
    }

    const plugins = raw.map((p) => ({
      name: p.name,
      version: p.version || '0.0.0',
      hooks: Array.isArray(p.hooks) ? [...p.hooks] : [],
      hookCount: Array.isArray(p.hooks) ? p.hooks.length : 0,
    }));

    return {
      count: plugins.length,
      plugins,
    };
  }

  /**
   * Enumerate available AI models from a provider instance.
   *
   * Providers may expose:
   *   - `listModels()` returning [{ id, name, ... }]
   *   - `models` property (object map)
   *   - `model` / `name` fallback for single-model providers
   *
   * @param {object} provider — provider instance
   * @returns {object} structured model catalog
   */
  discoverModels(provider) {
    const models = [];
    const seen = new Set();

    if (!provider) {
      return { count: 0, models: [] };
    }

    // Prefer explicit listModels()
    if (typeof provider.listModels === 'function') {
      const list = provider.listModels();
      if (Array.isArray(list)) {
        for (const m of list) {
          const id = m.id || m.name || '';
          if (!id || seen.has(id)) continue;
          seen.add(id);
          models.push({
            id,
            name: m.name || id,
            provider: provider.name || 'unknown',
            supportsStreaming: m.supportsStreaming !== false,
            supportsTools: m.supportsTools !== false,
            supportsImages: m.supportsImages || false,
            maxTokens: m.maxTokens || null,
          });
        }
      }
    }

    // Fall back to a static models map property
    if (models.length === 0 && provider.models && typeof provider.models === 'object') {
      for (const [id, info] of Object.entries(provider.models)) {
        if (!id || seen.has(id)) continue;
        seen.add(id);
        models.push({
          id,
          name: (info && info.name) || id,
          provider: provider.name || 'unknown',
          supportsStreaming: info && info.supportsStreaming !== false,
          supportsTools: info && info.supportsTools !== false,
          supportsImages: !!(info && info.supportsImages),
          maxTokens: (info && info.maxTokens) || null,
        });
      }
    }

    // Single-model fallback
    if (models.length === 0) {
      const id = provider.model || provider.name || 'default';
      if (id && !seen.has(id)) {
        models.push({
          id,
          name: id,
          provider: provider.name || 'unknown',
          supportsStreaming: true,
          supportsTools: true,
          supportsImages: false,
          maxTokens: provider.maxTokens || null,
        });
      }
    }

    return {
      count: models.length,
      models,
    };
  }

  /**
   * Full capability inventory — combines all four discovery methods.
   *
   * @param {object} opts — { toolRegistry, skillRegistry, pluginRegistry, provider }
   * @returns {object} complete capability catalog
   */
  discoverAll(opts = {}) {
    const { toolRegistry, skillRegistry, pluginRegistry, provider } = opts;

    const tools = this.discoverTools(toolRegistry);
    const skills = this.discoverSkills(skillRegistry);
    const plugins = this.discoverPlugins(pluginRegistry);
    const models = this.discoverModels(provider);

    const totalCapabilities = tools.count + skills.count + plugins.count + models.count;

    return {
      timestamp: new Date().toISOString(),
      totalCapabilities,
      tools,
      skills,
      plugins,
      models,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Normalise the skillRegistry input — it may be:
   *   - an object with a `.list()` method
   *   - a plain array
   *   - null/undefined
   */
  _resolveSkillList(skillRegistry) {
    if (!skillRegistry) return [];
    if (Array.isArray(skillRegistry)) return skillRegistry;
    if (typeof skillRegistry.list === 'function') {
      const list = skillRegistry.list();
      return Array.isArray(list) ? list : [];
    }
    if (typeof skillRegistry.skills === 'object' && skillRegistry.skills !== null) {
      const map = skillRegistry.skills;
      if (Array.isArray(map)) return map;
      return Object.values(map);
    }
    return [];
  }
}

module.exports = { CapabilityDiscovery };
