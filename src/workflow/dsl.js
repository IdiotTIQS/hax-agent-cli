"use strict";

const VALID_STEP_TYPES = new Set(["tool", "agent", "condition", "wait", "parallel"]);
const REQUIRED_STEP_FIELDS = ["id", "type"];

// ---- Public API ----

/**
 * Parse a YAML-like workflow definition string into a structured object.
 * Uses simple line-based parsing — no external YAML library required.
 *
 * Supported DSL syntax (indentation-based):
 *
 *   workflow: my-workflow
 *   description: optional description
 *   steps:
 *     - id: lint
 *       type: tool
 *       tool: shell.run
 *       args:
 *         command: npm run lint
 *       dependsOn: []
 *       retryCount: 2
 *       timeout: 60000
 *
 * @param {string} source - The raw DSL string.
 * @returns {object} { name, description?, steps: [...] }
 */
function parseWorkflow(source) {
  if (typeof source !== "string" || source.trim().length === 0) {
    throw new Error("Workflow source must be a non-empty string.");
  }

  const root = parseLines(source);
  return normalizeParsed(root);
}

/**
 * Validate a workflow definition object.
 * Returns an array of validation errors (empty if valid).
 *
 * @param {object} definition
 * @returns {string[]} Array of human-readable error messages.
 */
function validateWorkflow(definition) {
  const errors = [];

  if (!definition || typeof definition !== "object") {
    return ["Workflow definition must be an object."];
  }

  if (typeof definition.name !== "string" || definition.name.trim().length === 0) {
    errors.push('Workflow must have a non-empty "name".');
  }

  if (!Array.isArray(definition.steps)) {
    errors.push('Workflow must have a "steps" array.');
    return errors;
  }

  if (definition.steps.length === 0) {
    errors.push("Workflow must have at least one step.");
  }

  const stepIds = new Set();
  const depRefs = [];

  for (let i = 0; i < definition.steps.length; i++) {
    const step = definition.steps[i];

    if (!step || typeof step !== "object") {
      errors.push(`Step at index ${i} must be an object.`);
      continue;
    }

    // Required fields
    for (const field of REQUIRED_STEP_FIELDS) {
      if (!step[field]) {
        errors.push(`Step at index ${i} is missing required field "${field}".`);
      }
    }

    if (step.id && typeof step.id !== "string") {
      errors.push(`Step at index ${i}: "id" must be a string.`);
    }

    if (step.id && stepIds.has(step.id)) {
      errors.push(`Duplicate step id: "${step.id}".`);
    }
    if (typeof step.id === "string" && step.id.trim()) {
      stepIds.add(step.id);
    }

    if (step.type && !VALID_STEP_TYPES.has(step.type)) {
      errors.push(
        `Step "${step.id || `#${i}`}" has invalid type "${step.type}". Must be one of: ${[...VALID_STEP_TYPES].join(", ")}.`,
      );
    }

    // Validate config-relevant fields
    if (step.type === "tool" && !step.tool && !(step.config && step.config.tool)) {
      errors.push(`Step "${step.id || `#${i}`}" of type "tool" must have a "tool" field.`);
    }

    if (step.type === "wait" && !step.duration && !(step.config && step.config.duration)) {
      errors.push(`Step "${step.id || `#${i}`}" of type "wait" must have a "duration" field (in ms).`);
    }

    // Track dependsOn references
    if (Array.isArray(step.dependsOn)) {
      for (const dep of step.dependsOn) {
        depRefs.push({ source: step.id || `#${i}`, target: String(dep) });
      }
    }

    // Validate numeric fields
    for (const field of ["retryCount", "retryDelay", "timeout"]) {
      if (step[field] !== undefined && step[field] !== null) {
        const v = Number(step[field]);
        if (!Number.isSafeInteger(v) || v < 0) {
          errors.push(`Step "${step.id || `#${i}`}" "${field}" must be a non-negative integer, got ${step[field]}.`);
        }
      }
    }
  }

  // Validate dependsOn references
  for (const ref of depRefs) {
    if (!stepIds.has(ref.target)) {
      errors.push(`Step "${ref.source}" depends on unknown step: "${ref.target}".`);
    }
  }

  return errors;
}

/**
 * Serialize a workflow definition object back to DSL string format.
 *
 * @param {object} definition
 * @returns {string}
 */
function workflowToDsl(definition) {
  if (!definition || typeof definition !== "object") {
    throw new Error("Workflow definition must be an object.");
  }

  const lines = [];

  lines.push(`workflow: ${definition.name || "unnamed"}`);

  if (definition.description) {
    lines.push(`description: ${definition.description}`);
  }

  lines.push("steps:");

  const steps = Array.isArray(definition.steps) ? definition.steps : [];

  for (const step of steps) {
    lines.push(`  - id: ${step.id || ""}`);
    lines.push(`    type: ${step.type || "tool"}`);

    if (step.name) {
      lines.push(`    name: ${step.name}`);
    }

    if (step.tool) {
      lines.push(`    tool: ${step.tool}`);
    }

    if (step.description) {
      lines.push(`    description: ${step.description}`);
    }

    if (step.args && typeof step.args === "object") {
      const argEntries = Object.entries(step.args);
      if (argEntries.length > 0) {
        lines.push("    args:");
        for (const [key, val] of argEntries) {
          lines.push(`      ${key}: ${formatDslValue(val)}`);
        }
      }
    }

    if (Array.isArray(step.dependsOn) && step.dependsOn.length > 0) {
      lines.push(`    dependsOn: ${JSON.stringify(step.dependsOn)}`);
    }

    if (step.retryCount !== undefined && step.retryCount !== null) {
      lines.push(`    retryCount: ${step.retryCount}`);
    }

    if (step.retryDelay !== undefined && step.retryDelay !== null) {
      lines.push(`    retryDelay: ${step.retryDelay}`);
    }

    if (step.timeout !== undefined && step.timeout !== null) {
      lines.push(`    timeout: ${step.timeout}`);
    }

    if (step.continueOnError) {
      lines.push(`    continueOnError: true`);
    }

    if (step.duration !== undefined && step.duration !== null) {
      lines.push(`    duration: ${step.duration}`);
    }

    if (step.condition !== undefined) {
      lines.push(`    condition: ${formatDslValue(step.condition)}`);
    }
  }

  return lines.join("\n") + "\n";
}

// ---- Internal: line-by-line parser ----

const SECTION_RE = /^(\s*)(?:-\s+)?([a-zA-Z_]\w*)\s*:\s*(.*)$/;

function parseLines(source) {
  const rawLines = source.split("\n");
  const lines = [];

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    if (raw.trim() === "" || raw.trim().startsWith("#")) {
      continue; // skip blanks and comments
    }
    const indent = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();

    const match = trimmed.match(SECTION_RE);
    if (!match) {
      // Value continuation for multiline strings
      continue;
    }

    const listMarker = trimmed.startsWith("- ") || trimmed.startsWith("-");
    const key = match[2];
    const value = match[3].trim();

    lines.push({ indent, key, value, listMarker, rawIndent: indent });
  }

  return buildTree(lines);
}

function buildTree(lines) {
  const root = {};
  const scopeStack = [{ obj: root, indent: -1 }];

  let currentList = null;
  let currentListItem = null;

  for (const line of lines) {
    const { indent, key, value, listMarker } = line;

    // Pop scope until we find a parent with lower indent
    while (scopeStack.length > 1 && scopeStack[scopeStack.length - 1].indent >= indent) {
      const popped = scopeStack.pop();
      if (popped.listChunk !== undefined && popped.parentList !== undefined) {
        // Flush the list chunk
        if (Object.keys(popped.listChunk).length > 0) {
          popped.parentList[popped.parentList.length - 1] = {
            ...(popped.parentList[popped.parentList.length - 1] || {}),
            ...popped.listChunk,
          };
        }
      }
    }

    const parent = scopeStack[scopeStack.length - 1].obj;

    if (listMarker) {
      // Start or continue a list
      if (!Array.isArray(parent.__list)) {
        parent.__list = [];
      }

      if (value !== "" || (line.listMarker && key)) {
        // New list item with inline value
        const item = parseSimpleValue(value);
        if (item && typeof item === "object") {
          parent.__list.push(item);
        } else {
          parent.__list.push({ [key]: parseSimpleValue(value) });
          currentListItem = parent.__list[parent.__list.length - 1];
        }
      } else {
        // List item will be populated by child lines
        parent.__list.push({});
        currentListItem = parent.__list[parent.__list.length - 1];
      }

      if (currentListItem && typeof currentListItem === "object" && !Array.isArray(currentListItem)) {
        scopeStack.push({ obj: currentListItem, indent, listChunk: currentListItem, parentList: parent.__list });
      }
    } else {
      // Regular key-value
      if (value === "" || value === "{}" || value === "[]") {
        const nested = {};
        parent[key] = nested;
        scopeStack.push({ obj: nested, indent });
      } else {
        parent[key] = parseSimpleValue(value);
      }
    }
  }

  // Flatten list markers
  return flattenTree(root);
}

function flattenTree(node) {
  if (node === null || typeof node !== "object") return node;

  if (Array.isArray(node)) {
    return node.map(flattenTree);
  }

  // If this object only has __list, return the list directly
  const keys = Object.keys(node);
  if (keys.length === 1 && keys[0] === "__list") {
    return node.__list.map(flattenTree);
  }

  const result = {};

  for (const [key, value] of Object.entries(node)) {
    if (key === "__list") continue;
    const flattened = flattenTree(value);
    // If the flattened value is an array and the key suggests a list, use it directly
    // (handles "steps: {__list:[...]}" after flattening the container)
    if (Array.isArray(flattened)) {
      result[key] = flattened;
    } else {
      result[key] = flattened;
    }
  }

  return result;
}

function parseSimpleValue(raw) {
  if (raw === "") return "";
  if (raw === "null" || raw === "~") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;

  // JSON-ish objects and arrays
  if ((raw.startsWith("{") && raw.endsWith("}")) || (raw.startsWith("[") && raw.endsWith("]"))) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  // Numbers
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    const num = Number(raw);
    if (Number.isFinite(num)) return num;
  }

  // Quoted strings
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }

  return raw;
}

// ---- Internal: normalization ----

function normalizeParsed(root) {
  const name = String(root.workflow || root.name || "unnamed");
  const description = root.description || null;

  let steps = [];

  if (Array.isArray(root.steps)) {
    steps = root.steps.map(normalizeStep);
  }

  return {
    name,
    description,
    steps,
  };
}

function normalizeStep(step) {
  if (!step || typeof step !== "object") {
    return { id: "", name: "", type: "tool", config: {} };
  }

  const type = step.type || "tool";
  const config = {};

  // Copy tool-specific fields into config
  if (step.tool) config.tool = step.tool;
  if (step.args) config.args = step.args;
  if (step.handler) config.handler = step.handler;
  if (step.evaluate) config.evaluate = step.evaluate;
  if (step.duration) config.duration = normalizeInt(step.duration, 1000);
  if (step.steps) config.steps = step.steps;

  // Also carry over any unknown fields into config for flexibility
  for (const key of Object.keys(step)) {
    if (!["id", "name", "type", "config", "tool", "args", "handler", "evaluate", "duration", "steps",
      "dependsOn", "retryCount", "retryDelay", "timeout", "continueOnError", "condition", "description"].includes(key)) {
      config[key] = step[key];
    }
  }

  return {
    id: String(step.id || "").trim(),
    name: String(step.name || step.id || "").trim(),
    type,
    config,
    tool: step.tool || null,
    args: step.args || null,
    description: step.description || null,
    dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn.map(String) : [],
    retryCount: normalizeInt(step.retryCount, null),
    retryDelay: normalizeInt(step.retryDelay, null),
    timeout: normalizeInt(step.timeout, null),
    continueOnError: Boolean(step.continueOnError),
    duration: step.duration !== undefined ? normalizeInt(step.duration, null) : undefined,
    condition: step.condition !== undefined ? step.condition : undefined,
  };
}

// ---- Internal: DSL serialization helpers ----

function formatDslValue(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "string") {
    // Quote strings that need it
    if (/[:\s"'{}[\],]/.test(value) || value === "") {
      return JSON.stringify(value);
    }
    return value;
  }
  return String(value);
}

function normalizeInt(value, fallback) {
  const parsed = Number(value);
  if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  if (fallback !== undefined) return fallback;
  return undefined;
}

module.exports = {
  parseWorkflow,
  validateWorkflow,
  workflowToDsl,
};
