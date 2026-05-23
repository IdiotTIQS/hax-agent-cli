"use strict";

const VALID_STEP_TYPES = new Set(["tool", "agent", "condition", "wait", "parallel"]);
const REQUIRED_STEP_FIELDS = ["id", "type"];

// Guards: format of a step's `config` per its `type`.
const TYPE_CONFIG_GUARDS = {
  tool: (config) => config && (typeof config.handler === "function" || (config.tool && typeof config.tool === "string")),
  agent: (config) => config && typeof config.handler === "function",
  condition: (config) => config && typeof config.evaluate === "function",
  wait: (config) => config && typeof config.duration === "number" && config.duration >= 0,
  parallel: (config) => config && Array.isArray(config.steps) && config.steps.length > 0,
};

// Longer description used in error messages.
const TYPE_CONFIG_DESC = {
  tool: "config.handler (function) or config.tool (string)",
  agent: "config.handler (function)",
  condition: "config.evaluate (function)",
  wait: "config.duration (non-negative number)",
  parallel: "config.steps (non-empty array)",
};

class WorkflowValidator {
  /**
   * Full validation of a workflow definition.
   * @param {object} workflow  { name, steps, description? }
   * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
   */
  validate(workflow) {
    const errors = [];
    const warnings = [];

    if (!workflow || typeof workflow !== "object") {
      errors.push("Workflow definition must be an object.");
      return { valid: false, errors, warnings };
    }

    // Top-level shape
    if (typeof workflow.name !== "string" || workflow.name.trim().length === 0) {
      errors.push('Workflow must have a non-empty "name" string.');
    }

    if (!Array.isArray(workflow.steps)) {
      errors.push('Workflow must have a "steps" array.');
      return { valid: false, errors, warnings };
    }

    if (workflow.steps.length === 0) {
      errors.push("Workflow must have at least one step.");
      return { valid: false, errors, warnings };
    }

    // Step-level validation
    const stepErrors = this.validateSteps(workflow.steps);
    errors.push(...stepErrors.errors);
    warnings.push(...stepErrors.warnings);

    if (stepErrors.fatal) {
      return { valid: false, errors, warnings };
    }

    // Dependency validation
    const depResult = this.validateDependencies(workflow.steps);
    errors.push(...depResult.errors);
    warnings.push(...depResult.warnings);

    // Type-specific validation
    const typeResult = this.validateTypes(workflow.steps);
    errors.push(...typeResult.errors);
    warnings.push(...typeResult.warnings);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate individual steps: required fields, types, numeric ranges, duplicates.
   * @param {Array<object>} steps
   * @returns {{ errors: string[], warnings: string[], fatal: boolean }}
   */
  validateSteps(steps) {
    const errors = [];
    const warnings = [];
    const ids = new Set();

    if (!Array.isArray(steps)) {
      errors.push("Steps must be an array.");
      return { errors, warnings, fatal: true };
    }

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      if (!step || typeof step !== "object") {
        const label = step === null ? "null" : typeof step;
        errors.push(`Step at index ${i} must be an object, got ${label}.`);
        continue;
      }

      // Required fields
      for (const field of REQUIRED_STEP_FIELDS) {
        if (!step[field]) {
          errors.push(`Step at index ${i} is missing required field "${field}".`);
        }
      }

      // id must be a non-empty string
      if (step.id !== undefined && (typeof step.id !== "string" || step.id.trim().length === 0)) {
        errors.push(`Step at index ${i}: "id" must be a non-empty string, got ${typeof step.id}.`);
      }

      const stepId = typeof step.id === "string" ? step.id.trim() : null;

      // Duplicate check
      if (stepId) {
        if (ids.has(stepId)) {
          errors.push(`Duplicate step id: "${stepId}".`);
        }
        ids.add(stepId);
      }

      // Type validity
      if (step.type) {
        if (!VALID_STEP_TYPES.has(step.type)) {
          errors.push(
            `Step "${stepId || `#${i}`}" has invalid type "${step.type}". ` +
            `Must be one of: ${[...VALID_STEP_TYPES].join(", ")}.`,
          );
        }
      }

      // Numeric fields
      for (const field of ["retryCount", "retryDelay", "timeout"]) {
        if (step[field] !== undefined && step[field] !== null) {
          const v = Number(step[field]);
          if (!Number.isSafeInteger(v) || v < 0) {
            errors.push(
              `Step "${stepId || `#${i}`}" field "${field}" must be a non-negative integer, got ${step[field]}.`,
            );
          }
        }
      }

      // continueOnError should be boolean
      if (step.continueOnError !== undefined && typeof step.continueOnError !== "boolean") {
        warnings.push(`Step "${stepId || `#${i}`}": "continueOnError" should be a boolean value.`);
      }

      // dependsOn should be an array of strings
      if (step.dependsOn !== undefined) {
        if (!Array.isArray(step.dependsOn)) {
          errors.push(`Step "${stepId || `#${i}`}": "dependsOn" must be an array.`);
        } else {
          for (let j = 0; j < step.dependsOn.length; j++) {
            if (typeof step.dependsOn[j] !== "string") {
              errors.push(
                `Step "${stepId || `#${i}`}" dependsOn[${j}] must be a string, got ${typeof step.dependsOn[j]}.`,
              );
            }
          }
        }
      }

      // Name is strongly recommended
      if (!step.name || (typeof step.name === "string" && step.name.trim().length === 0)) {
        warnings.push(`Step "${stepId || `#${i}`}" is missing a descriptive "name".`);
      }

      // config should be an object if present
      if (step.config !== undefined && (typeof step.config !== "object" || step.config === null || Array.isArray(step.config))) {
        warnings.push(`Step "${stepId || `#${i}`}": "config" should be a plain object.`);
      }
    }

    return { errors, warnings, fatal: false };
  }

  /**
   * Validate the dependency graph: dangling references, circular deps, dead steps.
   * @param {Array<object>} steps
   * @returns {{ errors: string[], warnings: string[] }}
   */
  validateDependencies(steps) {
    const errors = [];
    const warnings = [];
    const stepIds = new Set();

    for (const step of steps) {
      if (step.id && typeof step.id === "string") {
        stepIds.add(step.id.trim());
      }
    }

    // Dangling references
    for (const step of steps) {
      const stepId = step.id && typeof step.id === "string" ? step.id.trim() : null;
      const deps = Array.isArray(step.dependsOn) ? step.dependsOn : [];

      for (const dep of deps) {
        const depStr = String(dep).trim();
        if (!stepIds.has(depStr)) {
          errors.push(`Step "${stepId || "?"}" depends on unknown step: "${depStr}".`);
        }
        if (depStr === stepId) {
          errors.push(`Step "${stepId}" depends on itself, which creates a trivial cycle.`);
        }
      }
    }

    // Circular dependency detection (return cycle path for diagnostics)
    const cycles = this._findCycles(steps);
    if (cycles.length > 0) {
      for (const cycle of cycles) {
        errors.push(
          `Circular dependency detected: ${cycle.join(" -> ")} -> ${cycle[0]}.`,
        );
      }
    }

    // Dead steps: unreachable from any entry point
    const entryPoints = steps.filter((s) => {
      const deps = Array.isArray(s.dependsOn) ? s.dependsOn : [];
      return deps.length === 0;
    });

    if (entryPoints.length === 0 && steps.length > 0) {
      warnings.push("No entry point step found (all steps have dependencies). This may indicate a circular dependency issue.");
    }

    const deadSteps = this._findDeadSteps(steps);
    if (deadSteps.length > 0) {
      warnings.push(
        `Dead step(s) detected (unreachable from any entry point): ${deadSteps.join(", ")}.`,
      );
    }

    // Also detect exit points (steps nothing depends on)
    const hasOutgoing = new Set();
    for (const step of steps) {
      const deps = Array.isArray(step.dependsOn) ? step.dependsOn : [];
      for (const dep of deps) {
        hasOutgoing.add(String(dep).trim());
      }
    }
    const exitPoints = steps.filter((s) => !hasOutgoing.has(s.id));
    if (exitPoints.length === 0 && steps.length > 0) {
      warnings.push("No exit point step found (every step is a dependency of another). This may indicate a circular dependency issue.");
    }

    return { errors, warnings };
  }

  /**
   * Validate type-specific config requirements.
   * @param {Array<object>} steps
   * @returns {{ errors: string[], warnings: string[] }}
   */
  validateTypes(steps) {
    const errors = [];
    const warnings = [];

    for (const step of steps) {
      if (!step || !step.type) continue;

      const stepId = step.id && typeof step.id === "string" ? step.id.trim() : "?";
      const guard = TYPE_CONFIG_GUARDS[step.type];

      if (guard) {
        const config = step.config || {};
        if (!guard(config)) {
          errors.push(
            `Step "${stepId}" of type "${step.type}" requires ${TYPE_CONFIG_DESC[step.type] || "valid config"}.`,
          );
        }
      }

      // Additional type-specific warnings
      if (step.type === "wait" && step.config) {
        const dur = step.config.duration;
        if (dur !== undefined && (typeof dur !== "number" || dur < 0)) {
          errors.push(`Step "${stepId}" of type "wait" has invalid config.duration: ${dur}. Must be a non-negative number.`);
        }
      }

      if (step.type === "parallel" && step.config) {
        if (Array.isArray(step.config.steps)) {
          if (step.config.steps.length === 0) {
            warnings.push(`Step "${stepId}" of type "parallel" has an empty config.steps array.`);
          }
        }
      }

      if (step.type === "condition" && step.config) {
        if (step.config.evaluate !== undefined && typeof step.config.evaluate !== "function") {
          errors.push(`Step "${stepId}" of type "condition" has a non-function config.evaluate.`);
        }
      }
    }

    return { errors, warnings };
  }

  /**
   * Analyze a workflow and return auto-fix suggestions for each issue found.
   * Suggestions are best-effort and may not be applicable in all contexts.
   *
   * @param {object} workflow  { name, steps, description? }
   * @returns {Array<object>}  [{ issue, suggestion, stepId?, severity }]
   */
  suggestFixes(workflow) {
    const suggestions = [];
    const { errors, warnings } = this.validate(workflow);

    for (const err of errors) {
      const sug = this._suggestFix(err, "error");
      if (sug) suggestions.push(sug);
    }

    for (const warn of warnings) {
      const sug = this._suggestFix(warn, "warning");
      if (sug) suggestions.push(sug);
    }

    return suggestions;
  }

  // ---- Private internals ----

  /**
   * Find all cycles in the dependency graph using DFS.
   * @returns {Array<Array<string>>} each cycle is an array of step IDs forming the loop.
   */
  _findCycles(steps) {
    const adjacency = new Map();
    for (const step of steps) {
      if (step.id) {
        adjacency.set(step.id, (Array.isArray(step.dependsOn) ? step.dependsOn : []).map(String));
      }
    }

    const cycles = [];
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map();
    const parent = new Map();

    for (const [id] of adjacency) {
      color.set(id, WHITE);
    }

    const dfs = (node) => {
      color.set(node, GRAY);

      for (const neighbor of (adjacency.get(node) || [])) {
        if (!color.has(neighbor)) continue; // dangling ref, handled elsewhere

        if (color.get(neighbor) === GRAY) {
          // Found a back edge — extract the cycle
          const cycle = [neighbor];
          let cur = node;
          while (cur !== neighbor) {
            cycle.unshift(cur);
            cur = parent.get(cur);
          }
          cycles.push(cycle);
        } else if (color.get(neighbor) === WHITE) {
          parent.set(neighbor, node);
          dfs(neighbor);
        }
      }

      color.set(node, BLACK);
    };

    for (const [id] of adjacency) {
      if (color.get(id) === WHITE) {
        dfs(id);
      }
    }

    return cycles;
  }

  /**
   * Find steps that are unreachable from any entry point (indegree 0).
   * @returns {string[]} IDs of dead steps.
   */
  _findDeadSteps(steps) {
    const stepIds = steps.filter((s) => s.id).map((s) => s.id);
    if (stepIds.length === 0) return [];

    const adjacency = new Map();
    for (const step of steps) {
      adjacency.set(step.id, (Array.isArray(step.dependsOn) ? step.dependsOn : []).map(String));
    }

    // Entry points: steps with no dependsOn
    const queue = [];
    const visited = new Set();

    for (const step of steps) {
      const deps = Array.isArray(step.dependsOn) ? step.dependsOn : [];
      if (deps.length === 0) {
        queue.push(step.id);
        visited.add(step.id);
      }
    }

    // BFS from all entry points
    while (queue.length > 0) {
      const current = queue.shift();
      // Find all steps that depend on `current`
      for (const step of steps) {
        const deps = Array.isArray(step.dependsOn) ? step.dependsOn.map(String) : [];
        if (deps.includes(current) && !visited.has(step.id)) {
          visited.add(step.id);
          queue.push(step.id);
        }
      }
    }

    // Dead = not visited
    const dead = [];
    for (const step of steps) {
      if (step.id && !visited.has(step.id)) {
        dead.push(step.id);
      }
    }

    return dead;
  }

  /**
   * Map an error/warning message to a suggested fix.
   */
  _suggestFix(message, severity) {
    // Missing name
    if (message.includes('must have a non-empty "name"')) {
      return { issue: message, suggestion: 'Add "name": "my-workflow" to the workflow definition.', severity };
    }

    // Missing steps array
    if (message.includes('must have a "steps" array')) {
      return { issue: message, suggestion: 'Add "steps": [] with at least one step definition.', severity };
    }

    // Empty steps
    if (message.includes("must have at least one step")) {
      return { issue: message, suggestion: "Add at least one step object to the steps array. Example: { id: \"first\", type: \"tool\", config: { handler: myFn } }", severity };
    }

    // Missing id or type
    const missingFieldMatch = message.match(/missing required field "(\w+)"/);
    if (missingFieldMatch) {
      const field = missingFieldMatch[1];
      return {
        issue: message,
        suggestion: `Add the "${field}" field to the step definition.`,
        stepId: this._extractStepId(message),
        severity,
      };
    }

    // Invalid type
    const invalidTypeMatch = message.match(/invalid type "([^"]+)"/);
    if (invalidTypeMatch) {
      return {
        issue: message,
        suggestion: `Change type from "${invalidTypeMatch[1]}" to one of: ${[...VALID_STEP_TYPES].join(", ")}.`,
        stepId: this._extractStepId(message),
        severity,
      };
    }

    // Duplicate id
    if (message.includes("Duplicate step id")) {
      const dupMatch = message.match(/Duplicate step id: "([^"]+)"/);
      return {
        issue: message,
        suggestion: `Rename one of the steps with id "${dupMatch ? dupMatch[1] : "?"}" to a unique identifier.`,
        severity,
      };
    }

    // Dangling dependency
    if (message.includes("depends on unknown step")) {
      const depMatch = message.match(/depends on unknown step: "([^"]+)"/);
      return {
        issue: message,
        suggestion: depMatch
          ? `Ensure a step with id "${depMatch[1]}" exists, or remove it from dependsOn.`
          : "Remove the invalid dependency or add the referenced step.",
        stepId: this._extractStepId(message),
        severity,
      };
    }

    // Self-dependency
    if (message.includes("depends on itself")) {
      return {
        issue: message,
        suggestion: "Remove the self-referencing entry from dependsOn.",
        stepId: this._extractStepId(message),
        severity,
      };
    }

    // Circular dependency
    if (message.includes("Circular dependency detected")) {
      return {
        issue: message,
        suggestion: "Break the cycle by removing or reordering at least one dependency edge.",
        severity,
      };
    }

    // Dead steps
    if (message.includes("Dead step")) {
      return {
        issue: message,
        suggestion: "Either remove the dead step(s) or add a dependency edge from another step to make them reachable.",
        severity,
      };
    }

    // No entry point
    if (message.includes("No entry point")) {
      return {
        issue: message,
        suggestion: "Ensure at least one step has an empty dependsOn array (or no dependsOn field).",
        severity,
      };
    }

    // No exit point
    if (message.includes("No exit point")) {
      return {
        issue: message,
        suggestion: "At least one step should not be a dependency of any other step.",
        severity,
      };
    }

    // Type-specific config issues
    if (message.includes("requires ")) {
      const cfgMatch = message.match(/requires (config\.\w+.*?)\.$/);
      return {
        issue: message,
        suggestion: cfgMatch
          ? `Provide the required ${cfgMatch[1]} for this step type.`
          : "Provide a valid config matching the step type requirements.",
        stepId: this._extractStepId(message),
        severity,
      };
    }

    // Numeric field issues
    const numericMatch = message.match(/field "(\w+)" must be a non-negative integer/);
    if (numericMatch) {
      return {
        issue: message,
        suggestion: `Set "${numericMatch[1]}" to a non-negative integer (e.g., 0).`,
        stepId: this._extractStepId(message),
        severity,
      };
    }

    // Non-string id
    if (message.includes('"id" must be a non-empty string')) {
      return {
        issue: message,
        suggestion: 'Set "id" to a non-empty string (e.g., "step-1").',
        stepId: this._extractStepId(message),
        severity,
      };
    }

    // dependsOn must be an array
    if (message.includes('"dependsOn" must be an array')) {
      return {
        issue: message,
        suggestion: 'Change dependsOn to an array of step ID strings, e.g., ["step-a"].',
        stepId: this._extractStepId(message),
        severity,
      };
    }

    // Missing name warning
    if (message.includes('missing a descriptive "name"')) {
      return {
        issue: message,
        suggestion: "Add a human-readable name describing the step's purpose.",
        stepId: this._extractStepId(message),
        severity,
      };
    }

    // continueOnError not boolean
    if (message.includes('"continueOnError" should be a boolean')) {
      return {
        issue: message,
        suggestion: "Set continueOnError to true or false.",
        stepId: this._extractStepId(message),
        severity,
      };
    }

    // Non-object definition
    if (message.includes("must be an object")) {
      return { issue: message, suggestion: "Provide a workflow definition object with name and steps properties.", severity };
    }

    // config warnings
    if (message.includes('"config" should be a plain object')) {
      return {
        issue: message,
        suggestion: "Ensure config is a plain object (not an array or null).",
        stepId: this._extractStepId(message),
        severity,
      };
    }

    return { issue: message, suggestion: "Manual review required.", severity };
  }

  /**
   * Extract step ID from an error/warning message if present.
   */
  _extractStepId(message) {
    const match = message.match(/Step "([^"]+)"/);
    return match ? match[1] : undefined;
  }
}

module.exports = {
  WorkflowValidator,
  VALID_STEP_TYPES,
  TYPE_CONFIG_GUARDS,
};
