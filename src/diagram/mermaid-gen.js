"use strict";

/**
 * mermaid-gen — generates Mermaid.js diagram syntax strings from structured data.
 *
 * Supported diagram types:
 *   flowchart, sequenceDiagram, classDiagram, stateDiagram, erDiagram, gantt
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const SANITIZE_RE = /[<>{}[\]()"&]/g;

function _sanitizeLabel(str) {
  return String(str)
    .replace(/"/g, "'")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function _escapeClassLabel(str) {
  return String(str).replace(/[<>]/g, "");
}

function _flowchartId(str) {
  // Create a safe Mermaid node id: replace non-word chars with underscore
  return String(str)
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/^(\d)/, "_$1")
    .replace(/_{2,}/g, "_")
    .slice(0, 40);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate Mermaid syntax for the given diagram type and data.
 *
 * @param {string} mermaidType — one of: flowchart, sequenceDiagram, classDiagram,
 *   stateDiagram, erDiagram, gantt
 * @param {object} data — structured input for the chosen type
 * @returns {string} valid Mermaid.js syntax
 */
function generateMermaid(mermaidType, data) {
  switch (mermaidType) {
    case "flowchart":
    case "graph":
      return flowchartFromDependencies(data);
    case "sequenceDiagram":
    case "sequence":
      return sequenceFromMessages(data);
    case "classDiagram":
    case "class":
      return classFromCode(data);
    case "stateDiagram":
    case "state":
      return stateFromLifecycle(data);
    case "erDiagram":
    case "er":
      return erFromSchema(data);
    case "gantt":
      return ganttFromTasks(data);
    default:
      throw new Error(`Unknown Mermaid diagram type: ${mermaidType}`);
  }
}

/**
 * Build a flowchart from a dependency graph.
 *
 * @param {object} deps
 * @param {Array<{name:string, deps:string[]}>} [deps.nodes] — modules/functions with their dependencies
 * @param {string} [deps.direction=TD] — graph direction: TD, LR, BT, RL
 * @param {string} [deps.title] — optional diagram title
 * @returns {string} Mermaid flowchart syntax
 */
function flowchartFromDependencies(deps) {
  deps = deps || {};
  const direction = deps.direction || "TD";
  const nodes = Array.isArray(deps.nodes) ? deps.nodes : [];
  const lines = [];
  const ids = new Set();

  if (deps.title) {
    lines.push("---");
    lines.push(`title: ${_sanitizeLabel(deps.title)}`);
    lines.push("---");
  }

  lines.push(`flowchart ${direction}`);

  // Declare nodes
  for (const node of nodes) {
    const id = _flowchartId(node.name);
    if (ids.has(id)) continue;
    ids.add(id);
    const label = _sanitizeLabel(node.name);
    const type = node.type || "default";
    const shape = _flowchartShape(id, label, type);
    lines.push(`    ${shape}`);
  }

  // Declare edges
  for (const node of nodes) {
    const fromId = _flowchartId(node.name);
    const edges = Array.isArray(node.deps) ? node.deps : Array.isArray(node.dependencies) ? node.dependencies : [];
    for (const dep of edges) {
      const toId = _flowchartId(String(dep));
      if (toId !== fromId) {
        lines.push(`    ${fromId} --> ${toId}`);
      }
    }
  }

  return lines.join("\n");
}

function _flowchartShape(id, label, type) {
  switch (type) {
    case "decision":
    case "condition":
      return `${id}{${label}}`;
    case "process":
    case "operation":
      return `${id}[${label}]`;
    case "io":
    case "input":
    case "output":
      return `${id}[/${label}/]`;
    case "database":
      return `${id}[(${label})]`;
    case "terminator":
    case "start":
    case "end":
      return `${id}((${label}))`;
    case "subroutine":
      return `${id}[[${label}]]`;
    default:
      return `${id}[${label}]`;
  }
}

/**
 * Build a sequence diagram from agent messages.
 *
 * @param {object} messages
 * @param {Array<{from:string, to:string, label?:string, type?:string}>} [messages.messages] — sequence of messages
 * @param {string} [messages.title] — optional diagram title
 * @returns {string} Mermaid sequence diagram
 */
function sequenceFromMessages(messages) {
  messages = messages || {};
  const msgs = Array.isArray(messages.messages) ? messages.messages : [];
  const lines = [];

  if (messages.title) {
    lines.push("---");
    lines.push(`title: ${_sanitizeLabel(messages.title)}`);
    lines.push("---");
  }

  lines.push("sequenceDiagram");

  // Collect unique participants
  const participants = new Set();
  for (const msg of msgs) {
    if (msg.from) participants.add(msg.from);
    if (msg.to) participants.add(msg.to);
  }

  // Declare participants (sorted for determinism)
  const aliases = {};
  let aliasIdx = 0;
  for (const p of [...participants].sort()) {
    const alias = `P${aliasIdx++}`;
    aliases[p] = alias;
    lines.push(`    participant ${alias} as ${_sanitizeLabel(p)}`);
  }

  // Render messages
  for (const msg of msgs) {
    const from = aliases[msg.from];
    const to = aliases[msg.to];
    if (!from || !to) continue;
    const label = msg.label ? `: ${_sanitizeLabel(msg.label)}` : "";
    const arrow = _sequenceArrow(msg.type);
    lines.push(`    ${from}${arrow}${to}${label}`);
  }

  return lines.join("\n");
}

function _sequenceArrow(type) {
  switch (type) {
    case "request":
    case "sync":
      return "->>";
    case "response":
    case "return":
      return "-->>";
    case "async":
    case "signal":
      return "-)";
    case "note":
    case "self":
      return "->";
    default:
      return "->>";
  }
}

/**
 * Build a class diagram from code structure data.
 *
 * @param {object} structure
 * @param {Array<{name:string, type:string, members?:Array, methods?:Array, extends?:string}>} [structure.classes] — class definitions
 * @param {Array<{from:string, to:string, relation?:string}>} [structure.relations] — class relationships
 * @param {string} [structure.title] — optional diagram title
 * @returns {string} Mermaid class diagram
 */
function classFromCode(structure) {
  structure = structure || {};
  const classes = Array.isArray(structure.classes) ? structure.classes : [];
  const relations = Array.isArray(structure.relations) ? structure.relations : [];
  const lines = [];

  if (structure.title) {
    lines.push("---");
    lines.push(`title: ${_sanitizeLabel(structure.title)}`);
    lines.push("---");
  }

  lines.push("classDiagram");

  // Declare classes
  for (const cls of classes) {
    const name = _escapeClassLabel(cls.name);
    const typeLabel = cls.type ? ` <<${cls.type}>>` : "";
    lines.push(`    class ${name} {`);
    _renderClassMembers(lines, "      ", cls);
    lines.push(`    }`);
    if (typeLabel) {
      lines.push(`    ${typeLabel}`);
    }
  }

  // Declare relations
  for (const rel of relations) {
    const arrow = _classRelation(rel.relation);
    const fromName = _escapeClassLabel(rel.from);
    const toName = _escapeClassLabel(rel.to);
    const label = rel.label ? ` : ${_sanitizeLabel(rel.label)}` : "";
    lines.push(`    ${fromName} ${arrow} ${toName}${label}`);
  }

  // Inheritance from class.extends
  for (const cls of classes) {
    if (cls.extends) {
      lines.push(`    ${_escapeClassLabel(cls.extends)} <|-- ${_escapeClassLabel(cls.name)}`);
    }
  }

  return lines.join("\n");
}

function _renderClassMembers(lines, indent, cls) {
  const members = Array.isArray(cls.members) ? cls.members : cls.attributes || [];
  for (const m of members) {
    const name = typeof m === "string" ? m : m.name;
    const type = typeof m === "string" ? "String" : m.type || "String";
    const visibility = (m.visibility || "public").slice(0, 1);
    if (visibility === "p") {
      lines.push(`${indent}+${name} ${_escapeClassLabel(type)}`);
    } else if (visibility === "r" || visibility === "d") {
      lines.push(`${indent}-${name} ${_escapeClassLabel(type)}`);
    } else if (visibility === "t") {
      lines.push(`${indent}#${name} ${_escapeClassLabel(type)}`);
    } else {
      lines.push(`${indent}+${name} ${_escapeClassLabel(type)}`);
    }
  }

  const methods = Array.isArray(cls.methods) ? cls.methods : [];
  for (const m of methods) {
    const name = typeof m === "string" ? m : m.name;
    const returnType = typeof m === "string" ? "void" : m.returnType || "void";
    const visibility = (m.visibility || "public").slice(0, 1);
    const params = Array.isArray(m.params) ? m.params.join(", ") : "";
    const prefix = visibility === "p" ? "+" : visibility === "r" || visibility === "d" ? "-" : visibility === "t" ? "#" : "+";
    lines.push(`${indent}${prefix}${name}(${params}) ${_escapeClassLabel(returnType)}`);
  }
}

function _classRelation(relation) {
  switch (relation) {
    case "extends":
    case "inheritance":
      return "<|--";
    case "implements":
    case "realization":
      return "<|..";
    case "composition":
      return "*--";
    case "aggregation":
      return "o--";
    case "association":
      return "-->";
    case "dependency":
      return "..>";
    default:
      return "-->";
  }
}

/**
 * Build a state diagram from lifecycle data.
 *
 * @param {object} lifecycle
 * @param {Array<{name:string, from?:string, to?:string, event?:string}>} [lifecycle.states] — state definitions
 * @param {Array<{from:string, to:string, event?:string, action?:string}>} [lifecycle.transitions] — transitions
 * @param {string} [lifecycle.initial] — initial state name
 * @param {string} [lifecycle.title] — optional diagram title
 * @returns {string} Mermaid state diagram
 */
function stateFromLifecycle(lifecycle) {
  lifecycle = lifecycle || {};
  const states = Array.isArray(lifecycle.states) ? lifecycle.states : [];
  const transitions = Array.isArray(lifecycle.transitions) ? lifecycle.transitions : [];
  const initial = lifecycle.initial || (states.length > 0 ? states[0].name : null);
  const lines = [];

  if (lifecycle.title) {
    lines.push("---");
    lines.push(`title: ${_sanitizeLabel(lifecycle.title)}`);
    lines.push("---");
  }

  lines.push("stateDiagram-v2");

  // Initial state marker
  if (initial) {
    lines.push(`    [*] --> ${_flowchartId(initial)}`);
  }

  // Declare states with optional substates
  for (const st of states) {
    const id = _flowchartId(st.name);
    let entry = `    state ${id} "${_sanitizeLabel(st.name)}"`;
    const substates = Array.isArray(st.states) ? st.states : [];
    if (substates.length > 0) {
      lines.push(`    state ${id} {`);
      for (const sub of substates) {
        const sid = _flowchartId(sub.name || sub);
        const slabel = typeof sub === "string" ? sub : sub.name;
        lines.push(`        ${sid}: ${_sanitizeLabel(slabel)}`);
      }
      lines.push(`    }`);
    } else {
      lines.push(entry);
    }
  }

  // Declare transitions
  for (const t of transitions) {
    const from = t.from === "*" || t.from === "start" ? "[*]" : _flowchartId(t.from);
    const to = t.to === "*" || t.to === "end" ? "[*]" : _flowchartId(t.to);
    const event = t.event ? `: ${_sanitizeLabel(t.event)}` : "";
    lines.push(`    ${from} --> ${to}${event}`);
  }

  // Auto-transitions from state.from/to
  for (const st of states) {
    if (st.from) {
      const from = st.from === "*" || st.from === "start" ? "[*]" : _flowchartId(st.from);
      const to = _flowchartId(st.name);
      const event = st.event ? `: ${_sanitizeLabel(st.event)}` : "";
      lines.push(`    ${from} --> ${to}${event}`);
    }
  }

  return lines.join("\n");
}

/**
 * Build an ER diagram from a data schema.
 *
 * @param {object} schema
 * @param {Array<{entity:string, attributes:Array<{name:string, type:string, key?:string}>}>} [schema.entities] — entity definitions
 * @param {Array<{from:string, to:string, type:string, label?:string}>} [schema.relationships] — relationships
 * @param {string} [schema.title] — optional diagram title
 * @returns {string} Mermaid ER diagram
 */
function erFromSchema(schema) {
  schema = schema || {};
  const entities = Array.isArray(schema.entities) ? schema.entities : [];
  const relationships = Array.isArray(schema.relationships) ? schema.relationships : [];
  const lines = [];

  if (schema.title) {
    lines.push("---");
    lines.push(`title: ${_sanitizeLabel(schema.title)}`);
    lines.push("---");
  }

  lines.push("erDiagram");

  // Declare entities with attributes
  for (const entity of entities) {
    const name = _sanitizeLabel(entity.entity || entity.name);
    lines.push(`    ${name} {`);
    const attrs = Array.isArray(entity.attributes) ? entity.attributes : entity.fields || [];
    for (const attr of attrs) {
      const attrName = typeof attr === "string" ? attr : attr.name;
      const attrType = typeof attr === "string" ? "string" : attr.type || "string";
      const key = (attr.key || "").toUpperCase();
      const keyPrefix = key === "PK" || key === "PRIMARY" ? "PK" :
                        key === "FK" || key === "FOREIGN" ? "FK" :
                        key === "UK" || key === "UNIQUE" ? "UK" : "";
      const keyLabel = keyPrefix ? `${keyPrefix} ` : "";
      lines.push(`        ${keyLabel}${_sanitizeLabel(attrType)} ${_sanitizeLabel(attrName)}`);
    }
    lines.push(`    }`);
  }

  // Declare relationships
  for (const rel of relationships) {
    const from = _sanitizeLabel(rel.from);
    const to = _sanitizeLabel(rel.to);
    const relType = _erRelation(rel.type);
    const label = rel.label ? ` : "${_sanitizeLabel(rel.label)}"` : "";
    lines.push(`    ${from} ${relType} ${to}${label}`);
  }

  return lines.join("\n");
}

function _erRelation(type) {
  switch (type) {
    case "one-to-one":
    case "1:1":
    case "one_one":
      return "||--||";
    case "one-to-many":
    case "1:n":
    case "1:N":
    case "one_many":
      return "||--o{";
    case "many-to-one":
    case "n:1":
    case "many_one":
      return "}o--||";
    case "many-to-many":
    case "n:m":
    case "N:M":
    case "many_many":
      return "}o--o{";
    case "zero-or-one":
    case "0..1":
      return "|o--|o";
    case "exactly-one":
    case "1":
      return "||--||";
    default:
      return "||--o{";
  }
}

/**
 * Build a Gantt chart from task data.
 *
 * @param {object} tasks
 * @param {string} [tasks.title] — optional diagram title
 * @param {string} [tasks.dateFormat=YYYY-MM-DD] — date format string
 * @param {Array<{name:string, start:string, end?:string, duration?:string|number, status?:string, after?:string|string[]}>} [tasks.tasks] — task definitions
 * @param {Array<{name:string}>} [tasks.sections] — optional sections
 * @returns {string} Mermaid Gantt syntax
 */
function ganttFromTasks(tasks) {
  tasks = tasks || {};
  const taskList = Array.isArray(tasks.tasks) ? tasks.tasks : [];
  const sections = Array.isArray(tasks.sections) ? tasks.sections : [];
  const dateFormat = tasks.dateFormat || "YYYY-MM-DD";
  const lines = [];

  if (tasks.title) {
    lines.push("---");
    lines.push(`title: ${_sanitizeLabel(tasks.title)}`);
    lines.push("---");
  }

  lines.push("gantt");
  lines.push(`    dateFormat  ${dateFormat}`);
  if (tasks.axisFormat) {
    lines.push(`    axisFormat  ${tasks.axisFormat}`);
  }

  if (sections.length === 0) {
    // No sections — render top-level tasks
    for (const t of taskList) {
      lines.push(`    ${_renderGanttTask(t)}`);
    }
  } else {
    for (const section of sections) {
      lines.push(`    section ${_sanitizeLabel(section.name)}`);
      for (const t of taskList) {
        if (t.section === section.name || (!t.section && sections.length === 1)) {
          lines.push(`    ${_renderGanttTask(t)}`);
        }
      }
    }
  }

  return lines.join("\n");
}

function _renderGanttTask(t) {
  const name = _sanitizeLabel(t.name);
  const status = t.status || "";
  const statusLabel = status ? `:${status}` : "";
  let timing = "";

  if (t.start && t.end) {
    timing = `${t.start}, ${t.end}`;
  } else if (t.start && t.duration !== undefined) {
    timing = `${t.start}, ${t.duration}d`;
  } else if (t.duration !== undefined) {
    timing = `after start, ${t.duration}d`;
  } else {
    timing = `${t.start || "start"}, 1d`;
  }

  let after = "";
  if (t.after) {
    const afterList = Array.isArray(t.after) ? t.after : [t.after];
    after = `, after ${afterList.map(a => _sanitizeLabel(a)).join(" ")}`;
  }

  return `    ${name} ${statusLabel}${statusLabel ? " " : ""}: ${timing}${after}`;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

module.exports = {
  generateMermaid,
  flowchartFromDependencies,
  sequenceFromMessages,
  classFromCode,
  stateFromLifecycle,
  erFromSchema,
  ganttFromTasks,
};
