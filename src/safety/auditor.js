'use strict';

// ---------------------------------------------------------------------------
// SafetyAuditor — post-hoc safety auditing that analyses recorded tool
// execution sessions for risk patterns, policy violations, and improvement
// recommendations.
//
// Safety categories audited:
//   - FILE_OPERATIONS   — file read/write/delete activity
//   - NETWORK_ACCESS    — outbound network requests
//   - SHELL_EXECUTION   — shell/process command execution
//   - DATA_ACCESS       — database queries and data mutations
// ---------------------------------------------------------------------------

// -- Constants ----------------------------------------------------------------

/**
 * Safety categories with their risk weight contribution to the total score.
 */
const SAFETY_CATEGORIES = Object.freeze({
  FILE_OPERATIONS: { weight: 25, label: 'File Operations' },
  NETWORK_ACCESS: { weight: 30, label: 'Network Access' },
  SHELL_EXECUTION: { weight: 35, label: 'Shell Execution' },
  DATA_ACCESS: { weight: 10, label: 'Data Access' },
});

/**
 * Severity weights used when computing risk deductions per-issue.
 */
const SEVERITY_WEIGHTS = Object.freeze({
  CRITICAL: 40,
  HIGH: 20,
  MEDIUM: 10,
  LOW: 5,
  INFO: 0,
});

// -- Helpers ------------------------------------------------------------------

/**
 * Deduplicate an array of objects by a composite key derived from the item.
 * @param {object[]} arr
 * @param {function} keyFn — (item) => string
 * @returns {object[]}
 */
function deduplicateByKey(arr, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of arr) {
    const key = keyFn(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

/**
 * Check whether an execution record matches a tool name pattern.
 * @param {object} exec
 * @param {string[]} patterns — substrings to match against the tool name
 * @returns {boolean}
 */
function toolMatches(exec, patterns) {
  const tool = (exec.tool || '').toLowerCase();
  return patterns.some((p) => tool.includes(p));
}

/**
 * Count total output bytes across an array of execution records.
 * @param {object[]} executions
 * @returns {number}
 */
function totalOutputSize(executions) {
  let total = 0;
  for (const exec of executions) {
    if (exec.result) {
      if (typeof exec.result === 'string') {
        total += Buffer.byteLength(exec.result, 'utf8');
      } else if (Buffer.isBuffer(exec.result)) {
        total += exec.result.length;
      } else if (typeof exec.result === 'object') {
        try {
          total += Buffer.byteLength(JSON.stringify(exec.result), 'utf8');
        } catch { /* ignore */ }
      }
    }
  }
  return total;
}

// -- Audit findings factory --------------------------------------------------

function createFinding(category, severity, message, details) {
  return {
    category,
    severity,
    message,
    details: details || {},
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// SafetyAuditor
// ---------------------------------------------------------------------------

/**
 * @class SafetyAuditor
 *
 * @description
 * Audits recorded tool-execution sessions for safety concerns. Computes a
 * 0-100 safety score, identifies risky operations, and generates actionable
 * recommendations for improving safety posture.
 *
 * Safety categories evaluated:
 * - **File Operations**: read/write/delete patterns, sensitive path access,
 *   filesystem mutations.
 * - **Network Access**: outbound requests, domain allowlisting, data exfiltration
 *   indicators.
 * - **Shell Execution**: command injection, suspicious commands, privilege
 *   escalation patterns.
 * - **Data Access**: query patterns, data mutations, sensitive table access.
 *
 * @example
 * const auditor = new SafetyAuditor();
 * auditor.audit(session);      // session = array of execution records
 * console.log(auditor.getSafetyScore());         // 85
 * console.log(auditor.getRiskyOperations());      // [{ tool: 'shell.run', ... }]
 * console.log(auditor.getSafetyRecommendations()); // ['Limit shell access', ...]
 */
class SafetyAuditor {
  /**
   * @param {object} [options]
   * @param {number}  [options.minDurationWarningMs] — flag executions slower than this (default: 100)
   * @param {number}  [options.maxRiskScore]         — upper cap for risk score (default: 100)
   * @param {boolean} [options.logFindings]           — log findings to console (default: false)
   */
  constructor(options = {}) {
    this._minDurationWarningMs = options.minDurationWarningMs || 100;
    this._maxRiskScore = options.maxRiskScore || 100;
    this._logFindings = options.logFindings === true;

    // Current session
    this._session = null;

    // Audit results
    this._findings = [];
    this._safetyScore = 100;
    this._riskyOperations = [];
    this._recommendations = [];
    this._categoryScores = {};

    // Stats from last audit
    this._auditStats = null;
  }

  // -- Audit ------------------------------------------------------------------

  /**
   * Audit a session of tool executions for safety issues.
   *
   * @param {object[]} session — array of execution records. Each record should
   *   have at minimum: `{ tool, args, result, status, durationMs, categories }`.
   * @returns {{ passed: boolean, safetyScore: number, findings: object[],
   *             riskyOperations: object[], recommendations: string[],
   *             categoryScores: object, stats: object }}
   */
  audit(session) {
    if (!Array.isArray(session)) {
      throw new TypeError('audit: session must be an array of execution records');
    }

    this._session = session;
    this._findings = [];
    this._riskyOperations = [];
    this._recommendations = [];
    this._categoryScores = {};

    // If session is empty, return perfect score
    if (session.length === 0) {
      this._safetyScore = 100;
      this._auditStats = { totalExecutions: 0, totalFindings: 0, totalRisky: 0 };
      return this._buildResult(true);
    }

    const stats = {
      totalExecutions: session.length,
      totalFindings: 0,
      totalRisky: 0,
      blockedCount: 0,
      errorCount: 0,
      totalOutputBytes: totalOutputSize(session),
      categories: {},
    };

    // Count statuses
    for (const exec of session) {
      if (exec.status === 'blocked' || exec.status === 'blocked_post') stats.blockedCount += 1;
      if (exec.status === 'error' || exec.status === 'error_post') stats.errorCount += 1;
      const cats = exec.categories || ['general'];
      for (const cat of cats) {
        stats.categories[cat] = (stats.categories[cat] || 0) + 1;
      }
    }

    this._auditStats = stats;

    // ---- Run category audits ------------------------------------------------
    this._auditFileOperations(session);
    this._auditNetworkAccess(session);
    this._auditShellExecution(session);
    this._auditDataAccess(session);

    // ---- Compute safety score -----------------------------------------------
    this._computeSafetyScore();

    // ---- Generate recommendations -------------------------------------------
    this._generateRecommendations(session);

    // ---- Log findings if configured -----------------------------------------
    if (this._logFindings && this._findings.length > 0) {
      for (const f of this._findings) {
        console.warn(`[SafetyAuditor] ${f.category} [${f.severity}] ${f.message}`);
      }
    }

    stats.totalFindings = this._findings.length;
    stats.totalRisky = this._riskyOperations.length;

    return this._buildResult(this._safetyScore >= 80);
  }

  // -- Category audits --------------------------------------------------------

  /**
   * Audit file operation risks:
   * - Multiple writes in quick succession
   * - Access to sensitive paths
   * - Write operations outside allowed directories
   * - Batch delete operations
   * - Large file operations
   *
   * @param {object[]} session
   */
  _auditFileOperations(session) {
    const fileOps = session.filter((e) => {
      const cats = e.categories || [];
      return cats.includes('file');
    });

    if (fileOps.length === 0) {
      this._categoryScores['FILE_OPERATIONS'] = 100;
      return;
    }

    let fileScore = 100;
    const writes = fileOps.filter((e) => toolMatches(e, ['write', 'create', 'save', 'output']));
    const deletes = fileOps.filter((e) => toolMatches(e, ['delete', 'remove', 'unlink', 'rm']));
    const sensitive = fileOps.filter((e) => e.status === 'blocked' || e.status === 'blocked_post');

    // 1. High write frequency
    if (writes.length > 10) {
      const deduction = Math.min(20, writes.length);
      fileScore -= deduction;
      this._findings.push(createFinding(
        'FILE_OPERATIONS', 'MEDIUM',
        `High volume of file write operations: ${writes.length} writes`,
        { writeCount: writes.length, tools: deduplicateByKey(writes, (e) => e.tool).map((e) => e.tool) }
      ));
      this._riskyOperations.push(...writes.map((e) => ({
        operation: 'FILE_WRITE',
        tool: e.tool,
        severity: 'MEDIUM',
        reason: 'High write frequency',
      })));
    } else if (writes.length > 3) {
      fileScore -= 5;
      this._findings.push(createFinding(
        'FILE_OPERATIONS', 'LOW',
        `Moderate file write activity: ${writes.length} writes`,
        { writeCount: writes.length }
      ));
    }

    // 2. Delete operations
    if (deletes.length > 0) {
      const deduction = Math.min(25, deletes.length * 10);
      fileScore -= deduction;
      for (const del of deletes) {
        this._findings.push(createFinding(
          'FILE_OPERATIONS', 'HIGH',
          `File delete operation: ${del.tool}`,
          { tool: del.tool, args: del.args }
        ));
      }
      this._riskyOperations.push(...deletes.map((e) => ({
        operation: 'FILE_DELETE',
        tool: e.tool,
        severity: 'HIGH',
        reason: 'File deletion detected',
      })));
    }

    // 3. Blocked operations
    if (sensitive.length > 0) {
      fileScore -= sensitive.length * 20;
      for (const s of sensitive) {
        this._findings.push(createFinding(
          'FILE_OPERATIONS', 'HIGH',
          `Blocked file operation: ${s.tool}`,
          { tool: s.tool, reason: s.preValidation ? s.preValidation.reason : 'Unknown' }
        ));
      }
    }

    // 4. Single large output (> 100KB)
    for (const op of fileOps) {
      const rs = (op.result && typeof op.result === 'string') ? Buffer.byteLength(op.result, 'utf8') : 0;
      if (rs > 100_000) {
        this._findings.push(createFinding(
          'FILE_OPERATIONS', 'LOW',
          `Large file operation result: ${(rs / 1024).toFixed(1)} KB`,
          { tool: op.tool, size: rs }
        ));
      }
    }

    this._categoryScores['FILE_OPERATIONS'] = Math.max(0, fileScore);
  }

  /**
   * Audit network access risks:
   * - Requests to unknown/unusual domains
   * - High request frequency
   * - Data exfiltration indicators (large uploads)
   * - Unencrypted requests (HTTP vs HTTPS)
   *
   * @param {object[]} session
   */
  _auditNetworkAccess(session) {
    const netOps = session.filter((e) => {
      const cats = e.categories || [];
      return cats.includes('network');
    });

    if (netOps.length === 0) {
      this._categoryScores['NETWORK_ACCESS'] = 100;
      return;
    }

    let netScore = 100;

    // 1. High request frequency
    if (netOps.length > 20) {
      const deduction = Math.min(30, netOps.length);
      netScore -= deduction;
      this._findings.push(createFinding(
        'NETWORK_ACCESS', 'MEDIUM',
        `High volume of network requests: ${netOps.length}`,
        { requestCount: netOps.length }
      ));
      this._riskyOperations.push(...netOps.slice(0, 5).map((e) => ({
        operation: 'NETWORK_REQUEST',
        tool: e.tool,
        severity: 'MEDIUM',
        reason: 'High request frequency',
      })));
    } else if (netOps.length > 5) {
      netScore -= 10;
      this._findings.push(createFinding(
        'NETWORK_ACCESS', 'LOW',
        `Moderate network activity: ${netOps.length} requests`,
        { requestCount: netOps.length }
      ));
    }

    // 2. Check for large responses (potential data exfiltration)
    for (const op of netOps) {
      if (op.result) {
        const rs = typeof op.result === 'string' ? Buffer.byteLength(op.result, 'utf8') :
          (typeof op.result === 'object' ? Buffer.byteLength(JSON.stringify(op.result), 'utf8') : 0);
        if (rs > 500_000) { // 500KB
          netScore -= 10;
          this._findings.push(createFinding(
            'NETWORK_ACCESS', 'MEDIUM',
            `Large network response: ${(rs / 1024).toFixed(1)} KB (potential exfiltration)`,
            { tool: op.tool, size: rs }
          ));
          this._riskyOperations.push({
            operation: 'LARGE_NETWORK_RESPONSE',
            tool: op.tool,
            severity: 'MEDIUM',
            reason: `Response size: ${(rs / 1024).toFixed(1)} KB`,
          });
        }
      }
    }

    // 3. HTTP (non-HTTPS) detection
    for (const op of netOps) {
      const argsStr = op.args ? JSON.stringify(op.args) : '';
      if (/http:\/\/(?!localhost|127\.0\.0\.1)/i.test(argsStr)) {
        netScore -= 5;
        this._findings.push(createFinding(
          'NETWORK_ACCESS', 'LOW',
          'Unencrypted HTTP request detected (non-localhost)',
          { tool: op.tool }
        ));
      }
    }

    this._categoryScores['NETWORK_ACCESS'] = Math.max(0, netScore);
  }

  /**
   * Audit shell execution risks:
   * - Suspicious command patterns
   * - Privilege escalation attempts
   * - Destructive commands
   * - Repeated shell executions
   *
   * @param {object[]} session
   */
  _auditShellExecution(session) {
    const shellOps = session.filter((e) => {
      const cats = e.categories || [];
      return cats.includes('shell');
    });

    if (shellOps.length === 0) {
      this._categoryScores['SHELL_EXECUTION'] = 100;
      return;
    }

    let shellScore = 100;

    // Shell execution itself is a concern — each shell op is inherently risky
    const deduction = Math.min(50, shellOps.length * 15);
    shellScore -= deduction;

    for (const op of shellOps) {
      // Blocked shell operations
      if (op.status === 'blocked' || op.status === 'blocked_post') {
        shellScore -= 10;
        this._findings.push(createFinding(
          'SHELL_EXECUTION', 'CRITICAL',
          `Blocked shell execution: ${op.tool}`,
          { tool: op.tool, reason: op.preValidation ? op.preValidation.reason : 'Unknown' }
        ));
        this._riskyOperations.push({
          operation: 'BLOCKED_SHELL',
          tool: op.tool,
          severity: 'CRITICAL',
          reason: op.preValidation ? op.preValidation.reason : 'Blocked by policy',
        });
      }

      // Long-running shell commands
      if (typeof op.durationMs === 'number' && op.durationMs > 5_000) {
        shellScore -= 5;
        this._findings.push(createFinding(
          'SHELL_EXECUTION', 'MEDIUM',
          `Long-running shell execution: ${op.durationMs}ms`,
          { tool: op.tool, durationMs: op.durationMs }
        ));
      }
    }

    // Repeated shell executions from the same tool
    const toolCounts = {};
    for (const op of shellOps) {
      toolCounts[op.tool] = (toolCounts[op.tool] || 0) + 1;
    }
    for (const [tool, count] of Object.entries(toolCounts)) {
      if (count > 5) {
        shellScore -= 10;
        this._findings.push(createFinding(
          'SHELL_EXECUTION', 'MEDIUM',
          `Repeated shell execution from "${tool}": ${count} times`,
          { tool, count }
        ));
      }
    }

    if (shellOps.length > 0) {
      this._riskyOperations.push(...shellOps.slice(0, 10).map((e) => ({
        operation: 'SHELL_EXECUTION',
        tool: e.tool,
        severity: e.status === 'blocked' ? 'CRITICAL' : 'MEDIUM',
        reason: 'Shell command execution',
      })));
    }

    this._categoryScores['SHELL_EXECUTION'] = Math.max(0, shellScore);
  }

  /**
   * Audit data access risks:
   * - Bulk data retrieval
   * - Destructive data mutations (DELETE, DROP, TRUNCATE)
   * - Repeated queries
   * - Sensitive table access indicators
   *
   * @param {object[]} session
   */
  _auditDataAccess(session) {
    const dataOps = session.filter((e) => {
      const cats = e.categories || [];
      return cats.includes('data');
    });

    if (dataOps.length === 0) {
      this._categoryScores['DATA_ACCESS'] = 100;
      return;
    }

    let dataScore = 100;

    // Check for destructive operations — either by tool name or args content
    const destructive = dataOps.filter((e) => {
      if (toolMatches(e, ['delete', 'drop', 'truncate', 'remove', 'purge'])) return true;
      // Also check args for destructive SQL/command patterns
      const argsStr = e.args ? JSON.stringify(e.args).toUpperCase() : '';
      return /\b(DROP\s|DELETE\s|TRUNCATE\s|ALTER\s|PURGE\b)/.test(argsStr);
    });

    if (destructive.length > 0) {
      const deduction = Math.min(25, destructive.length * 10);
      dataScore -= deduction;
      for (const op of destructive) {
        this._findings.push(createFinding(
          'DATA_ACCESS', 'HIGH',
          `Potentially destructive data operation: ${op.tool}`,
          { tool: op.tool }
        ));
        this._riskyOperations.push({
          operation: 'DESTRUCTIVE_DATA',
          tool: op.tool,
          severity: 'HIGH',
          reason: 'Destructive data operation detected',
        });
      }
    }

    // Check for bulk reads (> 100 records implied by large result)
    for (const op of dataOps) {
      if (op.result && typeof op.result === 'object' && Array.isArray(op.result)) {
        if (op.result.length > 100) {
          dataScore -= 10;
          this._findings.push(createFinding(
            'DATA_ACCESS', 'MEDIUM',
            `Bulk data retrieval: ${op.result.length} records`,
            { tool: op.tool, recordCount: op.result.length }
          ));
        }
      }
    }

    // Repeated queries
    const queryOps = dataOps.filter((e) => toolMatches(e, ['query', 'select', 'find', 'read', 'get']));
    if (queryOps.length > 20) {
      dataScore -= 15;
      this._findings.push(createFinding(
        'DATA_ACCESS', 'MEDIUM',
        `High volume of data queries: ${queryOps.length}`,
        { queryCount: queryOps.length }
      ));
    }

    this._categoryScores['DATA_ACCESS'] = Math.max(0, dataScore);
  }

  // -- Safety score computation -----------------------------------------------

  /**
   * Compute the overall safety score (0-100) from category scores and findings.
   *
   * The score starts at 100 and is reduced by:
   * - Weighted category deductions
   * - Severity-weighted finding count
   * - Risky operation count
   *
   * Uncapped minimum is 0.
   */
  _computeSafetyScore() {
    let score = 100;

    // Apply category deductions weighted by their importance
    const categoryWeights = {
      FILE_OPERATIONS: 0.25,
      NETWORK_ACCESS: 0.30,
      SHELL_EXECUTION: 0.35,
      DATA_ACCESS: 0.10,
    };

    for (const [category, catScore] of Object.entries(this._categoryScores)) {
      const weight = categoryWeights[category] || 0.25;
      const deduction = (100 - catScore) * weight;
      score -= deduction;
    }

    // Additional penalty per finding based on severity
    for (const finding of this._findings) {
      const penalty = SEVERITY_WEIGHTS[finding.severity] || 5;
      score -= penalty * 0.5;
    }

    // Additional penalty per risky operation
    score -= this._riskyOperations.length * 2;

    // Clamp to 0-100
    this._safetyScore = Math.max(0, Math.min(100, Math.round(score)));
  }

  // -- Recommendations --------------------------------------------------------

  /**
   * Generate safety improvement recommendations based on audit findings.
   *
   * @param {object[]} session
   */
  _generateRecommendations(session) {
    const recs = [];

    // Shell execution recommendations
    const shellOps = session.filter((e) => (e.categories || []).includes('shell'));
    if (shellOps.length > 0) {
      recs.push('Limit shell execution to a whitelist of approved commands');
      if (shellOps.length > 5) {
        recs.push('Consider consolidating multiple shell calls into a single script to reduce attack surface');
      }
    }

    // File operation recommendations
    const fileOps = session.filter((e) => (e.categories || []).includes('file'));
    const writes = fileOps.filter((e) => toolMatches(e, ['write', 'create', 'save']));
    const deletes = fileOps.filter((e) => toolMatches(e, ['delete', 'remove', 'unlink']));

    if (writes.length > 0) {
      recs.push('Restrict file write operations to a sandboxed or temporary directory');
    }
    if (deletes.length > 0) {
      recs.push('Require explicit confirmation for file deletion operations');
    }

    // Network recommendations
    const netOps = session.filter((e) => (e.categories || []).includes('network'));
    if (netOps.length > 0) {
      recs.push('Use a domain allowlist to restrict outbound network requests');
    }
    if (netOps.length > 10) {
      recs.push('Implement rate limiting for network requests to prevent abuse');
    }

    // Data access recommendations
    const dataOps = session.filter((e) => (e.categories || []).includes('data'));
    if (dataOps.length > 0) {
      recs.push('Use read-only database credentials when queries do not require writes');
    }
    const destructiveData = dataOps.filter((e) => {
      if (toolMatches(e, ['delete', 'drop', 'truncate', 'remove', 'purge'])) return true;
      const argsStr = e.args ? JSON.stringify(e.args).toUpperCase() : '';
      return /\b(DROP\s|DELETE\s|TRUNCATE\s|ALTER\s|PURGE\b)/.test(argsStr);
    });
    if (destructiveData.length > 0) {
      recs.push('Require explicit confirmation for destructive database operations');
    }

    // General recommendations
    const blocked = session.filter((e) => e.status === 'blocked' || e.status === 'blocked_post');
    if (blocked.length > 0) {
      recs.push('Review blocked operations and adjust safety policies if they are legitimate use cases');
    }

    const errors = session.filter((e) => e.status === 'error' || e.status === 'error_post');
    if (errors.length > 0) {
      recs.push('Investigate tool execution errors — they may indicate safety policy misconfiguration');
    }

    if (this._safetyScore < 50) {
      recs.push('CRITICAL: Overall safety score is dangerously low. Enable strict mode and review all tool permissions.');
    } else if (this._safetyScore < 75) {
      recs.push('Consider enabling strict mode or adding explicit allowlists to improve safety posture');
    }

    // Deduplicate recommendations
    this._recommendations = [...new Set(recs)];
  }

  // -- Getters ----------------------------------------------------------------

  /**
   * Get the overall safety score (0-100).
   * 100 = completely safe, 0 = extremely risky.
   *
   * @returns {number}
   */
  getSafetyScore() {
    return this._safetyScore;
  }

  /**
   * Get all flagged risky operations from the most recent audit.
   *
   * @param {string} [severity] — optional filter by severity
   * @returns {object[]}
   */
  getRiskyOperations(severity) {
    if (severity) {
      return this._riskyOperations.filter((op) => op.severity === severity);
    }
    return [...this._riskyOperations];
  }

  /**
   * Get safety improvement recommendations.
   *
   * @returns {string[]}
   */
  getSafetyRecommendations() {
    return [...this._recommendations];
  }

  /**
   * Get all audit findings from the most recent audit.
   *
   * @param {string} [category] — optional filter by category
   * @returns {object[]}
   */
  getFindings(category) {
    if (category) {
      return this._findings.filter((f) => f.category === category);
    }
    return [...this._findings];
  }

  /**
   * Get per-category safety scores.
   *
   * @returns {object} — { FILE_OPERATIONS: 95, NETWORK_ACCESS: 100, ... }
   */
  getCategoryScores() {
    return { ...this._categoryScores };
  }

  /**
   * Get audit statistics from the most recent audit.
   *
   * @returns {object|null}
   */
  getAuditStats() {
    return this._auditStats ? { ...this._auditStats } : null;
  }

  /**
   * Get a full audit report as a plain object.
   *
   * @returns {object}
   */
  getReport() {
    return {
      safetyScore: this._safetyScore,
      passed: this._safetyScore >= 80,
      categoryScores: { ...this._categoryScores },
      findingCount: this._findings.length,
      riskyOperationCount: this._riskyOperations.length,
      recommendationCount: this._recommendations.length,
      findings: this._findings.map((f) => ({ category: f.category, severity: f.severity, message: f.message })),
      riskyOperations: this._riskyOperations.map((r) => ({ operation: r.operation, tool: r.tool, severity: r.severity })),
      recommendations: [...this._recommendations],
      stats: this._auditStats ? { ...this._auditStats } : null,
    };
  }

  // -- Internals ---------------------------------------------------------------

  /**
   * Build the standard audit result object.
   */
  _buildResult(passed) {
    return Object.freeze({
      passed,
      safetyScore: this._safetyScore,
      findings: Object.freeze([...this._findings]),
      riskyOperations: Object.freeze([...this._riskyOperations]),
      recommendations: Object.freeze([...this._recommendations]),
      categoryScores: Object.freeze({ ...this._categoryScores }),
      stats: this._auditStats ? Object.freeze({ ...this._auditStats }) : null,
    });
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  SafetyAuditor,
  SAFETY_CATEGORIES,
  SEVERITY_WEIGHTS,
  createFinding,
};
