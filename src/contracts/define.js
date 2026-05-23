"use strict";

const CONTRACT_STATES = Object.freeze({
  DRAFT: 'draft',
  PROPOSED: 'proposed',
  NEGOTIATING: 'negotiating',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  TERMINATED: 'terminated',
});

const CONTRACT_SCHEMA = Object.freeze({
  name: { type: 'string', required: true },
  version: { type: 'string', required: true },
  input: { type: 'object', required: true },
  output: { type: 'object', required: true },
  requirements: { type: 'object', required: false },
  guarantees: { type: 'object', required: false },
  timeout: { type: 'number', required: false },
  retry: { type: 'object', required: false },
});

const GUARANTEES_SCHEMA = Object.freeze({
  deliverables: { type: 'array', required: false },
  qualityLevel: { type: 'string', required: false },
  slos: { type: 'object', required: false },
  constraints: { type: 'array', required: false },
});

const REQUIREMENTS_SCHEMA = Object.freeze({
  tools: { type: 'array', required: false },
  permissions: { type: 'array', required: false },
  models: { type: 'array', required: false },
  resources: { type: 'array', required: false },
  dependencies: { type: 'array', required: false },
});

const RETRY_SCHEMA = Object.freeze({
  maxAttempts: { type: 'number', required: false },
  backoff: { type: 'string', required: false },
  backoffFactor: { type: 'number', required: false },
});

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_RETRY_ATTEMPTS = 3;

class AgentContract {
  constructor(contract) {
    requireContract(contract);
    this._contract = deepClone(contract);
    this._state = CONTRACT_STATES.DRAFT;
    this._createdAt = new Date().toISOString();
    this._updatedAt = this._createdAt;
    this._id = `contract-${generateId()}`;
  }

  get id() {
    return this._id;
  }

  get state() {
    return this._state;
  }

  get contract() {
    return deepClone(this._contract);
  }

  get createdAt() {
    return this._createdAt;
  }

  get updatedAt() {
    return this._updatedAt;
  }

  _setState(newState) {
    if (!Object.values(CONTRACT_STATES).includes(newState)) {
      throw new Error(`Invalid contract state: ${newState}`);
    }
    this._state = newState;
    this._updatedAt = new Date().toISOString();
  }
}

function define(contract) {
  requireContract(contract);
  const validated = validateContractSchema(contract);
  const normalized = normalizeContract(validated);
  return new AgentContract(normalized);
}

function validate(agent, contract) {
  requireAgent(agent);
  requireContract(contract);

  const issues = [];

  const requirements = getRequirements(contract);
  const agentTools = normalizeList((agent && agent.tools) || []);
  const agentPermissions = normalizeList((agent && agent.permissions) || []);
  const agentModels = normalizeList((agent && agent.models) || []);
  const agentRole = String(typeof agent.role === 'string' ? agent.role : agent.agentType || '').trim();

  if (requirements.tools.length > 0) {
    const missingTools = requirements.tools.filter(
      (tool) => !agentTools.includes(tool)
    );
    if (missingTools.length > 0) {
      issues.push({
        type: 'tools',
        severity: 'error',
        message: `Agent missing required tools: ${missingTools.join(', ')}`,
        missing: missingTools,
      });
    }
  }

  if (requirements.permissions.length > 0) {
    const missingPermissions = requirements.permissions.filter(
      (perm) => !agentPermissions.includes(perm)
    );
    if (missingPermissions.length > 0) {
      issues.push({
        type: 'permissions',
        severity: 'error',
        message: `Agent missing required permissions: ${missingPermissions.join(', ')}`,
        missing: missingPermissions,
      });
    }
  }

  if (requirements.models.length > 0) {
    const missingModels = requirements.models.filter(
      (model) => !agentModels.includes(model)
    );
    if (missingModels.length > 0) {
      issues.push({
        type: 'models',
        severity: 'error',
        message: `Agent missing required models: ${missingModels.join(', ')}`,
        missing: missingModels,
      });
    }
  }

  if (agentRole) {
    const contractName = typeof contract === 'object' && contract !== null
      ? String(contract.name || '').toLowerCase()
      : '';
    if (contractName && !agentRole.toLowerCase().includes(contractName) && !contractName.includes(agentRole.toLowerCase())) {
      issues.push({
        type: 'role',
        severity: 'warning',
        message: `Agent role "${agentRole}" may not match contract name "${contractName}"`,
      });
    }
  }

  return {
    valid: issues.every((issue) => issue.severity !== 'error'),
    issues,
  };
}

function getInterface(contract) {
  requireContract(contract);
  return {
    input: deepClone(typeof contract.input === 'object' ? contract.input : {}),
    output: deepClone(typeof contract.output === 'object' ? contract.output : {}),
  };
}

function getRequirements(contract) {
  requireContract(contract);
  const req = typeof contract.requirements === 'object' && contract.requirements !== null
    ? contract.requirements
    : {};
  return {
    tools: normalizeList(req.tools),
    permissions: normalizeList(req.permissions),
    models: normalizeList(req.models),
    resources: normalizeList(req.resources),
    dependencies: normalizeList(req.dependencies),
  };
}

function getGuarantees(contract) {
  requireContract(contract);
  const g = typeof contract.guarantees === 'object' && contract.guarantees !== null
    ? contract.guarantees
    : {};
  return {
    deliverables: normalizeList(g.deliverables),
    qualityLevel: String(g.qualityLevel || 'standard').trim(),
    slos: typeof g.slos === 'object' && g.slos !== null ? deepClone(g.slos) : {},
    constraints: normalizeList(g.constraints),
  };
}

// --- Internal helpers ---

function validateContractSchema(contract) {
  const errors = [];

  for (const [field, schema] of Object.entries(CONTRACT_SCHEMA)) {
    if (schema.required && (contract[field] === undefined || contract[field] === null)) {
      errors.push(`Contract missing required field: "${field}"`);
      continue;
    }

    if (contract[field] !== undefined && contract[field] !== null) {
      const actualType = Array.isArray(contract[field]) ? 'array' : typeof contract[field];
      if (actualType !== schema.type) {
        errors.push(`Contract field "${field}" must be of type ${schema.type}, got ${actualType}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Contract validation failed: ${errors.join('; ')}`);
  }

  return contract;
}

function normalizeContract(contract) {
  const requirements = typeof contract.requirements === 'object' && contract.requirements !== null
    ? contract.requirements
    : {};
  const guarantees = typeof contract.guarantees === 'object' && contract.guarantees !== null
    ? contract.guarantees
    : {};
  const retry = typeof contract.retry === 'object' && contract.retry !== null
    ? contract.retry
    : {};

  return {
    name: String(contract.name || '').trim(),
    version: String(contract.version || '1.0.0').trim(),
    input: deepClone(contract.input),
    output: deepClone(contract.output),
    requirements: {
      tools: normalizeList(requirements.tools),
      permissions: normalizeList(requirements.permissions),
      models: normalizeList(requirements.models),
      resources: normalizeList(requirements.resources),
      dependencies: normalizeList(requirements.dependencies),
    },
    guarantees: {
      deliverables: normalizeList(guarantees.deliverables),
      qualityLevel: String(guarantees.qualityLevel || 'standard').trim(),
      slos: typeof guarantees.slos === 'object' && guarantees.slos !== null ? deepClone(guarantees.slos) : {},
      constraints: normalizeList(guarantees.constraints),
    },
    timeout: Number.isSafeInteger(contract.timeout) && contract.timeout > 0
      ? contract.timeout
      : DEFAULT_TIMEOUT,
    retry: {
      maxAttempts: Number.isSafeInteger(retry.maxAttempts) && retry.maxAttempts > 0
        ? retry.maxAttempts
        : DEFAULT_MAX_RETRY_ATTEMPTS,
      backoff: String(retry.backoff || 'exponential').trim(),
      backoffFactor: Number.isSafeInteger(retry.backoffFactor) && retry.backoffFactor > 0
        ? retry.backoffFactor
        : 2,
    },
  };
}

function requireContract(contract) {
  if (!contract || typeof contract !== 'object') {
    throw new Error('Contract must be a non-null object');
  }
}

function requireAgent(agent) {
  if (!agent || typeof agent !== 'object') {
    throw new Error('Agent must be a non-null object');
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

function deepClone(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
}

function generateId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `${timestamp}-${random}`;
}

module.exports = {
  AgentContract,
  CONTRACT_STATES,
  define,
  validate,
  getInterface,
  getRequirements,
  getGuarantees,
};
