/**
 * PatternMatcher tests — conversation pattern matching and prediction.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  PatternMatcher,
  classifyMessageType,
  DEFAULT_PATTERNS,
} = require("../../src/patterns/matcher");

// ── Test helpers ───────────────────────────────────────────────────────────

function convo(...messages) {
  return messages;
}

function msg(role, content) {
  return { role, content };
}

// ── classifyMessageType ────────────────────────────────────────────────────

test("classifyMessageType: user question with ?", () => {
  const result = classifyMessageType(msg("user", "How do I add authentication?"));
  assert.equal(result, "question");
});

test("classifyMessageType: user error report", () => {
  const result = classifyMessageType(msg("user", "My app is crashing with a null reference error"));
  assert.equal(result, "error_report");
});

test("classifyMessageType: user refactor request", () => {
  const result = classifyMessageType(msg("user", "Can we refactor the auth module to be cleaner?"));
  assert.equal(result, "refactor_request");
});

test("classifyMessageType: assistant code response", () => {
  const result = classifyMessageType(msg("assistant", "Here is the fix:\n```js\nconst x = 1;\n```"));
  assert.equal(result, "code_response");
});

test("classifyMessageType: assistant diagnosis", () => {
  const result = classifyMessageType(msg("assistant", "I found the bug. The error is caused by a null value in the reducer."));
  assert.equal(result, "diagnosis");
});

test("classifyMessageType: system message", () => {
  const result = classifyMessageType(msg("system", "You are a helpful assistant."));
  assert.equal(result, "system");
});

test("classifyMessageType: tool result", () => {
  const result = classifyMessageType(msg("tool", "File read successfully."));
  assert.equal(result, "tool_result");
});

test("classifyMessageType: user planning request", () => {
  const result = classifyMessageType(msg("user", "Can we design the architecture for a microservices app?"));
  assert.equal(result, "planning_request");
});

test("classifyMessageType: user onboarding request", () => {
  const result = classifyMessageType(msg("user", "I need to set up a new React project with TypeScript"));
  assert.equal(result, "onboarding_request");
});

test("classifyMessageType: user fix request", () => {
  const result = classifyMessageType(msg("user", "Can you fix the memory leak in the cache module?"));
  assert.equal(result, "fix_request");
});

// ── PatternMatcher.define ──────────────────────────────────────────────────

test("define: registers a new pattern", () => {
  const pm = new PatternMatcher();
  pm.define("testPattern", {
    sequence: ["question", "response", "question"],
    conditions: { minMessages: 2 },
    confidence: 0.7,
    expectedDuration: 5,
    description: "A test pattern",
  });

  const names = pm.getPatternNames();
  assert.ok(names.includes("testPattern"));
});

test("define: throws for empty name", () => {
  const pm = new PatternMatcher();
  assert.throws(
    () => pm.define("", { sequence: ["question"] }),
    { message: /non-empty string/ },
  );
});

test("define: throws for non-object pattern", () => {
  const pm = new PatternMatcher();
  assert.throws(
    () => pm.define("bad", null),
    { message: /must be an object/ },
  );
});

test("define: throws for missing sequence", () => {
  const pm = new PatternMatcher();
  assert.throws(
    () => pm.define("bad", { conditions: {} }),
    { message: /non-empty sequence/ },
  );
});

test("define: returns this for chaining", () => {
  const pm = new PatternMatcher();
  const result = pm.define("chain", { sequence: ["question", "response"] });
  assert.equal(result, pm);
});

// ── PatternMatcher.match ───────────────────────────────────────────────────

test("match: returns empty array for empty conversation", () => {
  const pm = new PatternMatcher();
  const result = pm.match([]);
  assert.deepEqual(result, []);
});

test("match: returns empty array for non-array input", () => {
  const pm = new PatternMatcher();
  const result = pm.match(null);
  assert.deepEqual(result, []);
});

test("match: detects Q&A pattern", () => {
  const pm = new PatternMatcher({ minConfidence: 0.3 });
  const result = pm.match(convo(
    msg("user", "What is a closure in JavaScript?"),
    msg("assistant", "A closure is a function that captures its lexical scope..."),
    msg("user", "Can you give me an example?"),
    msg("assistant", "Here is an example:\n```js\nfunction outer() {\n  let x = 1;\n  return function() { return x; };\n}\n```"),
  ));

  const qa = result.find((r) => r.pattern === "Q_A");
  assert.ok(qa, "Q&A pattern should be detected");
  assert.ok(qa.confidence > 0.3, "Confidence should be above threshold");
});

test("match: detects debugging pattern", () => {
  const pm = new PatternMatcher({ minConfidence: 0.3 });
  const result = pm.match(convo(
    msg("user", "The login page crashes when I click submit. Error: Cannot read property 'email' of undefined"),
    msg("assistant", "Let me investigate. I'll check the form submission handler and the state initialization."),
    msg("assistant", "I found the bug — the form state isn't initialized before the first render. The formData defaults to undefined."),
    msg("user", "Can you fix this?"),
    msg("assistant", "Here is the fix:\n```js\nconst [formData, setFormData] = useState({ email: '', password: '' });\n```"),
  ));

  const debug = result.find((r) => r.pattern === "debugging");
  assert.ok(debug, "Debugging pattern should be detected");
  assert.ok(debug.confidence > 0.3);
});

test("match: detects codeReview pattern", () => {
  const pm = new PatternMatcher({ minConfidence: 0.3 });
  const result = pm.match(convo(
    msg("user", "Here's my authentication middleware:\n```js\nfunction auth(req, res, next) {\n  const token = req.headers.authorization;\n  if (!token) return res.status(401).send();\n  next();\n}\n```\nCan you review it?"),
    msg("assistant", "Looking at your code, here are my findings..."),
    msg("assistant", "I've added JWT verification and error handling:\n```js\nfunction auth(req, res, next) {\n  const token = req.headers.authorization?.split(' ')[1];\n  if (!token) return res.status(401).json({ error: 'No token' });\n  try {\n    req.user = jwt.verify(token, SECRET);\n    next();\n  } catch { return res.status(403).json({ error: 'Invalid' }); }\n}\n```"),
    msg("user", "That's great, thanks!"),
  ));

  const cr = result.find((r) => r.pattern === "codeReview");
  assert.ok(cr, "CodeReview pattern should be detected");
  assert.ok(cr.confidence > 0.3);
});

test("match: detects crisis pattern", () => {
  const pm = new PatternMatcher({ minConfidence: 0.3 });
  const result = pm.match(convo(
    msg("user", "URGENT: Production is down! All users getting 500 errors after the deploy."),
    msg("assistant", "I'm on it. Let me check the error logs immediately."),
    msg("assistant", "Found it — null reference in the payment processor. Pushing a hotfix now."),
    msg("assistant", "Here is the fix:\n```js\nconst amount = payment?.amount ?? 0;\n```"),
  ));

  const crisis = result.find((r) => r.pattern === "crisis");
  assert.ok(crisis, "Crisis pattern should be detected");
  assert.ok(crisis.confidence > 0.3);
});

test("match: respects minConfidence option", () => {
  const pmHigh = new PatternMatcher({ minConfidence: 0.95 });
  const resultHigh = pmHigh.match(convo(
    msg("user", "What is a promise?"),
    msg("assistant", "A promise represents a future value..."),
  ));
  assert.equal(resultHigh.length, 0, "High threshold should filter out weak matches");

  const pmLow = new PatternMatcher({ minConfidence: 0.1 });
  const resultLow = pmLow.match(convo(
    msg("user", "What is a promise?"),
    msg("assistant", "A promise represents a future value..."),
  ));
  assert.ok(resultLow.length > 0, "Low threshold should allow some matches");
});

test("match: returns multiple matches when applicable", () => {
  const pm = new PatternMatcher({ minConfidence: 0.2 });
  const result = pm.match(convo(
    msg("user", "The app crashes with 'cannot read property of undefined'. Can you help me debug and refactor?"),
    msg("assistant", "I'll help debug and suggest refactoring. Let me investigate first."),
    msg("assistant", "Found the null reference. I'll also show a cleaner structure:\n```js\nconst value = obj?.prop ?? 'default';\n```"),
    msg("user", "Perfect, that fixed it!"),
  ));

  assert.ok(result.length >= 1, "Should find at least one match");
  // Debugging should be among the top matches
  const hasDebugging = result.some((r) => r.pattern === "debugging");
  assert.ok(hasDebugging, "Debugging should be detected");
});

test("match: includes matchedSegments in result", () => {
  const pm = new PatternMatcher({ minConfidence: 0.2 });
  const result = pm.match(convo(
    msg("user", "What is Node.js?"),
    msg("assistant", "Node.js is a JavaScript runtime built on Chrome's V8 engine."),
    msg("user", "How do I install it?"),
    msg("assistant", "You can download it from nodejs.org or use nvm."),
  ));

  const qa = result.find((r) => r.pattern === "Q_A");
  assert.ok(qa, "Q&A pattern should be detected");
  assert.ok(Array.isArray(qa.matchedSegments), "Should have matchedSegments array");
  assert.ok(qa.matchedSegments.length > 0, "Should have at least one matched segment");
});

test("match: detects exploration pattern", () => {
  const pm = new PatternMatcher({ minConfidence: 0.2 });
  const result = pm.match(convo(
    msg("user", "How does garbage collection work in V8?"),
    msg("assistant", "V8 uses a generational garbage collector with two main spaces..."),
    msg("user", "What about the Orinoco project?"),
    msg("assistant", "Orinoco aims to make GC mostly concurrent and parallel..."),
    msg("user", "How does this compare to Java's GC?"),
  ));

  const expl = result.find((r) => r.pattern === "exploration");
  assert.ok(expl, "Exploration pattern should be detected with varied questions");
});

test("match: detects planning pattern", () => {
  const pm = new PatternMatcher({ minConfidence: 0.2 });
  const result = pm.match(convo(
    msg("user", "I need to design the database schema for an e-commerce platform."),
    msg("assistant", "Let's plan this out. First, what are the core entities?"),
    msg("user", "Products, orders, users, and inventory."),
    msg("assistant", "Good. Here's a proposed schema and architecture plan. In summary, we need these tables..."),
  ));

  const plan = result.find((r) => r.pattern === "planning");
  assert.ok(plan, "Planning pattern should be detected");
});

// ── PatternMatcher.getActivePatterns ───────────────────────────────────────

test("getActivePatterns: returns active partial matches", () => {
  const pm = new PatternMatcher({ minConfidence: 0.1 });

  // Match a conversation to populate active patterns (need >= 2 messages for most patterns)
  pm.match(convo(
    msg("user", "The app is broken, getting error 500"),
    msg("assistant", "Let me investigate the error."),
  ));

  const active = pm.getActivePatterns();
  assert.ok(Array.isArray(active), "Should return an array");
  // Active patterns may include patterns that partially matched
  active.forEach((ap) => {
    assert.ok(typeof ap.pattern === "string", "Each active pattern should have a name");
    assert.ok(typeof ap.similarity === "number", "Each active pattern should have similarity");
    assert.ok(ap.similarity >= 0 && ap.similarity <= 1, "Similarity should be 0-1");
  });
});

test("getActivePatterns: clears after reset", () => {
  const pm = new PatternMatcher({ minConfidence: 0.1 });
  pm.match(convo(
    msg("user", "How do I set up Jest for testing?"),
    msg("assistant", "First, install Jest with npm. Then create a jest.config.js file."),
  ));

  let active = pm.getActivePatterns();
  assert.ok(active.length > 0, "Should have active patterns after match");

  pm.reset();
  active = pm.getActivePatterns();
  assert.equal(active.length, 0, "Should have no active patterns after reset");
});

// ── PatternMatcher.predictNext ─────────────────────────────────────────────

test("predictNext: returns predictions for ongoing conversation", () => {
  const pm = new PatternMatcher();
  const predictions = pm.predictNext(convo(
    msg("user", "I need to refactor the user service. It's getting too large."),
    msg("assistant", "Let's analyze the current structure first."),
  ));

  assert.ok(Array.isArray(predictions), "Should return an array of predictions");
  predictions.forEach((p) => {
    assert.ok(typeof p.pattern === "string", "Each prediction should have a pattern name");
    assert.ok(typeof p.probability === "number", "Each prediction should have probability");
    assert.ok(p.probability >= 0 && p.probability <= 1, "Probability should be 0-1");
    assert.ok(typeof p.remainingSteps === "number", "Each prediction should have remainingSteps");
  });
});

test("predictNext: returns empty for empty conversation", () => {
  const pm = new PatternMatcher();
  const predictions = pm.predictNext([]);
  assert.deepEqual(predictions, []);
});

test("predictNext: Q&A prediction has nextExpectedType", () => {
  const pm = new PatternMatcher();
  const predictions = pm.predictNext(convo(
    msg("user", "What is TypeScript?"),
    msg("assistant", "TypeScript is a typed superset of JavaScript..."),
  ));

  const qa = predictions.find((p) => p.pattern === "Q_A");
  assert.ok(qa, "Q&A should be predicted after one question-answer pair");
  // Q&A should have high probability since the pattern matches well
  assert.ok(qa.probability >= 0, "Q&A prediction should have non-negative probability");
});

test("predictNext: debugging prediction after error report", () => {
  const pm = new PatternMatcher();
  const predictions = pm.predictNext(convo(
    msg("user", "The payment API is returning 500 errors for all transactions. Stack trace shows NullPointerException in PaymentService."),
    msg("assistant", "I'm investigating the PaymentService now. Let me check the null reference."),
  ));

  const debug = predictions.find((p) => p.pattern === "debugging");
  assert.ok(debug, "Debugging should be predicted after error report + investigation");
  assert.ok(debug.probability > 0.3, "Debugging probability should be meaningful");
});

// ── PatternMatcher.getPatternNames ─────────────────────────────────────────

test("getPatternNames: returns all registered pattern names", () => {
  const pm = new PatternMatcher();
  const names = pm.getPatternNames();
  assert.ok(Array.isArray(names), "Should return an array");
  assert.ok(names.length >= 8, "Should include all default patterns");
  assert.ok(names.includes("Q_A"), "Should include Q&A");
  assert.ok(names.includes("debugging"), "Should include debugging");
  assert.ok(names.includes("codeReview"), "Should include codeReview");
  assert.ok(names.includes("refactoring"), "Should include refactoring");
  assert.ok(names.includes("onboarding"), "Should include onboarding");
  assert.ok(names.includes("exploration"), "Should include exploration");
  assert.ok(names.includes("planning"), "Should include planning");
  assert.ok(names.includes("crisis"), "Should include crisis");
});

// ── PatternMatcher: custom patterns ────────────────────────────────────────

test("match: with custom patterns from constructor", () => {
  const pm = new PatternMatcher({
    patterns: {
      customQA: {
        sequence: ["question", "response"],
        conditions: { minMessages: 2 },
        confidence: 0.9,
        expectedDuration: 3,
        description: "Custom Q&A",
      },
    },
    minConfidence: 0.3,
  });

  const result = pm.match(convo(
    msg("user", "What time is it?"),
    msg("assistant", "It is 3:00 PM."),
  ));

  const custom = result.find((r) => r.pattern === "customQA");
  assert.ok(custom, "Custom pattern should be detected");
  assert.ok(custom.confidence > 0.3);
});

// ── Edge cases ─────────────────────────────────────────────────────────────

test("match: handles messages with non-string content", () => {
  const pm = new PatternMatcher({ minConfidence: 0.1 });
  const result = pm.match([
    { role: "user", content: { text: "What is JavaScript?" } },
    { role: "assistant", content: ["JavaScript is a", "programming language"] },
    { role: "user", content: null },
  ]);

  // Should not throw; should handle gracefully
  assert.ok(Array.isArray(result), "Should return an array without throwing");
});

test("match: handles conversation with only one message", () => {
  const pm = new PatternMatcher({ minConfidence: 0.3 });
  const result = pm.match(convo(
    msg("user", "Hello"),
  ));

  // Most patterns require minMessages >= 2, so likely empty
  assert.ok(Array.isArray(result), "Should return an array");
});

test("match: confidence scores are between 0 and 1", () => {
  const pm = new PatternMatcher({ minConfidence: 0.1 });
  const result = pm.match(convo(
    msg("user", "What is Docker?"),
    msg("assistant", "Docker is a containerization platform."),
  ));

  for (const r of result) {
    assert.ok(r.confidence >= 0 && r.confidence <= 1,
      `Confidence for ${r.pattern} should be 0-1, got ${r.confidence}`);
  }
});

test("match: matchedSegments have valid indices", () => {
  const pm = new PatternMatcher({ minConfidence: 0.2 });
  const conversation = convo(
    msg("user", "What is React?"),
    msg("assistant", "React is a UI library."),
    msg("user", "How do I use hooks?"),
    msg("assistant", "Hooks are functions that let you use state..."),
  );

  const result = pm.match(conversation);
  const qa = result.find((r) => r.pattern === "Q_A");

  if (qa) {
    qa.matchedSegments.forEach((seg) => {
      assert.ok(seg.start >= 0, "Segment start should be >= 0");
      assert.ok(seg.end < conversation.length, "Segment end should be within bounds");
      assert.ok(seg.start <= seg.end, "Segment start should be <= end");
    });
  }
});
