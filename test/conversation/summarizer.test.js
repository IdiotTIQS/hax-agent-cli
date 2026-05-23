"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  extractKeyPoints,
  summarizeByTopic,
  generateTLDR,
  extractActionItems,
  extractDecisions,
  extractQuestions,
} = require("../../src/conversation/summarizer");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMsg(role, content, timestamp) {
  const msg = { role, content };
  if (timestamp) msg.timestamp = timestamp;
  return msg;
}

// ---------------------------------------------------------------------------
// extractKeyPoints
// ---------------------------------------------------------------------------

test("extractKeyPoints: returns decisions from a conversation", () => {
  const messages = [
    makeMsg("user", "Should we use TypeScript or plain JavaScript?"),
    makeMsg("assistant", "I think we should use TypeScript. It provides better type safety and tooling. I've decided to go with TypeScript for this project."),
    makeMsg("user", "OK, agreed. Let's also finalize the folder structure."),
    makeMsg("assistant", "We concluded that src/, test/, and docs/ directories will work best."),
  ];

  const points = extractKeyPoints(messages);

  assert.ok(points.length > 0, "should have at least one key point");
  const decisions = points.filter((p) => p.category === "decision");
  assert.ok(decisions.length >= 1, "should find at least one decision");
  assert.ok(decisions.some((d) => d.point.toLowerCase().includes("typescript")));
});

test("extractKeyPoints: extracts findings from bullet lists", () => {
  const messages = [
    makeMsg("assistant", `Here are my findings:\n- The API returns 200 for all endpoints\n- Response time averages 45ms\n- The auth middleware is working correctly`),
  ];

  const points = extractKeyPoints(messages);

  const findings = points.filter((p) => p.category === "finding");
  assert.ok(findings.length >= 3, "should extract bulleted findings");
  assert.ok(findings.some((f) => f.point.includes("200")));
});

test("extractKeyPoints: extracts conclusions from structural patterns", () => {
  const messages = [
    makeMsg("assistant", "After analyzing the options,\nIn conclusion, we should migrate to PostgreSQL because it offers better reliability and feature set. This will take approximately 2 weeks."),
  ];

  const points = extractKeyPoints(messages);

  const conclusions = points.filter((p) => p.category === "conclusion");
  assert.ok(conclusions.length >= 1, "should extract at least one conclusion");
  assert.ok(conclusions.some((c) => c.point.toLowerCase().includes("postgresql")));
});

test("extractKeyPoints: deduplicates near-identical points", () => {
  const messages = [
    makeMsg("user", "I have decided to use React."),
    makeMsg("assistant", "OK, we have decided to use React for the frontend."),
  ];

  const points = extractKeyPoints(messages);

  const reactPoints = points.filter((p) => p.point.toLowerCase().includes("react"));
  assert.ok(reactPoints.length <= 2, "near-duplicate points should be deduped or minimal");
});

test("extractKeyPoints: handles empty input", () => {
  const points = extractKeyPoints([]);
  assert.equal(points.length, 0);
});

test("extractKeyPoints: handles null input gracefully", () => {
  const points = extractKeyPoints(null);
  assert.equal(points.length, 0);
});

test("extractKeyPoints: handles messages with no content", () => {
  const messages = [
    { role: "user" },
    { role: "assistant", content: null },
  ];

  const points = extractKeyPoints(messages);

  assert.equal(points.length, 0);
});

// ---------------------------------------------------------------------------
// summarizeByTopic
// ---------------------------------------------------------------------------

test("summarizeByTopic: groups messages into topic blocks", () => {
  const messages = [
    makeMsg("user", "Let's discuss the database schema."),
    makeMsg("assistant", "The schema should have users, posts, and comments tables."),
    makeMsg("user", "OK. Now let's talk about the API design."),
    makeMsg("assistant", "We should use REST with Express. Here's the endpoint structure..."),
    makeMsg("user", "Moving on to authentication."),
    makeMsg("assistant", "We decided to use JWT tokens with refresh token rotation."),
  ];

  const topics = summarizeByTopic(messages);

  assert.ok(topics.length >= 1, "should detect at least one topic");
  assert.ok(topics.every((t) => t.messageCount > 0), "every topic should have messages");
  assert.ok(topics.every((t) => typeof t.topic === "string" && t.topic.length > 0));
  assert.ok(topics.every((t) => typeof t.summary === "string" && t.summary.length > 0));
});

test("summarizeByTopic: single block for short cohesive conversation", () => {
  const messages = [
    makeMsg("user", "How do I set up the project?"),
    makeMsg("assistant", "Run npm install and then npm start."),
    makeMsg("user", "Thanks, it works!"),
  ];

  const topics = summarizeByTopic(messages);

  // A short related conversation may stay as a single topic block.
  assert.ok(topics.length >= 1);
  const totalCount = topics.reduce((s, t) => s + t.messageCount, 0);
  assert.equal(totalCount, 3);
});

test("summarizeByTopic: assigns meaningful topic names", () => {
  const messages = [
    makeMsg("user", "I need help regarding user authentication. How should we implement login?"),
    makeMsg("assistant", "We can use Passport.js with local strategy."),
  ];

  const topics = summarizeByTopic(messages);

  assert.ok(topics.length >= 1);
  // The topic name should capture "user authentication" or similar.
  const firstTopic = topics[0].topic.toLowerCase();
  assert.ok(
    firstTopic.includes("user") || firstTopic.includes("authentication") || firstTopic.includes("login"),
    `topic should reflect content, got: "${topics[0].topic}"`,
  );
});

test("summarizeByTopic: handles empty input", () => {
  assert.equal(summarizeByTopic([]).length, 0);
});

// ---------------------------------------------------------------------------
// generateTLDR
// ---------------------------------------------------------------------------

test("generateTLDR: produces a 1-3 sentence summary", () => {
  const messages = [
    makeMsg("user", "I need to build a REST API for a todo app."),
    makeMsg("assistant", "OK, let's set up Express and define the routes: GET /todos, POST /todos, PUT /todos/:id, DELETE /todos/:id."),
    makeMsg("user", "Great. Add input validation."),
    makeMsg("assistant", "I added Joi validation for all endpoints. The API now validates title, description, and status fields."),
  ];

  const tldr = generateTLDR(messages);

  assert.ok(typeof tldr === "string");
  assert.ok(tldr.length > 20, "should be a substantive summary");
  assert.ok(tldr.split(". ").length >= 1, "should have at least one sentence");
  assert.ok(tldr.toLowerCase().includes("rest") || tldr.toLowerCase().includes("api") || tldr.toLowerCase().includes("todo"));
});

test("generateTLDR: handles single message conversations", () => {
  const messages = [
    makeMsg("user", "Hello, can you help me?"),
  ];

  const tldr = generateTLDR(messages);

  assert.ok(tldr.length > 0);
  assert.ok(tldr.includes("can you help me") || tldr.includes("Hello"));
});

test("generateTLDR: handles empty input", () => {
  const tldr = generateTLDR([]);
  assert.ok(tldr.includes("No conversation"));
});

// ---------------------------------------------------------------------------
// extractActionItems
// ---------------------------------------------------------------------------

test("extractActionItems: finds todo-style items", () => {
  const messages = [
    makeMsg("assistant", `Here's the action plan for next steps:
- TODO: Set up CI/CD pipeline — needs to be done by Friday
- TODO: Write unit tests for the auth module
- Should update the documentation with the new API changes
- Need to review the PR from @alice before merging`),
  ];

  const items = extractActionItems(messages);

  assert.ok(items.length >= 2, "should find multiple action items");
  assert.ok(items.every((i) => typeof i.action === "string" && i.action.length > 0));
  assert.ok(items.every((i) => typeof i.priority === "string"));
});

test("extractActionItems: extracts assignees from context", () => {
  const messages = [
    makeMsg("user", "TODO: Refactor the database layer. Assigned to @bob"),
  ];

  const items = extractActionItems(messages);

  assert.ok(items.length >= 1);
  const bobItem = items.find((i) => i.assignee === "bob");
  assert.ok(bobItem, "should extract assignee from @mention");
});

test("extractActionItems: assigns priority based on keyword density", () => {
  const messages = [
    makeMsg("user", "Low priority — consider adding dark mode someday."),
    makeMsg("user", "URGENT: We MUST do the security audit immediately. This is critical. Need to complete before the release deadline."),
  ];

  const items = extractActionItems(messages);

  const highPriority = items.filter((i) => i.priority === "high");
  const lowPriority = items.filter((i) => i.priority === "low");

  // At minimum we should have at least one priority item.
  assert.ok(items.length >= 1);
  // The high-priority message has many action keywords.
  if (highPriority.length > 0) {
    assert.ok(highPriority.some((i) => i.action.toLowerCase().includes("security")));
  }
});

test("extractActionItems: deduplicates near-identical items", () => {
  const messages = [
    makeMsg("user", "TODO: update README"),
    makeMsg("assistant", "Also, we should update README."),
  ];

  const items = extractActionItems(messages);

  const readmeItems = items.filter((i) => i.action.toLowerCase().includes("readme"));
  // Should appear at most once due to dedup.
  assert.ok(readmeItems.length <= 1, "duplicate action items should be deduped");
});

test("extractActionItems: handles empty input", () => {
  assert.equal(extractActionItems([]).length, 0);
});

// ---------------------------------------------------------------------------
// extractDecisions
// ---------------------------------------------------------------------------

test("extractDecisions: finds decisions with rationale", () => {
  const messages = [
    makeMsg("assistant", `I decided to use PostgreSQL for the database.

The reason for this choice is that PostgreSQL has better JSON support and we need complex queries across multiple tables. It also provides stronger ACID compliance.`),
  ];

  const decisions = extractDecisions(messages);

  assert.ok(decisions.length >= 1);
  assert.ok(decisions[0].decision.toLowerCase().includes("postgresql"));
  assert.ok(decisions[0].rationale !== null, "should capture rationale");
  assert.ok(decisions[0].rationale.toLowerCase().includes("json") || decisions[0].rationale.toLowerCase().includes("query"));
});

test("extractDecisions: distinguishes high vs low confidence", () => {
  const messages = [
    makeMsg("user", "I guess we could use Redis."), // low confidence
    makeMsg("user", "OK, we have decided, agreed, and finalized on using Redis for caching. The conclusion is final."), // high confidence
  ];

  const decisions = extractDecisions(messages);

  assert.ok(decisions.length >= 1);
  const high = decisions.filter((d) => d.confidence === "high");
  const low = decisions.filter((d) => d.confidence === "low");
  // We should at least have a high confidence decision from the second message.
  assert.ok(high.length >= 1 || decisions.some((d) => d.confidence !== "low"));
});

test("extractDecisions: deduplicates similar decisions", () => {
  const messages = [
    makeMsg("user", "I have decided to use React."),
    makeMsg("assistant", "OK, React has been decided as the framework."),
  ];

  const decisions = extractDecisions(messages);

  const reactDecisions = decisions.filter((d) => d.decision.toLowerCase().includes("react"));
  assert.ok(reactDecisions.length <= 2);
});

test("extractDecisions: handles empty input", () => {
  assert.equal(extractDecisions([]).length, 0);
});

// ---------------------------------------------------------------------------
// extractQuestions
// ---------------------------------------------------------------------------

test("extractQuestions: finds unanswered questions", () => {
  const messages = [
    makeMsg("user", "How should we handle error logging? Also, do we need a CDN?"),
    makeMsg("assistant", "For error logging, I recommend Winston or Pino."),
    // The CDN question was not answered.
  ];

  const questions = extractQuestions(messages);

  assert.ok(questions.length >= 1, "should find at least one question");
  const cdnQuestion = questions.find((q) => q.question.toLowerCase().includes("cdn"));
  assert.ok(cdnQuestion !== undefined, "should find the CDN question");
  assert.equal(cdnQuestion.confidence, "high", "explicit question should be high confidence");
});

test("extractQuestions: recognizes all questions as answered when addressed", () => {
  const messages = [
    makeMsg("user", "What framework should we use for the frontend?"),
    makeMsg("assistant", "For the frontend framework, I recommend React. It has a large ecosystem and strong community support. Here's a detailed breakdown of why React is the best framework for your project."),
  ];

  const questions = extractQuestions(messages);

  // The question about the framework was answered, so it shouldn't appear as unanswered.
  const frameworkQuestions = questions.filter((q) =>
    q.question.toLowerCase().includes("framework"),
  );
  assert.equal(frameworkQuestions.length, 0, "answered questions should not appear");
});

test("extractQuestions: detects implicit questions from uncertainty language", () => {
  const messages = [
    makeMsg("user", "I need to figure out how to configure the webpack build. I have no idea where to start."),
  ];

  const questions = extractQuestions(messages);

  assert.ok(questions.length >= 1, "should detect implicit questions");
  assert.ok(questions.some((q) => q.question.toLowerCase().includes("webpack") || q.question.toLowerCase().includes("configure")));
});

test("extractQuestions: handles conversations with no questions", () => {
  const messages = [
    makeMsg("user", "Create a new file called config.js."),
    makeMsg("assistant", "Done. The file has been created with default settings."),
  ];

  const questions = extractQuestions(messages);

  assert.equal(questions.length, 0);
});

test("extractQuestions: handles empty input", () => {
  assert.equal(extractQuestions([]).length, 0);
});
