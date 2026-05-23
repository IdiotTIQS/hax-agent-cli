"use strict";

const { strict: assert } = require('node:assert');
const { describe, it } = require('node:test');

const {
  TaskDecomposer,
  DECOMPOSITION_TEMPLATES,
} = require('../../src/planner/decomposer');

describe('TaskDecomposer', () => {
  describe('constructor', () => {
    it('creates an instance with default templates', () => {
      const dc = new TaskDecomposer();
      assert.ok(dc instanceof TaskDecomposer);
      assert.ok(typeof dc.decompose === 'function');
    });

    it('accepts custom templates', () => {
      const custom = new TaskDecomposer({
        templates: {
          deploy: { match: /deploy/, phases: [{ name: 'Build', type: 'build' }] },
        },
      });
      const result = custom.decompose('deploy to production');
      assert.strictEqual(result.metadata.template, 'deploy');
    });
  });

  describe('decompose', () => {
    let decomposer;

    it('throws on empty goal', () => {
      const dc = new TaskDecomposer();
      assert.throws(() => dc.decompose(''), /Goal must be a non-empty string/);
      assert.throws(() => dc.decompose(null), /Goal must be a non-empty string/);
    });

    it('decomposes "build X with Y" into design/implement/test/document phases', () => {
      const dc = new TaskDecomposer();
      const result = dc.decompose('build a user authentication system with JWT');
      assert.ok(result.tasks.length >= 4);
      const types = result.tasks.map((t) => t.type);
      assert.ok(types.includes('design'));
      assert.ok(types.includes('implement'));
      assert.ok(types.includes('test'));
      assert.ok(types.includes('document'));
      assert.strictEqual(result.metadata.template, /build|create|make|implement|develop|construct/.source);
    });

    it('decomposes "refactor X" into analyze/plan/extract/verify/cleanup phases', () => {
      const dc = new TaskDecomposer();
      const result = dc.decompose('refactor the user service layer');
      const types = result.tasks.map((t) => t.type);
      assert.ok(types.includes('analyze'));
      assert.ok(types.includes('plan'));
      assert.ok(types.includes('extract'));
      assert.ok(types.includes('verify'));
    });

    it('decomposes "debug X" into reproduce/isolate/hypothesize/fix/verify phases', () => {
      const dc = new TaskDecomposer();
      const result = dc.decompose('debug the memory leak in the websocket handler');
      const types = result.tasks.map((t) => t.type);
      assert.ok(types.includes('reproduce'));
      assert.ok(types.includes('isolate'));
      assert.ok(types.includes('hypothesize'));
      assert.ok(types.includes('fix'));
      assert.ok(types.includes('verify'));
    });

    it('decomposes "add feature X" into spec/design/implement/integrate/test/document', () => {
      const dc = new TaskDecomposer();
      const result = dc.decompose('add support for WebSocket streaming');
      const types = result.tasks.map((t) => t.type);
      assert.ok(types.includes('spec'));
      assert.ok(types.includes('design'));
      assert.ok(types.includes('implement'));
      assert.ok(types.includes('test'));
    });

    it('falls back to generic analyze/plan/execute/verify/document for unrecognized goals', () => {
      const dc = new TaskDecomposer();
      const result = dc.decompose('organize the kitchen pantry');
      assert.strictEqual(result.metadata.template, 'generic');
      assert.ok(result.tasks.length >= 4);
      assert.strictEqual(result.tasks[0].type, 'analyze');
      assert.strictEqual(result.tasks[result.tasks.length - 1].type, 'document');
    });

    it('respects maxTasks option', () => {
      const dc = new TaskDecomposer();
      const result = dc.decompose('build a complete e-commerce platform', { maxTasks: 3 });
      assert.ok(result.tasks.length <= 3);
    });
  });

  describe('estimateEffort', () => {
    it('detects "simple" keywords as S', () => {
      const dc = new TaskDecomposer();
      assert.strictEqual(dc.estimateEffort('add a simple logging wrapper'), 'S');
      assert.strictEqual(dc.estimateEffort('trivial cosmetic fix'), 'S');
    });

    it('detects "complex" keywords as L', () => {
      const dc = new TaskDecomposer();
      assert.strictEqual(dc.estimateEffort('implement a complex distributed locking system'), 'L');
    });

    it('detects "massive rewrite" keywords as XL', () => {
      const dc = new TaskDecomposer();
      assert.strictEqual(dc.estimateEffort('complete rewrite of the rendering engine from scratch'), 'XL');
    });
  });

  describe('identifyDependencies', () => {
    it('chains implement after design via keyword inference', () => {
      const dc = new TaskDecomposer();
      const tasks = [
        { id: 'T1', title: 'Design the API schema', type: 'design', dependsOn: [], parallel: true },
        { id: 'T2', title: 'Implement the endpoints', type: 'implement', dependsOn: [], parallel: true },
      ];
      const result = dc.identifyDependencies(tasks);
      assert.ok(result.find((t) => t.id === 'T2').dependsOn.includes('T1'));
    });

    it('chains test after implement', () => {
      const dc = new TaskDecomposer();
      const tasks = [
        { id: 'T1', title: 'Implement core logic', type: 'implement', dependsOn: [], parallel: true },
        { id: 'T2', title: 'Test edge cases', type: 'test', dependsOn: [], parallel: true },
      ];
      const result = dc.identifyDependencies(tasks);
      assert.ok(result.find((t) => t.id === 'T2').dependsOn.includes('T1'));
    });

    it('chains document after implement', () => {
      const dc = new TaskDecomposer();
      const tasks = [
        { id: 'T1', title: 'Implement feature', type: 'implement', dependsOn: [], parallel: true },
        { id: 'T2', title: 'Document API surface', type: 'document', dependsOn: [], parallel: true },
      ];
      const result = dc.identifyDependencies(tasks);
      assert.ok(result.find((t) => t.id === 'T2').dependsOn.includes('T1'));
    });
  });

  describe('suggestParallelism', () => {
    it('marks independent tasks as parallel', () => {
      const dc = new TaskDecomposer();
      const tasks = [
        { id: 'T1', title: 'Write unit tests', type: 'test', dependsOn: [], parallel: true },
        { id: 'T2', title: 'Update README', type: 'document', dependsOn: [], parallel: true },
      ];
      const result = dc.suggestParallelism(tasks);
      assert.ok(result.every((t) => t.parallel));
    });

    it('marks dependent tasks as non-parallel', () => {
      const dc = new TaskDecomposer();
      const tasks = [
        { id: 'T1', title: 'Design schema', type: 'design', dependsOn: [], parallel: true },
        { id: 'T2', title: 'Build schema', type: 'implement', dependsOn: ['T1'], parallel: false },
      ];
      const result = dc.suggestParallelism(tasks);
      assert.strictEqual(result.find((t) => t.id === 'T1').parallel, true);
      assert.strictEqual(result.find((t) => t.id === 'T2').parallel, false);
    });
  });

  describe('optimizeOrder', () => {
    it('topologically sorts tasks by dependency', () => {
      const dc = new TaskDecomposer();
      const tasks = [
        { id: 'T3', title: 'Deploy', type: 'integrate', dependsOn: ['T2'], parallel: false },
        { id: 'T1', title: 'Design', type: 'design', dependsOn: [], parallel: true },
        { id: 'T2', title: 'Implement', type: 'implement', dependsOn: ['T1'], parallel: false },
      ];
      const sorted = dc.optimizeOrder(tasks);
      assert.strictEqual(sorted[0].id, 'T1');
      assert.strictEqual(sorted[1].id, 'T2');
      assert.strictEqual(sorted[2].id, 'T3');
    });

    it('returns equal order for already-sorted tasks', () => {
      const dc = new TaskDecomposer();
      const tasks = [
        { id: 'T1', title: 'Analyze', type: 'analyze', dependsOn: [], parallel: true },
        { id: 'T2', title: 'Plan', type: 'plan', dependsOn: ['T1'], parallel: false },
      ];
      const sorted = dc.optimizeOrder(tasks);
      assert.strictEqual(sorted[0].id, 'T1');
      assert.strictEqual(sorted[1].id, 'T2');
    });
  });

  describe('full decomposition pipeline', () => {
    it('produces a complete plan for a build goal', () => {
      const dc = new TaskDecomposer();
      const result = dc.decompose('build a REST API for a todo app', {
        maxTasks: 6,
        detectDeps: true,
        suggestParallel: true,
        optimizeOrder: true,
        estimateEffort: true,
      });

      assert.strictEqual(result.goal, 'build a REST API for a todo app');
      assert.ok(Array.isArray(result.tasks));
      assert.ok(result.tasks.length > 0);
      assert.ok(result.metadata.summary.types);
      assert.ok(typeof result.metadata.summary.parallelCount === 'number');
      assert.ok(typeof result.metadata.summary.chainedCount === 'number');

      // Every task should have expected fields
      for (const task of result.tasks) {
        assert.ok(task.id, `Task missing id: ${JSON.stringify(task)}`);
        assert.ok(task.title, `Task ${task.id} missing title`);
        assert.ok(typeof task.type === 'string', `Task ${task.id} missing type`);
        assert.ok(Array.isArray(task.dependsOn), `Task ${task.id} dependsOn not array`);
        assert.ok(typeof task.parallel === 'boolean', `Task ${task.id} parallel not boolean`);
        assert.ok(['S', 'M', 'L', 'XL'].includes(task.effort), `Task ${task.id} has invalid effort: ${task.effort}`);
      }
    });
  });

  describe('additional template matching', () => {
    it('matches test/quality goals', () => {
      const dc = new TaskDecomposer();
      const result = dc.decompose('improve test coverage for auth module');
      const types = result.tasks.map((t) => t.type);
      assert.ok(types.includes('audit'));
    });

    it('matches optimize/performance goals', () => {
      const dc = new TaskDecomposer();
      const result = dc.decompose('optimize the image processing pipeline');
      const types = result.tasks.map((t) => t.type);
      assert.ok(types.includes('profile'));
      assert.ok(types.includes('implement'));
    });

    it('matches migrate/upgrade goals', () => {
      const dc = new TaskDecomposer();
      const result = dc.decompose('migrate from Express v4 to v5');
      const types = result.tasks.map((t) => t.type);
      assert.ok(types.includes('audit'));
      assert.ok(types.includes('review'));
    });
  });
});
