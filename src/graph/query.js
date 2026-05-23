"use strict";

const {
  KnowledgeGraph,
  NODE_TYPES,
  normalizeNodeType,
  matchProperties,
  requireString,
  shuffleArray,
} = require("./engine");

class GraphQuery {
  /**
   * @param {KnowledgeGraph} graph
   */
  constructor(graph) {
    if (!(graph instanceof KnowledgeGraph)) {
      throw new Error("GraphQuery requires a KnowledgeGraph instance");
    }
    this._graph = graph;
  }

  /**
   * Find nodes by type, optionally filtering by properties.
   *
   * @param {string} type - Node type.
   * @param {object} [filters={}] - Property key/value matches.
   * @returns {object[]}
   */
  findNodes(type, filters = {}) {
    const normalizedType = normalizeNodeType(type);
    let nodes = this._graph.getNodesByType(normalizedType);

    if (filters && Object.keys(filters).length > 0) {
      nodes = nodes.filter((node) => matchProperties(node.properties, filters));
    }

    return nodes;
  }

  /**
   * Find all paths between two nodes up to a maximum depth.
   * Uses DFS with backtracking.
   *
   * @param {string} from - Start node id.
   * @param {string} to   - End node id.
   * @param {number} [maxDepth=5] - Maximum path depth.
   * @returns {string[][]} Array of paths, each path is an array of node ids.
   */
  findPaths(from, to, maxDepth = 5) {
    requireString(from, "from");
    requireString(to, "to");

    if (!this._graph.hasNode(from)) {
      throw new Error(`Node '${from}' does not exist`);
    }
    if (!this._graph.hasNode(to)) {
      throw new Error(`Node '${to}' does not exist`);
    }

    const paths = [];
    const visited = new Set();

    const dfs = (currentId, path) => {
      if (path.length > maxDepth + 1) {
        return;
      }

      if (currentId === to) {
        paths.push([...path]);
        return;
      }

      visited.add(currentId);

      const edges = this._graph.getEdges(currentId, "outgoing");
      for (const edge of edges) {
        const nextId = edge.to;
        if (!visited.has(nextId)) {
          dfs(nextId, [...path, nextId]);
        }
      }

      visited.delete(currentId);
    };

    dfs(from, [from]);
    return paths;
  }

  /**
   * Find all neighbors of a node up to a given depth.
   *
   * @param {string} node  - Node id.
   * @param {number} [depth=1] - Neighborhood depth.
   * @returns {object} { nodes: [...], edges: [...] }
   */
  findNeighbors(node, depth = 1) {
    return this._graph.traverse(node, {
      maxDepth: depth,
      direction: "both",
    });
  }

  /**
   * Find the most connected nodes, ordered by edge count descending.
   *
   * @param {number} [limit=10] - Maximum number of results.
   * @returns {object[]} Array of { node, edgeCount }.
   */
  findCentralNodes(limit = 10) {
    const degrees = new Map();

    for (const nodeId of this._graph.nodeIds) {
      const allEdges = this._graph.getEdges(nodeId, "both");
      degrees.set(nodeId, allEdges.length);
    }

    const sorted = Array.from(degrees.entries())
      .map(([nodeId, edgeCount]) => ({
        node: this._graph.getNode(nodeId),
        edgeCount,
      }))
      .sort((a, b) => b.edgeCount - a.edgeCount)
      .slice(0, limit);

    return sorted;
  }

  /**
   * Detect communities using label propagation.
   *
   * @param {number} [maxIterations=20] - Maximum iterations of label propagation.
   * @returns {Map<string, string[]>} Map of label -> array of node ids.
   */
  findClusters(maxIterations = 20) {
    const nodeIds = this._graph.nodeIds;
    if (nodeIds.length === 0) {
      return new Map();
    }

    // Initialize each node with its own id as label
    const labels = new Map();
    for (const nodeId of nodeIds) {
      labels.set(nodeId, nodeId);
    }

    for (let iter = 0; iter < maxIterations; iter++) {
      let changed = false;

      const shuffled = shuffleArray([...nodeIds]);

      for (const nodeId of shuffled) {
        const edges = this._graph.getEdges(nodeId, "both");
        const neighborLabels = [];

        for (const edge of edges) {
          const neighborId = edge.from === nodeId ? edge.to : edge.from;
          if (labels.has(neighborId)) {
            neighborLabels.push(labels.get(neighborId));
          }
        }

        if (neighborLabels.length === 0) {
          continue;
        }

        const freq = new Map();
        for (const label of neighborLabels) {
          freq.set(label, (freq.get(label) || 0) + 1);
        }

        let maxCount = 0;
        let mostFrequent = labels.get(nodeId);
        for (const [label, count] of freq) {
          if (count > maxCount || (count === maxCount && label < mostFrequent)) {
            maxCount = count;
            mostFrequent = label;
          }
        }

        if (labels.get(nodeId) !== mostFrequent) {
          labels.set(nodeId, mostFrequent);
          changed = true;
        }
      }

      if (!changed) {
        break;
      }
    }

    const clusters = new Map();
    for (const [nodeId, label] of labels) {
      if (!clusters.has(label)) {
        clusters.set(label, []);
      }
      clusters.get(label).push(nodeId);
    }

    return clusters;
  }

  /**
   * Find the shortest path between two nodes using BFS.
   *
   * @param {string} from - Start node id.
   * @param {string} to   - End node id.
   * @returns {string[]|null} Array of node ids representing the path, or null if no path exists.
   */
  shortestPath(from, to) {
    requireString(from, "from");
    requireString(to, "to");

    if (this._graph.nodeCount === 0) {
      return null;
    }
    if (!this._graph.hasNode(from)) {
      return null;
    }
    if (!this._graph.hasNode(to)) {
      return null;
    }

    if (from === to) {
      return [from];
    }

    const visited = new Set();
    const parent = new Map();
    const queue = [from];
    visited.add(from);

    while (queue.length > 0) {
      const current = queue.shift();

      const edges = this._graph.getEdges(current, "outgoing");
      for (const edge of edges) {
        const neighbor = edge.to;
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          parent.set(neighbor, current);
          queue.push(neighbor);

          if (neighbor === to) {
            const path = [to];
            let step = to;
            while (parent.has(step)) {
              step = parent.get(step);
              path.unshift(step);
            }
            return path;
          }
        }
      }
    }

    return null;
  }

  /**
   * Get graph statistics.
   *
   * @returns {object}
   */
  stats() {
    const typeCounts = {};
    for (const nodeId of this._graph.nodeIds) {
      const node = this._graph.getNode(nodeId);
      typeCounts[node.type] = (typeCounts[node.type] || 0) + 1;
    }

    const edgeTypeCounts = {};
    for (const edgeId of this._graph.edgeIds) {
      const rawEdge = this._graph._edges.get(edgeId);
      if (rawEdge) {
        edgeTypeCounts[rawEdge.type] = (edgeTypeCounts[rawEdge.type] || 0) + 1;
      }
    }

    return {
      nodeCount: this._graph.nodeCount,
      edgeCount: this._graph.edgeCount,
      nodeTypes: typeCounts,
      edgeTypes: edgeTypeCounts,
    };
  }
}

module.exports = { GraphQuery };
