"use strict";

/**
 * PolicyGradient — maintains a policy (mapping from state features to action
 * preferences) and uses a simple REINFORCE-style gradient update to shift
 * action probabilities toward higher-reward choices.
 *
 * State shape: { taskType, context, availableTools, complexity }
 * Actions:    tool selections, response strategies, error recovery approaches
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function roundTo(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function hashState(state) {
  // Produce a stable string key for a state object
  const taskType = String(state.taskType || "");
  const context = String(state.context || "");
  const tools = Array.isArray(state.availableTools)
    ? state.availableTools.sort().join(",")
    : "";
  const complexity = state.complexity != null ? String(state.complexity) : "";
  return `${taskType}|${context.slice(0, 80)}|${tools}|${complexity}`;
}

function softmax(logits, temperature) {
  const t = Math.max(temperature, 0.01);
  const scaled = logits.map((v) => v / t);
  const maxScaled = Math.max(...scaled);
  const exps = scaled.map((v) => Math.exp(v - maxScaled));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// ---------------------------------------------------------------------------
// PolicyGradient class
// ---------------------------------------------------------------------------

class PolicyGradient {
  /**
   * @param {object} [options]
   * @param {number} [options.learningRate=0.01]   — alpha for gradient updates
   * @param {number} [options.discountFactor=0.95] — gamma for future rewards
   * @param {number} [options.epsilon=0.1]         — exploration rate
   * @param {number} [options.epsilonDecay=0.999]  — per-update epsilon multiplier
   * @param {number} [options.minEpsilon=0.01]     — floor for epsilon
   * @param {number} [options.temperature=1.0]     — softmax temperature for boltzmann
   * @param {number} [options.minActionProb=0.001] — floor for action probabilities
   * @param {string[]} [options.actions]           — known action space; auto-expands
   */
  constructor(options = {}) {
    this._learningRate = options.learningRate || 0.01;
    this._discountFactor = options.discountFactor || 0.95;
    this._epsilon = options.epsilon != null ? options.epsilon : 0.1;
    this._epsilonDecay = options.epsilonDecay != null ? options.epsilonDecay : 0.999;
    this._minEpsilon = options.minEpsilon != null ? options.minEpsilon : 0.01;
    this._temperature = options.temperature || 1.0;
    this._minActionProb = options.minActionProb != null ? options.minActionProb : 0.001;

    // stateHash -> { actionName -> { logit, count, totalReward } }
    this._policy = new Map();

    // Episode memory: list of { stateHash, action, reward }
    this._episode = [];

    // Known actions (auto-expanded via recordAction)
    this._knownActions = new Set(options.actions || []);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Records an action taken from a state along with its resulting reward.
   * The reward is accumulated into the episode buffer.
   *
   * @param {object} state
   * @param {string} action  — action name
   * @param {number} reward  — numeric reward (higher is better)
   * @returns {object} record entry
   */
  recordAction(state, action, reward) {
    if (!state) {
      return { stateHash: null, action, reward, error: "no state provided" };
    }
    if (typeof reward !== "number") {
      reward = 0;
    }

    const stateHash = hashState(state);
    this._knownActions.add(action);

    // Ensure policy entry exists for this state
    if (!this._policy.has(stateHash)) {
      this._policy.set(stateHash, new Map());
    }
    const statePolicy = this._policy.get(stateHash);

    // Ensure action entry exists
    if (!statePolicy.has(action)) {
      statePolicy.set(action, {
        logit: 0,
        count: 0,
        totalReward: 0,
      });
    }
    const entry = statePolicy.get(action);
    entry.count += 1;
    entry.totalReward += reward;

    // Push to episode
    const record = {
      stateHash,
      action,
      reward,
      timestamp: new Date().toISOString(),
    };
    this._episode.push(record);

    return record;
  }

  /**
   * Performs a policy gradient update using accumulated episode data.
   * Uses a simple Monte Carlo REINFORCE style:
   *   - Compute discounted returns G_t for each step
   *   - Increase logit for actions with positive return
   *   - Decrease logit for actions with negative return
   *
   * @returns {object} summary of the update
   */
  updatePolicy() {
    if (this._episode.length === 0) {
      return { updated: false, steps: 0, reason: "empty episode" };
    }

    const n = this._episode.length;

    // Compute discounted returns from the end
    let cumulative = 0;
    const returns = new Array(n);
    for (let t = n - 1; t >= 0; t--) {
      cumulative = this._episode[t].reward + this._discountFactor * cumulative;
      returns[t] = cumulative;
    }

    // Compute mean and std for baseline (advantage calculation)
    const mean = returns.reduce((a, b) => a + b, 0) / n;
    const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    const std = Math.sqrt(variance) || 1;

    const updatedActions = [];

    for (let t = 0; t < n; t++) {
      const step = this._episode[t];
      const advantage = (returns[t] - mean) / std;

      if (Math.abs(advantage) < 0.01) continue;

      const statePolicy = this._policy.get(step.stateHash);
      if (!statePolicy) continue;

      const actionEntry = statePolicy.get(step.action);
      if (!actionEntry) continue;

      // REINFORCE update: shift logit proportional to advantage
      actionEntry.logit += this._learningRate * advantage;

      updatedActions.push({
        stateHash: step.stateHash,
        action: step.action,
        advantage: roundTo(advantage, 4),
        newLogit: roundTo(actionEntry.logit, 4),
      });
    }

    // Clear episode
    this._episode = [];

    // Decay epsilon
    this._epsilon = Math.max(this._minEpsilon, this._epsilon * this._epsilonDecay);

    return {
      updated: true,
      steps: n,
      meanReturn: roundTo(mean, 4),
      updatedActions: updatedActions.length,
      details: updatedActions,
      epsilon: roundTo(this._epsilon, 4),
    };
  }

  /**
   * Epsilon-greedy action selection for a given state.
   * With probability epsilon, picks a random action.
   * Otherwise picks the action with the highest logit (greedy).
   *
   * @param {object} state
   * @param {object} [options]
   * @param {string[]} [options.availableActions] — restrict to these actions
   * @returns {string} selected action
   */
  selectAction(state, options = {}) {
    if (!state) return null;

    const stateHash = hashState(state);
    const available = Array.isArray(options.availableActions)
      ? options.availableActions
      : Array.from(this._knownActions);

    if (available.length === 0) return null;

    // Exploration
    if (Math.random() < this._epsilon) {
      const idx = Math.floor(Math.random() * available.length);
      return available[idx];
    }

    // Exploitation — pick best logit among available actions
    const statePolicy = this._policy.get(stateHash);
    if (!statePolicy || statePolicy.size === 0) {
      // No policy yet for this state; pick at random
      const idx = Math.floor(Math.random() * available.length);
      return available[idx];
    }

    let bestAction = available[0];
    let bestLogit = -Infinity;

    for (const action of available) {
      const entry = statePolicy.get(action);
      const logit = entry ? entry.logit : 0;
      if (logit > bestLogit) {
        bestLogit = logit;
        bestAction = action;
      }
    }

    return bestAction;
  }

  /**
   * Returns the highest-value action for a state (always greedy, no exploration).
   *
   * @param {object} state
   * @returns {string|null} best action name, or null if unknown
   */
  getBestAction(state) {
    if (!state) return null;

    const stateHash = hashState(state);
    const statePolicy = this._policy.get(stateHash);
    if (!statePolicy || statePolicy.size === 0) return null;

    let bestAction = null;
    let bestLogit = -Infinity;

    for (const [action, entry] of statePolicy.entries()) {
      if (entry.logit > bestLogit) {
        bestLogit = entry.logit;
        bestAction = action;
      }
    }

    return bestAction;
  }

  /**
   * Returns the action probability distribution for a state using softmax
   * over logits. This is a Boltzmann policy for the given state.
   *
   * @param {object} state
   * @returns {object[]} array of { action, probability, logit }
   */
  getPolicy(state) {
    if (!state) return [];

    const stateHash = hashState(state);
    const statePolicy = this._policy.get(stateHash);
    if (!statePolicy || statePolicy.size === 0) return [];

    const actions = Array.from(statePolicy.entries());
    const logits = actions.map(([, e]) => e.logit);
    const probs = softmax(logits, this._temperature);

    return actions
      .map(([action, entry], i) => ({
        action,
        probability: roundTo(clamp(probs[i], this._minActionProb, 1), 4),
        logit: roundTo(entry.logit, 4),
        count: entry.count,
        avgReward: entry.count > 0 ? roundTo(entry.totalReward / entry.count, 4) : 0,
      }))
      .sort((a, b) => b.logit - a.logit);
  }

  /**
   * Returns the number of states in the policy table.
   *
   * @returns {number}
   */
  getStateCount() {
    return this._policy.size;
  }

  /**
   * Returns a summary snapshot of the current learning state.
   *
   * @returns {object}
   */
  getSummary() {
    const stateCount = this._policy.size;
    let totalActions = 0;
    let totalReward = 0;

    for (const statePolicy of this._policy.values()) {
      totalActions += statePolicy.size;
      for (const entry of statePolicy.values()) {
        totalReward += entry.totalReward;
      }
    }

    return {
      states: stateCount,
      knownActions: this._knownActions.size,
      totalRecordedActions: totalActions,
      totalAccumulatedReward: roundTo(totalReward, 4),
      epsilon: roundTo(this._epsilon, 4),
      learningRate: this._learningRate,
      discountFactor: this._discountFactor,
      episodeLength: this._episode.length,
    };
  }

  /**
   * Resets the entire policy table and episode buffer.
   */
  reset() {
    this._policy.clear();
    this._episode = [];
    this._epsilon = 0.1;
    this._knownActions.clear();
  }

  /**
   * Clears only the episode buffer (keeps learned policy).
   */
  clearEpisode() {
    this._episode = [];
  }

  /**
   * Serialises the policy table for persistence.
   *
   * @returns {object} serialisable policy data
   */
  serialize() {
    const policy = {};
    for (const [stateHash, statePolicy] of this._policy) {
      const actions = {};
      for (const [action, entry] of statePolicy) {
        actions[action] = {
          logit: entry.logit,
          count: entry.count,
          totalReward: entry.totalReward,
        };
      }
      policy[stateHash] = actions;
    }

    return {
      policy,
      knownActions: Array.from(this._knownActions),
      epsilon: this._epsilon,
      learningRate: this._learningRate,
      discountFactor: this._discountFactor,
    };
  }

  /**
   * Loads serialised policy data.
   *
   * @param {object} data — output from serialize()
   */
  deserialize(data) {
    if (!data || typeof data !== "object") return;

    this._policy.clear();
    this._knownActions.clear();

    if (data.policy) {
      for (const [stateHash, actions] of Object.entries(data.policy)) {
        const statePolicy = new Map();
        for (const [action, entry] of Object.entries(actions)) {
          statePolicy.set(action, {
            logit: entry.logit || 0,
            count: entry.count || 0,
            totalReward: entry.totalReward || 0,
          });
        }
        this._policy.set(stateHash, statePolicy);
      }
    }

    if (Array.isArray(data.knownActions)) {
      for (const a of data.knownActions) this._knownActions.add(a);
    }

    this._epsilon = data.epsilon != null ? data.epsilon : 0.1;
    this._learningRate = data.learningRate || 0.01;
    this._discountFactor = data.discountFactor || 0.95;
    this._episode = [];
  }
}

module.exports = { PolicyGradient };
