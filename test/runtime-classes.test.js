/**
 * Runtime classes edge-case tests: AgentDefinition, TaskList,
 * CommandRegistry, RuntimeComposition, Message factory functions.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  AgentDefinition,
  AgentStatus,
  createAgent,
  createAgentDescriptor,
} = require("../src/runtime/agents");

const {
  TaskList,
  TaskStatus,
  createTask,
  createTaskList,
} = require("../src/runtime/tasks");

const {
  CommandRegistry,
  createCommand,
  createCommandRegistry,
} = require("../src/runtime/command-registry");

const {
  RuntimeComposition,
  createRuntimeComposition,
} = require("../src/runtime/composition");

const {
  MessageRole,
  createMessage,
  createSystemMessage,
  createUserMessage,
  createAssistantMessage,
  createToolMessage,
} = require("../src/runtime/messages");

const { Session, createSession } = require("../src/runtime/sessions");

// ── AgentDefinition ──────────────────────────────────────

test("AgentDefinition: requires name", () => {
  assert.throws(
    () => new AgentDefinition({ name: "" }),
    { message: /must be a non-empty string/ }
  );
});

test("AgentDefinition: defaults role, goal, tools", () => {
  const agent = new AgentDefinition({ name: "test" });
  assert.equal(agent.role, "");
  assert.equal(agent.goal, "");
  assert.deepEqual(agent.tools, []);
  assert.equal(agent.status, AgentStatus.idle);
});

test("AgentDefinition: canUseTool returns true when no tools specified", () => {
  const agent = new AgentDefinition({ name: "test" });
  assert.equal(agent.canUseTool("any.tool"), true);
});

test("AgentDefinition: canUseTool filters by tool list", () => {
  const agent = new AgentDefinition({
    name: "test",
    tools: ["file.read", "file.write"],
  });
  assert.equal(agent.canUseTool("file.read"), true);
  assert.equal(agent.canUseTool("shell.run"), false);
});

test("AgentDefinition: assign sets status to running", () => {
  const agent = new AgentDefinition({ name: "test" });
  const assignment = agent.assign("task-1");
  assert.equal(agent.status, AgentStatus.running);
  assert.equal(assignment.agent, "test");
  assert.equal(assignment.taskId, "task-1");
  assert.equal(assignment.status, AgentStatus.running);
});

test("AgentDefinition: release resets to idle", () => {
  const agent = new AgentDefinition({ name: "test" });
  agent.assign("task-1");
  const snapshot = agent.release(AgentStatus.idle);
  assert.equal(agent.status, AgentStatus.idle);
  assert.equal(snapshot.status, AgentStatus.idle);
});

test("AgentDefinition: release with blocked status", () => {
  const agent = new AgentDefinition({ name: "test" });
  const snapshot = agent.release(AgentStatus.blocked);
  assert.equal(agent.status, AgentStatus.blocked);
  assert.equal(snapshot.status, AgentStatus.blocked);
});

test("AgentDefinition: release requires valid status", () => {
  const agent = new AgentDefinition({ name: "test" });
  assert.throws(
    () => agent.release("invalid_status"),
    { message: /must be one of/ }
  );
});

test("AgentDefinition: snapshot is frozen", () => {
  const agent = new AgentDefinition({ name: "test", role: "tester" });
  const snap = agent.snapshot();
  assert.throws(() => (snap.name = "changed"));
});

test("createAgent: returns AgentDefinition instance", () => {
  const agent = createAgent({ name: "test" });
  assert.ok(agent instanceof AgentDefinition);
});

test("createAgentDescriptor: returns frozen snapshot", () => {
  const desc = createAgentDescriptor({ name: "test", role: "tester" });
  assert.equal(desc.name, "test");
  assert.equal(desc.role, "tester");
  assert.throws(() => (desc.name = "changed"));
});

// ── TaskList ─────────────────────────────────────────────

test("TaskList: requires task id", () => {
  assert.throws(() => createTask({}), { message: /must be a non-empty string/ });
});

test("TaskList: rejects invalid status", () => {
  assert.throws(
    () => createTask({ id: "T1", status: "unknown" }),
    { message: /must be one of/ }
  );
});

test("TaskList: defaults for missing fields", () => {
  const task = createTask({ id: "T1" });
  assert.equal(task.title, "");
  assert.equal(task.owner, null);
  assert.equal(task.status, TaskStatus.pending);
  assert.equal(task.parallel, true);
  assert.deepEqual(task.dependsOn, []);
  assert.equal(task.deliverable, "");
});

test("TaskList: add throws on duplicate id", () => {
  const list = new TaskList();
  list.add({ id: "T1" });
  assert.throws(() => list.add({ id: "T1" }), {
    message: /Duplicate task/,
  });
});

test("TaskList: get returns null for unknown", () => {
  const list = new TaskList();
  assert.equal(list.get("unknown"), null);
});

test("TaskList: update throws for unknown", () => {
  const list = new TaskList();
  assert.throws(() => list.update("unknown", { title: "New" }), {
    message: /Unknown task/,
  });
});

test("TaskList: update returns new frozen task", () => {
  const list = new TaskList([{ id: "T1", title: "Old" }]);
  const updated = list.update("T1", { title: "New" });
  assert.equal(updated.title, "New");
  assert.throws(() => (updated.title = "mutable"));
});

test("TaskList: ready filters by status and deps", () => {
  const list = new TaskList([
    { id: "T1", title: "A" },
    { id: "T2", title: "B", dependsOn: ["T1"] },
    { id: "T3", title: "C", status: TaskStatus.completed },
    { id: "T4", title: "D", status: TaskStatus.failed },
  ]);
  const ready = list.ready();
  assert.deepEqual(ready.map((t) => t.id), ["T1"]);
});

test("TaskList: ready when all deps completed", () => {
  const list = new TaskList([
    { id: "T1", title: "A", status: TaskStatus.completed },
    { id: "T2", title: "B", dependsOn: ["T1"] },
  ]);
  const ready = list.ready();
  assert.deepEqual(ready.map((t) => t.id), ["T2"]);
});

test("TaskList: blocked tasks not in ready", () => {
  const list = new TaskList([
    { id: "T1", title: "A", status: TaskStatus.blocked },
    { id: "T2", title: "B", dependsOn: ["T1"] },
  ]);
  const ready = list.ready();
  assert.deepEqual(ready, []);
});

test("TaskList: non-existent dep blocks task", () => {
  const list = new TaskList([
    { id: "T2", title: "B", dependsOn: ["non-existent"] },
  ]);
  const ready = list.ready();
  assert.deepEqual(ready, []);
});

// ── CommandRegistry ──────────────────────────────────────

test("CommandRegistry: register requires name", () => {
  assert.throws(
    () => createCommand({ name: "" }),
    { message: /must be a non-empty string/ }
  );
});

test("CommandRegistry: register requires run function", () => {
  assert.throws(
    () => createCommand({ name: "test" }),
    { message: /run must be a function/ }
  );
});

test("CommandRegistry: defaults description and usage", () => {
  const cmd = createCommand({ name: "test", run: () => {} });
  assert.equal(cmd.description, "");
  assert.equal(cmd.usage, "test");
});

test("CommandRegistry: register throws on duplicate", () => {
  const registry = new CommandRegistry();
  registry.register({ name: "cmd", run: () => {} });
  assert.throws(() => registry.register({ name: "cmd", run: () => {} }), {
    message: /Duplicate command/,
  });
});

test("CommandRegistry: get returns null for unknown", () => {
  const registry = new CommandRegistry();
  assert.equal(registry.get("unknown"), null);
});

test("CommandRegistry: list returns all commands", () => {
  const registry = new CommandRegistry([
    { name: "a", run: () => {} },
    { name: "b", run: () => {} },
  ]);
  assert.equal(registry.list().length, 2);
});

test("CommandRegistry: run throws for unknown command", async () => {
  const registry = new CommandRegistry();
  await assert.rejects(
    () => registry.run("unknown"),
    { message: /Unknown command/ }
  );
});

test("CommandRegistry: run executes command with context", async () => {
  const ctx = {};
  const registry = new CommandRegistry([
    {
      name: "greet",
      run: async (c) => `hello ${c.name}`,
    },
  ]);
  const result = await registry.run("greet", { name: "world" });
  assert.equal(result, "hello world");
});

test("createCommandRegistry: creates from array", () => {
  const registry = createCommandRegistry([
    { name: "cmd", run: () => {} },
  ]);
  assert.equal(registry.list().length, 1);
});

// ── RuntimeComposition ───────────────────────────────────

test("RuntimeComposition: initializes with defaults", () => {
  const comp = new RuntimeComposition();
  assert.ok(comp.commands instanceof CommandRegistry);
  assert.ok(comp.session instanceof Session);
  assert.equal(comp.session.messages.length, 0);
});

test("RuntimeComposition: registerProvider requires name", () => {
  const comp = new RuntimeComposition();
  assert.throws(
    () => comp.registerProvider("", {}),
    { message: /must be a non-empty string/ }
  );
});

test("RuntimeComposition: registerProvider stores provider", () => {
  const comp = new RuntimeComposition();
  const provider = { name: "mock" };
  comp.registerProvider("mock", provider);
  assert.equal(comp.providers.get("mock"), provider);
});

test("RuntimeComposition: registerTool stores tool", () => {
  const comp = new RuntimeComposition();
  const tool = { name: "test", execute: () => {} };
  comp.registerTool("test.tool", tool);
  assert.equal(comp.tools.get("test.tool"), tool);
});

test("RuntimeComposition: registerAgent stores agent", () => {
  const comp = new RuntimeComposition();
  const agent = new AgentDefinition({ name: "test" });
  comp.registerAgent("test", agent);
  assert.equal(comp.agents.get("test"), agent);
});

test("RuntimeComposition: snapshot returns frozen view", () => {
  const comp = new RuntimeComposition();
  comp.registerProvider("mock", { name: "mock" });
  comp.registerTool("tool.a", { name: "a" });
  const snap = comp.snapshot();
  assert.deepEqual(snap.providers, ["mock"]);
  assert.deepEqual(snap.tools, ["tool.a"]);
  assert.throws(() => (snap.providers = []));
});

// ── Messages ─────────────────────────────────────────────

test("createMessage: requires role and content", () => {
  assert.throws(() => createMessage({}), {
    message: /must be one of/,
  });
  assert.throws(
    () => createMessage({ role: MessageRole.user }),
    { message: /must be a non-empty string/ }
  );
});

test("createMessage: requires valid role", () => {
  assert.throws(
    () => createMessage({ role: "invalid", content: "hi" }),
    { message: /must be one of/ }
  );
});

test("createSystemMessage: creates system message", () => {
  const msg = createSystemMessage("Hello");
  assert.equal(msg.role, MessageRole.system);
  assert.equal(msg.content, "Hello");
});

test("createUserMessage: creates user message", () => {
  const msg = createUserMessage("Query");
  assert.equal(msg.role, MessageRole.user);
  assert.equal(msg.content, "Query");
});

test("createAssistantMessage: creates assistant message", () => {
  const msg = createAssistantMessage("Response");
  assert.equal(msg.role, MessageRole.assistant);
  assert.equal(msg.content, "Response");
});

test("createToolMessage: requires name", () => {
  assert.throws(
    () => createToolMessage("", "result"),
    { message: /must be a non-empty string/ }
  );
});

test("createToolMessage: creates tool message with name", () => {
  const msg = createToolMessage("file.read", "content");
  assert.equal(msg.role, MessageRole.tool);
  assert.equal(msg.name, "file.read");
  assert.equal(msg.content, "content");
});

test("createMessage: generates unique id", () => {
  const m1 = createMessage({ role: MessageRole.user, content: "a" });
  const m2 = createMessage({ role: MessageRole.user, content: "b" });
  assert.notEqual(m1.id, m2.id);
  assert.ok(m1.id.startsWith("msg-"));
});

test("createMessage: is frozen", () => {
  const msg = createMessage({ role: MessageRole.user, content: "hi" });
  assert.throws(() => (msg.content = "changed"));
});

test("createMessage: rejects invalid date", () => {
  assert.throws(
    () =>
      createMessage({
        role: MessageRole.user,
        content: "hi",
        createdAt: "not-a-date",
      }),
    { message: /must be a valid date/ }
  );
});

// ── Runtime Session ──────────────────────────────────────

test("runtime Session: addMessage requires role and content string", () => {
  const session = new Session();
  assert.throws(
    () => session.addMessage({}),
    { message: /requires role and content/ }
  );
});

test("runtime Session: addMessage returns the message", () => {
  const session = new Session();
  const msg = session.addMessage({ role: "user", content: "hello" });
  assert.equal(msg.role, "user");
  assert.equal(msg.content, "hello");
});

test("runtime Session: getTranscript joins messages", () => {
  const session = new Session();
  session.addMessage({ role: "user", content: "hello" });
  session.addMessage({ role: "assistant", content: "hi" });
  const transcript = session.getTranscript();
  assert.equal(transcript, "user: hello\nassistant: hi");
});

test("runtime Session: snapshot is independent frozen copy", () => {
  const session = new Session({ cwd: "/test" });
  session.addMessage({ role: "user", content: "hello" });
  const snap = session.snapshot();
  assert.equal(snap.cwd, "/test");
  assert.equal(snap.messages.length, 1);
  // Mutating original does not affect snapshot
  session.addMessage({ role: "assistant", content: "hi" });
  assert.equal(snap.messages.length, 1);
  assert.throws(() => (snap.cwd = "changed"));
});

test("runtime Session: cwd defaults to process.cwd", () => {
  const session = new Session();
  assert.equal(session.cwd, process.cwd());
});

test("runtime Session: touch updates updatedAt", async () => {
  const session = new Session();
  const original = session.updatedAt;
  // Wait a tick
  await new Promise((resolve) => setTimeout(resolve, 10));
  session.touch();
  assert.notEqual(session.updatedAt, original);
});

test("createSession: returns Session instance", () => {
  const session = createSession({ cwd: "/test" });
  assert.ok(session instanceof Session);
  assert.equal(session.cwd, "/test");
});
