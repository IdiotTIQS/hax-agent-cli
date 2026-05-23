"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  collectStream,
  bufferStream,
  filterStream,
  teeStream,
  resolveChunkText,
} = require("../../src/providers/streaming");

function createTextStream(chunks) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

function createDeltaStream(chunks) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield { type: "text", delta: chunk };
      }
    },
  };
}

function createSyncIterable(chunks) {
  return {
    *[Symbol.iterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

test("collectStream collects all chunks from async iterable", async () => {
  const stream = createTextStream(["Hello", " ", "World", "!"]);
  const result = await collectStream(stream);

  assert.equal(result, "Hello World!");
});

test("collectStream collects delta chunks", async () => {
  const stream = createDeltaStream(["Part ", "one.", " Part ", "two."]);
  const result = await collectStream(stream);

  assert.equal(result, "Part one. Part two.");
});

test("collectStream returns empty string for empty stream", async () => {
  const stream = createTextStream([]);
  const result = await collectStream(stream);

  assert.equal(result, "");
});

test("collectStream throws for null stream", async () => {
  await assert.rejects(
    () => collectStream(null),
    /Stream is required/,
  );
});

test("collectStream handles sync iterable", async () => {
  const stream = createSyncIterable(["A", "B", "C"]);
  const result = await collectStream(stream);

  assert.equal(result, "ABC");
});

test("bufferStream buffers small chunks into larger ones", async () => {
  const stream = createTextStream(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);
  const buffered = [];
  for await (const chunk of bufferStream(stream, 4)) {
    buffered.push(chunk);
  }

  assert.deepEqual(buffered, ["abcd", "efgh", "ij"]);
});

test("bufferStream with default chunk size", async () => {
  const chars = [];
  for (let i = 0; i < 25; i++) {
    chars.push(String.fromCharCode(97 + (i % 26)));
  }
  const stream = createTextStream(chars);
  const buffered = [];
  for await (const chunk of bufferStream(stream)) {
    buffered.push(chunk);
    assert.ok(chunk.length <= 20);
  }

  const collected = buffered.join("");
  assert.equal(collected, chars.join(""));
});

test("bufferStream emits remaining buffer at end", async () => {
  const stream = createTextStream(["abc", "def"]);
  const buffered = [];
  for await (const chunk of bufferStream(stream, 5)) {
    buffered.push(chunk);
  }

  assert.deepEqual(buffered, ["abcde", "f"]);
});

test("bufferStream throws for null stream", async () => {
  const buffered = bufferStream(null, 10);
  await assert.rejects(
    () => buffered.next(),
    /Stream is required/,
  );
});

test("filterStream filters out unwanted chunks", async () => {
  const stream = createTextStream(["keep", "skip", "keep", "skip", "keep"]);
  const filtered = [];
  for await (const chunk of filterStream(stream, (c) => c !== "skip")) {
    filtered.push(chunk);
  }

  assert.deepEqual(filtered, ["keep", "keep", "keep"]);
});

test("filterStream filters by chunk type", async () => {
  const chunks = [
    { type: "thinking", delta: "hidden" },
    { type: "text", delta: "visible" },
    { type: "thinking", delta: "more hidden" },
    { type: "text", delta: "also visible" },
  ];
  const stream = createTextStream(chunks);
  const filtered = [];
  for await (const chunk of filterStream(stream, (c) => c.type === "text")) {
    filtered.push(chunk);
  }

  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].delta, "visible");
  assert.equal(filtered[1].delta, "also visible");
});

test("filterStream returns empty stream when nothing matches", async () => {
  const stream = createTextStream(["a", "b", "c"]);
  const filtered = [];
  for await (const chunk of filterStream(stream, () => false)) {
    filtered.push(chunk);
  }

  assert.equal(filtered.length, 0);
});

test("filterStream throws for null stream", async () => {
  const filtered = filterStream(null, () => true);
  await assert.rejects(
    () => filtered.next(),
    /Stream is required/,
  );
});

test("filterStream throws for missing predicate", async () => {
  const stream = createTextStream(["a"]);
  const filtered = filterStream(stream, null);
  await assert.rejects(
    () => filtered.next(),
    /Predicate function is required/,
  );
});

test("teeStream fans out to multiple consumers", async () => {
  const stream = createTextStream(["A", "B", "C", "D", "E"]);

  // teeStream returns independent iterators; use them directly to collect
  const [iter1, iter2] = teeStream(stream, null, null);

  const consumer1 = [];
  const consumer2 = [];

  await Promise.all([
    (async () => { for await (const c of iter1) { consumer1.push(c); } })(),
    (async () => { for await (const c of iter2) { consumer2.push(c); } })(),
  ]);

  assert.deepEqual(consumer1, ["A", "B", "C", "D", "E"]);
  assert.deepEqual(consumer2, ["A", "B", "C", "D", "E"]);
});

test("teeStream throws for null stream", () => {
  assert.throws(
    () => teeStream(null, async () => {}),
    /Stream is required/,
  );
});

test("teeStream throws for no consumers", () => {
  const stream = createTextStream(["a"]);
  assert.throws(
    () => teeStream(stream),
    /At least one consumer is required/,
  );
});

test("resolveChunkText returns empty string for null", () => {
  assert.equal(resolveChunkText(null), "");
  assert.equal(resolveChunkText(undefined), "");
});

test("resolveChunkText returns string directly", () => {
  assert.equal(resolveChunkText("hello"), "hello");
});

test("resolveChunkText extracts delta from object", () => {
  assert.equal(resolveChunkText({ type: "text", delta: "hello world" }), "hello world");
});

test("resolveChunkText extracts text from object", () => {
  assert.equal(resolveChunkText({ text: "sample text" }), "sample text");
});

test("resolveChunkText converts non-string to string", () => {
  assert.equal(resolveChunkText(123), "123");
  assert.equal(resolveChunkText(true), "true");
});
