"use strict";

/**
 * TaskDecomposer -- rule-based goal decomposition engine.
 *
 * Breaks natural-language goals into structured subtask graphs with
 * dependency detection, parallelism suggestions, and effort estimates --
 * all without requiring an LLM.
 */

// ---------------------------------------------------------------------------
// Decomposition templates
// ---------------------------------------------------------------------------

/**
 * Each template maps a goal intent pattern to a sequence of phase names,
 * each with a type tag used later to classify the resulting task.
 */
const DECOMPOSITION_TEMPLATES = {
  build: {
    match: /build|create|make|implement|develop|construct/,
    phases: [
      { name: "Clarify requirements & scope", type: "design" },
      { name: "Design architecture & interfaces", type: "design" },
      { name: "Implement core logic", type: "implement" },
      { name: "Add error handling & edge cases", type: "implement" },
      { name: "Write / update tests", type: "test" },
      { name: "Document usage & API surface", type: "document" },
    ],
  },
  refactor: {
    match: /refactor|restructure|reorganize|extract|clean\s*up|tidy/,
    phases: [
      { name: "Analyze existing code & identify seams", type: "analyze" },
      { name: "Plan extraction / restructuring steps", type: "plan" },
      { name: "Extract / reorganise targeted modules", type: "extract" },
      { name: "Verify behaviour unchanged (tests pass)", type: "verify" },
      { name: "Clean up dead code & stale references", type: "cleanup" },
    ],
  },
  debug: {
    match: /debug|fix\s*(bug|issue|error|crash)|troubleshoot|resolve/,
    phases: [
      { name: "Reproduce the issue reliably", type: "reproduce" },
      { name: "Isolate root cause (logs, bisect, trace)", type: "isolate" },
      { name: "Formulate a hypothesis / fix plan", type: "hypothesize" },
      { name: "Apply fix with minimal blast radius", type: "fix" },
      { name: "Verify fix & add regression test", type: "verify" },
    ],
  },
  feature: {
    match: /add\s*(feature|support|capability)|new\s*feature|introduce/,
    phases: [
      { name: "Write feature specification", type: "spec" },
      { name: "Design data model / API changes", type: "design" },
      { name: "Implement feature logic", type: "implement" },
      { name: "Integrate with existing system", type: "integrate" },
      { name: "Write / update tests", type: "test" },
      { name: "Update documentation & changelog", type: "document" },
    ],
  },
  test: {
    match: /test|coverage|quality|validate|verify|lint/,
    phases: [
      { name: "Audit existing test coverage", type: "audit" },
      { name: "Identify critical gaps", type: "analyze" },
      { name: "Write / improve tests", type: "implement" },
      { name: "Run suite & fix failures", type: "verify" },
      { name: "Report coverage deltas", type: "document" },
    ],
  },
  optimize: {
    match: /optimize|performance|speed|fast|slow|benchmark/,
    phases: [
      { name: "Profile / benchmark current state", type: "profile" },
      { name: "Identify bottlenecks & hot paths", type: "analyze" },
      { name: "Implement targeted optimisations", type: "implement" },
      { name: "Benchmark after changes", type: "verify" },
      { name: "Document trade-offs & caveats", type: "document" },
    ],
  },
  migrate: {
    match: /migrate|upgrade|update\s*(dependency|package|lib)|bump/,
    phases: [
      { name: "Audit current dependency graph", type: "audit" },
      { name: "Review changelog / breaking changes", type: "review" },
      { name: "Update dependency & adapt API calls", type: "implement" },
      { name: "Run test suite & fix regressions", type: "verify" },
      { name: "Update lockfile & document migration", type: "document" },
    ],
  },
};

/**
 * Generic fallback: any goal that does not match a specialised template
 * follows this classic workflow.
 */
const GENERIC_PHASES = [
  { name: "Analyze goal & gather context", type: "analyze" },
  { name: "Plan approach & sequence work", type: "plan" },
  { name: "Execute implementation steps", type: "execute" },
  { name: "Verify outcomes & correctness", type: "verify" },
  { name: "Document decisions & remaining work", type: "document" },
];

// ---------------------------------------------------------------------------
// Effort keywords
// ---------------------------------------------------------------------------

const EFFORT_KEYWORDS = {
  S: /simple|trivial|minor|small|tiny|single|one\s*line|cosmetic/,
  M: /moderate|medium|few|some|update|change|modify/,
  L: /large|significant|major|complex|many|multiple|extensive|overhaul/,
  XL: /massive|huge|entire|complete\s*rewrite|ground\s*up|from\s*scratch|monumental/,
};

/**
 * Keywords that signal a dependency relationship between two task names.
 * { [dependentKeyword]: prerequisiteKeyword }
 */
const DEPENDENCY_HINTS = [
  { after: /implement|build|code/, before: /design|plan|spec/ },
  { after: /test|verify|validate/, before: /implement|build|fix/ },
  { after: /document|doc|write\s*(up|docs)/, before: /implement|test|verify/ },
  { after: /integrate|deploy|release/, before: /implement|test/ },
  { after: /review|audit/, before: /implement|build/ },
  { after: /fix|resolve|patch/, before: /reproduce|isolate|identify/ },
  { after: /clean\s*up|polish/, before: /implement|fix|verify/ },
  { after: /profile|benchmark/, before: /optimize|implement/ },
];

// ---------------------------------------------------------------------------
// TaskDecomposer
// ---------------------------------------------------------------------------

class TaskDecomposer {
  constructor(opts = {}) {
    this._templates = Object.assign({}, DECOMPOSITION_TEMPLATES, opts.templates || {});
    this._genericPhases = (opts.genericPhases || GENERIC_PHASES).slice();
  }

  // ---- Primary API --------------------------------------------------------

  /**
   * Decompose a natural-language goal into a structured task graph.
   *
   * @param {string} goal
   * @param {object} [options]
   * @param {number} [options.maxTasks=10]          - upper bound on generated subtask count
   * @param {boolean} [options.detectDeps=true]     - auto-detect implicit dependencies
   * @param {boolean} [options.suggestParallel=true] - annotate parallelisable tasks
   * @param {boolean} [options.optimizeOrder=true]   - reorder for optimal execution
   * @param {boolean} [options.estimateEffort=true]  - attach effort labels
   * @returns {{ goal: string, tasks: object[], metadata: object }}
   */
  decompose(goal, options = {}) {
    const opts = {
      maxTasks: 10,
      detectDeps: true,
      suggestParallel: true,
      optimizeOrder: true,
      estimateEffort: true,
      ...options,
    };

    const cleanGoal = String(goal || "").trim();
    if (!cleanGoal) {
      throw new Error("Goal must be a non-empty string.");
    }

    // 1. Match template
    const template = this._matchTemplate(cleanGoal);
    const phases = template ? template.phases : this._genericPhases;

    // 2. Generate tasks from phases (capped by maxTasks)
    let tasks = phases.slice(0, opts.maxTasks).map((phase, idx) => ({
      id: `T${idx + 1}`,
      title: phase.name,
      type: phase.type,
      effort: opts.estimateEffort ? this.estimateEffort(cleanGoal, idx, phases.length) : null,
      dependsOn: [],
      parallel: true,
    }));

    // 3. Detect implicit dependencies
    if (opts.detectDeps) {
      tasks = this.identifyDependencies(tasks);
    }

    // 4. Mark parallel-safe tasks
    if (opts.suggestParallel) {
      tasks = this.suggestParallelism(tasks);
    }

    // 5. Optimize execution order
    if (opts.optimizeOrder) {
      tasks = this.optimizeOrder(tasks);
    }

    // Collect metadata
    const summary = this._summarize(tasks);

    return {
      goal: cleanGoal,
      tasks,
      metadata: {
        template: template ? template.match.source : "generic",
        phaseCount: phases.length,
        taskCount: tasks.length,
        summary,
      },
    };
  }

  // ---- Effort estimation --------------------------------------------------

  /**
   * Assign a rough effort label to a task based on keyword heuristics.
   *
   * @param {string} text  - task title / goal description
   * @param {number} [idx] - position in the sequence (later phases tend larger)
   * @param {number} [total] - total number of phases
   * @returns {'S'|'M'|'L'|'XL'}
   */
  estimateEffort(text, idx, total) {
    const lower = String(text || "").toLowerCase();

    // Long goals often imply more work
    const wordCount = lower.split(/\s+/).filter(Boolean).length;

    // Check explicit keyword hints
    for (const [label, re] of Object.entries(EFFORT_KEYWORDS)) {
      if (re.test(lower)) return label;
    }

    // Position-based heuristics: middle phases (implementation) tend larger
    if (total && idx !== undefined) {
      const ratio = idx / total;
      if (ratio >= 0.8) return "S";      // documentation / polish phases
      if (ratio >= 0.6) return "M";      // verification / testing
      if (ratio >= 0.2) return "L";      // core implementation
      return "M";                         // early analysis / design
    }

    // Word-count heuristic
    if (wordCount > 20) return "L";
    if (wordCount > 10) return "M";
    return "S";
  }

  // ---- Dependency detection -----------------------------------------------

  /**
   * Walk through the task list and add `dependsOn` edges for any
   * implicit dependencies detected via keyword analysis.
   *
   * @param {object[]} tasks
   * @returns {object[]}  shallow-copied tasks with updated dependsOn
   */
  identifyDependencies(tasks) {
    if (!tasks || tasks.length === 0) return [];

    return tasks.map((task) => {
      const deps = new Set(task.dependsOn || []);

      for (const other of tasks) {
        if (other.id === task.id) continue;

        // Infer dep when `task` references a keyword whose prerequisite
        // is referenced by `other`.
        for (const hint of DEPENDENCY_HINTS) {
          if (hint.after.test(task.title.toLowerCase()) && hint.before.test(other.title.toLowerCase())) {
            deps.add(other.id);
            break;
          }
        }
      }

      // Sequential-by-default: later tasks implicitly depend on the
      // immediately preceding task when types form a natural chain.
      if (deps.size === 0) {
        const idx = tasks.indexOf(task);
        if (idx > 0) {
          const prev = tasks[idx - 1];
          // Only add sequential dep if the previous task is semantically
          // upstream (design → implement → test → document).
          const order = ["analyze", "spec", "design", "plan", "implement", "build",
            "test", "verify", "integrate", "document", "cleanup"];
          const prevIdx = order.indexOf(prev.type);
          const thisIdx = order.indexOf(task.type);
          if (thisIdx > prevIdx && prevIdx >= 0) {
            deps.add(prev.id);
          }
        }
      }

      return { ...task, dependsOn: [...deps] };
    });
  }

  // ---- Parallelism detection ----------------------------------------------

  /**
   * Inspect dependency edges and mark tasks as parallel-safe when they
   * have no unresolved dependencies that enforce ordering.
   *
   * @param {object[]} tasks
   * @returns {object[]}
   */
  suggestParallelism(tasks) {
    if (!tasks || tasks.length === 0) return [];

    return tasks.map((task) => {
      // A task is parallel-safe when it has zero dependencies of its
      // own.  Tasks that must wait for upstream work to finish cannot
      // be freely scheduled alongside their predecessors.
      const canParallel = (task.dependsOn || []).length === 0;

      return { ...task, parallel: canParallel };
    });
  }

  // ---- Order optimisation -------------------------------------------------

  /**
   * Reorder tasks so that:
   *  1. Topological sort is respected (dependencies always come first).
   *  2. Parallel-safe tasks are grouped at the same "level".
   *  3. Type-based natural ordering is preserved within a level.
   *
   * @param {object[]} tasks
   * @returns {object[]}
   */
  optimizeOrder(tasks) {
    if (!tasks || tasks.length <= 1) return tasks.slice();

    // Build indegree map
    const indegree = new Map();
    const adj = new Map();
    for (const task of tasks) {
      indegree.set(task.id, 0);
      adj.set(task.id, []);
    }

    for (const task of tasks) {
      for (const depId of task.dependsOn || []) {
        adj.get(depId).push(task.id);
        indegree.set(task.id, (indegree.get(task.id) || 0) + 1);
      }
    }

    // Topological sort using Kahn's algorithm
    const sortedIds = [];
    const queue = [];

    for (const [id, deg] of indegree) {
      if (deg === 0) queue.push(id);
    }

    // Sort initial queue by task type order for stability
    const typeOrder = ["analyze", "spec", "design", "plan", "implement", "build",
      "test", "verify", "integrate", "document", "cleanup", "profile", "audit",
      "reproduce", "isolate", "hypothesize", "fix", "extract", "review"];
    const sortByType = (aId, bId) => {
      const a = tasks.find((t) => t.id === aId);
      const b = tasks.find((t) => t.id === bId);
      const aIdx = typeOrder.indexOf(a?.type);
      const bIdx = typeOrder.indexOf(b?.type);
      return (aIdx >= 0 ? aIdx : 999) - (bIdx >= 0 ? bIdx : 999);
    };
    queue.sort(sortByType);

    while (queue.length > 0) {
      const current = queue.shift();
      sortedIds.push(current);

      const children = (adj.get(current) || []).slice().sort(sortByType);
      for (const child of children) {
        const deg = (indegree.get(child) || 1) - 1;
        indegree.set(child, deg);
        if (deg === 0) queue.push(child);
      }
      queue.sort(sortByType);
    }

    // Any remaining nodes (shouldn't happen in a DAG) are appended
    for (const [id, deg] of indegree) {
      if (deg > 0 && !sortedIds.includes(id)) {
        sortedIds.push(id);
      }
    }

    const idToTask = new Map(tasks.map((t) => [t.id, t]));
    return sortedIds.map((id) => idToTask.get(id) || { id });
  }

  // ---- Internal helpers ---------------------------------------------------

  /** @returns {object|undefined} the matching template, or undefined */
  _matchTemplate(goal) {
    const lower = goal.toLowerCase();
    for (const [, template] of Object.entries(this._templates)) {
      if (template.match && template.match.test(lower)) return template;
    }
    return undefined;
  }

  /** Build a human-readable summary of the decomposition. */
  _summarize(tasks) {
    const types = {};
    for (const task of tasks) {
      types[task.type] = (types[task.type] || 0) + 1;
    }

    const parallelCount = tasks.filter((t) => t.parallel).length;
    const chainedCount = tasks.filter((t) => !t.parallel).length;
    const effortCounts = { S: 0, M: 0, L: 0, XL: 0 };
    for (const task of tasks) {
      if (task.effort && effortCounts.hasOwnProperty(task.effort)) {
        effortCounts[task.effort]++;
      }
    }

    return {
      types,
      parallelCount,
      chainedCount,
      effortDistribution: effortCounts,
    };
  }
}

module.exports = {
  TaskDecomposer,
  DECOMPOSITION_TEMPLATES,
  EFFORT_KEYWORDS,
  DEPENDENCY_HINTS,
  GENERIC_PHASES,
};
