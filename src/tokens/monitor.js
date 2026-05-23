"use strict";

const ALERT_THRESHOLDS = Object.freeze({
  highConsumptionRatio: 0.9,
  sustainedSpikeWindows: 3,
  efficiencyDropThreshold: 0.5,
  exhaustionWarningThreshold: 0.85,
  maxConsecutiveOverdrafts: 2,
});

const TREND_WINDOW_MS = 300_000; // 5 minutes per trend bucket
const MAX_TREND_BUCKETS = 100;
const MAX_EVENTS = 10000;

class TokenMonitor {
  constructor(options = {}) {
    this._events = [];
    this._categoryUsage = {};
    this._alertHistory = [];
    this._trendBuckets = new Map();
    this._outputTokens = 0;
    this._usefulOutputTokens = 0;
    this._totalRequests = 0;
    this._startTime = Date.now();
    this._thresholds = { ...ALERT_THRESHOLDS, ...(options.thresholds || {}) };
    this._budgetRef = null;
  }

  setBudget(budget) {
    this._budgetRef = budget;
  }

  trackUsage(event) {
    if (!event || typeof event !== "object") {
      return;
    }

    const timestamp = event.timestamp || Date.now();
    const category = event.category || "unknown";
    const tokens = this._clampPositive(event.tokens);
    const metadata = event.metadata || {};

    const record = {
      timestamp,
      category,
      tokens,
      metadata,
      requestId: event.requestId || null,
      model: event.model || null,
    };

    this._events.push(record);
    this._totalRequests += 1;

    // Prune old events.
    while (this._events.length > MAX_EVENTS) {
      this._events.shift();
    }

    // Update category usage.
    if (!this._categoryUsage[category]) {
      this._categoryUsage[category] = { totalTokens: 0, events: 0, lastTimestamp: 0 };
    }
    this._categoryUsage[category].totalTokens += tokens;
    this._categoryUsage[category].events += 1;
    this._categoryUsage[category].lastTimestamp = timestamp;

    // Track output quality metrics.
    if (category === "output") {
      this._outputTokens += tokens;
      if (metadata.useful !== false) {
        this._usefulOutputTokens += tokens;
      }
    }

    // Update trend buckets.
    this._updateTrendBucket(timestamp, category, tokens);

    // Generate alerts if needed.
    this._generateAlerts(record);
  }

  getUsageStats() {
    const totalTokens = this._totalTokensConsumed();
    const runtimeMs = Date.now() - this._startTime;
    const runtimeMinutes = runtimeMs / 60000;

    return {
      totalTokens,
      totalRequests: this._totalRequests,
      averageTokensPerRequest: this._totalRequests > 0
        ? Math.round(totalTokens / this._totalRequests)
        : 0,
      runtimeMs,
      runtimeMinutes: Math.round(runtimeMinutes * 100) / 100,
      tokensPerMinute: runtimeMinutes > 0
        ? Math.round(totalTokens / runtimeMinutes)
        : 0,
      eventCount: this._events.length,
      outputTokens: this._outputTokens,
      usefulOutputTokens: this._usefulOutputTokens,
      efficiency: this.getEfficiency(),
      categories: Object.keys(this._categoryUsage).length,
      alerts: this._alertHistory.length,
      lastActivity: this._events.length > 0
        ? this._events[this._events.length - 1].timestamp
        : null,
    };
  }

  getUsageByCategory() {
    const result = {};
    const totalTokens = this._totalTokensConsumed();

    for (const [category, data] of Object.entries(this._categoryUsage)) {
      result[category] = {
        totalTokens: data.totalTokens,
        events: data.events,
        percentage: totalTokens > 0
          ? Math.round((data.totalTokens / totalTokens) * 10000) / 100
          : 0,
        averagePerEvent: data.events > 0
          ? Math.round(data.totalTokens / data.events)
          : 0,
        lastUsed: data.lastTimestamp,
        budgetStatus: this._getBudgetStatusForCategory(category),
      };
    }

    return result;
  }

  getUsageTrend() {
    const buckets = [];

    for (const [timestamp, data] of this._trendBuckets.entries()) {
      buckets.push({
        timestamp: Number(timestamp),
        totalTokens: data.totalTokens,
        categories: { ...data.categories },
        requestCount: data.requestCount,
      });
    }

    buckets.sort((a, b) => a.timestamp - b.timestamp);

    if (buckets.length < 2) {
      return {
        buckets,
        direction: "stable",
        rate: 0,
        message: buckets.length === 0
          ? "No trend data available."
          : "Insufficient data for trend analysis.",
      };
    }

    // Compute linear regression slope for the last N buckets.
    const recent = buckets.slice(-20);
    const n = recent.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;

    const baseTime = recent[0].timestamp;
    for (let i = 0; i < n; i++) {
      const x = (recent[i].timestamp - baseTime) / 60000; // minutes
      const y = recent[i].totalTokens;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }

    const denominator = n * sumX2 - sumX * sumX;
    const slope = denominator !== 0 ? (n * sumXY - sumX * sumY) / denominator : 0;

    let direction = "stable";
    if (slope > 5) direction = "increasing";
    else if (slope < -5) direction = "decreasing";

    return {
      buckets,
      direction,
      rate: Math.round(slope * 100) / 100,
      message: `Token usage is ${direction} at ${Math.abs(Math.round(slope * 100) / 100)} tokens/min.`,
    };
  }

  predictExhaustion() {
    if (!this._budgetRef) {
      return {
        canPredict: false,
        message: "No budget reference set. Call setBudget() first.",
      };
    }

    const budget = this._budgetRef.getBudget();
    const totalRemaining = budget.totalRemaining;
    const totalConsumed = budget.totalConsumed;

    if (totalConsumed === 0) {
      return {
        canPredict: true,
        remainingTokens: totalRemaining,
        estimatedTimeRemainingMs: null,
        message: "No tokens consumed yet; cannot estimate exhaustion time.",
      };
    }

    const runtimeMs = Date.now() - this._startTime;
    const consumptionRate = totalConsumed / (runtimeMs / 60000); // tokens per minute

    if (consumptionRate <= 0) {
      return {
        canPredict: true,
        remainingTokens: totalRemaining,
        estimatedTimeRemainingMs: null,
        message: "No active consumption detected.",
      };
    }

    const minutesRemaining = totalRemaining / consumptionRate;
    const msRemaining = minutesRemaining * 60000;

    const perCategory = {};
    for (const [category, data] of Object.entries(this._categoryUsage)) {
      const categoryRate = data.totalTokens / (runtimeMs / 60000);
      const categoryRemaining = budget.categories[category]
        ? budget.categories[category].remaining
        : 0;

      perCategory[category] = {
        remainingTokens: categoryRemaining,
        consumptionRate: Math.round(categoryRate * 100) / 100,
        estimatedMinutesRemaining: categoryRate > 0
          ? Math.round((categoryRemaining / categoryRate) * 100) / 100
          : null,
      };
    }

    return {
      canPredict: true,
      remainingTokens: totalRemaining,
      totalConsumed,
      consumptionRate: Math.round(consumptionRate * 100) / 100,
      estimatedTimeRemainingMs: Math.round(msRemaining),
      estimatedMinutesRemaining: Math.round(minutesRemaining * 100) / 100,
      perCategory,
      message: minutesRemaining < 5
        ? `WARNING: Budget may be exhausted in approximately ${Math.round(minutesRemaining)} minutes.`
        : `Budget should last approximately ${Math.round(minutesRemaining)} minutes at current rate.`,
      isUrgent: minutesRemaining < 5,
    };
  }

  getEfficiency() {
    if (this._outputTokens === 0) {
      return 0;
    }

    return this._usefulOutputTokens / this._outputTokens;
  }

  generateAlerts() {
    return [...this._alertHistory];
  }

  reset() {
    this._events = [];
    this._categoryUsage = {};
    this._alertHistory = [];
    this._trendBuckets.clear();
    this._outputTokens = 0;
    this._usefulOutputTokens = 0;
    this._totalRequests = 0;
    this._startTime = Date.now();
  }

  // --- private helpers ---

  _totalTokensConsumed() {
    let total = 0;
    for (const data of Object.values(this._categoryUsage)) {
      total += data.totalTokens;
    }
    return total;
  }

  _updateTrendBucket(timestamp, category, tokens) {
    const bucketKey = Math.floor(timestamp / TREND_WINDOW_MS) * TREND_WINDOW_MS;

    if (!this._trendBuckets.has(bucketKey)) {
      this._trendBuckets.set(bucketKey, {
        totalTokens: 0,
        categories: {},
        requestCount: 0,
      });
    }

    const bucket = this._trendBuckets.get(bucketKey);
    bucket.totalTokens += tokens;
    bucket.requestCount += 1;

    if (!bucket.categories[category]) {
      bucket.categories[category] = 0;
    }
    bucket.categories[category] += tokens;

    // Prune old buckets.
    if (this._trendBuckets.size > MAX_TREND_BUCKETS) {
      const keys = [...this._trendBuckets.keys()].sort();
      for (let i = 0; i < keys.length - MAX_TREND_BUCKETS; i++) {
        this._trendBuckets.delete(keys[i]);
      }
    }
  }

  _generateAlerts(record) {
    const alerts = [];

    // Alert 1: High consumption ratio per category.
    if (this._budgetRef) {
      const budget = this._budgetRef.getBudget();
      const categoryBudget = budget.categories[record.category];
      if (categoryBudget && categoryBudget.allocated > 0) {
        const ratio = categoryBudget.consumed / categoryBudget.allocated;
        if (ratio >= this._thresholds.highConsumptionRatio) {
          alerts.push({
            type: "high_consumption",
            severity: ratio >= 0.95 ? "critical" : "warning",
            category: record.category,
            consumed: categoryBudget.consumed,
            allocated: categoryBudget.allocated,
            ratio: Math.round(ratio * 100) / 100,
            timestamp: record.timestamp,
            message: `"${record.category}" is at ${Math.round(ratio * 100)}% of allocated budget.`,
          });
        }
      }
    }

    // Alert 2: Sustained spikes.
    const recentEvents = this._events.slice(-this._thresholds.sustainedSpikeWindows);
    const spikeCategory = record.category;
    if (recentEvents.length >= this._thresholds.sustainedSpikeWindows) {
      const allSame = recentEvents.every((e) => e.category === spikeCategory);
      if (allSame) {
        const totalRecent = recentEvents.reduce((s, e) => s + e.tokens, 0);
        const avg = totalRecent / recentEvents.length;
        if (avg > 2000) {
          alerts.push({
            type: "sustained_spike",
            severity: "warning",
            category: spikeCategory,
            averageTokens: Math.round(avg),
            window: recentEvents.length,
            timestamp: record.timestamp,
            message: `Sustained high usage detected in "${spikeCategory}" (avg ${Math.round(avg)} tokens/event over ${recentEvents.length} events).`,
          });
        }
      }
    }

    // Alert 3: Efficiency drop.
    if (record.category === "output" && this._outputTokens > 0) {
      const currentEfficiency = this.getEfficiency();
      if (currentEfficiency < this._thresholds.efficiencyDropThreshold && this._totalRequests > 5) {
        alerts.push({
          type: "efficiency_drop",
          severity: "info",
          efficiency: Math.round(currentEfficiency * 100) / 100,
          timestamp: record.timestamp,
          message: `Output efficiency dropped to ${Math.round(currentEfficiency * 100)}%.`,
        });
      }
    }

    // Alert 4: Consecutive overdrafts.
    if (this._budgetRef) {
      const overdrafts = this._budgetRef.getOverdrafts();
      if (overdrafts.length >= this._thresholds.maxConsecutiveOverdrafts) {
        alerts.push({
          type: "consecutive_overdrafts",
          severity: "critical",
          count: overdrafts.length,
          timestamp: record.timestamp,
          message: `${overdrafts.length} consecutive overdrafts detected. Budget may need reallocation.`,
        });
      }
    }

    // Deduplicate and add.
    for (const alert of alerts) {
      const isDuplicate = this._alertHistory.some(
        (a) => a.type === alert.type && a.category === alert.category && a.timestamp === alert.timestamp
      );
      if (!isDuplicate) {
        this._alertHistory.push(alert);
      }
    }

    // Prune alert history.
    if (this._alertHistory.length > 500) {
      this._alertHistory = this._alertHistory.slice(-500);
    }
  }

  _getBudgetStatusForCategory(category) {
    if (!this._budgetRef) {
      return { hasBudget: false };
    }

    try {
      const budget = this._budgetRef.getBudget();
      const catBudget = budget.categories[category];
      if (!catBudget) {
        return { hasBudget: false };
      }

      return {
        hasBudget: true,
        allocated: catBudget.allocated,
        consumed: catBudget.consumed,
        remaining: catBudget.remaining,
        exhausted: catBudget.exhausted,
        usagePercent: catBudget.allocated > 0
          ? Math.round((catBudget.consumed / catBudget.allocated) * 10000) / 100
          : 0,
      };
    } catch (_err) {
      return { hasBudget: false, error: true };
    }
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
  TokenMonitor,
  ALERT_THRESHOLDS,
};
