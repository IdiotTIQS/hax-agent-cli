/**
 * ui-preview.tsx — Task 2 + Task 3 preview harness.
 *
 * Task 2: Renders StatusBar in multiple states (normal/yolo/plan, various
 * context usage levels) plus a CJK sample row.
 *
 * Task 3: Renders ToolList with running/done/error tools, same-name collapse,
 * and a diff-bearing tool in both detail=false and detail=true modes.
 *
 * Unmounts after 3 s.
 *
 * Run: npx tsx src/tui-ink/ui-preview.tsx
 */
import React from "react";
import { render, Box, Text } from "ink";
import { StatusBar } from "./components/StatusBar.js";
import { ToolList } from "./components/ToolList.js";
import type { ToolCallState } from "./types.js";

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
    </Box>
  );
}

const { unmount } = render(<Preview />);
setTimeout(() => unmount(), 3000);
