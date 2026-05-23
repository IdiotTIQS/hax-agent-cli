"use strict";

/**
 * AgentProfile — builds a machine-readable capability profile from a
 * CapabilityDiscovery catalog and provides high-level introspection:
 *   - canPerform(action)       — yes/no/pass-through to tool/skill lookup
 *   - bestToolFor(task)        — heuristic recommendation
 *   - limitations() / strengths()
 *
 * The profile shape:
 *   availableTools, availableSkills, modelCapabilities,
 *   resourceLimits, permissionLevel
 */

const TOOL_TASK_KEYWORDS = Object.freeze([
  { tools: ['file.read'], keywords: ['read', 'view', 'inspect', 'show', 'open', 'cat', 'preview'] },
  { tools: ['file.write'], keywords: ['write', 'save', 'create', 'output'] },
  { tools: ['file.glob'], keywords: ['find', 'glob', 'locate', 'discover', 'ls', 'list'] },
  { tools: ['file.search'], keywords: ['search', 'grep', 'scan', 'lookup', 'query'] },
  { tools: ['shell.run'], keywords: ['execute', 'run', 'shell', 'bash', 'cmd', 'terminal', 'command', 'exec'] },
  { tools: ['web.fetch'], keywords: ['fetch', 'http', 'download', 'get', 'curl', 'api', 'rest'] },
  { tools: ['web.search'], keywords: ['web', 'google', 'bing', 'internet', 'online'] },
  { tools: ['file.edit'], keywords: ['edit', 'modify', 'change', 'update', 'patch', 'replace'] },
  { tools: ['file.readDirectory'], keywords: ['dir', 'directory', 'folder', 'ls'] },
  { tools: ['file.delete'], keywords: ['delete', 'remove', 'rm', 'clean', 'trash'] },
  { tools: ['stock.quote'], keywords: ['stock', 'quote', 'price', 'ticker', 'market'] },
]);

const SKILL_TASK_KEYWORDS = Object.freeze([
  { skills: ['code-review'], keywords: ['review', 'audit', 'inspect', 'check'] },
  { skills: ['test'], keywords: ['test', 'verify', 'validate', 'assert'] },
  { skills: ['doc'], keywords: ['document', 'docs', 'documentation', 'readme'] },
  { skills: ['refactor'], keywords: ['refactor', 'restructure', 'cleanup', 'reorganize'] },
  { skills: ['deploy'], keywords: ['deploy', 'release', 'publish', 'ship'] },
]);

const DESTRUCTIVE_TOOLS = new Set(['file.delete', 'shell.run', 'file.write', 'file.edit']);

class AgentProfile {
  constructor() {
    this.tools = [];
    this.skills = [];
    this.plugins = [];
    this.models = [];
    this._permissionLevel = 'standard';
    this._resourceLimits = { maxConcurrentTasks: 4, maxTokensPerCall: null, timeoutMs: 120_000 };
  }

  /**
   * Build a profile from the discovery output (or an existing catalog).
   *
   * @param {object} discovery — result of CapabilityDiscovery#discoverAll()
   * @param {object} [options]
   * @param {string} [options.permissionLevel='standard'] — 'restricted' | 'standard' | 'elevated'
   * @param {object} [options.resourceLimits] — { maxConcurrentTasks, maxTokensPerCall, timeoutMs }
   */
  buildProfile(discovery, options = {}) {
    const catalog = discovery || {};

    this.tools = this._ensureArray(catalog.tools, 'tools');
    this.skills = this._ensureArray(catalog.skills, 'skills');
    this.plugins = this._ensureArray(catalog.plugins, 'plugins');
    this.models = this._ensureArray(catalog.models, 'models');

    this._permissionLevel = ['restricted', 'standard', 'elevated'].includes(options.permissionLevel)
      ? options.permissionLevel
      : 'standard';

    this._resourceLimits = {
      maxConcurrentTasks: Number.isSafeInteger(options.resourceLimits?.maxConcurrentTasks)
        ? options.resourceLimits.maxConcurrentTasks
        : 4,
      maxTokensPerCall: Number.isSafeInteger(options.resourceLimits?.maxTokensPerCall)
        ? options.resourceLimits.maxTokensPerCall
        : null,
      timeoutMs: Number.isSafeInteger(options.resourceLimits?.timeoutMs)
        ? options.resourceLimits.timeoutMs
        : 120_000,
    };

    return this._snapshot();
  }

  // -----------------------------------------------------------------------
  // Capability checks
  // -----------------------------------------------------------------------

  /**
   * Check whether the agent can perform a given action.
   *
   * Actions are matched by:
   *   1. Exact tool name
   *   2. Exact skill name
   *   3. Keyword match against tool descriptions
   *   4. Keyword match against skill descriptions
   *
   * @param {string} action — e.g. "file.read", "write file", "run shell"
   * @returns {object} { can: boolean, reason: string, matches: string[] }
   */
  canPerform(action) {
    const norm = String(action || '').trim().toLowerCase();
    if (!norm) {
      return { can: false, reason: 'No action specified', matches: [] };
    }

    // 1. Exact tool name match
    for (const tool of this.tools) {
      if (tool.name && tool.name.toLowerCase() === norm) {
        return { can: true, reason: `Tool "${tool.name}" is registered`, matches: [tool.name] };
      }
    }

    // 2. Exact skill name match
    for (const skill of this.skills) {
      if (skill.name && skill.name.toLowerCase() === norm) {
        return { can: true, reason: `Skill "${skill.name}" is loaded`, matches: [skill.name] };
      }
    }

    // 3. Keyword match against tool descriptions
    const toolMatches = [];
    for (const tool of this.tools) {
      const desc = String(tool.description || '').toLowerCase();
      const name = String(tool.name || '').toLowerCase();
      if (desc.includes(norm) || name.includes(norm)) {
        toolMatches.push(tool.name);
      }
    }

    if (toolMatches.length > 0) {
      return { can: true, reason: `Tools match "${action}"`, matches: toolMatches };
    }

    // 4. Keyword match against skill descriptions
    const skillMatches = [];
    for (const skill of this.skills) {
      const desc = String(skill.description || '').toLowerCase();
      const name = String(skill.name || '').toLowerCase();
      if (desc.includes(norm) || name.includes(norm)) {
        skillMatches.push(skill.name);
      }
    }

    if (skillMatches.length > 0) {
      return { can: true, reason: `Skills match "${action}"`, matches: skillMatches };
    }

    return { can: false, reason: `No tool or skill matches "${action}"`, matches: [] };
  }

  /**
   * Heuristic recommendation of the best tool for a task description.
   *
   * Scoring:
   *   +1 per keyword match in the task string against our known maps
   *   -1 if the tool is destructive and the task looks read-only
   *
   * @param {string} task — natural-language task description
   * @returns {object} { tool: string|null, confidence: number (0-1), alternatives: string[] }
   */
  bestToolFor(task) {
    const norm = String(task || '').trim().toLowerCase();
    if (!norm || this.tools.length === 0) {
      return { tool: null, confidence: 0, alternatives: [] };
    }

    const scored = [];

    for (const tool of this.tools) {
      let score = 0;
      const toolName = String(tool.name || '').toLowerCase();
      const toolDesc = String(tool.description || '').toLowerCase();

      // Direct name match (high signal)
      if (norm.includes(toolName) || toolName.includes(norm)) {
        score += 10;
      }

      // Description keyword overlap
      for (const word of norm.split(/\s+/)) {
        if (word.length > 1 && toolDesc.includes(word)) {
          score += 2;
        }
      }

      // Mapped keyword scoring
      for (const entry of TOOL_TASK_KEYWORDS) {
        if (entry.tools.includes(tool.name)) {
          for (const kw of entry.keywords) {
            if (norm.includes(kw)) {
              score += 1;
            }
          }
        }
      }

      // Penalise destructive tools for read-only tasks
      if (DESTRUCTIVE_TOOLS.has(tool.name)) {
        const readOnlyWords = ['read', 'view', 'inspect', 'show', 'preview', 'check', 'see', 'look'];
        const readOnlyScore = readOnlyWords.filter((w) => norm.includes(w)).length;
        if (readOnlyScore >= 2) {
          score -= 5;
        }
      }

      if (score > 0) {
        scored.push({ name: tool.name, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      return { tool: null, confidence: 0, alternatives: [] };
    }

    const maxScore = scored[0].score;
    const confidence = Math.min(1, maxScore / 10);

    return {
      tool: scored[0].name,
      confidence,
      alternatives: scored.slice(1).map((s) => s.name).slice(0, 3),
    };
  }

  // -----------------------------------------------------------------------
  // Introspection
  // -----------------------------------------------------------------------

  /**
   * Identify capability gaps / limitations.
   *
   * @returns {object} limitations report
   */
  limitations() {
    const gaps = [];

    if (this.tools.length === 0) {
      gaps.push({ severity: 'critical', area: 'tools', detail: 'No tools are registered — the agent cannot interact with the system.' });
    }

    if (this.models.length === 0) {
      gaps.push({ severity: 'critical', area: 'models', detail: 'No AI models available — no reasoning capability.' });
    }

    if (!this.tools.some((t) => String(t.name || '').includes('search') || String(t.description || '').includes('search'))) {
      gaps.push({ severity: 'medium', area: 'search', detail: 'No search tool is available. Cross-file investigation is limited.' });
    }

    if (!this.tools.some((t) => String(t.name || '').includes('shell') || String(t.description || '').includes('shell'))) {
      gaps.push({ severity: 'medium', area: 'execution', detail: 'No shell tool — cannot run external commands or scripts.' });
    }

    if (!this.tools.some((t) => String(t.name || '').includes('web'))) {
      gaps.push({ severity: 'low', area: 'network', detail: 'No web tools — cannot fetch or search external resources.' });
    }

    if (this.plugins.length === 0) {
      gaps.push({ severity: 'low', area: 'extensibility', detail: 'No plugins loaded — no custom lifecycle hooks.' });
    }

    if (this._permissionLevel === 'restricted') {
      gaps.push({ severity: 'medium', area: 'permissions', detail: 'Restricted permission level — destructive tools may be blocked.' });
    }

    const readonlyToolCount = this.tools.filter((t) => !DESTRUCTIVE_TOOLS.has(t.name)).length;
    if (readonlyToolCount === this.tools.length && this.tools.length > 0) {
      gaps.push({ severity: 'low', area: 'write-access', detail: 'All tools are read-only — the agent cannot make modifications.' });
    }

    return {
      hasCriticalGaps: gaps.some((g) => g.severity === 'critical'),
      count: gaps.length,
      gaps,
    };
  }

  /**
   * Identify capability strengths.
   *
   * @returns {object} strengths report
   */
  strengths() {
    const items = [];

    if (this.tools.length >= 8) {
      items.push({ area: 'tools', detail: `${this.tools.length} tools — broad system interaction surface.` });
    }

    if (this.skills.length >= 3) {
      items.push({ area: 'skills', detail: `${this.skills.length} specialised skills loaded for domain tasks.` });
    }

    if (this.plugins.length > 0) {
      items.push({ area: 'plugins', detail: `${this.plugins.length} plugins extend lifecycle hooks.` });
    }

    if (this.models.length > 1) {
      items.push({ area: 'models', detail: `${this.models.length} AI models available for fallback and routing.` });
    }

    if (this.tools.some((t) => String(t.name || '').includes('shell'))) {
      items.push({ area: 'execution', detail: 'Shell tool available — arbitrary command execution possible.' });
    }

    if (this.tools.some((t) => String(t.name || '').includes('web'))) {
      items.push({ area: 'network', detail: 'Web tools available — external resource access enabled.' });
    }

    if (this.tools.some((t) => String(t.name || '').includes('search'))) {
      items.push({ area: 'search', detail: 'Search tool available — codebase investigation supported.' });
    }

    if (this.tools.some((t) => String(t.name || '').includes('glob'))) {
      items.push({ area: 'navigation', detail: 'Glob tool available — filesystem exploration supported.' });
    }

    if (this._permissionLevel === 'elevated') {
      items.push({ area: 'permissions', detail: 'Elevated permissions — full system access.' });
    }

    if (this._resourceLimits.maxTokensPerCall === null) {
      items.push({ area: 'resources', detail: 'No strict token limit per call.' });
    }

    return {
      count: items.length,
      items,
    };
  }

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  get availableTools() {
    return [...this.tools];
  }

  get availableSkills() {
    return [...this.skills];
  }

  get modelCapabilities() {
    return [...this.models];
  }

  get resourceLimits() {
    return { ...this._resourceLimits };
  }

  get permissionLevel() {
    return this._permissionLevel;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  _ensureArray(catalogEntry, key) {
    if (!catalogEntry) return [];
    if (Array.isArray(catalogEntry[key] || catalogEntry)) return [...(catalogEntry[key] || catalogEntry)];
    if (Array.isArray(catalogEntry)) return [...catalogEntry];
    return [];
  }

  _snapshot() {
    return {
      availableTools: [...this.tools],
      availableSkills: [...this.skills],
      modelCapabilities: [...this.models],
      resourceLimits: { ...this._resourceLimits },
      permissionLevel: this._permissionLevel,
    };
  }
}

module.exports = { AgentProfile, TOOL_TASK_KEYWORDS, SKILL_TASK_KEYWORDS, DESTRUCTIVE_TOOLS };
