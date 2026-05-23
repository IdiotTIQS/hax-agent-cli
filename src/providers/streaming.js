"use strict";

const DEFAULT_BUFFER_SIZE = 20;

async function collectStream(stream) {
  if (stream == null) {
    throw new Error("Stream is required");
  }

  let result = "";

  if (typeof stream[Symbol.asyncIterator] === "function") {
    for await (const chunk of stream) {
      result += resolveChunkText(chunk);
    }
  } else if (typeof stream[Symbol.iterator] === "function") {
    for (const chunk of stream) {
      result += resolveChunkText(chunk);
    }
  } else {
    throw new Error("Stream must be an async iterable or iterable");
  }

  return result;
}

async function* bufferStream(stream, chunkSize) {
  if (stream == null) {
    throw new Error("Stream is required");
  }

  const resolvedSize = Number.isFinite(chunkSize) && chunkSize > 0 ? chunkSize : DEFAULT_BUFFER_SIZE;
  let buffer = "";

  for await (const chunk of stream) {
    const text = resolveChunkText(chunk);
    buffer += text;

    while (buffer.length >= resolvedSize) {
      yield buffer.slice(0, resolvedSize);
      buffer = buffer.slice(resolvedSize);
    }
  }

  if (buffer.length > 0) {
    yield buffer;
  }
}

async function* filterStream(stream, predicate) {
  if (stream == null) {
    throw new Error("Stream is required");
  }

  if (typeof predicate !== "function") {
    throw new Error("Predicate function is required");
  }

  for await (const chunk of stream) {
    if (predicate(chunk)) {
      yield chunk;
    }
  }
}

function teeStream(sourceStream, ...consumers) {
  if (sourceStream == null) {
    throw new Error("Stream is required");
  }

  if (consumers.length === 0) {
    throw new Error("At least one consumer is required");
  }

  const count = consumers.length;
  const queues = Array.from({ length: count }, () => []);
  const resolvers = Array.from({ length: count }, () => []);
  let done = false;
  let error = null;

  function enqueue(index, item) {
    if (resolvers[index].length > 0) {
      const resolve = resolvers[index].shift();
      resolve({ value: item, done: false });
    } else {
      queues[index].push(item);
    }
  }

  function signalDone() {
    done = true;
    for (let i = 0; i < count; i++) {
      for (const resolve of resolvers[i]) {
        resolve({ value: undefined, done: true });
      }
      resolvers[i] = [];
    }
  }

  function signalError(err) {
    error = err;
    done = true;
    for (let i = 0; i < count; i++) {
      for (const resolve of resolvers[i]) {
        resolve({ value: undefined, done: true });
      }
      resolvers[i] = [];
    }
  }

  function makeIterator(index) {
    return {
      async next() {
        if (queues[index].length > 0) {
          return { value: queues[index].shift(), done: false };
        }
        if (done) {
          if (error) {
            throw error;
          }
          return { value: undefined, done: true };
        }
        return new Promise((resolve) => {
          resolvers[index].push(resolve);
        });
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }

  (async () => {
    try {
      for await (const chunk of sourceStream) {
        for (let i = 0; i < count; i++) {
          enqueue(i, chunk);
        }
      }
      signalDone();
    } catch (err) {
      signalError(err);
    }
  })();

  const iterators = [];
  for (let i = 0; i < count; i++) {
    const iter = makeIterator(i);
    iterators.push(iter);
    if (typeof consumers[i] === "function") {
      consumers[i](iter);
    }
  }

  return iterators;
}

function resolveChunkText(chunk) {
  if (chunk == null) {
    return "";
  }

  if (typeof chunk === "string") {
    return chunk;
  }

  if (typeof chunk === "object") {
    if (typeof chunk.delta === "string") {
      return chunk.delta;
    }
    if (typeof chunk.text === "string") {
      return chunk.text;
    }
    if (typeof chunk.content === "string") {
      return chunk.content;
    }
  }

  return String(chunk);
}

module.exports = {
  collectStream,
  bufferStream,
  filterStream,
  teeStream,
  resolveChunkText,
};
