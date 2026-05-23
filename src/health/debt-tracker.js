"use strict";

/**
 * TechnicalDebtTracker — records, tracks, and prioritizes technical debt items.
 *
 * Each debt item is recorded with a file path, type, severity, and description.
 * The tracker provides summary views, cost estimation, and ROI-based prioritization
 * so that agents can make data-driven refactoring decisions.
 *
 * Debt types:
 *   TODO_FIXME, MAGIC_NUMBER, LONG_FUNCTION, DEEP_NESTING,
 *   DUPLICATE_CODE, MISSING_ERROR_HANDLING
 *
 * Severity levels: 'low', 'medium', 'high', 'critical'
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEBT_TYPES = Object.freeze({
  TODO_FIXME: {
    label: "TODO / FIXME",
    description: "Code comments indicating unfinished or broken functionality",
    baseCostHours: 0.5,
    impactWeight: 0.4,
  },
  MAGIC_NUMBER: {
    label: "Magic Number",
    description: "Hardcoded numeric literals without named constants",
    baseCostHours: 0.25,
    impactWeight: 0.3,
  },
  LONG_FUNCTION: {
    label: "Long Function",
    description: "Functions exceeding reasonable length limits",
    baseCostHours: 2.0,
    impactWeight: 0.8,
  },
  DEEP_NESTING: {
    label: "Deep Nesting",
    description: "Excessive nesting of conditionals and loops",
    baseCostHours: 1.5,
    impactWeight: 0.7,
  },
  DUPLICATE_CODE: {
    label: "Duplicate Code",
    description: "Copy-pasted or near-identical code blocks",
    baseCostHours: 1.0,
    impactWeight: 0.9,
  },
  MISSING_ERROR_HANDLING: {
    label: "Missing Error Handling",
    description: "Try/catch or validation not present where expected",
    baseCostHours: 0.75,
    impactWeight: 0.85,
  },
});

const SEVERITY_WEIGHTS = Object.freeze({
  low: 0.25,
  medium: 0.5,
  high: 0.75,
  critical: 1.0,
});

// ---------------------------------------------------------------------------
// TechnicalDebtTracker
// ---------------------------------------------------------------------------

class TechnicalDebtTracker {
  constructor() {
    /** @type {Array<{id: number, filePath: string, type: string, severity: string, description: string, timestamp: string, resolved: boolean, resolvedAt: string|null}>} */
    this._debts = [];
    this._nextId = 1;
    this._history = []; // snapshot history for trend analysis
  }

  /**
   * Record a new debt item.
   *
   * @param {string} filePath - path to the file with the debt
   * @param {string} type - one of the DEBT_TYPES keys
   * @param {string} severity - 'low', 'medium', 'high', or 'critical'
   * @param {string} description - human-readable description of the debt
   * @returns {object} the created debt record
   */
  recordDebt(filePath, type, severity, description) {
    if (typeof filePath !== "string" || !filePath.trim()) {
      throw new TypeError("filePath must be a non-empty string");
    }
    if (!DEBT_TYPES[type]) {
      throw new TypeError(
        `Unknown debt type "${type}". Valid types: ${Object.keys(DEBT_TYPES).join(", ")}`
      );
    }
    if (!SEVERITY_WEIGHTS[severity]) {
      throw new TypeError(
        `Unknown severity "${severity}". Valid severities: ${Object.keys(SEVERITY_WEIGHTS).join(", ")}`
      );
    }
    if (typeof description !== "string" || !description.trim()) {
      throw new TypeError("description must be a non-empty string");
    }

    const debt = {
      id: this._nextId++,
      filePath,
      type,
      severity,
      description,
      timestamp: new Date().toISOString(),
      resolved: false,
      resolvedAt: null,
    };

    this._debts.push(debt);
    return debt;
  }

  /**
   * Mark a debt item as resolved by file path and description match.
   * If multiple debts match, only the first unresolved one is resolved.
   *
   * @param {string} filePath
   * @param {string} description
   * @returns {object|null} the resolved debt record, or null if not found
   */
  resolveDebt(filePath, description) {
    const idx = this._debts.findIndex(
      (d) => d.filePath === filePath && d.description === description && !d.resolved
    );

    if (idx === -1) {
      return null;
    }

    this._debts[idx].resolved = true;
    this._debts[idx].resolvedAt = new Date().toISOString();

    // Record a snapshot of the current state for trend tracking.
    this._recordSnapshot("resolve", this._debts[idx]);

    return this._debts[idx];
  }

  /**
   * Resolve a debt by its unique ID.
   *
   * @param {number} id
   * @returns {object|null} the resolved debt record, or null if not found
   */
  resolveDebtById(id) {
    const debt = this._debts.find((d) => d.id === id);

    if (!debt || debt.resolved) {
      return null;
    }

    debt.resolved = true;
    debt.resolvedAt = new Date().toISOString();

    this._recordSnapshot("resolve", debt);

    return debt;
  }

  /**
   * Get comprehensive debt summary.
   *
   * @returns {{
   *   totalActive: number,
   *   totalResolved: number,
   *   totalCount: number,
   *   resolutionRate: string,
   *   byType: object,
   *   bySeverity: object,
   *   byFile: object,
   *   estimatedTotalHours: number,
   *   oldestDebt: object|null,
   *   newestDebt: object|null
   * }}
   */
  getDebtSummary() {
    const active = this._debts.filter((d) => !d.resolved);
    const resolved = this._debts.filter((d) => d.resolved);

    // By type (active only).
    const byType = {};
    for (const d of active) {
      if (!byType[d.type]) {
        byType[d.type] = { count: 0, items: [], estimatedHours: 0 };
      }
      byType[d.type].count++;
      byType[d.type].items.push(d);
      byType[d.type].estimatedHours += this.estimateCost(d);
    }

    // By severity (active only).
    const bySeverity = { low: { count: 0 }, medium: { count: 0 }, high: { count: 0 }, critical: { count: 0 } };
    for (const d of active) {
      if (bySeverity[d.severity]) {
        bySeverity[d.severity].count++;
      }
    }

    // By file (active only).
    const byFile = {};
    for (const d of active) {
      if (!byFile[d.filePath]) {
        byFile[d.filePath] = { count: 0, items: [], estimatedHours: 0 };
      }
      byFile[d.filePath].count++;
      byFile[d.filePath].items.push(d);
      byFile[d.filePath].estimatedHours += this.estimateCost(d);
    }

    // Total estimated hours.
    let estimatedTotalHours = 0;
    for (const d of active) {
      estimatedTotalHours += this.estimateCost(d);
    }

    const totalCount = this._debts.length;
    const resolutionRate = totalCount > 0
      ? ((resolved.length / totalCount) * 100).toFixed(0) + "%"
      : "0%";

    const sorted = [...this._debts].sort(
      (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
    );
    const oldestActive = active.length > 0
      ? active.reduce((a, b) => (new Date(a.timestamp) < new Date(b.timestamp) ? a : b))
      : null;
    const newestActive = active.length > 0
      ? active.reduce((a, b) => (new Date(a.timestamp) > new Date(b.timestamp) ? a : b))
      : null;

    return {
      totalActive: active.length,
      totalResolved: resolved.length,
      totalCount,
      resolutionRate,
      byType,
      bySeverity,
      byFile,
      estimatedTotalHours: Math.round(estimatedTotalHours * 100) / 100,
      oldestDebt: oldestActive,
      newestDebt: newestActive,
    };
  }

  /**
   * Estimate the effort (in hours) required to resolve a debt item.
   * Based on debt type, severity, and base cost modifiers.
   *
   * @param {object} debt - a debt record
   * @returns {number} estimated hours
   */
  estimateCost(debt) {
    const typeDef = DEBT_TYPES[debt.type];
    if (!typeDef) return 1.0;

    const severityMult = SEVERITY_WEIGHTS[debt.severity] || 1.0;
    let hours = typeDef.baseCostHours;

    // Severity multiplier: low = 0.5x, medium = 1x, high = 1.5x, critical = 2x.
    switch (debt.severity) {
      case "low":
        hours *= 0.5;
        break;
      case "medium":
        hours *= 1.0;
        break;
      case "high":
        hours *= 1.5;
        break;
      case "critical":
        hours *= 2.0;
        break;
    }

    // Apply severity weight for fine-tuning.
    hours *= (0.5 + severityMult * 0.5);

    return Math.round(hours * 100) / 100;
  }

  /**
   * Prioritize all active debts by ROI (impact / cost).
   * Higher ROI items appear first.
   *
   * @returns {Array<{debt: object, roi: number, estimatedHours: number}>}
   */
  prioritize() {
    const active = this._debts.filter((d) => !d.resolved);

    const ranked = active.map((debt) => {
      const typeDef = DEBT_TYPES[debt.type];
      const severityWeight = SEVERITY_WEIGHTS[debt.severity] || 0.5;
      const impact = (typeDef ? typeDef.impactWeight : 0.5) * severityWeight;
      const cost = this.estimateCost(debt);

      // ROI = impact / cost; avoid division by zero.
      const roi = cost > 0 ? impact / cost : impact;

      return {
        debt,
        roi: Math.round(roi * 10000) / 10000,
        estimatedHours: cost,
        impact: Math.round(impact * 100) / 100,
      };
    });

    // Sort by ROI descending, then by severity.
    const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
    ranked.sort((a, b) => {
      if (b.roi !== a.roi) return b.roi - a.roi;
      return (severityOrder[b.debt.severity] || 0) - (severityOrder[a.debt.severity] || 0);
    });

    return ranked;
  }

  /**
   * Get all debt items (active and resolved).
   *
   * @param {boolean} [activeOnly] - if true, return only active (unresolved) debts
   * @returns {Array<object>}
   */
  getAllDebts(activeOnly = false) {
    if (activeOnly) {
      return this._debts.filter((d) => !d.resolved);
    }
    return [...this._debts];
  }

  /**
   * Get debt trend data from recorded snapshots.
   *
   * @returns {{
   *   snapshots: Array<{timestamp: string, active: number, resolved: number}>,
   *   trend: 'improving'|'declining'|'stable'|'insufficient-data'
   * }}
   */
  getTrend() {
    if (this._history.length < 2) {
      return {
        snapshots: [...this._history],
        trend: "insufficient-data",
      };
    }

    const firstHalf = this._history.slice(0, Math.floor(this._history.length / 2));
    const secondHalf = this._history.slice(Math.floor(this._history.length / 2));

    const firstAvg =
      firstHalf.reduce((sum, s) => sum + s.active, 0) / firstHalf.length;
    const secondAvg =
      secondHalf.reduce((sum, s) => sum + s.active, 0) / secondHalf.length;

    let trend = "stable";
    if (secondAvg < firstAvg * 0.9) {
      trend = "improving";
    } else if (secondAvg > firstAvg * 1.1) {
      trend = "declining";
    }

    return {
      snapshots: [...this._history],
      trend,
    };
  }

  /**
   * Remove all debt records (useful for testing).
   */
  clear() {
    this._debts = [];
    this._history = [];
    this._nextId = 1;
  }

  // ---- Private helpers ----

  _recordSnapshot(event, debt) {
    const active = this._debts.filter((d) => !d.resolved).length;
    const resolved = this._debts.filter((d) => d.resolved).length;

    this._history.push({
      timestamp: new Date().toISOString(),
      event,
      debtId: debt.id,
      active,
      resolved,
      total: this._debts.length,
    });
  }
}

module.exports = {
  TechnicalDebtTracker,
  DEBT_TYPES,
  SEVERITY_WEIGHTS,
};
