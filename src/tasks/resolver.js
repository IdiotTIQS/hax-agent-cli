"use strict";

/**
 * TaskResolver -- intelligent task dependency graph resolver.
 *
 * Manages a directed acyclic graph (DAG) of tasks where edges represent
 * "depends on" relationships.  Provides topological sort, cycle detection,
 * critical-path analysis, parallel-group discovery, and order optimisation
 * for maximum parallelism.
 */

// ---------------------------------------------------------------------------
// TaskResolver
// ---------------------------------------------------------------------------

class TaskResolver {
  constructor() {
    /** @type {Map<string, { id: string, title?: string, dependsOn: string[] }>} */
    this._tasks = new Map();
  }

  // ---- Primary API ----------------------------------------------------------

  /**
   * Add a task to the dependency graph.
   *
   * @param {{ id: string, title?: string, dependsOn?: string[] }} task
   * @returns {TaskResolver} this (chainable)
   */
  addTask(task) {
    if (!task || typeof task !== "object") {
      throw new TypeError("Task must be an object.");
    }
    if (typeof task.id !== "string") {
      throw new TypeError("Task id must be a string.");
    }

    const id = task.id.trim();
    if (id.length === 0) {
      throw new Error("Task id must be non-empty.");
    }
    if (this._tasks.has(id)) {
      throw new Error(`Duplicate task id: "${id}".`);
    }

    const dependsOn = Array.isArray(task.dependsOn)
      ? task.dependsOn.map((d) => String(d).trim()).filter((d) => d.length > 0)
      : [];

    // Validate that deps don't include self
    if (dependsOn.includes(id)) {
      throw new Error(`Task "${id}" cannot depend on itself.`);
    }

    this._tasks.set(id, {
      id,
      title: task.title || id,
      dependsOn,
    });

    return this;
  }

  /**
   * Resolve the entire dependency graph, validating all edges exist and
   * no cycles are present.
   *
   * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
   */
  resolve() {
    const errors = [];
    const warnings = [];

    // Validate all dependency references resolve to known tasks
    for (const [id, task] of this._tasks) {
      for (const depId of task.dependsOn) {
        if (!this._tasks.has(depId)) {
          errors.push(`Task "${id}" depends on unknown task: "${depId}".`);
        }
      }
    }

    // Detect cycles
    const cycles = this.detectCycles();
    if (cycles.length > 0) {
      for (const cycle of cycles) {
        errors.push(`Circular dependency detected: ${cycle.join(" -> ")}.`);
      }
    }

    // Warn about orphan tasks with no dependencies and no dependents
    if (this._tasks.size > 1) {
      for (const [id] of this._tasks) {
        const hasParents = [...this._tasks.values()].some(
          (t) => t.dependsOn.includes(id)
        );
        const task = this._tasks.get(id);
        if (task.dependsOn.length === 0 && !hasParents) {
          warnings.push(`Task "${id}" is orphaned (no dependencies and no dependents).`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Perform a topological (Kahn) sort and return the ordered task list.
   *
   * @returns {object[]} tasks in execution order
   * @throws {Error} if a cycle exists
   */
  getExecutionOrder() {
    const indegree = this._buildIndegreeMap();
    const adj = this._buildAdjacencyMap();

    const queue = [];
    for (const [id, deg] of indegree) {
      if (deg === 0) queue.push(id);
    }

    // Sort initial queue alphabetically for deterministic output
    queue.sort();

    const sorted = [];

    while (queue.length > 0) {
      const current = queue.shift();
      sorted.push(this._tasks.get(current));

      const children = (adj.get(current) || []).slice().sort();
      for (const child of children) {
        const deg = (indegree.get(child) || 1) - 1;
        indegree.set(child, deg);
        if (deg === 0) queue.push(child);
      }
      queue.sort();
    }

    if (sorted.length !== this._tasks.size) {
      throw new Error(
        "Cannot determine execution order: circular dependency detected."
      );
    }

    return sorted;
  }

  /**
   * Detect all cycles in the dependency graph.
   *
   * Uses iterative DFS with colour marking (0 = white, 1 = grey, 2 = black)
   * to find every cycle reachable from unvisited nodes.
   *
   * @returns {string[][]} array of cycles, each cycle is an ordered id list
   */
  detectCycles() {
    const WHITE = 0;
    const GREY = 1;
    const BLACK = 2;

    const colour = new Map();
    const parent = new Map();
    const cycles = [];
    const stack = [];

    for (const [id] of this._tasks) {
      colour.set(id, WHITE);
    }

    const iterate = (startId) => {
      // Use explicit stack for iterative DFS
      const dfsStack = [[startId, false]]; // [nodeId, doneWith]

      while (dfsStack.length > 0) {
        const [current, done] = dfsStack.pop();

        if (done) {
          // Post-order: mark black and pop from grey stack
          colour.set(current, BLACK);
          stack.pop();
          continue;
        }

        if (colour.get(current) === BLACK) continue;

        if (colour.get(current) === GREY) {
          // Still on the recursion stack -- this can happen if we push a node
          // that's still grey from a different path. In a purely DFS approach
          // this means the node was already being processed; we skip.
          continue;
        }

        // Mark grey & push onto recursion stack
        colour.set(current, GREY);
        stack.push(current);

        // Push the "done" marker for post-processing
        dfsStack.push([current, true]);

        // Explore dependents (who depends on `current`)
        for (const [id, task] of this._tasks) {
          if (task.dependsOn.includes(current)) {
            const childColour = colour.get(id);
            if (childColour === GREY) {
              // Back-edge found -- extract the cycle from the stack
              const cycleStart = stack.indexOf(id);
              if (cycleStart !== -1) {
                const cycle = stack.slice(cycleStart);
                cycle.push(id); // close the cycle
                cycles.push(cycle);
              }
            } else if (childColour === WHITE) {
              dfsStack.push([id, false]);
            }
          }
        }
      }
    };

    for (const [id] of this._tasks) {
      if (colour.get(id) === WHITE) {
        iterate(id);
      }
    }

    return cycles;
  }

  /**
   * Find the critical path -- the longest dependency chain through the graph.
   *
   * Uses DP (dynamic programming) on the topologically sorted DAG.  For each
   * task, its longest path length is max(dep.longest + 1).  The critical path
   * is traced back from the task(s) with the greatest length.
   *
   * @returns {{ length: number, path: object[] }}
   */
  getCriticalPath() {
    if (this._tasks.size === 0) {
      return { length: 0, path: [] };
    }

    // Build adjacency in forward direction (who does each task unlock?)
    const unlocked = new Map();
    for (const [id] of this._tasks) {
      unlocked.set(id, []);
    }
    for (const [id, task] of this._tasks) {
      for (const depId of task.dependsOn) {
        unlocked.get(depId).push(id);
      }
    }

    // Topological sort (Kahn)
    const indegree = this._buildIndegreeMap();
    const queue = [...indegree.entries()]
      .filter(([, deg]) => deg === 0)
      .map(([id]) => id);
    queue.sort();

    const order = [];
    while (queue.length > 0) {
      const current = queue.shift();
      order.push(current);
      for (const child of (unlocked.get(current) || []).slice().sort()) {
        const deg = indegree.get(child) - 1;
        indegree.set(child, deg);
        if (deg === 0) queue.push(child);
      }
      queue.sort();
    }

    // DP: longest path ending at each node
    const longest = new Map();
    const prev = new Map();

    for (const id of order) {
      const task = this._tasks.get(id);
      let maxLen = 1;
      let bestPrev = null;

      for (const depId of task.dependsOn) {
        const depLen = (longest.get(depId) || 0) + 1;
        // On ties, prefer the first alphabetically to keep output stable
        if (
          depLen > maxLen ||
          (depLen === maxLen && bestPrev !== null && depId < bestPrev)
        ) {
          maxLen = depLen;
          bestPrev = depId;
        }
      }

      longest.set(id, maxLen);
      prev.set(id, bestPrev);
    }

    // Find the node with the maximum longest-path value
    let maxId = order[0];
    for (const id of order) {
      if (
        (longest.get(id) || 0) > (longest.get(maxId) || 0) ||
        ((longest.get(id) || 0) === (longest.get(maxId) || 0) && id < maxId)
      ) {
        maxId = id;
      }
    }

    // Reconstruct the path
    const pathIds = [];
    let cursor = maxId;
    while (cursor) {
      pathIds.unshift(cursor);
      cursor = prev.get(cursor);
    }

    const path = pathIds.map((id) => this._tasks.get(id));

    return { length: path.length, path };
  }

  /**
   * Group tasks by topological level -- tasks at the same level are independent
   * and can be executed in parallel.
   *
   * @returns {object[][]} array of levels, each level is an array of tasks
   */
  getParallelGroups() {
    if (this._tasks.size === 0) return [];

    const order = this.getExecutionOrder();
    const taskIds = order.map((t) => t.id);

    // Forward adjacency (who does each task enable?)
    const unlocked = new Map();
    for (const [id] of this._tasks) {
      unlocked.set(id, []);
    }
    for (const [id, task] of this._tasks) {
      for (const depId of task.dependsOn) {
        unlocked.get(depId).push(id);
      }
    }

    // BFS to compute levels
    const level = new Map();
    const indegree = this._buildIndegreeMap();

    // Set level 0 for all root tasks
    for (const [id, deg] of indegree) {
      if (deg === 0) {
        level.set(id, 0);
      }
    }

    for (const id of taskIds) {
      const currentLevel = level.get(id) || 0;
      for (const child of unlocked.get(id) || []) {
        const candidate = currentLevel + 1;
        if (!level.has(child) || candidate > level.get(child)) {
          level.set(child, candidate);
        }
      }
    }

    // Group by level
    const groups = new Map();
    for (const [id, lvl] of level) {
      if (!groups.has(lvl)) groups.set(lvl, []);
      groups.get(lvl).push(this._tasks.get(id));
    }

    // Collect levels in ascending order
    const result = [];
    const maxLevel = Math.max(...level.values(), 0);
    for (let i = 0; i <= maxLevel; i++) {
      if (groups.has(i)) {
        // Sort alphabetically within each group for deterministic output
        result.push(
          groups.get(i).sort((a, b) => a.id.localeCompare(b.id))
        );
      }
    }

    return result;
  }

  /**
   * Reorder tasks for maximum parallelism.
   *
   * Returns tasks in topological order but with a heuristic that prioritises
   * tasks on the critical path first, so long-dependency chains start as
   * early as possible.  Within each topological level, critical-path tasks
   * come first, then others.
   *
   * @returns {object[]} optimised task order
   */
  optimizeOrder() {
    if (this._tasks.size <= 1) {
      return this.getExecutionOrder();
    }

    const { path: criticalPath } = this.getCriticalPath();
    const criticalSet = new Set(criticalPath.map((t) => t.id));

    // Build indegree + forward adjacency
    const indegree = this._buildIndegreeMap();
    const adj = this._buildAdjacencyMap();
    const unlocked = new Map();
    for (const [id] of this._tasks) unlocked.set(id, []);
    for (const [id, task] of this._tasks) {
      for (const depId of task.dependsOn) {
        unlocked.get(depId).push(id);
      }
    }

    // Priority queue: critical-path tasks first, then alphabetical
    const compare = (a, b) => {
      const aCrit = criticalSet.has(a) ? 0 : 1;
      const bCrit = criticalSet.has(b) ? 0 : 1;
      if (aCrit !== bCrit) return aCrit - bCrit;
      return a.localeCompare(b);
    };

    const pq = [...indegree.entries()]
      .filter(([, deg]) => deg === 0)
      .map(([id]) => id)
      .sort(compare);

    const result = [];

    while (pq.length > 0) {
      const current = pq.shift();
      result.push(this._tasks.get(current));

      for (const child of unlocked.get(current) || []) {
        const deg = indegree.get(child) - 1;
        indegree.set(child, deg);
        if (deg === 0) pq.push(child);
      }

      pq.sort(compare);
    }

    return result;
  }

  // ---- Query helpers --------------------------------------------------------

  /**
   * Return the total number of tasks in the graph.
   * @returns {number}
   */
  get size() {
    return this._tasks.size;
  }

  /**
   * Get a shallow copy of all tasks.
   * @returns {object[]}
   */
  getAllTasks() {
    return [...this._tasks.values()].map(cloneTask);
  }

  /**
   * Get a specific task by id.
   * @param {string} id
   * @returns {object|undefined}
   */
  getTask(id) {
    const task = this._tasks.get(id);
    return task ? cloneTask(task) : undefined;
  }

  /**
   * Remove all tasks from the graph.
   */
  clear() {
    this._tasks.clear();
  }

  // ---- Internal helpers -----------------------------------------------------

  /** @returns {Map<string, number>} */
  _buildIndegreeMap() {
    const indegree = new Map();
    for (const [id] of this._tasks) indegree.set(id, 0);
    for (const [, task] of this._tasks) {
      for (const depId of task.dependsOn) {
        indegree.set(task.id, (indegree.get(task.id) || 0) + 1);
      }
    }
    return indegree;
  }

  /** @returns {Map<string, string[]>} task id -> dependents */
  _buildAdjacencyMap() {
    const adj = new Map();
    for (const [id] of this._tasks) adj.set(id, []);
    for (const [, task] of this._tasks) {
      for (const depId of task.dependsOn) {
        adj.get(depId).push(task.id);
      }
    }
    return adj;
  }
}

// ---------------------------------------------------------------------------
// Standalone helpers
// ---------------------------------------------------------------------------

function cloneTask(task) {
  return {
    id: task.id,
    title: task.title,
    dependsOn: [...task.dependsOn],
  };
}

module.exports = {
  TaskResolver,
};
