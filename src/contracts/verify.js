"use strict";

const { getRequirements, getGuarantees } = require('./define');

const COMPLIANCE_THRESHOLDS = Object.freeze({
  CRITICAL: 60,
  WARNING: 80,
  OPTIMAL: 100,
});

const VIOLATION_TYPE = Object.freeze({
  MISSING_TOOL: 'missing_tool',
  MISSING_PERMISSION: 'missing_permission',
  MISSING_MODEL: 'missing_model',
  INSUFFICIENT_CAPABILITY: 'insufficient_capability',
  TIMEOUT_RISK: 'timeout_risk',
  RETRY_RISK: 'retry_risk',
  ROLE_MISMATCH: 'role_mismatch',
  UNSUPPORTED_FEATURE: 'unsupported_feature',
});

class ContractVerifier {
  constructor(options = {}) {
    this._strictMode = options.strictMode === true;
    this._verbose = options.verbose === true;
  }

  get strictMode() {
    return this._strictMode;
  }

  verifyCompliance(agent, contract) {
    requireAgent(agent);
    requireContract(contract);

    const violations = [];
    const warnings = [];
    const checks = [];

    const requirements = getRequirements(contract);

    // Check tools
    const toolResult = this.checkTools(
      requirements.tools,
      normalizeList((agent && agent.tools) || [])
    );
    checks.push({ category: 'tools', ...toolResult });
    if (!toolResult.pass) {
      for (const missing of toolResult.missing) {
        violations.push({
          type: VIOLATION_TYPE.MISSING_TOOL,
          message: `Required tool not available: ${missing}`,
          detail: { tool: missing, available: toolResult.available },
        });
      }
    }

    // Check permissions
    const permResult = this.checkPermissions(
      requirements.permissions,
      normalizeList((agent && agent.permissions) || [])
    );
    checks.push({ category: 'permissions', ...permResult });
    if (!permResult.pass) {
      for (const missing of permResult.missing) {
        violations.push({
          type: VIOLATION_TYPE.MISSING_PERMISSION,
          message: `Required permission not granted: ${missing}`,
          detail: { permission: missing, granted: permResult.granted },
        });
      }
    }

    // Check models
    const modelResult = this.checkModel(
      requirements.models,
      normalizeList((agent && agent.models) || [])
    );
    checks.push({ category: 'models', ...modelResult });
    if (!modelResult.pass) {
      for (const missing of modelResult.missing) {
        violations.push({
          type: VIOLATION_TYPE.MISSING_MODEL,
          message: `Required model not available: ${missing}`,
          detail: { model: missing, available: modelResult.available },
        });
      }
    }

    // Check capacity (timeout/retry)
    const capacityResult = this.checkCapacity(agent, contract);
    checks.push({ category: 'capacity', ...capacityResult });
    for (const warn of capacityResult.warnings || []) {
      warnings.push(warn);
    }

    // Role check
    const roleResult = this.checkRoleCompatibility(agent, contract);
    checks.push({ category: 'role', ...roleResult });
    if (!roleResult.pass) {
      warnings.push({
        type: VIOLATION_TYPE.ROLE_MISMATCH,
        message: roleResult.message,
        detail: roleResult.detail,
      });
    }

    const compliant = violations.length === 0;
    const report = {
      compliant,
      violations,
      warnings,
      score: this._calculateScore(checks, violations, warnings),
      checks,
      timestamp: new Date().toISOString(),
    };

    return report;
  }

  checkTools(required, available) {
    requireArray(required, 'required tools');
    requireArray(available, 'available tools');

    const availSet = new Set(available);
    const missing = required.filter((tool) => !availSet.has(tool));

    return {
      pass: missing.length === 0,
      missing,
      available,
      required,
      coverage: required.length > 0
        ? ((required.length - missing.length) / required.length) * 100
        : 100,
    };
  }

  checkPermissions(required, granted) {
    requireArray(required, 'required permissions');
    requireArray(granted, 'granted permissions');

    const grantedSet = new Set(granted);
    const missing = required.filter((perm) => !grantedSet.has(perm));

    return {
      pass: missing.length === 0,
      missing,
      granted,
      required,
      coverage: required.length > 0
        ? ((required.length - missing.length) / required.length) * 100
        : 100,
    };
  }

  checkModel(required, available) {
    requireArray(required, 'required models');
    requireArray(available, 'available models');

    const results = [];
    const availSet = new Set(available);
    const missing = [];

    for (const modelReq of required) {
      // Support model patterns like "claude-sonnet-4*" or "gpt-4*"
      const matched = this._matchModelPattern(modelReq, available);
      if (matched) {
        results.push({ required: modelReq, matched, capability: 'sufficient' });
      } else {
        const isWildcard = modelReq.includes('*');
        if (isWildcard) {
          // Wildcard didn't match anything
          missing.push(modelReq);
        } else {
          // Exact model not found, check for compatible
          const compatible = this._findCompatibleModel(modelReq, available);
          if (compatible) {
            results.push({
              required: modelReq,
              matched: compatible,
              capability: this._strictMode ? 'insufficient' : 'compatible',
            });
            if (this._strictMode) {
              missing.push(modelReq);
            }
          } else {
            missing.push(modelReq);
          }
        }
      }
    }

    return {
      pass: missing.length === 0,
      missing,
      available,
      required,
      matches: results,
      coverage: required.length > 0
        ? ((required.length - missing.length) / required.length) * 100
        : 100,
    };
  }

  checkCapacity(agent, contract) {
    requireAgent(agent);
    requireContract(contract);

    const warnings = [];
    const contractTimeout = Number.isSafeInteger(contract.timeout) && contract.timeout > 0
      ? contract.timeout
      : 30000;
    const agentTimeout = Number.isSafeInteger(agent.timeout) && agent.timeout > 0
      ? agent.timeout
      : null;

    // Check if agent timeout exceeds contract timeout
    if (agentTimeout !== null && agentTimeout > contractTimeout * 2) {
      warnings.push({
        type: VIOLATION_TYPE.TIMEOUT_RISK,
        message: `Agent timeout (${agentTimeout}ms) significantly exceeds contract timeout (${contractTimeout}ms)`,
        detail: { agentTimeout, contractTimeout },
      });
    }

    // Check retry capability
    const contractRetry = typeof contract.retry === 'object' && contract.retry !== null
      ? contract.retry
      : {};
    const contractMaxAttempts = Number.isSafeInteger(contractRetry.maxAttempts) && contractRetry.maxAttempts > 0
      ? contractRetry.maxAttempts
      : 3;

    if (typeof agent.retry !== 'undefined' && agent.retry !== null) {
      const agentMaxAttempts = Number.isSafeInteger(agent.retry) ? agent.retry : null;
      if (agentMaxAttempts !== null && agentMaxAttempts < contractMaxAttempts) {
        warnings.push({
          type: VIOLATION_TYPE.RETRY_RISK,
          message: `Agent max retry attempts (${agentMaxAttempts}) lower than contract requirement (${contractMaxAttempts})`,
          detail: { agentMaxAttempts, contractMaxAttempts },
        });
      }
    }

    return {
      pass: warnings.length === 0,
      capacity: 'adequate',
      warnings,
    };
  }

  checkRoleCompatibility(agent, contract) {
    requireAgent(agent);
    requireContract(contract);

    const agentRole = String(typeof agent.role === 'string' ? agent.role : agent.agentType || '').trim().toLowerCase();
    const agentName = String(typeof agent.name === 'string' ? agent.name : agent.agentType || '').trim().toLowerCase();
    const contractName = String(contract.name || '').trim().toLowerCase();

    if (!agentRole && !agentName) {
      return {
        pass: true,
        message: 'No agent role to check',
      };
    }

    // Check if contract name contains agent role or vice versa
    const roleMatch = contractName.includes(agentRole) || agentRole.includes(contractName);
    const nameMatch = contractName.includes(agentName) || agentName.includes(contractName);

    if (roleMatch || nameMatch) {
      return {
        pass: true,
        message: 'Role and contract appear compatible',
        detail: { agentRole: agentRole || agentName, contractName },
      };
    }

    return {
      pass: !this._strictMode,
      message: `Agent role "${agentRole || agentName}" does not match contract name "${contractName}"`,
      detail: { agentRole: agentRole || agentName, contractName },
    };
  }

  generateComplianceReport(agent, contract) {
    const result = this.verifyCompliance(agent, contract);

    const report = {
      summary: {
        compliant: result.compliant,
        score: result.score,
        violations: result.violations.length,
        warnings: result.warnings.length,
        timestamp: result.timestamp,
      },
      details: result,
      recommendations: this._generateRecommendations(result),
    };

    if (this._verbose) {
      report.metadata = {
        agent: summarizeAgent(agent),
        contract: summarizeContract(contract),
        thresholds: COMPLIANCE_THRESHOLDS,
        verifierOptions: {
          strictMode: this._strictMode,
          verbose: this._verbose,
        },
      };
    }

    return report;
  }

  // --- Internal ---

  _matchModelPattern(pattern, available) {
    if (!pattern.includes('*')) {
      return available.includes(pattern) ? pattern : null;
    }

    const prefix = pattern.replace(/\*/g, '');
    const matched = available.find((m) => m.startsWith(prefix));
    return matched || null;
  }

  _findCompatibleModel(required, available) {
    // Simple compatibility: same provider prefix
    const reqLower = required.toLowerCase();
    for (const avail of available) {
      const availLower = avail.toLowerCase();
      // Check shared provider prefix (e.g., both start with "claude" or "gpt")
      const providers = ['claude', 'gpt', 'llama', 'gemini', 'deepseek', 'mistral', 'mixtral'];
      for (const provider of providers) {
        if (reqLower.startsWith(provider) && availLower.startsWith(provider)) {
          return avail;
        }
      }
    }
    return null;
  }

  _calculateScore(checks, violations, warnings) {
    const totalChecks = checks.length;
    if (totalChecks === 0) {
      return 100;
    }

    const categoryWeights = {
      tools: 30,
      permissions: 25,
      models: 25,
      capacity: 10,
      role: 10,
    };

    let totalWeight = 0;
    let earnedWeight = 0;

    for (const check of checks) {
      const weight = categoryWeights[check.category] || 10;
      totalWeight += weight;

      if (check.category === 'capacity') {
        earnedWeight += check.pass ? weight : weight * 0.5;
      } else if (check.category === 'role') {
        earnedWeight += check.pass ? weight : weight * 0.5;
      } else {
        // tools, permissions, models: scale by coverage
        const coverage = typeof check.coverage === 'number' ? check.coverage : (check.pass ? 100 : 0);
        earnedWeight += (coverage / 100) * weight;
      }
    }

    return totalWeight > 0 ? Math.round(earnedWeight) : 100;
  }

  _generateRecommendations(result) {
    const recommendations = [];

    if (result.violations.length > 0) {
      const toolViolations = result.violations.filter((v) => v.type === VIOLATION_TYPE.MISSING_TOOL);
      const permViolations = result.violations.filter((v) => v.type === VIOLATION_TYPE.MISSING_PERMISSION);
      const modelViolations = result.violations.filter((v) => v.type === VIOLATION_TYPE.MISSING_MODEL);

      if (toolViolations.length > 0) {
        recommendations.push(`Add missing tools to agent: ${toolViolations.map((v) => v.detail.tool).join(', ')}`);
      }
      if (permViolations.length > 0) {
        recommendations.push(`Grant missing permissions to agent: ${permViolations.map((v) => v.detail.permission).join(', ')}`);
      }
      if (modelViolations.length > 0) {
        recommendations.push(`Provide access to missing models: ${modelViolations.map((v) => v.detail.model).join(', ')}`);
      }
    }

    if (result.warnings.length > 0) {
      recommendations.push('Review warnings for potential compliance risks before activation.');
    }

    if (result.compliant) {
      recommendations.push('Agent is fully compliant. The contract can be activated.');
    }

    return recommendations;
  }
}

// --- Helpers ---

function requireAgent(agent) {
  if (!agent || typeof agent !== 'object') {
    throw new Error('Agent must be a non-null object');
  }
}

function requireContract(contract) {
  if (!contract || typeof contract !== 'object') {
    throw new Error('Contract must be a non-null object');
  }
}

function requireArray(value, name) {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array, got ${typeof value}`);
  }
}

function normalizeList(value) {
  if (value === undefined || value === null || value === '') {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function summarizeAgent(agent) {
  return {
    name: typeof agent.name === 'string' ? agent.name : null,
    agentType: typeof agent.agentType === 'string' ? agent.agentType : null,
    role: typeof agent.role === 'string' ? agent.role : null,
    toolCount: Array.isArray(agent.tools) ? agent.tools.length : 0,
    modelCount: Array.isArray(agent.models) ? agent.models.length : 0,
  };
}

function summarizeContract(contract) {
  const requirements = typeof contract.requirements === 'object' && contract.requirements !== null
    ? contract.requirements
    : {};
  return {
    name: typeof contract.name === 'string' ? contract.name : null,
    version: typeof contract.version === 'string' ? contract.version : null,
    toolRequirements: Array.isArray(requirements.tools) ? requirements.tools.length : 0,
    permissionRequirements: Array.isArray(requirements.permissions) ? requirements.permissions.length : 0,
    modelRequirements: Array.isArray(requirements.models) ? requirements.models.length : 0,
  };
}

module.exports = {
  ContractVerifier,
  COMPLIANCE_THRESHOLDS,
  VIOLATION_TYPE,
};
