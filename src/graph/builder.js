"use strict";

const path = require("path");
const {
  KnowledgeGraph,
  NODE_TYPES,
  EDGE_TYPES,
  requireString,
  deepClone,
} = require("./engine");

const DEFAULT_EXTENSIONS = new Set([
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".mjs",
  ".cjs",
  ".json",
  ".py",
  ".java",
  ".go",
  ".rs",
  ".rb",
  ".php",
  ".cs",
  ".swift",
  ".kt",
  ".scala",
]);

const FUNCTION_PATTERNS = {
  ".js": /function\s+(\w+)\s*\(/g,
  ".ts": /function\s+(\w+)\s*\(/g,
  ".mjs": /function\s+(\w+)\s*\(/g,
  ".cjs": /function\s+(\w+)\s*\(/g,
  ".jsx": /function\s+(\w+)\s*\(/g,
  ".tsx": /function\s+(\w+)\s*\(/g,
  ".py": /def\s+(\w+)\s*\(/g,
  ".rb": /def\s+(\w+)/g,
  ".go": /func\s+(\w+)\s*\(/g,
  ".rs": /fn\s+(\w+)/g,
  ".java": /(?:public|private|protected|static|\s)+\s+\w+\s+(\w+)\s*\(/g,
  ".php": /function\s+(\w+)\s*\(/g,
  ".swift": /func\s+(\w+)/g,
  ".kt": /fun\s+(\w+)/g,
  ".scala": /def\s+(\w+)/g,
  ".cs": /(?:public|private|protected|static|\s)+\s+\w+\s+(\w+)\s*\(/g,
};

const CLASS_PATTERNS = {
  ".js": /class\s+(\w+)/g,
  ".ts": /class\s+(\w+)/g,
  ".mjs": /class\s+(\w+)/g,
  ".cjs": /class\s+(\w+)/g,
  ".jsx": /class\s+(\w+)/g,
  ".tsx": /class\s+(\w+)/g,
  ".py": /class\s+(\w+)/g,
  ".rb": /class\s+(\w+)/g,
  ".java": /class\s+(\w+)/g,
  ".php": /class\s+(\w+)/g,
  ".swift": /class\s+(\w+)/g,
  ".kt": /class\s+(\w+)/g,
  ".scala": /class\s+(\w+)/g,
  ".cs": /class\s+(\w+)/g,
};

const IMPORT_PATTERNS = {
  ".js": /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ".ts": /(?:import\s+.*?\s+from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g,
  ".mjs": /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
  ".jsx": /(?:import\s+.*?\s+from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g,
  ".tsx": /(?:import\s+.*?\s+from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g,
  ".py": /(?:import\s+(\w+)|from\s+(\w+)\s+import)/g,
  ".go": /import\s+(?:\(\s*)?(?:"([^"]+)"|(\w+))/g,
  ".java": /import\s+([\w.]+)/g,
  ".rs": /use\s+([\w:]+)/g,
  ".rb": /require\s+['"]([^'"]+)['"]/g,
};

class GraphBuilder {
  constructor(options = {}) {
    this._options = options;
  }

  /**
   * Build a knowledge graph from a codebase by scanning source files.
   *
   * @param {string} root    - Root directory of the codebase.
   * @param {object} [options]
   * @param {string[]} [options.extensions] - File extensions to scan.
   * @param {string[]} [options.exclude]    - Glob patterns to exclude.
   * @param {string}  [options.name]        - Graph name.
   * @returns {KnowledgeGraph}
   */
  fromCodebase(root, options = {}) {
    requireString(root, "root");

    const fs = require("fs");
    const graph = new KnowledgeGraph({ name: options.name || "codebase" });
    const extensions = options.extensions
      ? new Set(options.extensions.map((e) => e.startsWith(".") ? e : `.${e}`))
      : DEFAULT_EXTENSIONS;
    const excludePatterns = (options.exclude || []).map((pattern) => {
      if (pattern instanceof RegExp) return pattern;
      // Convert glob to separator-agnostic regex
      // Replace ** with a placeholder, * with non-separator chars, / with separator
      const platformAgnostic = pattern
        .replace(/\\/g, "/")
        .replace(/\*\*/g, "§GLOBSTAR§")
        .replace(/\*/g, "[^\\\\\\/]*")
        .replace(/\//g, "[\\\\\\/]")
        .replace(/§GLOBSTAR§/g, ".*");
      return new RegExp(`(?:^|[\\\\\\/])${platformAgnostic}(?:$|[\\\\\\/])`);
    });

    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      return graph;
    }

    const fileInfos = []; // { fullPath, relativePath, content }

    // ---- Pass 1: collect all files ----
    const walk = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (excludePatterns.some((p) => p.test(fullPath))) {
          continue;
        }

        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (extensions.has(ext)) {
            const relativePath = path.relative(root, fullPath);
            try {
              const content = fs.readFileSync(fullPath, "utf8");
              fileInfos.push({ fullPath, relativePath, content, ext });
            } catch (_) {
              // Skip unreadable files
            }
          }
        }
      }
    };

    walk(root);

    // Collect all file paths (both absolute and relative) for import resolution
    const allFilePaths = new Set();
    const resolvedRoot = path.resolve(root);
    for (const info of fileInfos) {
      allFilePaths.add(info.fullPath);
      allFilePaths.add(info.relativePath);
    }

    // ---- Pass 2: add all nodes to the graph ----
    for (const info of fileInfos) {
      const { fullPath, relativePath, content, ext } = info;
      const fileId = `file:${relativePath}`;

      const stats = fs.statSync(fullPath);
      graph.addNode(NODE_TYPES.FILE, fileId, {
        path: relativePath,
        absolutePath: fullPath,
        extension: ext,
        size: stats.size,
        lineCount: content.split("\n").length,
      });

      // Add function nodes
      const funcPattern = FUNCTION_PATTERNS[ext];
      if (funcPattern) {
        const matches = extractMatches(content, funcPattern);
        for (const funcName of matches) {
          graph.addNode(NODE_TYPES.FUNCTION, `func:${relativePath}:${funcName}`, {
            name: funcName,
            file: relativePath,
          });
        }
      }

      // Add class nodes
      const classPattern = CLASS_PATTERNS[ext];
      if (classPattern) {
        const matches = extractMatches(content, classPattern);
        for (const className of matches) {
          graph.addNode(NODE_TYPES.CLASS, `class:${relativePath}:${className}`, {
            name: className,
            file: relativePath,
          });
        }
      }
    }

    // ---- Pass 3: add all edges ----
    for (const info of fileInfos) {
      const { fullPath, relativePath, content, ext } = info;
      const fileId = `file:${relativePath}`;

      // Edges from file to its functions
      const funcPattern = FUNCTION_PATTERNS[ext];
      if (funcPattern) {
        const matches = extractMatches(content, funcPattern);
        for (const funcName of matches) {
          graph.addEdge(fileId, `func:${relativePath}:${funcName}`, EDGE_TYPES.OWNED_BY, {
            relationship: "contains",
          });
        }
      }

      // Edges from file to its classes
      const classPattern = CLASS_PATTERNS[ext];
      if (classPattern) {
        const matches = extractMatches(content, classPattern);
        for (const className of matches) {
          graph.addEdge(fileId, `class:${relativePath}:${className}`, EDGE_TYPES.OWNED_BY, {
            relationship: "contains",
          });
        }
      }

      // Edges for imports/dependencies
      const importPattern = IMPORT_PATTERNS[ext];
      if (importPattern) {
        const raw = extractImportMatches(content, importPattern);
        for (const depPath of raw) {
          let resolved = resolveImportPath(fullPath, depPath, allFilePaths);
          if (resolved && path.isAbsolute(resolved)) {
            resolved = path.relative(root, resolved);
          }
          if (resolved && graph.hasNode(`file:${resolved}`)) {
            graph.addEdge(fileId, `file:${resolved}`, EDGE_TYPES.DEPENDS_ON, {
              importPath: depPath,
            });
          }
        }
      }
    }

    return graph;
  }

  /**
   * Build a knowledge graph from a session transcript.
   *
   * @param {object} session - Session object with entries array.
   * @returns {KnowledgeGraph}
   */
  fromSession(session) {
    const graph = new KnowledgeGraph({ name: "session" });

    if (!session || !session.id) {
      return graph;
    }

    const sessionId = `session:${session.id}`;
    graph.addNode(NODE_TYPES.TASK, sessionId, {
      type: "session",
      sessionId: session.id,
      timestamp: session.createdAt || new Date().toISOString(),
    });

    const entries = Array.isArray(session.entries) ? session.entries : [];
    let taskCounter = 0;
    let conceptCounter = 0;
    let decisionCounter = 0;
    let errorCounter = 0;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry) continue;

      const entryId = `entry:${session.id}:${i}`;
      const role = entry.role || "unknown";

      if (role === "user") {
        // User messages represent tasks/intents
        taskCounter++;
        const taskId = `task:${session.id}:${taskCounter}`;
        graph.addNode(NODE_TYPES.TASK, taskId, {
          role: "user",
          content: truncateString(entry.content, 200),
          entryIndex: i,
        });
        graph.addEdge(sessionId, taskId, EDGE_TYPES.RELATED_TO);
      } else if (role === "assistant") {
        // Look for decisions, concepts, and errors in assistant responses
        const content = entry.content || "";
        const toolCalls = entry.tool_calls || [];

        // Detect decisions (explicit mentions)
        if (/decided|decision|choose|chose|selected|picked|opt(ed)? for/i.test(content)) {
          decisionCounter++;
          const decisionId = `decision:${session.id}:${decisionCounter}`;
          graph.addNode(NODE_TYPES.DECISION, decisionId, {
            entryIndex: i,
            snippet: truncateString(content, 200),
          });
          graph.addEdge(sessionId, decisionId, EDGE_TYPES.RELATED_TO);
        }

        // Detect concepts (key terms, definitions)
        const conceptTerms = extractConcepts(content);
        for (const term of conceptTerms) {
          conceptCounter++;
          const conceptId = `concept:${session.id}:${conceptCounter}`;
          graph.addNode(NODE_TYPES.CONCEPT, conceptId, {
            term: term,
            entryIndex: i,
          });
          graph.addEdge(sessionId, conceptId, EDGE_TYPES.RELATED_TO);
        }

        // Detect errors
        if (/error|fail|exception|crash|bug|Issue/i.test(content)) {
          errorCounter++;
          const errorId = `error:${session.id}:${errorCounter}`;
          graph.addNode(NODE_TYPES.ERROR, errorId, {
            entryIndex: i,
            snippet: truncateString(content, 200),
          });
          graph.addEdge(sessionId, errorId, EDGE_TYPES.RELATED_TO);
        }

        // Connect tool calls
        for (const call of toolCalls) {
          if (call.name) {
            const toolId = `tool:${call.name}`;
            if (!graph.hasNode(toolId)) {
              graph.addNode(NODE_TYPES.CONCEPT, toolId, {
                type: "tool",
                name: call.name,
              });
            }
            const decisionId = `decision:${session.id}:${decisionCounter || 1}`;
            if (graph.hasNode(decisionId)) {
              graph.addEdge(decisionId, toolId, EDGE_TYPES.RELATED_TO);
            }
          }
        }
      }
    }

    return graph;
  }

  /**
   * Build a knowledge graph from dependency data.
   *
   * @param {object|object[]} deps - Dependency data (package.json, requirements.txt, etc.).
   * @returns {KnowledgeGraph}
   */
  fromDependencies(deps) {
    const graph = new KnowledgeGraph({ name: "dependencies" });

    const depList = Array.isArray(deps) ? deps : [deps];
    let depCounter = 0;

    for (const dep of depList) {
      if (!dep) continue;

      const entries = dep.dependencies || dep.packages || (dep.name ? [dep] : dep);

      const depEntries = Array.isArray(entries)
        ? entries
        : Object.entries(entries).map(([name, version]) => ({
            name,
            version: typeof version === "object" ? JSON.stringify(version) : version,
          }));

      for (const item of depEntries) {
        depCounter++;
        const depId = `dep:${item.name || item.package || depCounter}`;
        graph.addNode(NODE_TYPES.FILE, depId, {
          type: "dependency",
          name: item.name,
          version: String(item.version || item.spec || "unknown"),
          registry: item.registry || "npm",
        });

        // Link dependencies
        const subDeps = item.dependencies || item.peerDependencies || item.requires;
        if (subDeps && typeof subDeps === "object") {
          const subEntries = Array.isArray(subDeps)
            ? subDeps
            : Object.entries(subDeps).map(([name, spec]) => ({
                name,
                version: typeof spec === "object" ? JSON.stringify(spec) : String(spec),
              }));

          for (const sub of subEntries) {
            const subName = sub.name || sub.package;
            // Find or create the sub-dep node
            let subId = null;
            for (const nodeId of graph.nodeIds) {
              const node = graph.getNode(nodeId);
              if (node && node.properties.name === subName) {
                subId = nodeId;
                break;
              }
            }
            if (!subId) {
              depCounter++;
              subId = `dep:${subName}`;
              graph.addNode(NODE_TYPES.FILE, subId, {
                type: "dependency",
                name: subName,
                version: sub.version || sub.spec || "unknown",
              });
            }
            graph.addEdge(depId, subId, EDGE_TYPES.DEPENDS_ON);
          }
        }
      }
    }

    return graph;
  }

  /**
   * Merge multiple KnowledgeGraph instances into a single graph.
   *
   * @param {KnowledgeGraph[]} graphs - Array of graphs to merge.
   * @returns {KnowledgeGraph}
   */
  merge(graphs) {
    if (!Array.isArray(graphs) || graphs.length === 0) {
      return new KnowledgeGraph();
    }

    const merged = new KnowledgeGraph({ name: "merged" });

    for (const g of graphs) {
      if (!(g instanceof KnowledgeGraph)) {
        continue;
      }

      for (const node of g.nodes) {
        if (!merged.hasNode(node.id)) {
          merged.addNode(node.type, node.id, node.properties);
        } else {
          // Update properties for existing nodes
          const existing = merged.getNode(node.id);
          if (existing) {
            merged.addNode(node.type, node.id, {
              ...existing.properties,
              ...node.properties,
            });
          }
        }
      }

      for (const edge of g.edges) {
        // Only add edge if both endpoints exist (might need to add nodes first)
        if (merged.hasNode(edge.from) && merged.hasNode(edge.to)) {
          // Check if equivalent edge already exists
          const existingEdges = merged.getEdges(edge.from, "outgoing", edge.type);
          const exists = existingEdges.some((e) => e.to === edge.to && e.type === edge.type);

          if (!exists) {
            merged.addEdge(edge.from, edge.to, edge.type, edge.properties);
          }
        }
      }
    }

    return merged;
  }

  /**
   * Export the graph in DOT format for Graphviz visualization.
   *
   * @param {KnowledgeGraph} graph
   * @returns {string} DOT format string.
   */
  toDot(graph) {
    if (!(graph instanceof KnowledgeGraph)) {
      return "digraph G {}";
    }

    const lines = [];
    lines.push("digraph G {");
    lines.push('  rankdir=LR;');
    lines.push('  node [shape=box, style=filled];');

    // Color map for node types
    const nodeColors = {
      FILE: "lightblue",
      FUNCTION: "lightyellow",
      CLASS: "lightgreen",
      AGENT: "lightsalmon",
      TASK: "lightcoral",
      DECISION: "lightgoldenrod",
      CONCEPT: "plum",
      ERROR: "lightpink",
    };

    // Edge style map
    const edgeStyles = {
      DEPENDS_ON: "solid",
      IMPLEMENTS: "dashed",
      CALLS: "solid",
      MODIFIES: "dotted",
      OWNED_BY: "dashed",
      RELATED_TO: "dotted",
      CAUSED_BY: "bold",
    };

    for (const node of graph.nodes) {
      const color = nodeColors[node.type] || "white";
      const label = `${node.type}\\n${escapeDotLabel(node.id)}`;
      lines.push(
        `  "${escapeDot(node.id)}" [label="${label}", fillcolor=${color}];`
      );
    }

    for (const edge of graph.edges) {
      const style = edgeStyles[edge.type] || "solid";
      const label = edge.type;
      lines.push(
        `  "${escapeDot(edge.from)}" -> "${escapeDot(edge.to)}" [label="${label}", style=${style}];`
      );
    }

    lines.push("}");
    return lines.join("\n");
  }

  /**
   * Export the graph as a Mermaid diagram.
   *
   * @param {KnowledgeGraph} graph
   * @returns {string} Mermaid flowchart string.
   */
  toMermaid(graph) {
    if (!(graph instanceof KnowledgeGraph)) {
      return "graph LR\n  ;";
    }

    const lines = [];
    lines.push("graph LR");

    // Node type to shape mapping
    const nodeShapes = {
      FILE: "[\"FILE\"]",
      FUNCTION: "([\"FUNCTION\"])",
      CLASS: "[[\"CLASS\"]]",
      AGENT: ">\"AGENT\"]",
      TASK: "{\"TASK\"}",
      DECISION: "{{DECISION}}",
      CONCEPT: "(\"CONCEPT\")",
      ERROR: ">\"ERROR\"]",
    };

    const nodeIds = graph.nodeIds;
    const aliasMap = new Map();

    // Create short aliases for cleaner diagram
    let aliasCounter = 0;
    for (const nodeId of nodeIds) {
      const alias = `N${aliasCounter++}`;
      aliasMap.set(nodeId, alias);
    }

    // Define nodes
    for (const node of graph.nodes) {
      const alias = aliasMap.get(node.id);
      const shape = nodeShapes[node.type] || "[\"NODE\"]";
      const label = `${node.type}: ${node.id}`;
      lines.push(`  ${alias}${shape}`);
    }

    // Define edges
    for (const edge of graph.edges) {
      const fromAlias = aliasMap.get(edge.from);
      const toAlias = aliasMap.get(edge.to);
      const edgeLabel = edge.type;
      lines.push(`  ${fromAlias} -->|${edgeLabel}| ${toAlias}`);
    }

    return lines.join("\n");
  }
}

// ---- Helpers ----

function extractMatches(content, regex) {
  const results = new Set();
  let match;
  // Reset regex state
  regex.lastIndex = 0;
  while ((match = regex.exec(content)) !== null) {
    // Find the first captured group that's not undefined
    for (let i = 1; i < match.length; i++) {
      if (match[i] !== undefined) {
        results.add(match[i]);
        break;
      }
    }
  }
  return [...results];
}

function extractImportMatches(content, regex) {
  const results = [];
  let match;
  regex.lastIndex = 0;
  while ((match = regex.exec(content)) !== null) {
    // Find the first captured group that's not undefined
    for (let i = 1; i < match.length; i++) {
      if (match[i] !== undefined) {
        results.push(match[i]);
        break;
      }
    }
  }
  return [...new Set(results)];
}

function resolveImportPath(currentFile, importSpecifier, knownFiles) {
  // Resolve relative imports to known file paths
  if (importSpecifier.startsWith(".")) {
    const dir = path.dirname(currentFile);

    // Try exact match
    const possiblePath = path.normalize(path.join(dir, importSpecifier));
    for (const known of knownFiles) {
      if (known === possiblePath || known.startsWith(possiblePath)) {
        return known;
      }
    }

    // Try with extensions
    for (const ext of DEFAULT_EXTENSIONS) {
      const withExt = possiblePath + ext;
      for (const known of knownFiles) {
        if (known === withExt) {
          return known;
        }
      }
    }

    // Try index file in directory
    for (const ext of DEFAULT_EXTENSIONS) {
      const indexFile = path.join(possiblePath, `index${ext}`);
      for (const known of knownFiles) {
        if (known === indexFile) {
          return known;
        }
      }
    }
  }

  return null;
}

function extractConcepts(text) {
  if (!text) return [];

  const concepts = new Set();

  // Extract capitalized technical terms
  const techPattern = /[A-Z][a-z]+(?:[A-Z][a-z]+)+/g;
  let match;
  while ((match = techPattern.exec(text)) !== null) {
    concepts.add(match[0]);
  }

  // Extract key terms in backticks
  const backtickPattern = /`([^`]+)`/g;
  while ((match = backtickPattern.exec(text)) !== null) {
    const term = match[1].trim();
    if (term.length >= 2 && term.length <= 50) {
      concepts.add(term);
    }
  }

  // Extract key terms in quotes
  const quotePattern = /"([^"]{2,40})"/g;
  while ((match = quotePattern.exec(text)) !== null) {
    concepts.add(match[1]);
  }

  return [...concepts].slice(0, 10); // Limit to top 10
}

function escapeDot(str) {
  return String(str).replace(/"/g, '\\"');
}

function escapeDotLabel(str) {
  return String(str).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function truncateString(str, maxLength) {
  if (!str) return "";
  return str.length <= maxLength ? str : str.substring(0, maxLength) + "...";
}

module.exports = { GraphBuilder };
