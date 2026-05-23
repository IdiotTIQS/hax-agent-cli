"use strict";

const NODE_TYPES = Object.freeze({
  FILE: "FILE",
  FUNCTION: "FUNCTION",
  CLASS: "CLASS",
  AGENT: "AGENT",
  TASK: "TASK",
  DECISION: "DECISION",
  CONCEPT: "CONCEPT",
  ERROR: "ERROR",
});

const EDGE_TYPES = Object.freeze({
  DEPENDS_ON: "DEPENDS_ON",
  IMPLEMENTS: "IMPLEMENTS",
  CALLS: "CALLS",
  MODIFIES: "MODIFIES",
  OWNED_BY: "OWNED_BY",
  RELATED_TO: "RELATED_TO",
  CAUSED_BY: "CAUSED_BY",
});

class KnowledgeGraph {
  constructor(options = {}) {
    this._nodes = new Map();
    this._edges = new Map();
    this._edgesByFrom = new Map();
    this._edgesByTo = new Map();
    this._sequence = 0;
    this._name = options.name || "knowledge-graph";
  }

  /**
   * Add a node to the graph.
   *
   * @param {string} type - One of NODE_TYPES.
   * @param {string} id   - Unique node identifier.
   * @param {object} [properties={}] - Arbitrary key/value metadata.
   * @returns {object} The created node.
   */
  addNode(type, id, properties = {}) {
    requireString(id, "id");

    const normalizedType = normalizeNodeType(type);
    const node = {
      id: String(id).trim(),
      type: normalizedType,
      properties: deepClone(properties),
      createdAt: new Date().toISOString(),
    };

    this._nodes.set(node.id, node);
    return deepClone(node);
  }

  /**
   * Add a directed edge between two nodes.
   *
   * @param {string} from - Source node id.
   * @param {string} to   - Target node id.
   * @param {string} type - One of EDGE_TYPES.
   * @param {object} [properties={}] - Arbitrary key/value metadata.
   * @returns {object} The created edge.
   */
  addEdge(from, to, type, properties = {}) {
    requireString(from, "from");
    requireString(to, "to");

    if (!this._nodes.has(from)) {
      throw new Error(`Source node '${from}' does not exist`);
    }
    if (!this._nodes.has(to)) {
      throw new Error(`Target node '${to}' does not exist`);
    }

    const normalizedType = normalizeEdgeType(type);
    const edge = {
      id: `e-${++this._sequence}`,
      from: String(from).trim(),
      to: String(to).trim(),
      type: normalizedType,
      properties: deepClone(properties),
      createdAt: new Date().toISOString(),
    };

    this._edges.set(edge.id, edge);

    if (!this._edgesByFrom.has(edge.from)) {
      this._edgesByFrom.set(edge.from, new Map());
    }
    if (!this._edgesByFrom.get(edge.from).has(edge.to)) {
      this._edgesByFrom.get(edge.from).set(edge.to, []);
    }
    this._edgesByFrom.get(edge.from).get(edge.to).push(edge);

    if (!this._edgesByTo.has(edge.to)) {
      this._edgesByTo.set(edge.to, new Map());
    }
    if (!this._edgesByTo.get(edge.to).has(edge.from)) {
      this._edgesByTo.get(edge.to).set(edge.from, []);
    }
    this._edgesByTo.get(edge.to).get(edge.from).push(edge);

    return deepClone(edge);
  }

  /**
   * Query the graph using a pattern object.
   *
   * Pattern can contain:
   *   { nodeType, properties: { key: value }, edges: [{ type, direction }] }
   *
   * Simple forms:
   *   query({ nodeType: "FILE" })           — all FILE nodes
   *   query({ nodeType: "FUNCTION", edges: [{ type: "CALLS" }] })
   *
   * @param {object} pattern
   * @returns {object} { nodes: [...], edges: [...] }
   */
  query(pattern = {}) {
    const matchedNodes = new Map();
    const matchedEdges = [];

    let candidates;
    if (pattern.nodeType) {
      const normalizedType = normalizeNodeType(pattern.nodeType);
      candidates = this.getNodesByType(normalizedType);
    } else {
      candidates = Array.from(this._nodes.values());
    }

    if (pattern.properties && Object.keys(pattern.properties).length > 0) {
      candidates = candidates.filter((node) =>
        matchProperties(node.properties, pattern.properties)
      );
    }

    if (pattern.id) {
      candidates = candidates.filter((node) => node.id === pattern.id);
    }

    for (const node of candidates) {
      matchedNodes.set(node.id, deepClone(node));
    }

    if (pattern.edges && Array.isArray(pattern.edges) && pattern.edges.length > 0) {
      for (const edgeSpec of pattern.edges) {
        const edgeType = edgeSpec.type ? normalizeEdgeType(edgeSpec.type) : null;
        const direction = edgeSpec.direction || "outgoing";

        for (const nodeId of matchedNodes.keys()) {
          const neighbors = this._getEdgesByDirection(nodeId, direction, edgeType);

          for (const edge of neighbors) {
            const otherId = direction === "incoming" ? edge.from : edge.to;

            if (edgeSpec.nodeType) {
              const otherNode = this._nodes.get(otherId);
              if (!otherNode || otherNode.type !== normalizeNodeType(edgeSpec.nodeType)) {
                continue;
              }
            }

            if (edgeSpec.properties && Object.keys(edgeSpec.properties).length > 0) {
              const otherNode = this._nodes.get(otherId);
              if (!otherNode || !matchProperties(otherNode.properties, edgeSpec.properties)) {
                continue;
              }
            }

            matchedEdges.push(deepClone(edge));
            if (!matchedNodes.has(otherId)) {
              matchedNodes.set(otherId, deepClone(this._nodes.get(otherId)));
            }
          }
        }
      }
    }

    return {
      nodes: Array.from(matchedNodes.values()),
      edges: removeDuplicateEdges(matchedEdges),
    };
  }

  /**
   * Traverse the graph starting from a node, following edges that match criteria.
   *
   * @param {string} startNode - Starting node id.
   * @param {object} [options]
   * @param {number} [options.maxDepth=Infinity]  - Maximum traversal depth.
   * @param {string[]} [options.edgeTypes]         - Allowed edge types.
   * @param {string} [options.direction="outgoing"] - "outgoing", "incoming", or "both".
   * @param {function} [options.nodeFilter]         - Predicate (node) => boolean.
   * @param {function} [options.edgeFilter]         - Predicate (edge) => boolean.
   * @returns {object} { nodes: [...], edges: [...] }
   */
  traverse(startNode, options = {}) {
    requireString(startNode, "startNode");

    if (!this._nodes.has(startNode)) {
      throw new Error(`Start node '${startNode}' does not exist`);
    }

    const maxDepth = options.maxDepth !== undefined ? options.maxDepth : Infinity;
    const edgeTypes = options.edgeTypes
      ? new Set(options.edgeTypes.map((t) => normalizeEdgeType(t)))
      : null;
    const direction = options.direction || "outgoing";
    const nodeFilter = typeof options.nodeFilter === "function" ? options.nodeFilter : null;
    const edgeFilter = typeof options.edgeFilter === "function" ? options.edgeFilter : null;

    const visited = new Set();
    const matchedNodes = new Map();
    const matchedEdges = [];

    const queue = [[startNode, 0]];
    visited.add(startNode);
    matchedNodes.set(startNode, deepClone(this._nodes.get(startNode)));

    while (queue.length > 0) {
      const [currentId, depth] = queue.shift();

      if (depth >= maxDepth) {
        continue;
      }

      const neighbors = this._getEdgesByDirection(currentId, direction, null);

      for (const edge of neighbors) {
        const targetId = edge.from === currentId ? edge.to : edge.from;

        if (edgeTypes && !edgeTypes.has(edge.type)) {
          continue;
        }

        if (edgeFilter && !edgeFilter(edge)) {
          continue;
        }

        const nextNode = this._nodes.get(targetId);
        if (!nextNode) {
          continue;
        }

        if (nodeFilter && !nodeFilter(nextNode)) {
          continue;
        }

        matchedEdges.push(deepClone(edge));

        if (!visited.has(targetId)) {
          visited.add(targetId);
          matchedNodes.set(targetId, deepClone(nextNode));
          queue.push([targetId, depth + 1]);
        }
      }
    }

    return {
      nodes: Array.from(matchedNodes.values()),
      edges: removeDuplicateEdges(matchedEdges),
    };
  }

  /**
   * Get a node by its id.
   *
   * @param {string} id
   * @returns {object|null}
   */
  getNode(id) {
    const node = this._nodes.get(id);
    return node ? deepClone(node) : null;
  }

  /**
   * Get all edges connected to a node.
   *
   * @param {string} id     - Node id.
   * @param {string} [direction] - "outgoing", "incoming", or "both" (default).
   * @param {string} [type]      - Filter by edge type.
   * @returns {object[]}
   */
  getEdges(id, direction, type) {
    requireString(id, "id");

    const results = this._getEdgesByDirection(
      id,
      direction || "both",
      type ? normalizeEdgeType(type) : null
    );
    return deepClone(results);
  }

  /**
   * Get all nodes of a specific type.
   *
   * @param {string} type
   * @returns {object[]}
   */
  getNodesByType(type) {
    const normalizedType = normalizeNodeType(type);
    const results = [];
    for (const node of this._nodes.values()) {
      if (node.type === normalizedType) {
        results.push(deepClone(node));
      }
    }
    return results;
  }

  /**
   * Check if a node exists.
   *
   * @param {string} id
   * @returns {boolean}
   */
  hasNode(id) {
    return this._nodes.has(id);
  }

  /**
   * Remove a node and all its connected edges.
   *
   * @param {string} id
   * @returns {boolean} Whether the node was removed.
   */
  removeNode(id) {
    const node = this._nodes.get(id);
    if (!node) {
      return false;
    }

    for (const [edgeId, edge] of this._edges) {
      if (edge.from === id || edge.to === id) {
        this._edges.delete(edgeId);
      }
    }

    this._edgesByFrom.delete(id);
    this._edgesByTo.delete(id);

    for (const [, toMap] of this._edgesByFrom) {
      toMap.delete(id);
    }
    for (const [, fromMap] of this._edgesByTo) {
      fromMap.delete(id);
    }

    // Clean up empty maps
    for (const key of [...this._edgesByFrom.keys()]) {
      if (this._edgesByFrom.get(key).size === 0) {
        this._edgesByFrom.delete(key);
      }
    }
    for (const key of [...this._edgesByTo.keys()]) {
      if (this._edgesByTo.get(key).size === 0) {
        this._edgesByTo.delete(key);
      }
    }

    this._nodes.delete(id);
    return true;
  }

  /**
   * Remove an edge by its id.
   *
   * @param {string} edgeId
   * @returns {boolean} Whether the edge was removed.
   */
  removeEdge(edgeId) {
    const edge = this._edges.get(edgeId);
    if (!edge) {
      return false;
    }

    this._edges.delete(edgeId);

    const fromMap = this._edgesByFrom.get(edge.from);
    if (fromMap) {
      const toList = fromMap.get(edge.to);
      if (toList) {
        const idx = toList.findIndex((e) => e.id === edgeId);
        if (idx !== -1) {
          toList.splice(idx, 1);
        }
        if (toList.length === 0) {
          fromMap.delete(edge.to);
        }
      }
      if (fromMap.size === 0) {
        this._edgesByFrom.delete(edge.from);
      }
    }

    const toMap = this._edgesByTo.get(edge.to);
    if (toMap) {
      const fromList = toMap.get(edge.from);
      if (fromList) {
        const idx = fromList.findIndex((e) => e.id === edge.id);
        if (idx !== -1) {
          fromList.splice(idx, 1);
        }
        if (fromList.length === 0) {
          toMap.delete(edge.from);
        }
      }
      if (toMap.size === 0) {
        this._edgesByTo.delete(edge.to);
      }
    }

    return true;
  }

  /**
   * Clear all nodes and edges from the graph.
   */
  clear() {
    this._nodes.clear();
    this._edges.clear();
    this._edgesByFrom.clear();
    this._edgesByTo.clear();
    this._sequence = 0;
  }

  /**
   * Return the total number of nodes.
   */
  get nodeCount() {
    return this._nodes.size;
  }

  /**
   * Return the total number of edges.
   */
  get edgeCount() {
    return this._edges.size;
  }

  /**
   * Return all node ids.
   */
  get nodeIds() {
    return Array.from(this._nodes.keys());
  }

  /**
   * Return all edge ids.
   */
  get edgeIds() {
    return Array.from(this._edges.keys());
  }

  /**
   * Return the graph name.
   */
  get name() {
    return this._name;
  }

  /**
   * Return all nodes as an array.
   */
  get nodes() {
    return Array.from(this._nodes.values()).map(deepClone);
  }

  /**
   * Return all edges as an array.
   */
  get edges() {
    return Array.from(this._edges.values()).map(deepClone);
  }

  // ---- Internal helpers exposed for query/builder ----

  _getEdgesByDirection(nodeId, direction, edgeType) {
    const results = [];

    if (direction === "outgoing" || direction === "both") {
      const fromMap = this._edgesByFrom.get(nodeId);
      if (fromMap) {
        for (const [, edgeList] of fromMap) {
          for (const edge of edgeList) {
            if (!edgeType || edge.type === edgeType) {
              results.push(edge);
            }
          }
        }
      }
    }

    if (direction === "incoming" || direction === "both") {
      const toMap = this._edgesByTo.get(nodeId);
      if (toMap) {
        for (const [, edgeList] of toMap) {
          for (const edge of edgeList) {
            if (!edgeType || edge.type === edgeType) {
              results.push(edge);
            }
          }
        }
      }
    }

    return results;
  }
}

// ---- Helpers ----

function normalizeNodeType(type) {
  const normalized = String(type || "").trim().toUpperCase();
  if (NODE_TYPES[normalized]) {
    return NODE_TYPES[normalized];
  }
  throw new Error(
    `Invalid node type '${type}'. Must be one of: ${Object.keys(NODE_TYPES).join(", ")}`
  );
}

function normalizeEdgeType(type) {
  const normalized = String(type || "").trim().toUpperCase();
  if (EDGE_TYPES[normalized]) {
    return EDGE_TYPES[normalized];
  }
  throw new Error(
    `Invalid edge type '${type}'. Must be one of: ${Object.keys(EDGE_TYPES).join(", ")}`
  );
}

function matchProperties(nodeProps, filterProps) {
  for (const key of Object.keys(filterProps)) {
    if (!(key in nodeProps)) {
      return false;
    }
    const filterVal = filterProps[key];
    const nodeVal = nodeProps[key];

    if (filterVal instanceof RegExp) {
      if (!filterVal.test(String(nodeVal))) {
        return false;
      }
    } else if (typeof filterVal === "function") {
      if (!filterVal(nodeVal)) {
        return false;
      }
    } else if (nodeVal !== filterVal) {
      return false;
    }
  }
  return true;
}

function removeDuplicateEdges(edges) {
  const seen = new Set();
  const result = [];
  for (const edge of edges) {
    if (!seen.has(edge.id)) {
      seen.add(edge.id);
      result.push(edge);
    }
  }
  return result;
}

function deepClone(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

module.exports = {
  EDGE_TYPES,
  KnowledgeGraph,
  NODE_TYPES,
  normalizeEdgeType,
  normalizeNodeType,
  matchProperties,
  deepClone,
  requireString,
  shuffleArray,
};
