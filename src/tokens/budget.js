"use strict";

const CATEGORIES = Object.freeze([
  "system_prompt",
  "conversation",
  "tools",
  "output",
  "safety_margin",
]);

const DEFAULT_ALLOCATION_PERCENTAGES = Object.freeze({
  system_prompt: 0.10,
  conversation: 0.45,
  tools: 0.15,
  output: 0.20,
  safety_margin: 0.10,
});

const MINIMUM_RESERVE_TOKENS = 1;

class TokenBudget {
  constructor() {
    this._categories = {};
    this._reserved = {};
    this._consumed = {};
    this._warnings = [];
    this._overdrafts = [];
    this._totalTokens = 0;
    this._frozen = false;

    for (const category of CATEGORIES) {
      this._categories[category] = 0;
      this._reserved[category] = 0;
      this._consumed[category] = 0;
    }
  }

  allocate(totalTokens) {
    if (this._frozen) {
      this._warn("Budget is frozen; cannot re-allocate.");
      return this;
    }

    const tokens = this._clampPositive(totalTokens);
    this._totalTokens = tokens;

    for (const category of CATEGORIES) {
      const share = Math.floor(tokens * DEFAULT_ALLOCATION_PERCENTAGES[category]);
      this._categories[category] = Math.max(MINIMUM_RESERVE_TOKENS, share);
    }

    this._normalizeAllocation();
    this._warnings = [];
    this._overdrafts = [];
    return this;
  }

  reserve(category, tokens) {
    this._validateCategory(category);

    if (this._frozen) {
      this._warn(`Budget is frozen; cannot reserve tokens for "${category}".`);
      return this;
    }

    const amount = this._clampPositive(tokens);

    if (amount > this._categories[category]) {
      this._warn(
        `Reserve of ${amount} tokens for "${category}" exceeds allocated ${this._categories[category]}. ` +
        `Budget expanded to accommodate.`
      );
      this._categories[category] = amount;
    }

    this._reserved[category] = amount;
    return this;
  }

  consume(category, tokens) {
    this._validateCategory(category);

    const amount = this._clampPositive(tokens);
    const available = this._categories[category] - this._consumed[category];

    if (amount > available) {
      const deficit = amount - available;
      this._overdrafts.push({
        category,
        amount,
        available,
        deficit,
        timestamp: Date.now(),
      });
      this._warn(
        `Overdraft in "${category}": attempted to consume ${amount} tokens but only ${available} available. ` +
        `Overdraft of ${deficit} tokens.`
      );
    }

    this._consumed[category] += amount;
    return this;
  }

  remaining(category) {
    if (category !== undefined) {
      this._validateCategory(category);
      const allocated = this._categories[category];
      const consumed = this._consumed[category];
      return Math.max(0, allocated - consumed);
    }

    let total = 0;
    for (const category of CATEGORIES) {
      total += this.remaining(category);
    }
    return total;
  }

  getBudget() {
    const categories = {};
    for (const category of CATEGORIES) {
      categories[category] = {
        allocated: this._categories[category],
        reserved: this._reserved[category],
        consumed: this._consumed[category],
        remaining: this.remaining(category),
        exhausted: this.isExhausted(category),
        percentage: this._totalTokens > 0
          ? Math.round((this._categories[category] / this._totalTokens) * 100)
          : 0,
      };
    }

    return {
      totalTokens: this._totalTokens,
      totalConsumed: this._totalConsumed(),
      totalRemaining: this.remaining(),
      totalReserved: this._totalReserved(),
      categories,
      frozen: this._frozen,
      warnings: [...this._warnings],
      overdrafts: [...this._overdrafts],
    };
  }

  isExhausted(category) {
    this._validateCategory(category);
    return this.remaining(category) <= 0;
  }

  freeze() {
    this._frozen = true;
    return this;
  }

  unfreeze() {
    this._frozen = false;
    return this;
  }

  getWarnings() {
    return [...this._warnings];
  }

  getOverdrafts() {
    return [...this._overdrafts];
  }

  clearWarnings() {
    this._warnings = [];
    return this;
  }

  // --- private helpers ---

  _totalConsumed() {
    let total = 0;
    for (const category of CATEGORIES) {
      total += this._consumed[category];
    }
    return total;
  }

  _totalReserved() {
    let total = 0;
    for (const category of CATEGORIES) {
      total += this._reserved[category];
    }
    return total;
  }

  _normalizeAllocation() {
    const allocated = CATEGORIES.reduce((sum, cat) => sum + this._categories[cat], 0);

    if (allocated === this._totalTokens || this._totalTokens === 0) {
      return;
    }

    // Distribute rounding remainder to the conversation category.
    const delta = this._totalTokens - allocated;
    this._categories["conversation"] += delta;

    if (this._categories["conversation"] < MINIMUM_RESERVE_TOKENS) {
      this._categories["conversation"] = MINIMUM_RESERVE_TOKENS;
    }
  }

  _validateCategory(category) {
    if (!CATEGORIES.includes(category)) {
      throw new Error(
        `Unknown budget category "${category}". Valid categories: ${CATEGORIES.join(", ")}`
      );
    }
  }

  _warn(message) {
    this._warnings.push({
      message,
      timestamp: Date.now(),
    });
  }

  _clampPositive(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) {
      return 0;
    }
    return Math.floor(num);
  }
}

module.exports = {
  TokenBudget,
  CATEGORIES,
  DEFAULT_ALLOCATION_PERCENTAGES,
};
