/**
 * ui-preview.tsx — Task 2 + Task 3 + Task 5 preview harness.
 *
 * Task 2: Renders StatusBar in multiple states (normal/yolo/plan, various
 * context usage levels) plus a CJK sample row.
 *
 * Task 3: Renders ToolList with running/done/error tools, same-name collapse,
 * and a diff-bearing tool in both detail=false and detail=true modes.
 *
 * Task 5: Renders ConversationTurn with mock committed turns including
 * tools, CJK text, interrupted flag, and error state.
 *
 * Task 6: Renders CommandPalette with a mock "/" query and command/skill names.
 *
 * Unmounts after 3 s.
 *
 * Run: npx tsx src/tui-ink/ui-preview.tsx
 */
import React from "react";
import { render, Box, Text } from "ink";
import { StatusBar } from "./components/StatusBar.js";
import { ToolList } from "./components/ToolList.js";
import { ConversationTurn } from "./components/ConversationTurn.js";
import { CommandPalette } from "./components/CommandPalette.js";
import type { ToolCallState, CommittedTurn } from "./types.js";

// ---------------------------------------------------------------------------
// Mock tool data
// ---------------------------------------------------------------------------

const mockTools: ToolCallState[] = [
  {
    name: "file.read",
    input: { path: "src/index.ts" },
    status: "done",
    durationMs: 12,
    data: { path: "src/index.ts", bytes: 2048 },
  },
  {
    name: "file.read",
    input: { path: "src/cli.ts" },
    status: "done",
    durationMs: 8,
    data: { path: "src/cli.ts", bytes: 1024 },
  },
  {
    name: "file.read",
    input: { path: "src/renderer.ts" },
    status: "done",
    durationMs: 9,
    data: { path: "src/renderer.ts", bytes: 3072 },
  },
  {
    name: "shell.run",
    input: { command: "npm", args: ["test"] },
    status: "running",
  },
  {
    name: "file.write",
    input: { path: "src/output.ts" },
    status: "error",
    error: { message: "Permission denied", code: "EACCES" },
    durationMs: 5,
  },
];

// A file.edit tool with actual diff data
const diffTool: ToolCallState = {
  name: "file.edit",
  input: { path: "src/example.ts", old_string: "foo", new_string: "bar" },
  status: "done",
  durationMs: 21,
  data: {
    path: "src/example.ts",
    diff: "- const foo = 1;\n+ const bar = 1;\n  \n- export { foo };\n+ export { bar };",
    changed: true,
    oldLines: 2,
    newLines: 2,
  },
};

// ---------------------------------------------------------------------------
// Mock CommittedTurn data (Task 5)
// ---------------------------------------------------------------------------

const turnNormal: CommittedTurn = {
  userText: "请帮我读取并解释 src/cli.ts 文件",
  assistantText: "好的，我来读取 `src/cli.ts` 文件并解释其结构。\n\n该文件是 HaxAgent 的 CLI 入口，负责解析参数和启动交互循环。",
  thinking: "",
  tools: [
    {
      name: "file.read",
      input: { path: "src/cli.ts" },
      status: "done",
      durationMs: 14,
      data: { path: "src/cli.ts", bytes: 8192 },
    },
  ],
  interrupted: false,
  error: null,
};

const turnWithThinking: CommittedTurn = {
  userText: "What is 2 + 2?",
  assistantText: "2 + 2 = 4.",
  thinking: "The user is asking a simple arithmetic question. The answer is 4.",
  tools: [],
  interrupted: false,
  error: null,
};

const turnInterrupted: CommittedTurn = {
  userText: "Run a long computation",
  assistantText: "Starting the computation…",
  thinking: "",
  tools: [
    {
      name: "shell.run",
      input: { command: "node", args: ["heavy-script.js"] },
      status: "running",
    },
  ],
  interrupted: true,
  error: null,
};

const turnError: CommittedTurn = {
  userText: "Write to /etc/passwd",
  assistantText: "",
  thinking: "",
  tools: [],
  interrupted: false,
  error: "PERMISSION_DENIED: cannot write to /etc/passwd",
};

// ---------------------------------------------------------------------------
// Preview component
// ---------------------------------------------------------------------------

function Preview(): React.ReactElement {
  return (
    <Box flexDirection="column" gap={1}>
      {/* ── Task 2: StatusBar ─────────────────────────────────────── */}
      <Text>{"— StatusBar —"}</Text>
      <StatusBar
        model="claude-sonnet-4-6"
        mode="normal"
        inputTokens={1200}
        outputTokens={600}
        cost={0.0042}
        turnCount={3}
      />
      <StatusBar
        model="claude-opus-4-8"
        mode="yolo"
        inputTokens={150000}
        outputTokens={30000}
        cost={0.21}
        turnCount={12}
      />
      <Text>{"— 中文样例(CJK 对齐目测) —"}</Text>
      <StatusBar
        model="深度模型 4"
        mode="plan"
        inputTokens={5000}
        outputTokens={2000}
        cost={0}
      />

      {/* ── Task 3: ToolList (collapse mode, detail=false) ─────────── */}
      <Text>{"— ToolList: collapse mode (detail=false) —"}</Text>
      <Text dimColor>{"  3× file.read → collapses to ✓ Read ×3"}</Text>
      <ToolList tools={mockTools} detail={false} />

      {/* ── Task 3: ToolList (detail=true) ─────────────────────────── */}
      <Text>{"— ToolList: detail mode (detail=true) —"}</Text>
      <Text dimColor>{"  same tools, no collapse"}</Text>
      <ToolList tools={mockTools} detail />

      {/* ── Task 3: DiffView via detail=false ──────────────────────── */}
      <Text>{"— file.edit with diff (detail=false, no DiffView) —"}</Text>
      <ToolList tools={[diffTool]} detail={false} />

      {/* ── Task 3: DiffView via detail=true ───────────────────────── */}
      <Text>{"— file.edit with diff (detail=true, DiffView shown) —"}</Text>
      <ToolList tools={[diffTool]} detail />

      {/* ── Task 5: ConversationTurn samples ──────────────────────── */}
      <Text>{"— ConversationTurn: normal turn with CJK + tool —"}</Text>
      <ConversationTurn turn={turnNormal} detail={false} />

      <Text>{"— ConversationTurn: turn with thinking block —"}</Text>
      <ConversationTurn turn={turnWithThinking} detail={false} />

      <Text>{"— ConversationTurn: interrupted turn —"}</Text>
      <ConversationTurn turn={turnInterrupted} detail={false} />

      <Text>{"— ConversationTurn: error turn —"}</Text>
      <ConversationTurn turn={turnError} detail={false} />

      <Text>{"— ConversationTurn: normal turn in detail mode —"}</Text>
      <ConversationTurn turn={turnNormal} detail />

      {/* ── Task 6: CommandPalette samples ────────────────────────── */}
      <Text>{"— CommandPalette: query='/' (all commands) —"}</Text>
      <CommandPalette
        query="/"
        commandNames={["help", "clear", "model", "provider", "skills", "goal", "yolo", "plan", "perms", "cost", "export", "history"]}
        skillNames={["deep-research", "code-review", "simplify", "verify"]}
        onPick={(v) => process.stdout.write("picked: " + v + "\n")}
        onClose={() => process.stdout.write("palette closed\n")}
      />
      <Text>{"— CommandPalette: query='/mo' (filtered) —"}</Text>
      <CommandPalette
        query="/mo"
        commandNames={["help", "clear", "model", "provider", "skills", "goal", "yolo", "plan", "perms", "cost", "export", "history"]}
        skillNames={["deep-research", "code-review", "simplify", "verify"]}
        onPick={(v) => process.stdout.write("picked: " + v + "\n")}
        onClose={() => process.stdout.write("palette closed\n")}
      />
      <Text>{"— CommandPalette: query='/zzz' (no match → hidden) —"}</Text>
      <CommandPalette
        query="/zzz"
        commandNames={["help", "clear", "model"]}
        skillNames={[]}
        onPick={(v) => process.stdout.write("picked: " + v + "\n")}
        onClose={() => process.stdout.write("palette closed\n")}
      />
    </Box>
  );
}

const { unmount } = render(<Preview />);
setTimeout(() => unmount(), 3000);
