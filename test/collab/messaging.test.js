"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  AgentMailbox,
  MessageThread,
  PRIORITY_LEVELS,
} = require("../../src/collab/messaging");

// ---- Registration ----

test("AgentMailbox: registerAgent adds an inbox", () => {
  const mailbox = new AgentMailbox();
  mailbox.registerAgent("architect");
  mailbox.registerAgent("reviewer");

  assert.deepEqual(mailbox.agents.sort(), ["architect", "reviewer"]);
});

test("AgentMailbox: registerAgent is idempotent", () => {
  const mailbox = new AgentMailbox();
  mailbox.registerAgent("architect");
  mailbox.registerAgent("architect");
  mailbox.registerAgent("architect");

  assert.equal(mailbox.agents.length, 1);
});

test("AgentMailbox: registerAgent throws on empty agentId", () => {
  const mailbox = new AgentMailbox();

  assert.throws(() => mailbox.registerAgent(""), {
    message: /non-empty string/,
  });
});

// ---- Send ----

test("AgentMailbox: send delivers a message from one agent to another", () => {
  const mailbox = new AgentMailbox();
  mailbox.registerAgent("architect");
  mailbox.registerAgent("reviewer");

  const message = mailbox.send("architect", "reviewer", {
    subject: "Code review",
    body: "Please review PR #42.",
    priority: "high",
  });

  assert.ok(message.id.startsWith("msg-"));
  assert.equal(message.from, "architect");
  assert.equal(message.to, "reviewer");
  assert.equal(message.subject, "Code review");
  assert.equal(message.body, "Please review PR #42.");
  assert.equal(message.priority, "high");
  assert.equal(message.read, null);
  assert.ok(message.timestamp);
});

test("AgentMailbox: send accepts a plain string body", () => {
  const mailbox = new AgentMailbox();
  mailbox.registerAgent("alice");
  mailbox.registerAgent("bob");

  const message = mailbox.send("alice", "bob", "Hello Bob!");

  assert.equal(message.body, "Hello Bob!");
  assert.equal(message.subject, "");
  assert.equal(message.priority, "normal");
});

// ---- Broadcast ----

test("AgentMailbox: broadcast sends to all registered agents except sender", () => {
  const mailbox = new AgentMailbox();
  mailbox.registerAgent("lead");
  mailbox.registerAgent("architect");
  mailbox.registerAgent("reviewer");

  const results = mailbox.broadcast("lead", { subject: "Meeting", body: "Standup at 10am" });

  assert.equal(results.length, 2);
  const recipients = results.map((m) => m.to).sort();
  assert.deepEqual(recipients, ["architect", "reviewer"]);

  // Sender should NOT have received the broadcast
  const leadInbox = mailbox.inbox("lead");
  assert.equal(leadInbox.length, 0);
});

test("AgentMailbox: broadcast excludes specified agents", () => {
  const mailbox = new AgentMailbox();
  mailbox.registerAgent("lead");
  mailbox.registerAgent("alice");
  mailbox.registerAgent("bob");
  mailbox.registerAgent("carol");

  const results = mailbox.broadcast("lead", "Team update", ["bob"]);

  const recipients = results.map((m) => m.to).sort();
  assert.deepEqual(recipients, ["alice", "carol"]);
});

// ---- Inbox ----

test("AgentMailbox: inbox returns messages sorted by newest first", () => {
  const mailbox = new AgentMailbox();
  mailbox.registerAgent("alice");
  mailbox.registerAgent("bob");

  mailbox.send("bob", "alice", "First message");
  mailbox.send("bob", "alice", "Second message");

  const inbox = mailbox.inbox("alice");
  assert.equal(inbox.length, 2);
  // Most recent first
  assert.equal(inbox[0].body, "Second message");
  assert.equal(inbox[1].body, "First message");
});

test("AgentMailbox: inbox returns empty array for unknown agent", () => {
  const mailbox = new AgentMailbox();
  assert.deepEqual(mailbox.inbox("ghost"), []);
});

// ---- Read tracking ----

test("AgentMailbox: markRead marks a specific message as read", () => {
  const mailbox = new AgentMailbox();
  mailbox.registerAgent("alice");
  mailbox.registerAgent("bob");

  const sent = mailbox.send("bob", "alice", "Hello");

  assert.equal(mailbox.getUnreadCount("alice"), 1);

  const updated = mailbox.markRead("alice", sent.id);
  assert.ok(updated.read);
  assert.equal(mailbox.getUnreadCount("alice"), 0);
});

test("AgentMailbox: markRead returns null for unknown message", () => {
  const mailbox = new AgentMailbox();
  mailbox.registerAgent("alice");

  const result = mailbox.markRead("alice", "nonexistent");
  assert.equal(result, null);
});

test("AgentMailbox: markAllRead marks all messages for an agent", () => {
  const mailbox = new AgentMailbox();
  mailbox.registerAgent("alice");
  mailbox.registerAgent("bob");
  mailbox.registerAgent("carol");

  mailbox.send("bob", "alice", "One");
  mailbox.send("carol", "alice", "Two");
  mailbox.send("carol", "alice", "Three");

  assert.equal(mailbox.getUnreadCount("alice"), 3);

  const marked = mailbox.markAllRead("alice");
  assert.equal(marked, 3);
  assert.equal(mailbox.getUnreadCount("alice"), 0);
});

// ---- Reply and threads ----

test("AgentMailbox: reply creates a threaded response and returns the message", () => {
  const mailbox = new AgentMailbox();
  mailbox.registerAgent("alice");
  mailbox.registerAgent("bob");

  const original = mailbox.send("alice", "bob", "Can you review this?");

  const reply = mailbox.reply("bob", original.id, "Sure, I will look at it.");

  assert.equal(reply.from, "bob");
  assert.equal(reply.to, "alice");
  assert.equal(reply.threadId, original.id);
  assert.equal(reply.body, "Sure, I will look at it.");

  // Original still in bob's inbox, reply in alice's inbox
  assert.equal(mailbox.inbox("bob").length, 1);
  assert.equal(mailbox.inbox("alice").length, 1);
});

test("AgentMailbox: reply to a reply continues the thread", () => {
  const mailbox = new AgentMailbox();
  mailbox.registerAgent("alice");
  mailbox.registerAgent("bob");

  const msg1 = mailbox.send("alice", "bob", "Initial question");
  const msg2 = mailbox.reply("bob", msg1.id, "First answer");
  const msg3 = mailbox.reply("alice", msg2.id, "Thanks!");

  assert.equal(msg3.threadId, msg1.id);

  const thread = mailbox.getThread(msg1.id);
  assert.equal(thread.length, 3);
  assert.equal(thread.rootMessage.id, msg1.id);
  assert.equal(thread.latestMessage.id, msg3.id);
});

test("AgentMailbox: reply throws for unknown message", () => {
  const mailbox = new AgentMailbox();
  mailbox.registerAgent("alice");

  assert.throws(() => mailbox.reply("alice", "nonexistent", "Reply"), {
    message: /Unknown message/,
  });
});

// ---- Threads ----

test("AgentMailbox: getThread returns null for unknown thread", () => {
  const mailbox = new AgentMailbox();
  assert.equal(mailbox.getThread("nonexistent"), null);
});

test("AgentMailbox: getAllThreads returns all threads", () => {
  const mailbox = new AgentMailbox();
  mailbox.registerAgent("alice");
  mailbox.registerAgent("bob");

  const msg1 = mailbox.send("alice", "bob", "Thread A?");
  mailbox.reply("bob", msg1.id, "Thread A reply");

  const msg2 = mailbox.send("bob", "alice", "Thread B?");
  mailbox.reply("alice", msg2.id, "Thread B reply");

  const threads = mailbox.getAllThreads();
  assert.equal(threads.length, 2);
});

// ---- Query ----

test("AgentMailbox: query filters messages by criteria", () => {
  const mailbox = new AgentMailbox();
  mailbox.registerAgent("alice");
  mailbox.registerAgent("bob");
  mailbox.registerAgent("carol");

  mailbox.send("alice", "bob", { subject: "Urgent", body: "Fix ASAP", priority: "high" });
  mailbox.send("alice", "carol", { subject: "FYI", body: "Release notes", priority: "low" });
  mailbox.send("bob", "carol", { subject: "Question", body: "Status?", priority: "normal" });

  const highPriority = mailbox.query({ priority: "high" });
  assert.equal(highPriority.length, 1);
  assert.equal(highPriority[0].subject, "Urgent");

  const fromAlice = mailbox.query({ from: "alice" });
  assert.equal(fromAlice.length, 2);

  const toCarol = mailbox.query({ to: "carol" });
  assert.equal(toCarol.length, 2);
});

test("AgentMailbox: query with unreadOnly returns only unread messages", () => {
  const mailbox = new AgentMailbox();
  mailbox.registerAgent("alice");
  mailbox.registerAgent("bob");

  const msg1 = mailbox.send("bob", "alice", "First");
  mailbox.send("bob", "alice", "Second");

  mailbox.markRead("alice", msg1.id);

  const unread = mailbox.query({ unreadOnly: true, to: "alice" });
  assert.equal(unread.length, 1);
  assert.equal(unread[0].body, "Second");
});

// ---- Delete ----

test("AgentMailbox: deleteMessage removes a message from an inbox", () => {
  const mailbox = new AgentMailbox();
  mailbox.registerAgent("alice");
  mailbox.registerAgent("bob");

  const msg = mailbox.send("bob", "alice", "Temporary");
  assert.equal(mailbox.inbox("alice").length, 1);

  const removed = mailbox.deleteMessage("alice", msg.id);
  assert.equal(removed, true);
  assert.equal(mailbox.inbox("alice").length, 0);
});

test("AgentMailbox: deleteMessage returns false for nonexistent message", () => {
  const mailbox = new AgentMailbox();
  mailbox.registerAgent("alice");

  assert.equal(mailbox.deleteMessage("alice", "nonexistent"), false);
});

// ---- Clear ----

test("AgentMailbox: clear removes all messages, threads, and resets sequence", () => {
  const mailbox = new AgentMailbox();
  mailbox.registerAgent("alice");
  mailbox.registerAgent("bob");

  const msg = mailbox.send("alice", "bob", "Thread start");
  mailbox.reply("bob", msg.id, "Reply");

  assert.equal(mailbox.inbox("alice").length, 1);
  assert.equal(mailbox.inbox("bob").length, 1);
  assert.equal(mailbox.getUnreadCount("alice"), 1);
  assert.equal(mailbox.getAllThreads().length, 1);

  mailbox.clear();

  assert.equal(mailbox.agents.length, 0);
  assert.equal(mailbox.inbox("alice").length, 0);
  assert.equal(mailbox.getAllThreads().length, 0);
});

// ---- Default priority ----

test("AgentMailbox: default priority can be configured", () => {
  const mailbox = new AgentMailbox({ defaultPriority: "low" });
  mailbox.registerAgent("alice");
  mailbox.registerAgent("bob");

  const message = mailbox.send("alice", "bob", "Hey");
  assert.equal(message.priority, "low");
});

// ---- MessageThread ----

test("MessageThread: tracks thread ID, messages, and root/latest accessors", () => {
  const thread = new MessageThread("thread-1");

  assert.equal(thread.threadId, "thread-1");
  assert.equal(thread.length, 0);
  assert.equal(thread.rootMessage, null);
  assert.equal(thread.latestMessage, null);

  thread._addMessage({ id: "msg-1", body: "First" });
  thread._addMessage({ id: "msg-2", body: "Second" });
  thread._addMessage({ id: "msg-3", body: "Third" });

  assert.equal(thread.length, 3);
  assert.equal(thread.rootMessage.body, "First");
  assert.equal(thread.latestMessage.body, "Third");

  // messages returns a cloned copy
  const msgs = thread.messages;
  assert.equal(msgs.length, 3);
  msgs.pop();
  // Original should be unaffected
  assert.equal(thread.messages.length, 3);
});
