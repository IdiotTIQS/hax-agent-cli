'use strict';

const { requireString } = require('../runtime/utils');

// ---- Routing Strategies ----

const STRATEGY = Object.freeze({
  DIRECT: 'direct',
  BROADCAST: 'broadcast',
  ROLE_BASED: 'role_based',
  CAPABILITY_BASED: 'capability_based',
});

const STRATEGY_PRIORITY = Object.freeze([
  STRATEGY.DIRECT,
  STRATEGY.ROLE_BASED,
  STRATEGY.CAPABILITY_BASED,
  STRATEGY.BROADCAST,
]);

// ---- Agent descriptor (for routing purposes) ----

function normalizeAgent(agent) {
  if (!agent || typeof agent !== 'object') {
    throw new TypeError('agent must be a non-null object');
  }

  requireString(agent.name, 'agent.name');

  return {
    name: agent.name,
    role: agent.role || '',
    capabilities: Array.isArray(agent.capabilities) ? [...agent.capabilities] : [],
    status: agent.status || 'idle',
    metadata: agent.metadata && typeof agent.metadata === 'object' ? { ...agent.metadata } : {},
  };
}

// ---- Role-to-capability inference ----

const ROLE_CAPABILITY_HINTS = Object.freeze({
  architect: ['plan', 'design', 'architecture', 'boundaries'],
  reviewer: ['review', 'audit', 'inspect', 'quality'],
  'security-reviewer': ['security', 'auth', 'vulnerability', 'audit'],
  tester: ['test', 'verify', 'validate', 'lint'],
  'test-runner': ['test', 'verify', 'validate', 'lint', 'typecheck'],
  'docs-writer': ['document', 'write', 'readme', 'usage'],
  planner: ['plan', 'design', 'architecture', 'strategy'],
  implementer: ['implement', 'code', 'build', 'refactor'],
  explorer: ['explore', 'inspect', 'map', 'find', 'search'],
});

// ---- MessageRouter ----

class MessageRouter {
  constructor(options = {}) {
    this._agents = new Map();
    this._defaultStrategy = STRATEGY_PRIORITY.includes(options.defaultStrategy)
      ? options.defaultStrategy
      : STRATEGY.DIRECT;
    this._routeCounts = new Map();

    for (const strategy of STRATEGY_PRIORITY) {
      this._routeCounts.set(strategy, 0);
    }
  }

  /**
   * Register an agent for routing.
   *
   * @param {object} agent
   * @param {string} agent.name
   * @param {string} [agent.role]
   * @param {string[]} [agent.capabilities]
   * @param {string} [agent.status]
   */
  registerAgent(agent) {
    const normalized = normalizeAgent(agent);

    if (this._agents.has(normalized.name)) {
      throw new Error(`Duplicate agent: ${normalized.name}`);
    }

    this._agents.set(normalized.name, normalized);
    return { ...normalized };
  }

  /**
   * Remove an agent from the routing table.
   *
   * @param {string} agentName
   * @returns {boolean} Whether the agent was found and removed.
   */
  unregisterAgent(agentName) {
    requireString(agentName, 'agentName');
    return this._agents.delete(agentName);
  }

  /**
   * Determine the best recipient(s) for a message.
   *
   * Strategies tried in priority order:
   *   1. direct — message has explicit 'to' field
   *   2. role_based — match message intent to agent role
   *   3. capability_based — match message requirements to agent capabilities
   *   4. broadcast — send to all available agents
   *
   * @param {object} message
   * @param {string} [message.to] - Explicit recipient
   * @param {string} [message.intent] - Hint for role/capability matching
   * @param {string[]} [message.requiredCapabilities] - Required capabilities
   * @param {string} [message.preferredRole] - Preferred agent role
   * @param {object[]} [agents] - Optional override list of agents (uses registered agents if omitted)
   * @returns {object} Routing result.
   */
  route(message, agents) {
    if (!message || typeof message !== 'object') {
      throw new TypeError('message must be a non-null object');
    }

    const pool = this._resolveAgentPool(agents);

    if (pool.length === 0) {
      return { strategy: null, recipients: [], reason: 'no agents registered' };
    }

    // Strategy 1: Direct
    if (message.to) {
      const target = pool.find((agent) => agent.name === message.to);

      if (target) {
        this._incrementStrategy(STRATEGY.DIRECT);
        return {
          strategy: STRATEGY.DIRECT,
          recipients: [target.name],
          reason: `direct match: ${target.name}`,
        };
      }

      return {
        strategy: STRATEGY.DIRECT,
        recipients: [],
        reason: `direct target not found: ${message.to}`,
      };
    }

    // Strategy 2: Role-based
    if (message.preferredRole) {
      const matched = this._matchByRole(pool, message.preferredRole);

      if (matched.length > 0) {
        this._incrementStrategy(STRATEGY.ROLE_BASED);
        return {
          strategy: STRATEGY.ROLE_BASED,
          recipients: matched.map((agent) => agent.name),
          reason: `role match: ${message.preferredRole}`,
        };
      }
    }

    // Also try inferring role from intent
    if (message.intent) {
      const inferredRole = this._inferRoleFromIntent(message.intent);

      if (inferredRole) {
        const matched = this._matchByRole(pool, inferredRole);

        if (matched.length > 0) {
          this._incrementStrategy(STRATEGY.ROLE_BASED);
          return {
            strategy: STRATEGY.ROLE_BASED,
            recipients: matched.map((agent) => agent.name),
            reason: `inferred role from intent: ${inferredRole}`,
          };
        }
      }
    }

    // Strategy 3: Capability-based
    const requiredCaps = message.requiredCapabilities || [];

    if (requiredCaps.length > 0 || message.intent) {
      const searchCaps = requiredCaps.length > 0
        ? requiredCaps
        : this._inferCapabilitiesFromIntent(message.intent || '');

      if (searchCaps.length > 0) {
        const matched = this._matchByCapabilities(pool, searchCaps);

        if (matched.length > 0) {
          this._incrementStrategy(STRATEGY.CAPABILITY_BASED);
          return {
            strategy: STRATEGY.CAPABILITY_BASED,
            recipients: matched.map((agent) => agent.name),
            reason: `capability match: ${searchCaps.join(', ')}`,
          };
        }
      }
    }

    // Strategy 4: Broadcast fallback
    const availablePool = pool.filter((agent) => agent.status === 'idle');

    if (availablePool.length > 0) {
      this._incrementStrategy(STRATEGY.BROADCAST);
      return {
        strategy: STRATEGY.BROADCAST,
        recipients: availablePool.map((agent) => agent.name),
        reason: 'broadcast to all available agents',
      };
    }

    // Last resort: broadcast to all (even busy)
    this._incrementStrategy(STRATEGY.BROADCAST);
    return {
      strategy: STRATEGY.BROADCAST,
      recipients: pool.map((agent) => agent.name),
      reason: 'broadcast to all agents (none idle)',
    };
  }

  /**
   * Selectively broadcast a message to agents matching the filter.
   *
   * @param {object} message
   * @param {object[]} [agents] - Optional override list of agents.
   * @param {object} [filter]
   * @param {string} [filter.role] - Only agents with this role.
   * @param {string[]} [filter.capabilities] - Only agents with ALL these capabilities.
   * @param {string} [filter.status] - Only agents with this status.
   * @param {string[]} [filter.exclude] - Agent names to exclude.
   * @returns {object} Broadcast result.
   */
  broadcast(message, agents, filter) {
    if (!message || typeof message !== 'object') {
      throw new TypeError('message must be a non-null object');
    }

    const pool = this._resolveAgentPool(agents);
    const criteria = filter || {};
    const excludeSet = new Set(criteria.exclude || []);

    let recipients = pool.filter((agent) => !excludeSet.has(agent.name));

    if (criteria.role) {
      recipients = recipients.filter((agent) => agent.role === criteria.role);
    }

    if (criteria.status) {
      recipients = recipients.filter((agent) => agent.status === criteria.status);
    }

    if (Array.isArray(criteria.capabilities) && criteria.capabilities.length > 0) {
      recipients = recipients.filter((agent) =>
        criteria.capabilities.every((cap) => agent.capabilities.includes(cap))
      );
    }

    return {
      messageId: message.id || null,
      recipients: recipients.map((agent) => agent.name),
      excluded: [...excludeSet],
      totalAgents: pool.length,
      matchedCount: recipients.length,
    };
  }

  /**
   * Get the current routing table state.
   *
   * @returns {object}
   */
  getRoutingTable() {
    const agents = Array.from(this._agents.values()).map((agent) => ({
      ...agent,
    }));

    const counts = {};
    for (const [strategy, count] of this._routeCounts) {
      counts[strategy] = count;
    }

    return {
      agentCount: this._agents.size,
      agents,
      routeCounts: counts,
      defaultStrategy: this._defaultStrategy,
      totalRoutes: Array.from(this._routeCounts.values()).reduce((sum, v) => sum + v, 0),
    };
  }

  /**
   * Get all registered agent names.
   * @returns {string[]}
   */
  get agents() {
    return Array.from(this._agents.keys());
  }

  /**
   * Reset routing counters.
   */
  resetCounters() {
    for (const key of this._routeCounts.keys()) {
      this._routeCounts.set(key, 0);
    }
  }

  // ---- Internal ----

  _resolveAgentPool(agents) {
    if (Array.isArray(agents) && agents.length > 0) {
      return agents.map(normalizeAgent);
    }

    return Array.from(this._agents.values());
  }

  _matchByRole(pool, role) {
    const normalizedRole = role.toLowerCase().trim();

    // Exact match
    const exact = pool.filter(
      (agent) => agent.role.toLowerCase() === normalizedRole && agent.status === 'idle'
    );

    if (exact.length > 0) {
      return exact;
    }

    // Also check idle agents whose role contains the search
    return pool.filter(
      (agent) =>
        agent.role.toLowerCase().includes(normalizedRole) ||
        normalizedRole.includes(agent.role.toLowerCase())
    ).filter((agent) => agent.status === 'idle');
  }

  _matchByCapabilities(pool, requiredCaps) {
    const normalizedCaps = requiredCaps.map((cap) => cap.toLowerCase().trim());

    // Score each idle agent by how many required capabilities they have
    const scored = pool
      .filter((agent) => agent.status === 'idle')
      .map((agent) => {
        const expandedCaps = this._expandCapabilities(agent);
        const matchCount = normalizedCaps.filter((cap) =>
          expandedCaps.some((agentCap) => agentCap.includes(cap) || cap.includes(agentCap))
        ).length;

        return { agent, matchCount };
      })
      .filter((scored) => scored.matchCount > 0)
      .sort((a, b) => b.matchCount - a.matchCount);

    if (scored.length === 0) {
      return [];
    }

    // Return the top-scoring agent(s)
    const topScore = scored[0].matchCount;
    return scored
      .filter((scored) => scored.matchCount === topScore)
      .map((scored) => scored.agent);
  }

  _expandCapabilities(agent) {
    const caps = new Set(agent.capabilities.map((cap) => cap.toLowerCase()));

    // Add inferred capabilities from role
    const hints = ROLE_CAPABILITY_HINTS[agent.role];
    if (hints) {
      for (const hint of hints) {
        caps.add(hint);
      }
    }

    return Array.from(caps);
  }

  _inferRoleFromIntent(intent) {
    const text = String(intent || '').toLowerCase();

    if (/test|verify|lint|typecheck|build/.test(text)) return 'tester';
    if (/review|audit|risk|bug|inspect/.test(text)) return 'reviewer';
    if (/security|auth|token|permission|secret|vulnerab/.test(text)) return 'security-reviewer';
    if (/doc|readme|usage|write/.test(text)) return 'docs-writer';
    if (/plan|design|architecture|strategy/.test(text)) return 'planner';
    if (/explore|inspect|map|find|search/.test(text)) return 'explorer';
    if (/implement|code|build|refactor|create/.test(text)) return 'implementer';

    return null;
  }

  _inferCapabilitiesFromIntent(intent) {
    const text = String(intent || '').toLowerCase();
    const caps = [];

    if (/test|verify|lint|typecheck|build/.test(text)) caps.push('test', 'verify');
    if (/review|audit|inspect/.test(text)) caps.push('review', 'audit');
    if (/security|auth|vulnerab/.test(text)) caps.push('security', 'audit');
    if (/doc|readme|write/.test(text)) caps.push('document', 'write');
    if (/plan|design|architecture/.test(text)) caps.push('plan', 'design');
    if (/explore|map|find|search/.test(text)) caps.push('explore', 'search');
    if (/implement|code|build|refactor/.test(text)) caps.push('implement', 'code');

    return caps;
  }

  _incrementStrategy(strategy) {
    const current = this._routeCounts.get(strategy) || 0;
    this._routeCounts.set(strategy, current + 1);
  }
}

function createRouter(options) {
  return new MessageRouter(options);
}

module.exports = {
  MessageRouter,
  ROLE_CAPABILITY_HINTS,
  STRATEGY,
  STRATEGY_PRIORITY,
  createRouter,
  normalizeAgent,
};
