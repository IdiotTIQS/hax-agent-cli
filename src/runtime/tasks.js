const TaskStatus = Object.freeze({
  pending: 'pending',
  inProgress: 'in_progress',
  blocked: 'blocked',
  completed: 'completed',
  failed: 'failed',
});

class TaskList {
  constructor(tasks = []) {
    this.tasks = new Map();
    tasks.forEach((task) => this.add(task));
  }

  add(input) {
    const task = createTask(input);

    if (this.tasks.has(task.id)) {
      throw new Error(`Duplicate task: ${task.id}`);
    }

    this.tasks.set(task.id, task);
    return task;
  }

  get(id) {
    return this.tasks.get(id) || null;
  }

  list() {
    return Array.from(this.tasks.values());
  }

  update(id, updates = {}) {
    const current = this.get(id);

    if (!current) {
      throw new Error(`Unknown task: ${id}`);
    }

    const nextTask = createTask({ ...current, ...updates, id });
    this.tasks.set(id, nextTask);
    return nextTask;
  }

  ready() {
    return this.list().filter((task) => {
      if (task.status !== TaskStatus.pending) {
        return false;
      }

      return task.dependsOn.every((dependencyId) => {
        const dependency = this.get(dependencyId);
        return dependency && dependency.status === TaskStatus.completed;
      });
    });
  }
}

function createTask(input) {
  const task = input || {};
  requireString(task.id, 'task.id');

  const status = task.status || TaskStatus.pending;
  requireEnum(status, TaskStatus, 'task.status');

  return Object.freeze({
    id: task.id,
    title: task.title || '',
    owner: task.owner || null,
    status,
    parallel: task.parallel !== false,
    dependsOn: Object.freeze([...(task.dependsOn || [])]),
    deliverable: task.deliverable || '',
    metadata: Object.freeze({ ...(task.metadata || {}) }),
  });
}

function createTaskList(tasks) {
  return new TaskList(tasks);
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function requireEnum(value, options, name) {
  if (!Object.values(options).includes(value)) {
    throw new TypeError(`${name} must be one of: ${Object.values(options).join(', ')}`);
  }
}

module.exports = { TaskList, TaskStatus, createTask, createTaskList };
