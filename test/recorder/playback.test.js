"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { SessionPlayer, SPEED_PRESETS } = require("../../src/recorder/playback");

function makeRecording(events) {
  return {
    version: 1,
    metadata: { id: "test-rec", sessionId: "test" },
    events,
    startTime: events[0]?.timestamp || new Date().toISOString(),
    endTime: events[events.length - 1]?.timestamp || new Date().toISOString(),
  };
}

function makeEvent(type, data, offsetMs = 0) {
  const ts = new Date(Date.now() + offsetMs);
  return { type, timestamp: ts.toISOString(), data: data || `${type} data`, context: {} };
}

test("SessionPlayer: load() loads a recording from a file", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-playback-test-"));
  try {
    const recording = makeRecording([
      makeEvent("user_message", "hello"),
      makeEvent("assistant_response", "hi there"),
    ]);
    const filePath = path.join(tmpDir, "recording.json");
    fs.writeFileSync(filePath, JSON.stringify(recording, null, 2));

    const player = new SessionPlayer();
    player.load(filePath);

    const progress = player.getProgress();
    assert.equal(progress.total, 2);
    assert.equal(progress.current, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("SessionPlayer: load() throws for missing file", () => {
  const player = new SessionPlayer();

  assert.throws(() => {
    player.load("/nonexistent/path/recording.json");
  }, /Recording file not found/);
});

test("SessionPlayer: load() throws for invalid JSON", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-playback-test-"));
  try {
    const filePath = path.join(tmpDir, "bad.json");
    fs.writeFileSync(filePath, "not valid json {{{");

    const player = new SessionPlayer();

    assert.throws(() => {
      player.load(filePath);
    }, /Invalid recording JSON/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("SessionPlayer: load() validates recording structure", () => {
  const player = new SessionPlayer();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-playback-test-"));
  try {
    const badPath = path.join(tmpDir, "bad-recording.json");
    fs.writeFileSync(badPath, JSON.stringify({ version: 1 }));
    assert.throws(() => player.load(badPath), /"events" array/);

    const noVersionPath = path.join(tmpDir, "no-ver.json");
    fs.writeFileSync(noVersionPath, JSON.stringify({ events: [] }));
    assert.throws(() => player.load(noVersionPath), /"version" field/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("SessionPlayer: step() advances one event at a time", () => {
  const player = new SessionPlayer();
  const recording = makeRecording([
    makeEvent("user_message", "first"),
    makeEvent("assistant_response", "second"),
    makeEvent("user_message", "third"),
  ]);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-playback-test-"));
  try {
    const filePath = path.join(tmpDir, "rec.json");
    fs.writeFileSync(filePath, JSON.stringify(recording));
    player.load(filePath);

    const event1 = player.step();
    assert.equal(event1.data, "first");
    assert.equal(player.getProgress().current, 1);

    const event2 = player.step();
    assert.equal(event2.data, "second");
    assert.equal(player.getProgress().current, 2);

    const event3 = player.step();
    assert.equal(event3.data, "third");
    assert.equal(player.getProgress().current, 3);

    // At end, should emit 'end' and return null
    let ended = false;
    player.once("end", () => { ended = true; });
    const event4 = player.step();
    assert.equal(event4, null);
    assert.ok(ended);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("SessionPlayer: step() emits step event with progress", () => {
  const player = new SessionPlayer();
  const recording = makeRecording([
    makeEvent("user_message", "msg"),
    makeEvent("assistant_response", "resp"),
  ]);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-playback-test-"));
  try {
    const filePath = path.join(tmpDir, "rec.json");
    fs.writeFileSync(filePath, JSON.stringify(recording));
    player.load(filePath);

    let stepEvent = null;
    let stepProgress = null;
    player.on("step", (event, progress) => {
      stepEvent = event;
      stepProgress = progress;
    });

    player.step();
    assert.equal(stepEvent.data, "msg");
    assert.equal(stepProgress.current, 1);
    assert.equal(stepProgress.total, 2);
    assert.equal(stepProgress.percent, 50);
    assert.equal(stepProgress.remaining, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("SessionPlayer: seek() jumps to specific timestamp", () => {
  const player = new SessionPlayer();
  const now = Date.now();
  const recording = makeRecording([
    makeEvent("user_message", "msg1", -5000),
    makeEvent("assistant_response", "msg2", -4000),
    makeEvent("user_message", "msg3", -3000),
    makeEvent("assistant_response", "msg4", -2000),
    makeEvent("user_message", "msg5", -1000),
  ]);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-playback-test-"));
  try {
    const filePath = path.join(tmpDir, "rec.json");
    fs.writeFileSync(filePath, JSON.stringify(recording));
    player.load(filePath);

    // Seek to before the 4th event (msg4 at -2000ms)
    const targetTime = new Date(now - 2500).toISOString();
    player.seek(targetTime);

    const current = player.getCurrentEvent();
    assert.equal(current.data, "msg3");
    assert.equal(player.getProgress().current, 3);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("SessionPlayer: seek() throws for invalid timestamp", () => {
  const player = new SessionPlayer();
  const recording = makeRecording([makeEvent("user_message", "test")]);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-playback-test-"));
  try {
    const filePath = path.join(tmpDir, "rec.json");
    fs.writeFileSync(filePath, JSON.stringify(recording));
    player.load(filePath);

    assert.throws(() => {
      player.seek("not-a-date");
    }, /Invalid timestamp/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("SessionPlayer: getCurrentEvent() returns null before any step", () => {
  const player = new SessionPlayer();
  const recording = makeRecording([makeEvent("user_message", "first")]);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-playback-test-"));
  try {
    const filePath = path.join(tmpDir, "rec.json");
    fs.writeFileSync(filePath, JSON.stringify(recording));
    player.load(filePath);

    assert.equal(player.getCurrentEvent(), null);

    player.step();
    assert.ok(player.getCurrentEvent());
    assert.equal(player.getCurrentEvent().data, "first");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("SessionPlayer: getProgress() returns correct progress object", () => {
  const player = new SessionPlayer();

  // No recording loaded
  assert.deepEqual(player.getProgress(), {
    current: 0, total: 0, percent: 0, elapsed: 0, remaining: 0,
  });

  const recording = makeRecording([
    makeEvent("user_message", "m1"),
    makeEvent("assistant_response", "m2"),
    makeEvent("user_message", "m3"),
  ]);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-playback-test-"));
  try {
    const filePath = path.join(tmpDir, "rec.json");
    fs.writeFileSync(filePath, JSON.stringify(recording));
    player.load(filePath);

    let progress = player.getProgress();
    assert.equal(progress.current, 0);
    assert.equal(progress.total, 3);
    assert.equal(progress.percent, 0);
    assert.equal(progress.remaining, 3);

    player.step();
    progress = player.getProgress();
    assert.equal(progress.current, 1);
    assert.equal(progress.percent, 33);

    player.step();
    player.step();
    progress = player.getProgress();
    assert.equal(progress.current, 3);
    assert.equal(progress.percent, 100);
    assert.equal(progress.remaining, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("SessionPlayer: play() with MAX speed emits all events immediately", (t, done) => {
  const player = new SessionPlayer();
  const recording = makeRecording([
    makeEvent("user_message", "m1"),
    makeEvent("assistant_response", "m2"),
    makeEvent("tool_call", "m3"),
  ]);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-playback-test-"));
  try {
    const filePath = path.join(tmpDir, "rec.json");
    fs.writeFileSync(filePath, JSON.stringify(recording));
    player.load(filePath);

    const events = [];
    player.on("step", (event) => events.push(event));
    player.on("end", () => {
      assert.equal(events.length, 3);
      assert.equal(events[0].data, "m1");
      assert.equal(events[1].data, "m2");
      assert.equal(events[2].data, "m3");
      done();
    });

    player.play({ speed: "MAX" });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("SessionPlayer: pause() and resume() control playback", (t, done) => {
  const player = new SessionPlayer();
  const recording = makeRecording([
    makeEvent("user_message", "m1", 0),
    makeEvent("assistant_response", "m2", 1),
    makeEvent("user_message", "m3", 2),
  ]);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-playback-test-"));
  try {
    const filePath = path.join(tmpDir, "rec.json");
    fs.writeFileSync(filePath, JSON.stringify(recording));
    player.load(filePath);

    let stepCount = 0;
    let paused = false;

    player.on("step", () => {
      stepCount += 1;
      // Pause after the second event
      if (stepCount === 2 && !paused) {
        paused = true;
        player.pause();

        // Verify no more steps during pause
        setTimeout(() => {
          assert.equal(stepCount, 2, "Step count should remain 2 while paused");
          player.resume();
        }, 20);
      }
    });

    player.on("end", () => {
      assert.equal(stepCount, 3);
      done();
    });

    // Play at max speed for instant playback
    player.play({ speed: "MAX" });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("SessionPlayer: reset() returns to beginning", () => {
  const player = new SessionPlayer();
  const recording = makeRecording([
    makeEvent("user_message", "m1"),
    makeEvent("assistant_response", "m2"),
  ]);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-playback-test-"));
  try {
    const filePath = path.join(tmpDir, "rec.json");
    fs.writeFileSync(filePath, JSON.stringify(recording));
    player.load(filePath);

    player.step();
    player.step();
    assert.equal(player.getProgress().current, 2);

    player.reset();
    assert.equal(player.getCurrentEvent(), null);
    assert.equal(player.getProgress().current, 0);
    assert.equal(player.getProgress().percent, 0);

    // Can step again from beginning
    const event = player.step();
    assert.equal(event.data, "m1");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("SessionPlayer: play() with from option starts at specific index", (t, done) => {
  const player = new SessionPlayer();
  const recording = makeRecording([
    makeEvent("user_message", "m1"),
    makeEvent("assistant_response", "m2"),
    makeEvent("tool_call", "m3"),
  ]);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-playback-test-"));
  try {
    const filePath = path.join(tmpDir, "rec.json");
    fs.writeFileSync(filePath, JSON.stringify(recording));
    player.load(filePath);

    let firstEvent = null;
    player.on("step", (event) => {
      if (!firstEvent) {
        firstEvent = event;
      }
    });
    player.on("end", () => {
      assert.equal(firstEvent.data, "m3");
      done();
    });

    player.play({ speed: "MAX", from: 2 });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("SessionPlayer: play() with invalid speed throws", () => {
  const player = new SessionPlayer();
  const recording = makeRecording([makeEvent("user_message", "test")]);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-playback-test-"));
  try {
    const filePath = path.join(tmpDir, "rec.json");
    fs.writeFileSync(filePath, JSON.stringify(recording));
    player.load(filePath);

    assert.throws(() => {
      player.play({ speed: -1 });
    }, /Speed must be a positive number/);

    assert.throws(() => {
      player.play({ speed: "invalid" });
    }, /Invalid speed/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("SessionPlayer: SPEED_PRESETS contains expected values", () => {
  assert.equal(SPEED_PRESETS["1x"], 1);
  assert.equal(SPEED_PRESETS["2x"], 2);
  assert.equal(SPEED_PRESETS["5x"], 5);
  assert.equal(SPEED_PRESETS["10x"], 10);
  assert.equal(SPEED_PRESETS["MAX"], Infinity);
});
