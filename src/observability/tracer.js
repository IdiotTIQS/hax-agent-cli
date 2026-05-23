"use strict";

const { randomUUID } = require("node:crypto");

let spanIdCounter = 0;

function generateSpanId() {
  spanIdCounter += 1;
  return `span_${spanIdCounter}_${Date.now().toString(36)}`;
}

function generateTraceId() {
  return `trace_${randomUUID()}`;
}

class Span {
  constructor(options = {}) {
    this.id = options.id || generateSpanId();
    this.traceId = options.traceId || generateTraceId();
    this.parentId = options.parentId || null;
    this.name = options.name || "unnamed";
    this.startTime = options.startTime || Date.now();
    this.endTime = null;
    this.tags = new Map(Object.entries(options.tags || {}));
    this.events = [];
    this.children = [];

    if (options.autoStart !== false) {
      this.startTime = options.startTime || Date.now();
    }
  }

  setTag(key, value) {
    this.tags.set(String(key), value);
    return this;
  }

  getTag(key) {
    return this.tags.get(String(key));
  }

  addEvent(name, attributes = {}) {
    this.events.push({
      name: String(name),
      timestamp: Date.now(),
      attributes: redactAttributes(attributes),
    });
    return this;
  }

  finish(endTime) {
    this.endTime = endTime || Date.now();
    return this;
  }

  addChild(span) {
    span.parentId = this.id;
    span.traceId = this.traceId;
    this.children.push(span);
    return this;
  }

  durationMs() {
    const end = this.endTime || Date.now();
    return end - this.startTime;
  }

  toJson() {
    return {
      id: this.id,
      traceId: this.traceId,
      parentId: this.parentId,
      name: this.name,
      startTime: new Date(this.startTime).toISOString(),
      endTime: this.endTime ? new Date(this.endTime).toISOString() : null,
      durationMs: this.durationMs(),
      tags: Object.fromEntries(this.tags),
      events: this.events.map((evt) => ({
        ...evt,
        timestamp: new Date(evt.timestamp).toISOString(),
      })),
      children: this.children.map((child) => child.toJson()),
    };
  }

  toJSON() {
    return this.toJson();
  }
}

class Tracer {
  constructor(options = {}) {
    this.serviceName = options.serviceName || "haxagent";
    this._spans = [];
    this._active = new Map();
    this._maxSpans = options.maxSpans || 10000;
    this._tags = new Map(Object.entries(options.tags || {}));
  }

  startSpan(name, options = {}) {
    if (this._spans.length >= this._maxSpans) {
      this._spans = this._spans.slice(this._spans.length - Math.floor(this._maxSpans / 2));
    }

    let parentSpan = null;
    if (options.parentId) {
      parentSpan = this._findSpan(options.parentId);
    } else if (options.childOf) {
      parentSpan = options.childOf;
    }

    const span = new Span({
      name,
      parentId: parentSpan ? parentSpan.id : null,
      traceId: parentSpan ? parentSpan.traceId : generateTraceId(),
      tags: { service: this.serviceName, ...this._tagsToObj(), ...options.tags },
    });

    if (parentSpan) {
      parentSpan.addChild(span);
    }

    this._spans.push(span);
    this._active.set(span.id, span);

    return span;
  }

  finishSpan(spanOrId) {
    const span = typeof spanOrId === "string" ? this._active.get(spanOrId) : spanOrId;
    if (!span) return null;
    span.finish();
    this._active.delete(span.id);
    return span;
  }

  setTag(key, value) {
    this._tags.set(String(key), value);
  }

  currentSpan() {
    const entries = [...this._active.entries()];
    if (entries.length === 0) return null;
    return entries[entries.length - 1][1];
  }

  getSpans() {
    return [...this._spans];
  }

  rootSpans() {
    return this._spans.filter((s) => s.parentId === null);
  }

  toJson() {
    return {
      serviceName: this.serviceName,
      tags: Object.fromEntries(this._tags),
      spans: this.rootSpans().map((span) => span.toJson()),
    };
  }

  toJSON() {
    return this.toJson();
  }

  reset() {
    this._spans = [];
    this._active.clear();
    spanIdCounter = 0;
  }

  _findSpan(id) {
    return this._spans.find((s) => s.id === id) || null;
  }

  _tagsToObj() {
    return Object.fromEntries(this._tags);
  }
}

function createTracer(options = {}) {
  return new Tracer(options);
}

function redactAttributes(attrs) {
  const sensitive = new Set(["apiKey", "token", "password", "secret", "authorization", "credential"]);
  const result = {};
  for (const [key, value] of Object.entries(attrs)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = sensitive.has(key) || sensitive.has(lowerKey) ||
      [...sensitive].some((sk) => lowerKey.includes(sk));
    result[key] = isSensitive ? "[REDACTED]" : value;
  }
  return result;
}

module.exports = { Tracer, Span, createTracer, generateSpanId, generateTraceId };
