"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { SessionRecorder, RECORDING_VERSION } = require("../../src/recorder/capture");

test("SessionRecorder: start() initializes a new recording", () => {
  const recorder = new SessionRecorder();
  const session = { id: "test-session-123", provider: { name: "anthropic", model: "claude-sonnet" } };

  recorder.start(session);
  const recording = recorder.getRecording();

  assert.ok(recording);
  assert.equal(recording.version, RECORDING_VERSION);
  assert.equal(recording.metadata.sessionId, "test-session-123");
  assert.equal(recording.metadata.provider, "anthropic");
  assert.equal(recording.metadata.model, "claude-sonnet");
  assert.ok(recording.metadata.id);
  assert.ok(recording.startTime);
  assert.equal(recording.endTime, null);
  assert.deepEqual(recording.events, []);
});

test("SessionRecorder: start() throws if already recording", () => {
  const recorder = new SessionRecorder();
  recorder.start({ id: "s1" });

  assert.throws(() => {
    recorder.start({ id: "s2" });
  }, /already recording/);
});

test("SessionRecorder: recordEvent() records events with correct shape", () => {
  const recorder = new SessionRecorder();
  recorder.start({ id: "test-session" });

  recorder.recordEvent({
    type: "user_message",
    data: { content: "Hello, agent!" },
    context: { turn: 1 },
  });

  recorder.recordEvent({
    type: "assistant_response",
    data: { content: "Hello! How can I help?" },
  });

  const recording = recorder.getRecording();
  assert.equal(recording.events.length, 2);

  const [event1, event2] = recording.events;

  assert.equal(event1.type, "user_message");
  assert.equal(event1.data.content, "Hello, agent!");
  assert.equal(event1.context.turn, 1);
  assert.ok(event1.timestamp);

  assert.equal(event2.type, "assistant_response");
  assert.equal(event2.data.content, "Hello! How can I help?");
  assert.deepEqual(event2.context, {});
});

test("SessionRecorder: recordEvent() throws for invalid event type", () => {
  const recorder = new SessionRecorder();
  recorder.start({ id: "test-session" });

  assert.throws(() => {
    recorder.recordEvent({ type: "nonexistent_type", data: "test" });
  }, /Invalid event type/);
});

test("SessionRecorder: recordEvent() throws for non-object event", () => {
  const recorder = new SessionRecorder();
  recorder.start({ id: "test-session" });

  assert.throws(() => {
    recorder.recordEvent(null);
  }, /Event must be an object/);

  assert.throws(() => {
    recorder.recordEvent("not an object");
  }, /Event must be an object/);
});

test("SessionRecorder: recordEvent() throws when not recording", () => {
  const recorder = new SessionRecorder();

  assert.throws(() => {
    recorder.recordEvent({ type: "user_message", data: "test" });
  }, /not recording/);
});

test("SessionRecorder: stop() finalizes recording and returns it", () => {
  const recorder = new SessionRecorder();
  recorder.start({ id: "test-session" });

  recorder.recordEvent({ type: "user_message", data: "Hi" });
  const recording = recorder.stop();

  assert.ok(recording.endTime);
  assert.equal(recording.events.length, 1);

  const afterStop = recorder.getRecording();
  assert.equal(afterStop, null);
});

test("SessionRecorder: stop() throws when not recording", () => {
  const recorder = new SessionRecorder();

  assert.throws(() => {
    recorder.stop();
  }, /not recording/);
});

test("SessionRecorder: save() writes recording to disk", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-capture-test-"));
  try {
    const recorder = new SessionRecorder();
    recorder.start({ id: "session-save-test" });
    recorder.recordEvent({ type: "user_message", data: "Save me" });
    recorder.recordEvent({ type: "assistant_response", data: "Saved!" });

    const outputPath = path.join(tmpDir, "test-recording.json");
    const savedPath = recorder.save(outputPath);

    assert.equal(savedPath, path.resolve(outputPath));
    assert.ok(fs.existsSync(outputPath));

    const raw = fs.readFileSync(outputPath, "utf8");
    const parsed = JSON.parse(raw);

    assert.equal(parsed.events.length, 2);
    assert.equal(parsed.metadata.sessionId, "session-save-test");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("SessionRecorder: isRecording() reports correct state", () => {
  const recorder = new SessionRecorder();

  assert.equal(recorder.isRecording(), false);

  recorder.start({ id: "test" });
  assert.equal(recorder.isRecording(), true);

  recorder.stop();
  assert.equal(recorder.isRecording(), false);
});

test("SessionRecorder: eventCount() tracks event count", () => {
  const recorder = new SessionRecorder();

  assert.equal(recorder.eventCount(), 0);

  recorder.start({ id: "test" });
  assert.equal(recorder.eventCount(), 0);

  recorder.recordEvent({ type: "user_message", data: "msg1" });
  recorder.recordEvent({ type: "assistant_response", data: "resp1" });
  recorder.recordEvent({ type: "tool_call", data: { name: "read" } });
  assert.equal(recorder.eventCount(), 3);

  recorder.stop();
  assert.equal(recorder.eventCount(), 0);
});

test("SessionRecorder: records all valid event types", () => {
  const recorder = new SessionRecorder();
  recorder.start({ id: "all-types-test" });

  const types = [
    "user_message",
    "assistant_response",
    "tool_call",
    "tool_result",
    "error",
    "state_change",
  ];

  for (const type of types) {
    recorder.recordEvent({ type, data: { note: `Event type: ${type}` } });
  }

  const recording = recorder.stop();
  assert.equal(recording.events.length, 6);

  for (let i = 0; i < types.length; i++) {
    assert.equal(recording.events[i].type, types[i]);
  }
});

test("SessionRecorder: getRecording() returns a deep copy", () => {
  const recorder = new SessionRecorder();
  recorder.start({ id: "test" });
  recorder.recordEvent({ type: "user_message", data: "original" });

  const recording = recorder.getRecording();
  recording.events.push({ type: "assistant_response", data: "injected", timestamp: new Date().toISOString() });

  // The internal recording should still have only 1 event
  const secondRecording = recorder.getRecording();
  assert.equal(secondRecording.events.length, 1);
});

test("SessionRecorder: elapsedMs() returns elapsed time", () => {
  const recorder = new SessionRecorder();

  assert.equal(recorder.elapsedMs(), 0);

  recorder.start({ id: "test" });
  const before = recorder.elapsedMs();
  assert.ok(before >= 0);

  recorder.recordEvent({ type: "user_message", data: "test" });
  const after = recorder.elapsedMs();
  assert.ok(after >= before);
});
