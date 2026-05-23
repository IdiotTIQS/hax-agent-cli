"use strict";

/**
 * ReflectionEngine — meta-cognitive layer that lets the agent reason about
 * its own capabilities, assess fitness for tasks, identify gaps, and plan
 * growth.
 *
 * Consumes the CapabilityDiscovery catalog and the AgentProfile snapshot.
 */

const WELL_KNOWN_PLUGINS = Object.freeze([
  { name: 'security-auditor', description: 'Adds automated security checks to tool calls', area: 'security' },
  { name: 'performance-profiler', description: 'Measures and reports tool-call latency', area: 'observability' },
  { name: 'session-recorder', description: 'Persists session transcripts for later review', area: 'history' },
  { name: 'rate-limiter', description: 'Enforces rate limits on API-billed operations', area: 'safety' },
  { name: 'context-compactor', description: 'Automatically compacts context to stay within token budgets', area: 'memory' },
]);

const WELL_KNOWN_SKILLS = Object.freeze([
  { name: 'code-review', description: 'Reviews code for regressions and correctness', area: 'quality' },
  { name: 'security-review', description: 'Audits trust boundaries and secret handling', area: 'security' },
  { name: 'deployment', description: 'Packages and ships the application', area: 'devops' },
  { name: 'database-migration', description: 'Manages database schema migrations', area: 'data' },
  { name: 'api-documentation', description: 'Generates OpenAPI / API reference docs', area: 'docs' },
  { name: 'test-generator', description: 'Auto-generates test suites from source files', area: 'quality' },
  { name: 'dependency-auditor', description: 'Checks dependencies for known vulnerabilities', area: 'security' },
  { name: 'localization', description: 'Manages i18n / translation workflows', area: 'i18n' },
]);

const TASK_CATEGORY_KW = Object.freeze({
  'file-io': ['read', 'write', 'file', 'save', 'open', 'edit', 'delete', 'create'],
  execution: ['run', 'execute', 'shell', 'bash', 'cmd', 'command', 'script'],
  search: ['search', 'find', 'grep', 'locate', 'query', 'lookup'],
  web: ['web', 'http', 'fetch', 'download', 'api', 'internet', 'online'],
  code: ['code', 'programming', 'function', 'class', 'module', 'import', 'refactor'],
  testing: ['test', 'verify', 'validate', 'assert', 'coverage', 'mock'],
  documentation: ['doc', 'docs', 'documentation', 'readme', 'comment', 'explain'],
  security: ['security', 'vulnerability', 'auth', 'secret', 'permission', 'injection'],
  deployment: ['deploy', 'release', 'publish', 'ci', 'cd', 'pipeline'],
});

class ReflectionEngine {
  /**
   * @param {object} profile — an AgentProfile instance (or a plain profile snapshot)
   * @param {object} [options]
   */
  constructor(profile, options = {}) {
    this.profile = this._normaliseProfile(profile);
    this.options = options;
  }

  // -----------------------------------------------------------------------
  // Core introspection
  // -----------------------------------------------------------------------

  /**
   * Agent examines its own capabilities and returns a self-awareness summary.
   *
   * @returns {object} introspection result
   */
  introspect() {
    const tools = this._tools();
    const skills = this._skills();
    const plugins = this._plugins();
    const models = this._models();

    const toolCategories = this._categoriseTools(tools);
    const skillAreas = this._skillAreas(skills);

    return {
      identity: {
        toolCount: tools.length,
        skillCount: skills.length,
        pluginCount: plugins.length,
        modelCount: models.length,
        permissionLevel: this.profile.permissionLevel || 'standard',
      },
      capabilities: {
        canReadFiles: tools.some((t) => String(t.name || '').includes('read')),
        canWriteFiles: tools.some((t) => String(t.name || '').includes('write')),
        canExecuteCommands: tools.some((t) => String(t.name || '').includes('shell')),
        canSearch: tools.some((t) => String(t.name || '').includes('search')),
        canAccessWeb: tools.some((t) => String(t.name || '').includes('web')),
        canGlob: tools.some((t) => String(t.name || '').includes('glob')),
      },
      toolCategories,
      skillAreas,
      resourceLimits: this.profile.resourceLimits || {},
      summary: this._buildSummary(tools, skills, models),
    };
  }

  /**
   * Suggest capability improvements based on current profile gaps.
   *
   * @returns {object} improvement suggestions
   */
  suggestImprovements() {
    const tools = this._tools();
    const skills = this._skills();
    const plugins = this._plugins();
    const models = this._models();
    const suggestions = [];

    // Tool gaps
    if (!tools.some((t) => String(t.name || '').includes('shell'))) {
      suggestions.push({
        priority: 'high',
        type: 'tool',
        name: 'shell.run',
        reason: 'Shell execution is fundamental for running commands, tests, and scripts.',
      });
    }

    if (!tools.some((t) => String(t.name || '').includes('search'))) {
      suggestions.push({
        priority: 'high',
        type: 'tool',
        name: 'file.search',
        reason: 'Content search is essential for investigating large codebases.',
      });
    }

    if (!tools.some((t) => String(t.name || '').includes('web'))) {
      suggestions.push({
        priority: 'medium',
        type: 'tool',
        name: 'web.fetch',
        reason: 'Web fetch enables accessing external documentation and APIs.',
      });
    }

    // Plugin gaps
    const existingPluginNames = new Set(plugins.map((p) => p.name));
    for (const wp of WELL_KNOWN_PLUGINS) {
      if (!existingPluginNames.has(wp.name)) {
        suggestions.push({
          priority: 'medium',
          type: 'plugin',
          name: wp.name,
          reason: wp.description,
        });
      }
    }

    // Skill gaps
    const existingSkillNames = new Set(skills.map((s) => s.name));
    for (const ws of WELL_KNOWN_SKILLS) {
      if (!existingSkillNames.has(ws.name)) {
        suggestions.push({
          priority: 'low',
          type: 'skill',
          name: ws.name,
          reason: ws.description,
        });
      }
    }

    // Model gaps
    if (models.length === 0) {
      suggestions.push({
        priority: 'critical',
        type: 'model',
        name: 'claude-sonnet-4-20250514',
        reason: 'No AI model is available — the agent cannot reason.',
      });
    } else if (models.length === 1) {
      suggestions.push({
        priority: 'low',
        type: 'model',
        name: 'Secondary fallback model',
        reason: 'Only one model available — no fallback if it is unavailable.',
      });
    }

    const order = { critical: 0, high: 1, medium: 2, low: 3 };

    return {
      count: suggestions.length,
      suggestions: suggestions.sort((a, b) => {
        const aVal = a.priority in order ? order[a.priority] : 99;
        const bVal = b.priority in order ? order[b.priority] : 99;
        return aVal - bVal;
      }),
    };
  }

  /**
   * Assess how well the agent's capabilities fit a given task.
   *
   * @param {string} task — natural-language task description
   * @returns {object} { score: 0-100, reasoning: string, matchedCategories: string[], missingCategories: string[] }
   */
  evaluateFitness(task) {
    const norm = String(task || '').trim().toLowerCase();
    if (!norm) {
      return { score: 0, reasoning: 'No task specified.', matchedCategories: [], missingCategories: [] };
    }

    const relevantCategories = this._detectTaskCategories(norm);
    const tools = this._tools();
    const matched = [];
    const missing = [];

    const weights = { 'file-io': 25, execution: 25, search: 20, web: 15, code: 10, testing: 10, documentation: 5, security: 15, deployment: 15 };
    let totalWeight = 0;
    let matchedWeight = 0;

    for (const cat of relevantCategories) {
      const weight = weights[cat] || 10;
      totalWeight += weight;

      const satisfies = this._categorySatisfied(cat, tools);
      if (satisfies) {
        matched.push(cat);
        matchedWeight += weight;
      } else {
        missing.push(cat);
      }
    }

    // If no categories detected, do a generic capability check
    if (totalWeight === 0) {
      const score = tools.length > 0 ? 70 : 10;
      if (tools.length === 0) {
        missing.push('general');
      }
      return {
        score: Math.max(0, Math.min(100, score)),
        reasoning: `No specific task categories detected. ${tools.length} tool(s) available.`,
        matchedCategories: tools.length > 0 ? ['general'] : [],
        missingCategories: missing,
      };
    }

    // Score is the weighted percentage of satisfied categories
    const score = Math.round((matchedWeight / totalWeight) * 100);

    const reasoning = matched.length === relevantCategories.length
      ? `All ${matched.length} required categories are covered.`
      : `${matched.length}/${relevantCategories.length} required categories covered. Missing: ${missing.join(', ')}.`;

    return {
      score,
      reasoning,
      matchedCategories: matched,
      missingCategories: missing,
    };
  }

  /**
   * Identify specific missing capabilities for a task.
   *
   * @param {string} task — natural-language task description
   * @returns {object} gaps report
   */
  identifyGaps(task) {
    const fitness = this.evaluateFitness(task);
    const gaps = [];
    const tools = this._tools();
    const skills = this._skills();

    for (const cat of fitness.missingCategories) {
      const recommendations = this._recommendForCategory(cat, tools, skills);
      gaps.push({ category: cat, recommendations });
    }

    return {
      fitnessScore: fitness.score,
      totalGaps: gaps.length,
      gaps,
    };
  }

  /**
   * Suggest plugins and skills to acquire to close known gaps.
   *
   * @returns {object} growth plan
   */
  planCapabilityGrowth() {
    const suggestions = this.suggestImprovements();

    const highPriority = suggestions.suggestions.filter((s) => s.priority === 'critical' || s.priority === 'high');
    const mediumPriority = suggestions.suggestions.filter((s) => s.priority === 'medium');
    const lowPriority = suggestions.suggestions.filter((s) => s.priority === 'low');

    return {
      summary: `${suggestions.count} suggestions — ${highPriority.length} high, ${mediumPriority.length} medium, ${lowPriority.length} low.`,
      phases: [
        { phase: 1, label: 'Immediate (critical/high)', items: highPriority },
        { phase: 2, label: 'Near-term (medium)', items: mediumPriority },
        { phase: 3, label: 'Future (low)', items: lowPriority },
      ],
    };
  }

  /**
   * Generate a human-readable capability report.
   *
   * @returns {string} multi-line report
   */
  generateCapabilityReport() {
    const intro = this.introspect();
    const lines = [];

    lines.push('=== Agent Capability Report ===');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');
    lines.push('-- Identity --');
    lines.push(`  Tools:        ${intro.identity.toolCount}`);
    lines.push(`  Skills:       ${intro.identity.skillCount}`);
    lines.push(`  Plugins:      ${intro.identity.pluginCount}`);
    lines.push(`  Models:       ${intro.identity.modelCount}`);
    lines.push(`  Permissions:  ${intro.identity.permissionLevel}`);
    lines.push('');
    lines.push('-- Core Capabilities --');
    for (const [key, value] of Object.entries(intro.capabilities)) {
      lines.push(`  ${key}: ${value ? 'YES' : 'NO'}`);
    }
    lines.push('');
    lines.push('-- Tool Categories --');
    for (const [cat, count] of Object.entries(intro.toolCategories)) {
      lines.push(`  ${cat}: ${count} tool(s)`);
    }
    lines.push('');
    lines.push('-- Skill Areas --');
    if (intro.skillAreas.length === 0) {
      lines.push('  (none)');
    } else {
      for (const area of intro.skillAreas) {
        lines.push(`  ${area}`);
      }
    }
    lines.push('');
    lines.push('-- Resource Limits --');
    const rl = intro.resourceLimits;
    lines.push(`  maxConcurrentTasks: ${rl.maxConcurrentTasks ?? 'unlimited'}`);
    lines.push(`  maxTokensPerCall:   ${rl.maxTokensPerCall ?? 'unlimited'}`);
    lines.push(`  timeoutMs:          ${rl.timeoutMs ?? 'unlimited'}`);
    lines.push('');
    lines.push('-- Summary --');
    lines.push(`  ${intro.summary}`);
    lines.push('');
    lines.push('=== End of Report ===');

    return lines.join('\n');
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  _normaliseProfile(profile) {
    if (!profile) {
      return { tools: [], skills: [], plugins: [], models: [], permissionLevel: 'standard', resourceLimits: {} };
    }

    // If it's an AgentProfile instance, extract its snapshot, then re-normalise
    if (typeof profile._snapshot === 'function') {
      return this._normaliseProfile(profile._snapshot());
    }

    return {
      tools: profile.availableTools || profile.tools || [],
      skills: profile.availableSkills || profile.skills || [],
      plugins: profile.plugins || [],
      models: profile.modelCapabilities || profile.models || [],
      permissionLevel: profile.permissionLevel || 'standard',
      resourceLimits: profile.resourceLimits || {},
    };
  }

  _tools() { return this.profile.tools || []; }
  _skills() { return this.profile.skills || []; }
  _plugins() { return this.profile.plugins || []; }
  _models() { return this.profile.models || []; }

  _detectTaskCategories(task) {
    const norm = task.toLowerCase();
    const categories = [];

    for (const [cat, keywords] of Object.entries(TASK_CATEGORY_KW)) {
      if (keywords.some((kw) => norm.includes(kw))) {
        categories.push(cat);
      }
    }

    return categories;
  }

  _categorySatisfied(category, tools) {
    const toolNames = tools.map((t) => String(t.name || '').toLowerCase());

    switch (category) {
      case 'file-io':
        return toolNames.some((n) => n.includes('read') || n.includes('write') || n.includes('edit') || n.includes('delete'));
      case 'execution':
        return toolNames.some((n) => n.includes('shell'));
      case 'search':
        return toolNames.some((n) => n.includes('search') || n.includes('glob'));
      case 'web':
        return toolNames.some((n) => n.includes('web'));
      case 'code':
        return toolNames.some((n) => n.includes('read') || n.includes('write') || n.includes('edit'));
      case 'testing':
        return toolNames.some((n) => n.includes('shell'));
      case 'documentation':
        return toolNames.some((n) => n.includes('read') || n.includes('write'));
      case 'security':
        return toolNames.some((n) => n.includes('read') || n.includes('search'));
      case 'deployment':
        return toolNames.some((n) => n.includes('shell'));
      default:
        return tools.length > 0;
    }
  }

  _recommendForCategory(category, tools, skills) {
    const recs = [];

    switch (category) {
      case 'file-io':
        recs.push('Register file.read, file.write, file.edit, and file.delete tools.');
        break;
      case 'execution':
        recs.push('Register the shell.run tool for command execution.');
        break;
      case 'search':
        recs.push('Register file.search and/or file.glob for content and path search.');
        break;
      case 'web':
        recs.push('Register web.fetch and/or web.search for network access.');
        break;
      case 'code':
        recs.push('Ensure file I/O tools are registered for reading and modifying code.');
        break;
      case 'testing':
        recs.push('Use shell.run combined with file.read to run and inspect test suites.');
        break;
      case 'documentation':
        recs.push('Use file.read/write tools to produce documentation artifacts.');
        break;
      case 'security':
        recs.push('Add a security-review skill for automated vulnerability scanning.');
        break;
      case 'deployment':
        recs.push('Add shell.run and possibly a deployment skill.');
        break;
      default:
        recs.push('Register basic file.read and file.search tools to start.');
    }

    return recs;
  }

  _categoriseTools(tools) {
    const cats = { 'file-io': 0, execution: 0, search: 0, web: 0, other: 0 };

    for (const tool of tools) {
      const name = String(tool.name || '').toLowerCase();
      if (name.includes('file') && (name.includes('read') || name.includes('write') || name.includes('edit') || name.includes('delete'))) {
        cats['file-io'] += 1;
      } else if (name.includes('shell')) {
        cats.execution += 1;
      } else if (name.includes('search') || name.includes('glob')) {
        cats.search += 1;
      } else if (name.includes('web')) {
        cats.web += 1;
      } else {
        cats.other += 1;
      }
    }

    // Remove zero-count categories
    for (const [key, val] of Object.entries(cats)) {
      if (val === 0) delete cats[key];
    }

    return cats;
  }

  _skillAreas(skills) {
    const areas = new Set();
    for (const skill of skills) {
      const name = String(skill.name || '').toLowerCase();
      if (name.includes('review') || name.includes('audit')) areas.add('review');
      if (name.includes('test') || name.includes('validate')) areas.add('testing');
      if (name.includes('doc') || name.includes('write')) areas.add('documentation');
      if (name.includes('deploy') || name.includes('release')) areas.add('deployment');
      if (name.includes('security') || name.includes('vulnerability')) areas.add('security');
      if (name.includes('data') || name.includes('migration') || name.includes('db')) areas.add('data');
      if (name.includes('i18n') || name.includes('local') || name.includes('translate')) areas.add('i18n');
    }
    return areas.size > 0 ? [...areas].sort() : [];
  }

  _buildSummary(tools, skills, models) {
    const parts = [];

    if (tools.length > 0) {
      parts.push(`${tools.length} tool(s) available`);
    } else {
      parts.push('no tools available');
    }

    if (skills.length > 0) {
      parts.push(`${skills.length} skill(s) loaded`);
    } else {
      parts.push('no skills loaded');
    }

    if (models.length > 0) {
      parts.push(`powered by ${models.length} model(s)`);
    } else {
      parts.push('no AI model configured');
    }

    const pLevel = this.profile.permissionLevel || 'standard';
    parts.push(`permission level: ${pLevel}`);

    return parts.join(', ') + '.';
  }
}

module.exports = { ReflectionEngine, WELL_KNOWN_PLUGINS, WELL_KNOWN_SKILLS, TASK_CATEGORY_KW };
