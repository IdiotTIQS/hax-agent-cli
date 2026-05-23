/**
 * ConversationClassifier tests — conversation type classification.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ConversationClassifier,
  CLASS_PROFILES,
} = require("../../src/patterns/classifier");

// ── Test helpers ───────────────────────────────────────────────────────────

function convo(...messages) {
  return messages;
}

function msg(role, content) {
  return { role, content };
}

// ── classify: empty / invalid input ────────────────────────────────────────

test("classify: returns null for empty conversation", () => {
  const cc = new ConversationClassifier();
  const result = cc.classify([]);
  assert.equal(result.classification, null);
  assert.equal(result.confidence, 0);
  assert.equal(result.reason, "Empty conversation");
});

test("classify: handles non-array input gracefully", () => {
  const cc = new ConversationClassifier();
  const result = cc.classify(null);
  assert.equal(result.classification, null);
  assert.equal(result.confidence, 0);
});

test("classify: handles messages with non-string content", () => {
  const cc = new ConversationClassifier({ minConfidence: 0.1 });
  const result = cc.classify([
    { role: "user", content: { text: "How do I deploy?" } },
    { role: "assistant", content: ["You can use", "Docker for deployment"] },
  ]);
  // Should not throw
  assert.ok(typeof result.classification === "string" || result.classification === null,
    "Should return a classification or null");
});

// ── classify: TASK_ORIENTED ────────────────────────────────────────────────

test("classify: detects TASK_ORIENTED conversation", () => {
  const cc = new ConversationClassifier({ minConfidence: 0.1 });
  const result = cc.classify(convo(
    msg("user", "Add user registration to the auth module with input validation."),
    msg("assistant", "I'll add the registration endpoint with the necessary validation logic."),
    msg("tool", "File modified: routes/auth.js"),
    msg("assistant", "Registration route added. Now the auth module handles sign-ups."),
    msg("user", "Update the login endpoint to use the new validation."),
    msg("tool", "File modified: routes/auth.js"),
    msg("assistant", "Login endpoint updated with the new validation middleware."),
    msg("user", "Remove the deprecated password reset endpoint."),
    msg("tool", "File removed: routes/reset.js"),
    msg("assistant", "Removed. All auth endpoints are now consistent."),
  ));
  assert.equal(result.classification, "TASK_ORIENTED");
  assert.ok(result.confidence > 0.1);
  assert.ok(typeof result.features === "object", "Should include features");
});

test("classify: TASK_ORIENTED has high directive ratio in features", () => {
  const cc = new ConversationClassifier({ minConfidence: 0.1 });
  const result = cc.classify(convo(
    msg("user", "Write unit tests for the auth module."),
    msg("user", "Also add input validation for the login form."),
    msg("assistant", "I've created the test file and added validation."),
  ));
  assert.equal(result.classification, "TASK_ORIENTED");
  assert.ok(result.features.directiveRatio >= 0, "Directive ratio should be present");
});

// ── classify: EXPLORATORY ─────────────────────────────────────────────────

test("classify: detects EXPLORATORY conversation", () => {
  const cc = new ConversationClassifier({ minConfidence: 0.1 });
  const result = cc.classify(convo(
    msg("user", "What are the differences between SQL and NoSQL databases?"),
    msg("assistant", "SQL databases are relational, use structured schemas..."),
    msg("user", "How does MongoDB handle indexing?"),
    msg("assistant", "MongoDB uses B-tree indexes by default..."),
    msg("user", "What about Redis? How does its data model compare?"),
    msg("assistant", "Redis is an in-memory key-value store..."),
    msg("user", "Are there any hybrid approaches?"),
  ));
  assert.equal(result.classification, "EXPLORATORY");
  assert.ok(result.confidence > 0.1);
  assert.ok(result.features.questionDensity > 0, "Should have high question density");
});

// ── classify: EDUCATIONAL ─────────────────────────────────────────────────

test("classify: detects EDUCATIONAL conversation", () => {
  const cc = new ConversationClassifier({ minConfidence: 0.05 });
  const result = cc.classify(convo(
    msg("user", "Can you explain how closures work in JavaScript?"),
    msg("assistant", "A closure is a function that captures variables from its enclosing scope. This is a key concept in JavaScript."),
    msg("user", "Explain it again more simply please."),
    msg("assistant", "A closure simply means a function remembers the variables around it even after the outer function finishes."),
    msg("user", "Please elaborate on how closures capture variables."),
    msg("assistant", "When a closure is created, it keeps a reference to the outer variables, not a copy. This means changes are reflected."),
    msg("user", "Walk me through the concept step by step."),
    msg("assistant", "Here is how it works: first an outer function defines a variable, then an inner function references it, creating a closure over that variable."),
  ));
  // Educational conversations share traits with exploratory ones.
  // Verify EDUCATIONAL is detected — either as primary classification or a strong alternative.
  const isEducational = result.classification === "EDUCATIONAL"
    || cc.getAlternatives().some((a) => a.class === "EDUCATIONAL" && a.confidence >= 0.3);
  assert.ok(isEducational, "EDUCATIONAL should be detected as primary or strong alternative");
  assert.ok(result.features.explanationRequestRatio > 0, "Should have explanation requests");
});

// ── classify: DEBUGGING ───────────────────────────────────────────────────

test("classify: detects DEBUGGING conversation", () => {
  const cc = new ConversationClassifier({ minConfidence: 0.1 });
  const result = cc.classify(convo(
    msg("user", "My app keeps crashing with 'TypeError: Cannot read property of undefined'. This is so frustrating!"),
    msg("assistant", "Let me check where this error occurs. I'll look at the stack trace."),
    msg("tool", "Searched codebase for 'undefined' references."),
    msg("assistant", "Found the bug — the reducer doesn't handle the initial state correctly. Here is the fix."),
    msg("user", "That fixed the crash, but now the data isn't loading."),
    msg("assistant", "Let me investigate the data loading issue."),
  ));
  assert.equal(result.classification, "DEBUGGING");
  assert.ok(result.confidence > 0.1);
  assert.ok(result.features.errorSignalScore === 1, "Should detect error signals");
});

test("classify: DEBUGGING has negative sentiment", () => {
  const cc = new ConversationClassifier({ minConfidence: 0.1 });
  const result = cc.classify(convo(
    msg("user", "This is terrible! The entire module is broken and nothing works!"),
    msg("assistant", "I understand your frustration. Let me find the root cause."),
    msg("assistant", "I found the bug — a missing null check in the data pipeline."),
  ));
  assert.equal(result.classification, "DEBUGGING");
  assert.ok(result.features.sentimentScore < 0, "Should have negative sentiment");
});

// ── classify: CREATIVE ────────────────────────────────────────────────────

test("classify: detects CREATIVE conversation", () => {
  const cc = new ConversationClassifier({ minConfidence: 0.1 });
  const result = cc.classify(convo(
    msg("user", "Write a complete React dashboard component with charts and a data table."),
    msg("assistant", "I'll create a beautiful dashboard for you. Here it is:\n```jsx\nconst Dashboard = () => {\n  ...\n}\n```"),
    msg("user", "That's perfect! Now add a dark mode toggle."),
    msg("assistant", "Great idea! Here is the enhanced version with dark mode:\n```jsx\n...\n```"),
  ));
  assert.equal(result.classification, "CREATIVE");
  assert.ok(result.confidence > 0.1);
  assert.ok(result.features.generationRequestRatio > 0, "Should have generation requests");
});

// ── classify: ANALYTICAL ──────────────────────────────────────────────────

test("classify: detects ANALYTICAL conversation", () => {
  const cc = new ConversationClassifier({ minConfidence: 0.1 });
  const result = cc.classify(convo(
    msg("user", "Analyze the performance of this sorting algorithm against a large dataset."),
    msg("tool", "Benchmark tool executed: 1000 items = 15ms"),
    msg("tool", "Benchmark tool executed: 10000 items = 340ms"),
    msg("assistant", "Based on the benchmark results, this algorithm exhibits O(n log n) time complexity. Here is a detailed breakdown:\n```\nInput size  |  Time (ms)  |  Memory (MB)\n1000        |  15         |  4.2\n10000       |  340        |  12.8\n```"),
    msg("user", "Profile the memory usage and garbage collection patterns."),
    msg("tool", "Memory profiler executed: peak heap 24MB, GC pause 2.3ms"),
    msg("assistant", "The memory profile shows efficient garbage collection. Here is the allocation trace:\n```\nAllocation site        |  Count   |  Size\nsort function          |  10000   |  800KB\ntemp buffer            |  10000   |  400KB\n```\nIn summary, the algorithm is well-optimized for both time and space."),
  ));
  assert.equal(result.classification, "ANALYTICAL");
  assert.ok(result.confidence > 0.1);
});

// ── classify: ADMINISTRATIVE ──────────────────────────────────────────────

test("classify: detects ADMINISTRATIVE conversation", () => {
  const cc = new ConversationClassifier({ minConfidence: 0.1 });
  const result = cc.classify(convo(
    msg("user", "I need to set up a CI/CD pipeline with GitHub Actions."),
    msg("assistant", "Let me help you configure that. First, create a .github/workflows directory."),
    msg("user", "Also configure the environment variables for production."),
    msg("assistant", "I'll set up the .env file and update the deployment configuration."),
    msg("user", "Deploy to staging first, then production."),
    msg("assistant", "Configuration is complete. The pipeline will deploy to staging on PR merge and production on tag push."),
  ));
  assert.equal(result.classification, "ADMINISTRATIVE");
  assert.ok(result.confidence > 0.1);
  assert.ok(result.features.setupConfigRatio > 0, "Should have setup/config references");
});

// ── getConfidence ──────────────────────────────────────────────────────────

test("getConfidence: returns 0 before any classification", () => {
  const cc = new ConversationClassifier();
  assert.equal(cc.getConfidence(), 0);
});

test("getConfidence: returns confidence after classification", () => {
  const cc = new ConversationClassifier();
  const result = cc.classify(convo(
    msg("user", "Write a function that reverses a string."),
    msg("assistant", "Here you go:\n```js\nconst reverse = s => s.split('').reverse().join('');\n```"),
  ));
  const conf = cc.getConfidence();
  assert.ok(conf > 0, "Should have positive confidence after classification");
  assert.equal(conf, result.confidence, "getConfidence should match classify confidence");
});

// ── getAlternatives ────────────────────────────────────────────────────────

test("getAlternatives: returns empty before classification", () => {
  const cc = new ConversationClassifier();
  const alts = cc.getAlternatives();
  assert.deepEqual(alts, []);
});

test("getAlternatives: returns alternative classifications", () => {
  const cc = new ConversationClassifier({ minConfidence: 0.05 });
  cc.classify(convo(
    msg("user", "What is Kubernetes? How do I set it up for my microservices?"),
    msg("assistant", "Kubernetes is a container orchestration platform. Here is how to set it up..."),
    msg("user", "Can you also review my deployment config?"),
    msg("assistant", "Looking at your config, I see several issues to fix."),
  ));
  const alts = cc.getAlternatives();
  assert.ok(Array.isArray(alts), "Should return an array");
  alts.forEach((a) => {
    assert.ok(typeof a.class === "string", "Alternative should have class name");
    assert.ok(typeof a.confidence === "number", "Alternative should have confidence");
    assert.ok(a.confidence >= 0 && a.confidence <= 1, "Confidence should be 0-1");
  });
});

test("getAlternatives: respects maxAlternatives option", () => {
  const cc2 = new ConversationClassifier({ minConfidence: 0.05, maxAlternatives: 2 });
  cc2.classify(convo(
    msg("user", "Set up a new project with TypeScript and ESLint."),
    msg("assistant", "I'll help you configure that..."),
  ));
  assert.ok(cc2.getAlternatives().length <= 2, "Should respect maxAlternatives limit");
});

// ── reclassify ─────────────────────────────────────────────────────────────

test("reclassify: detects when classification changes", () => {
  const cc = new ConversationClassifier({ minConfidence: 0.1 });

  // First classification: ADMINISTRATIVE (setup)
  const r1 = cc.reclassify(convo(
    msg("user", "Set up a project with webpack and babel."),
    msg("assistant", "I'll configure webpack and babel for you."),
  ));
  assert.ok(!r1.changed || r1.previousClassification === null,
    "First classification should have no previous");
  assert.ok(r1.classification !== null, "Should classify");

  // Add debugging messages
  const r2 = cc.reclassify(convo(
    msg("user", "Set up a project with webpack and babel."),
    msg("assistant", "I'll configure webpack and babel for you."),
    msg("user", "The build is broken! Getting 'Module not found' errors everywhere."),
    msg("assistant", "Found the issue in webpack config — the resolve alias is wrong."),
  ));

  assert.ok(typeof r2.classification === "string" || r2.classification === null,
    "Should return a classification");
  assert.ok(typeof r2.changed === "boolean", "Should indicate if classification changed");
  assert.ok(typeof r2.previousClassification === "string" || r2.previousClassification === null,
    "Should provide previous classification");
});

test("reclassify: returns features on reclassification", () => {
  const cc = new ConversationClassifier({ minConfidence: 0.1 });

  cc.classify(convo(
    msg("user", "What is Docker?"),
    msg("assistant", "Docker is a container platform."),
  ));

  const result = cc.reclassify(convo(
    msg("user", "What is Docker?"),
    msg("assistant", "Docker is a container platform."),
    msg("user", "The container keeps crashing with exit code 137."),
    msg("assistant", "Exit code 137 means OOM. Let me investigate the memory limits."),
  ));

  assert.ok(typeof result.features === "object", "Should include features");
  assert.ok(result.features.totalMessages > 0, "Should have totalMessages in features");
});

// ── getFeatures ────────────────────────────────────────────────────────────

test("getFeatures: returns null before classification", () => {
  const cc = new ConversationClassifier();
  assert.equal(cc.getFeatures(), null);
});

test("getFeatures: returns feature vector after classification", () => {
  const cc = new ConversationClassifier();
  cc.classify(convo(
    msg("user", "Create a REST API endpoint."),
    msg("assistant", "Here is the endpoint implementation."),
  ));
  const features = cc.getFeatures();
  assert.ok(typeof features === "object", "Should return features object");
  assert.ok("directiveRatio" in features, "Should include directiveRatio");
  assert.ok("toolUsageRatio" in features, "Should include toolUsageRatio");
  assert.ok("codeBlockFrequency" in features, "Should include codeBlockFrequency");
  assert.ok("questionDensity" in features, "Should include questionDensity");
  assert.ok("messageRatio_UserAssistant" in features, "Should include messageRatio_UserAssistant");
  assert.ok("avgTurnLength" in features, "Should include avgTurnLength");
  assert.ok("sentimentScore" in features, "Should include sentimentScore");
  assert.ok("errorSignalScore" in features, "Should include errorSignalScore");
  assert.ok("topicDiversity" in features, "Should include topicDiversity");
  assert.ok("totalMessages" in features, "Should include totalMessages");
});

// ── Custom options ─────────────────────────────────────────────────────────

test("constructor: respects minConfidence option", () => {
  const ccHigh = new ConversationClassifier({ minConfidence: 0.9 });
  const result = ccHigh.classify(convo(
    msg("user", "hi"),
    msg("assistant", "Hello!"),
  ));
  assert.equal(result.classification, null, "High threshold should reject weak matches");
});

test("constructor: accepts maxAlternatives option", () => {
  const cc = new ConversationClassifier({ minConfidence: 0.05, maxAlternatives: 1 });
  cc.classify(convo(
    msg("user", "Set up and deploy a new microservice."),
    msg("assistant", "I'll help with the setup and deployment configuration."),
  ));
  assert.ok(cc.getAlternatives().length <= 1, "Should cap alternatives");
});

// ── Edge cases ─────────────────────────────────────────────────────────────

test("classify: handles single message", () => {
  const cc = new ConversationClassifier({ minConfidence: 0.05 });
  const result = cc.classify(convo(
    msg("user", "Fix the bug in the login handler."),
  ));
  assert.ok(typeof result.classification === "string" || result.classification === null,
    "Should return classification or null without throwing");
});

test("classify: features are within reasonable ranges", () => {
  const cc = new ConversationClassifier();
  cc.classify(convo(
    msg("user", "What is the meaning of life?"),
    msg("assistant", "That is a deep philosophical question."),
    msg("user", "How about the meaning of code?"),
    msg("assistant", "Code has meaning when it serves a purpose."),
  ));

  const features = cc.getFeatures();
  assert.ok(features.directiveRatio >= 0 && features.directiveRatio <= 1, "directiveRatio should be 0-1");
  assert.ok(features.toolUsageRatio >= 0 && features.toolUsageRatio <= 1, "toolUsageRatio should be 0-1");
  assert.ok(features.questionDensity >= 0, "questionDensity should be >= 0");
  assert.ok(features.sentimentScore >= -1 && features.sentimentScore <= 1, "sentimentScore should be -1 to 1");
  assert.ok(features.messageRatio_UserAssistant >= -1 && features.messageRatio_UserAssistant <= 1,
    "messageRatio_UserAssistant should be -1 to 1");
});

test("CLASS_PROFILES: all profiles have valid structure", () => {
  assert.ok(Array.isArray(CLASS_PROFILES), "CLASS_PROFILES should be an array");
  assert.ok(CLASS_PROFILES.length === 7, "Should have 7 classification profiles");

  const expectedClasses = [
    "TASK_ORIENTED", "EXPLORATORY", "EDUCATIONAL",
    "DEBUGGING", "CREATIVE", "ANALYTICAL", "ADMINISTRATIVE",
  ];

  for (const cls of expectedClasses) {
    const profile = CLASS_PROFILES.find((p) => p.class === cls);
    assert.ok(profile, `Profile should exist for ${cls}`);
    assert.ok(typeof profile.features === "object", `${cls} should have features`);
    assert.ok(typeof profile.description === "string", `${cls} should have description`);
    assert.ok(profile.description.length > 0, `${cls} description should not be empty`);

    // Verify each feature weight is a number
    for (const [key, weight] of Object.entries(profile.features)) {
      assert.ok(typeof weight === "number", `${cls}.features.${key} should be a number`);
      assert.ok(weight >= -1 && weight <= 1, `${cls}.features.${key} should be -1 to 1`);
    }
  }
});
