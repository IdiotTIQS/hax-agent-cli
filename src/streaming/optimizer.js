"use strict";

const { resolveChunkText } = require("../providers/streaming");

const DEFAULT_MIN_BUFFER_SIZE = 20;
const DEFAULT_THROTTLE_FPS = 30;

const CHUNK_TYPE_HIERARCHY = {
  error: 0,
  tool_call: 1,
  tool_start: 1,
  tool_result: 2,
  thinking: 3,
  text_delta: 4,
  text: 4,
  metadata: 5,
};

const DEFAULT_CHUNK_PRIORITY = 10;

function getChunkType(chunk) {
  if (chunk == null) return "text";
  if (typeof chunk === "string") return "text";
  if (chunk.type && typeof chunk.type === "string") return chunk.type;
  return "text";
}

function extractChunkDisplayText(chunk) {
  if (chunk == null) return "";
  if (typeof chunk === "string") return chunk;
  return resolveChunkText(chunk);
}

function sameDisplayText(a, b) {
  return extractChunkDisplayText(a) === extractChunkDisplayText(b);
}

function sameChunkKind(a, b) {
  return getChunkType(a) === getChunkType(b);
}

class StreamOptimizer {
  constructor(options = {}) {
    this._minBufferSize =
      Number.isFinite(options.minBufferSize) && options.minBufferSize > 0
        ? options.minBufferSize
        : DEFAULT_MIN_BUFFER_SIZE;
    this._throttleFps =
      Number.isFinite(options.throttleFps) && options.throttleFps > 0
        ? options.throttleFps
        : DEFAULT_THROTTLE_FPS;
    this._stats = {
      chunksProcessed: 0,
      chunksBuffered: 0,
      chunksDeduped: 0,
      chunksSkipped: 0,
      chunksMerged: 0,
      chunksPrioritized: 0,
      startTime: 0,
      endTime: 0,
    };
  }

  /**
   * Buffers small chunks until they reach minSize, then yields a combined chunk.
   * Preserves chunk type from the first chunk in each buffer group.
   */
  async *bufferChunks(stream, minSize) {
    if (stream == null) {
      throw new Error("Stream is required");
    }

    const size =
      Number.isFinite(minSize) && minSize > 0 ? minSize : this._minBufferSize;
    this._stats.startTime = Date.now();
    let buffer = "";
    let bufferType = null;

    for await (const chunk of stream) {
      this._stats.chunksProcessed++;
      const text = extractChunkDisplayText(chunk);

      if (!bufferType) {
        bufferType = getChunkType(chunk);
      }

      const currentType = getChunkType(chunk);
      if (currentType !== bufferType && buffer.length > 0) {
        yield createBufferChunk(bufferType, buffer, chunk);
        buffer = "";
        bufferType = currentType;
      }

      buffer += text;

      while (buffer.length >= size) {
        yield createBufferChunk(bufferType, buffer.slice(0, size), chunk);
        buffer = buffer.slice(size);
        this._stats.chunksBuffered++;
      }
    }

    if (buffer.length > 0) {
      yield createBufferChunk(bufferType, buffer);
      this._stats.chunksBuffered++;
    }

    this._stats.endTime = Date.now();
  }

  /**
   * Removes consecutive chunks that produce the same display text.
   */
  async *deduplicateChunks(stream) {
    if (stream == null) {
      throw new Error("Stream is required");
    }

    this._stats.startTime = Date.now();
    let lastText = null;

    for await (const chunk of stream) {
      this._stats.chunksProcessed++;
      const text = extractChunkDisplayText(chunk);

      if (text === lastText && text !== "") {
        this._stats.chunksDeduped++;
        this._stats.chunksSkipped++;
        continue;
      }

      lastText = text;
      yield chunk;
    }

    this._stats.endTime = Date.now();
  }

  /**
   * Limits the display update rate to at most `fps` yields per second.
   */
  async *throttleStream(stream, fps) {
    if (stream == null) {
      throw new Error("Stream is required");
    }

    const rate =
      Number.isFinite(fps) && fps > 0 ? fps : this._throttleFps;
    const frameInterval = Math.floor(1000 / rate);
    this._stats.startTime = Date.now();
    let lastYieldTime = 0;

    for await (const chunk of stream) {
      this._stats.chunksProcessed++;

      const now = Date.now();
      if (lastYieldTime === 0) {
        lastYieldTime = now;
        yield chunk;
        continue;
      }

      const elapsed = now - lastYieldTime;
      if (elapsed >= frameInterval) {
        lastYieldTime = now;
        yield chunk;
      } else {
        this._stats.chunksSkipped++;
      }
    }

    this._stats.endTime = Date.now();
  }

  /**
   * Reorders chunks within a lookbehind window by priority.
   * Higher priority chunks are yielded first.
   *
   * @param {AsyncIterable} stream
   * @param {Function|string} priority - a function (chunk) => number,
   *   or a preset name: "type" uses CHUNK_TYPE_HIERARCHY.
   */
  async *prioritizeChunks(stream, priority) {
    if (stream == null) {
      throw new Error("Stream is required");
    }

    const priorityFn = resolvePriority(priority);
    const WINDOW = 4;
    this._stats.startTime = Date.now();

    const window = [];
    for await (const chunk of stream) {
      this._stats.chunksProcessed++;
      const score = priorityFn(chunk);
      window.push({ chunk, score, index: window.length });

      if (window.length >= WINDOW) {
        window.sort((a, b) => a.score - b.score);
        for (const entry of window) {
          yield entry.chunk;
          this._stats.chunksPrioritized++;
        }
        window.length = 0;
      }
    }

    if (window.length > 0) {
      window.sort((a, b) => a.score - b.score);
      for (const entry of window) {
        yield entry.chunk;
        this._stats.chunksPrioritized++;
      }
    }

    this._stats.endTime = Date.now();
  }

  /**
   * Combines adjacent chunks of the same type into a single chunk.
   * Text delta chunks get their text concatenated.
   */
  async *mergeAdjacentChunks(stream) {
    if (stream == null) {
      throw new Error("Stream is required");
    }

    this._stats.startTime = Date.now();

    let pending = null;

    for await (const chunk of stream) {
      this._stats.chunksProcessed++;

      if (pending === null) {
        pending = cloneChunk(chunk);
        continue;
      }

      if (sameChunkKind(pending, chunk)) {
        if (pending.delta != null && chunk.delta != null) {
          pending.delta += chunk.delta;
        } else if (pending.text != null && chunk.text != null) {
          pending.text += chunk.text;
        } else if (pending.content != null && chunk.content != null) {
          pending.content += chunk.content;
        } else if (typeof pending === "string" && typeof chunk === "string") {
          pending += chunk;
        } else {
          yield pending;
          pending = cloneChunk(chunk);
        }
        this._stats.chunksMerged++;
      } else {
        yield pending;
        pending = cloneChunk(chunk);
      }
    }

    if (pending !== null) {
      yield pending;
    }

    this._stats.endTime = Date.now();
  }

  /**
   * Returns a snapshot of streaming statistics.
   */
  getStats() {
    return {
      ...this._stats,
      elapsed:
        this._stats.startTime > 0
          ? (this._stats.endTime || Date.now()) - this._stats.startTime
          : 0,
      deduplicationRate:
        this._stats.chunksProcessed > 0
          ? (this._stats.chunksDeduped / this._stats.chunksProcessed) * 100
          : 0,
      mergeRate:
        this._stats.chunksProcessed > 0
          ? (this._stats.chunksMerged / this._stats.chunksProcessed) * 100
          : 0,
    };
  }

  /**
   * Resets internal statistics.
   */
  resetStats() {
    this._stats = {
      chunksProcessed: 0,
      chunksBuffered: 0,
      chunksDeduped: 0,
      chunksSkipped: 0,
      chunksMerged: 0,
      chunksPrioritized: 0,
      startTime: 0,
      endTime: 0,
    };
  }
}

function resolvePriority(priority) {
  if (typeof priority === "function") {
    return priority;
  }

  if (priority === "type") {
    return (chunk) => {
      const type = getChunkType(chunk);
      return CHUNK_TYPE_HIERARCHY[type] ?? DEFAULT_CHUNK_PRIORITY;
    };
  }

  return () => 0;
}

function createBufferChunk(type, text, template) {
  if (template != null && typeof template === "object" && template.type) {
    if (typeof template.delta === "string" || template.delta == null) {
      return { ...template, delta: text, type };
    }
    if (typeof template.text === "string" || template.text == null) {
      return { ...template, text, type };
    }
  }
  return { type, delta: text };
}

function cloneChunk(chunk) {
  if (chunk == null) return chunk;
  if (typeof chunk !== "object") return chunk;
  if (Array.isArray(chunk)) return [...chunk];
  return { ...chunk };
}

module.exports = {
  StreamOptimizer,
  getChunkType,
  extractChunkDisplayText,
  DEFAULT_MIN_BUFFER_SIZE,
  DEFAULT_THROTTLE_FPS,
  CHUNK_TYPE_HIERARCHY,
};
