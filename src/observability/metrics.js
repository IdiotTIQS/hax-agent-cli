"use strict";

class Counter {
  constructor(options = {}) {
    this.name = options.name || "unnamed";
    this.help = options.help || "";
    this._value = 0;
    this._createdAt = Date.now();
    this._lastIncrementAt = null;
  }

  inc(delta = 1) {
    if (typeof delta !== "number" || delta < 0) {
      return;
    }
    this._value += delta;
    this._lastIncrementAt = Date.now();
  }

  value() {
    return this._value;
  }

  rate() {
    const elapsed = (Date.now() - this._createdAt) / 1000;
    if (elapsed <= 0) return 0;
    return this._value / elapsed;
  }

  reset() {
    this._value = 0;
    this._createdAt = Date.now();
    this._lastIncrementAt = null;
  }

  toJSON() {
    return {
      type: "counter",
      name: this.name,
      help: this.help,
      value: this._value,
      rate: this.rate(),
      createdAt: new Date(this._createdAt).toISOString(),
      lastIncrementAt: this._lastIncrementAt
        ? new Date(this._lastIncrementAt).toISOString()
        : null,
    };
  }
}

class Histogram {
  constructor(options = {}) {
    this.name = options.name || "unnamed";
    this.help = options.help || "";
    this._values = [];
    this._count = 0;
    this._sum = 0;
    this._min = Infinity;
    this._max = -Infinity;
  }

  observe(value) {
    if (typeof value !== "number" || value < 0) {
      return;
    }
    this._values.push(value);
    this._count += 1;
    this._sum += value;
    if (value < this._min) this._min = value;
    if (value > this._max) this._max = value;
  }

  count() {
    return this._count;
  }

  sum() {
    return this._sum;
  }

  avg() {
    if (this._count === 0) return 0;
    return this._sum / this._count;
  }

  min() {
    return this._count === 0 ? 0 : this._min;
  }

  max() {
    return this._count === 0 ? 0 : this._max;
  }

  percentile(p) {
    if (this._values.length === 0) return 0;
    const sorted = [...this._values].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }

  p50() {
    return this.percentile(50);
  }

  p95() {
    return this.percentile(95);
  }

  p99() {
    return this.percentile(99);
  }

  reset() {
    this._values = [];
    this._count = 0;
    this._sum = 0;
    this._min = Infinity;
    this._max = -Infinity;
  }

  toJSON() {
    return {
      type: "histogram",
      name: this.name,
      help: this.help,
      count: this._count,
      sum: this._sum,
      avg: this.avg(),
      min: this.min(),
      max: this.max(),
      p50: this.p50(),
      p95: this.p95(),
      p99: this.p99(),
    };
  }
}

class Gauge {
  constructor(options = {}) {
    this.name = options.name || "unnamed";
    this.help = options.help || "";
    this._value = options.initialValue !== undefined ? options.initialValue : 0;
    this._history = [];
    this._maxHistory = options.maxHistory || 100;
    if (options.recordInitial !== false) {
      this._history.push({ timestamp: Date.now(), value: this._value });
    }
  }

  set(value) {
    if (typeof value !== "number") return;
    this._value = value;
    this._history.push({ timestamp: Date.now(), value });
    if (this._history.length > this._maxHistory) {
      this._history = this._history.slice(this._history.length - this._maxHistory);
    }
  }

  inc(delta = 1) {
    this.set(this._value + delta);
  }

  dec(delta = 1) {
    this.set(this._value - delta);
  }

  value() {
    return this._value;
  }

  history() {
    return this._history.map((entry) => ({
      timestamp: new Date(entry.timestamp).toISOString(),
      value: entry.value,
    }));
  }

  reset() {
    this._value = 0;
    this._history = [];
  }

  toJSON() {
    return {
      type: "gauge",
      name: this.name,
      help: this.help,
      value: this._value,
      history: this.history(),
    };
  }
}

class MetricsRegistry {
  constructor() {
    this._metrics = new Map();
    this._registerDefaults();
  }

  register(metric) {
    if (!metric || !metric.name) {
      throw new TypeError("Metric must have a name.");
    }
    if (this._metrics.has(metric.name)) {
      return;
    }
    this._metrics.set(metric.name, metric);
  }

  counter(name, options = {}) {
    const c = new Counter({ ...options, name });
    this.register(c);
    return c;
  }

  histogram(name, options = {}) {
    const h = new Histogram({ ...options, name });
    this.register(h);
    return h;
  }

  gauge(name, options = {}) {
    const g = new Gauge({ ...options, name });
    this.register(g);
    return g;
  }

  get(name) {
    return this._metrics.get(name) || null;
  }

  collect() {
    const result = {};
    for (const [name, metric] of this._metrics) {
      result[name] = metric.toJSON();
    }
    return result;
  }

  reset() {
    for (const metric of this._metrics.values()) {
      metric.reset();
    }
  }

  _registerDefaults() {
    this.counter("tool.executions", { help: "Total number of tool executions" });
    this.counter("tool.errors", { help: "Total number of tool execution errors" });
    this.histogram("tool.duration_ms", { help: "Tool execution duration in milliseconds" });
    this.counter("agent.turns", { help: "Total number of agent turns" });
    this.counter("agent.tokens_in", { help: "Total number of input tokens" });
    this.counter("agent.tokens_out", { help: "Total number of output tokens" });
  }
}

module.exports = { Counter, Histogram, Gauge, MetricsRegistry };
