# ink TUI UX 提升 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已完成的 ink 迁移底座上,把 TUI 从"功能对等"提升为现代体验:固定三段式布局 + Static 提交历史、工具折叠、菜单审批、命令面板、富状态栏,全部用原生 ink 元素(CJK 对齐)。

**Architecture:** A+C 融合——在现有 `src/tui-ink/` 原地演进,复用 F1 类型契约 + F5 引擎接线/审批桥;先建 `src/tui-ink/ui/` 原语层(useTerminalSize/Separator/Select),其上重构组件。`--ink` 全程可跑,`--legacy` readline 始终保留。

**Tech Stack:** TypeScript (strict, NodeNext ESM), React 19, ink 7, ink-text-input 6, node:test。

**Spec:** `docs/superpowers/specs/2026-06-30-ink-tui-ux-redesign-design.md`
**参考:** `E:\claude-code-main`(逆向 Claude Code,只读参考)

## Global Constraints

- 语言/模块:TypeScript strict、ESM NodeNext、相对 import 必带 `.js` 后缀。
- 门禁(每个 task 必须满足):`npx tsc --noEmit` → 0;`npx tsc -p tsconfig.build.json --noEmit` → 0;`node scripts/run-tests.js` → 全过 0 fail;构建后 `node dist/cli.js --version` → `hax-agent v1.6.0`;`--legacy` 路径不破坏。
- 环境:Windows,所有 npx/node 命令在 `E:\HaxAgent` 运行,**绝不 cd 到该目录外**(会破坏 npx)。删文件用 `git rm`。
- 新组件全部**原生 ink**(`<Box>`/`<Text color>`),不引入新的 ANSI-passthrough。可保留对现有 renderer.ts 导出的纯格式化函数的复用(toToolLabel/formatDuration/formatBytes 等)用于取文本,但渲染走原生元素。
- 不做(超范围):自实现 scrollback viewport、全屏 alt-screen、vim、fork ink、异步大文件 diff 扫描、multi-select、TreeSelect 分组、fuzzy(保持前缀匹配)。
- 保留 F4/F5 审批桥的正确性:`setImmediate` 延迟 resolve、一次性 `resolvedRef` 守卫、`wrappedResolve` 同时 resolve 引擎 Promise 并 dispatch `set_approval(null)`。
- 测试文件加入 `scripts/run-tests.js` 的硬编码列表才会被运行。
- 真实交互(键盘/审批/流式/resize/CJK 目测)无法自动测——每个相关 task 产出 preview harness,最终汇总人工 TTY 测试清单。
- 提交信息前缀 `feat(ink-ux Tn): ...` / `refactor(ink-ux Tn): ...`。

## File Structure

新增:
- `src/tui-ink/ui/useTerminalSize.ts` — 终端尺寸 hook
- `src/tui-ink/ui/Separator.tsx` — 状态栏分隔符
- `src/tui-ink/ui/Select.tsx` — 单选菜单原语
- `src/tui-ink/ui/select-state.ts` — Select 的纯导航逻辑(可单测)
- `src/tui-ink/ui/index.ts` — ui 原语 barrel
- `src/tui-ink/components/DiffView.tsx` — 原生 diff 渲染
- `src/tui-ink/components/ConversationTurn.tsx` — 已完成轮次快照渲染
- `src/tui-ink/components/CommandPalette.tsx` — 斜杠命令面板
- `src/tui-ink/ui-preview.tsx` — ui 原语 + 新组件预览 harness
- `test/tui-ink-select-state.test.ts`、`test/tui-ink-reducer-redesign.test.ts`

修改:
- `src/tui-ink/types.ts` — AppState 加 committedTurns/detailMode/commandPalette;新 actions;CommittedTurn 类型
- `src/tui-ink/reducer.ts` — commit_turn/toggle_detail/palette 处理;turn.completed 改为推 committedTurns
- `src/tui-ink/components/StatusBar.tsx` — 重写为富状态栏(原生 + Separator + useTerminalSize + context 进度条)
- `src/tui-ink/components/ToolCall.tsx` — 原生化 + detailMode 感知
- `src/tui-ink/components/ToolList.tsx` — 同名折叠
- `src/tui-ink/components/ApprovalPrompt.tsx` — 改用 Select(保留审批桥)
- `src/tui-ink/keybindings.tsx` — 加 Ctrl+R
- `src/tui-ink/App.tsx` — 三段式 + Static + 接线新 state
- `scripts/run-tests.js` — 加新测试文件

---

## Task 1: UI 原语层(useTerminalSize / Separator / Select + 纯导航逻辑)

**Files:**
- Create: `src/tui-ink/ui/select-state.ts`
- Create: `src/tui-ink/ui/useTerminalSize.ts`
- Create: `src/tui-ink/ui/Separator.tsx`
- Create: `src/tui-ink/ui/Select.tsx`
- Create: `src/tui-ink/ui/index.ts`
- Test: `test/tui-ink-select-state.test.ts`
- Modify: `scripts/run-tests.js`

**Interfaces:**
- Produces:
  - `nextIndex(current: number, len: number, dir: 1 | -1): number` — wrap-around 导航(纯函数)
  - `matchHotkey(items: SelectItem[], input: string): number` — 返回首字母 hint 匹配的索引,无匹配返回 -1
  - `interface SelectItem { label: string; value: string; description?: string; hotkey?: string }`
  - `useTerminalSize(): { columns: number; rows: number }`
  - `Separator(): React.ReactElement`
  - `Select(props: { items: SelectItem[]; onSelect: (value: string) => void; isFocused?: boolean; initialIndex?: number }): React.ReactElement`

- [ ] **Step 1: 写失败测试 `test/tui-ink-select-state.test.ts`**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { nextIndex, matchHotkey, type SelectItem } from "../src/tui-ink/ui/select-state.js";

test("nextIndex wraps forward", () => {
  assert.equal(nextIndex(0, 3, 1), 1);
  assert.equal(nextIndex(2, 3, 1), 0); // wrap
});
test("nextIndex wraps backward", () => {
  assert.equal(nextIndex(0, 3, -1), 2); // wrap
  assert.equal(nextIndex(2, 3, -1), 1);
});
test("nextIndex handles empty/single", () => {
  assert.equal(nextIndex(0, 0, 1), 0);
  assert.equal(nextIndex(0, 1, 1), 0);
});
test("matchHotkey finds first-letter hint", () => {
  const items: SelectItem[] = [
    { label: "Approve", value: "approve", hotkey: "y" },
    { label: "Deny", value: "deny", hotkey: "n" },
  ];
  assert.equal(matchHotkey(items, "n"), 1);
  assert.equal(matchHotkey(items, "Y"), 0); // case-insensitive
  assert.equal(matchHotkey(items, "z"), -1);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --import tsx --test test/tui-ink-select-state.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写 `src/tui-ink/ui/select-state.ts`**

```ts
export interface SelectItem {
  label: string;
  value: string;
  description?: string;
  hotkey?: string;
}

/** Wrap-around index move. dir +1 = down/next, -1 = up/prev. */
export function nextIndex(current: number, len: number, dir: 1 | -1): number {
  if (len <= 0) return 0;
  return (current + dir + len) % len;
}

/** Index of the item whose hotkey matches `input` (case-insensitive), or -1. */
export function matchHotkey(items: SelectItem[], input: string): number {
  const k = input.toLowerCase();
  return items.findIndex((it) => it.hotkey && it.hotkey.toLowerCase() === k);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --import tsx --test test/tui-ink-select-state.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 写 `src/tui-ink/ui/useTerminalSize.ts`**

```ts
import { useEffect, useState } from "react";

export interface TerminalSize {
  columns: number;
  rows: number;
}

/**
 * Tracks terminal dimensions, updating on resize. Falls back to 80x24 when
 * stdout is not a TTY (pipes/CI). Listener cleaned up on unmount.
 */
export function useTerminalSize(): TerminalSize {
  const read = (): TerminalSize => ({
    columns: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  });
  const [size, setSize] = useState<TerminalSize>(read);
  useEffect(() => {
    const onResize = () => setSize(read());
    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, []);
  return size;
}
```

- [ ] **Step 6: 写 `src/tui-ink/ui/Separator.tsx`**

```tsx
import React from "react";
import { Text } from "ink";

/** Status-bar separator: dim vertical bar with surrounding spaces. */
export function Separator(): React.ReactElement {
  return <Text dimColor>{" │ "}</Text>;
}
```

- [ ] **Step 7: 写 `src/tui-ink/ui/Select.tsx`**

```tsx
import React, { useState } from "react";
import { Box, Text, useInput, useStdin } from "ink";
import { nextIndex, matchHotkey, type SelectItem } from "./select-state.js";

export interface SelectProps {
  items: SelectItem[];
  onSelect: (value: string) => void;
  isFocused?: boolean;
  initialIndex?: number;
}

/**
 * Single-select menu. Arrow keys navigate (wrap), Enter confirms, hotkey
 * letters jump+confirm. Native ink rendering (CJK-safe). Caller controls
 * focus via isFocused (default true); useInput guarded for non-TTY.
 */
export function Select({ items, onSelect, isFocused = true, initialIndex = 0 }: SelectProps): React.ReactElement {
  const [index, setIndex] = useState(initialIndex);
  const { isRawModeSupported } = useStdin();

  useInput(
    (input, key) => {
      if (key.upArrow) { setIndex((i) => nextIndex(i, items.length, -1)); return; }
      if (key.downArrow) { setIndex((i) => nextIndex(i, items.length, 1)); return; }
      if (key.return) { const it = items[index]; if (it) onSelect(it.value); return; }
      const hk = matchHotkey(items, input);
      if (hk !== -1) { setIndex(hk); const it = items[hk]; if (it) onSelect(it.value); }
    },
    { isActive: isFocused && isRawModeSupported },
  );

  return (
    <Box flexDirection="column">
      {items.map((it, i) => {
        const selected = i === index;
        return (
          <Box key={it.value}>
            <Text color={selected ? "cyan" : undefined}>{selected ? "❯ " : "  "}{it.label}</Text>
            {it.hotkey ? <Text dimColor>{" (" + it.hotkey + ")"}</Text> : null}
            {it.description ? <Text dimColor>{"  " + it.description}</Text> : null}
          </Box>
        );
      })}
    </Box>
  );
}
```

- [ ] **Step 8: 写 `src/tui-ink/ui/index.ts`**

```ts
export { nextIndex, matchHotkey } from "./select-state.js";
export type { SelectItem } from "./select-state.js";
export { useTerminalSize } from "./useTerminalSize.js";
export type { TerminalSize } from "./useTerminalSize.js";
export { Separator } from "./Separator.js";
export { Select } from "./Select.js";
export type { SelectProps } from "./Select.js";
```

- [ ] **Step 9: 加测试到 `scripts/run-tests.js`**

在 nodeArgs 的测试文件列表里追加 `'test/tui-ink-select-state.test.ts'`(放在现有 tui-ink 测试旁边)。

- [ ] **Step 10: 门禁**

Run: `npx tsc --noEmit` → 0；`npx tsc -p tsconfig.build.json --noEmit` → 0；`node scripts/run-tests.js` → 全过(原有 + 4 新)。

- [ ] **Step 11: 提交**

```bash
git add src/tui-ink/ui test/tui-ink-select-state.test.ts scripts/run-tests.js
git commit -m "feat(ink-ux T1): UI 原语层（useTerminalSize/Separator/Select + 纯导航逻辑）"
```

---

## Task 2: 富状态栏(StatusBar 重写 + context 进度条)

**Files:**
- Modify: `src/tui-ink/components/StatusBar.tsx`(整体重写)
- Create: `src/tui-ink/ui-preview.tsx`(本 task 起步,后续 task 追加)

**Interfaces:**
- Consumes: `useTerminalSize`, `Separator`(Task 1);`formatTokens`-ish 自实现或复用 renderer 的 `formatBytes`/`pluralize`(取整数 token 显示)。
- Produces: `StatusBar(props: StatusBarProps)` —
  ```ts
  export interface StatusBarProps {
    model: string;
    mode: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    turnCount?: number;
    contextWindow?: number; // 默认 200000
  }
  ```

- [ ] **Step 1: 读现有 StatusBar 确认当前 props**

Run: `Read src/tui-ink/components/StatusBar.tsx`
（当前 props: model, mode, inputTokens, outputTokens, cost。本 task 加 turnCount?、contextWindow?。）

- [ ] **Step 2: 重写 `src/tui-ink/components/StatusBar.tsx`**

```tsx
import React from "react";
import { Box, Text } from "ink";
import { useTerminalSize, Separator } from "../ui/index.js";

export interface StatusBarProps {
  model: string;
  mode: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  turnCount?: number;
  contextWindow?: number;
}

const CTX_BAR_SEGMENTS = 8;

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1000) return Math.round(n / 1000) + "k";
  return String(n);
}

/** Mini context-usage bar: filled segments scale with pct; red when near full. */
function ContextBar({ pct }: { pct: number }): React.ReactElement {
  const filled = Math.min(CTX_BAR_SEGMENTS, Math.round((pct / 100) * CTX_BAR_SEGMENTS));
  const color = pct >= 90 ? "red" : pct >= 70 ? "yellow" : "green";
  return (
    <Text color={color}>
      {"█".repeat(filled)}
      <Text dimColor>{"░".repeat(CTX_BAR_SEGMENTS - filled)}</Text>
    </Text>
  );
}

function StatusBarInner(props: StatusBarProps): React.ReactElement {
  const { model, mode, inputTokens, outputTokens, cost, turnCount, contextWindow = 200000 } = props;
  const { columns } = useTerminalSize();
  const narrow = columns < 70;

  const used = inputTokens + outputTokens;
  const pct = Math.min(100, Math.round((used / contextWindow) * 100));
  const modelParts = model.split(" ");
  const shortModel = modelParts.length >= 2 ? modelParts[0] + " " + modelParts[1] : model;

  return (
    <Box>
      <Text dimColor>{shortModel}</Text>
      <Separator />
      <Text color={mode === "yolo" || mode === "full_auto" ? "yellow" : undefined}>{mode}</Text>
      <Separator />
      <Text dimColor>{"ctx "}</Text>
      <ContextBar pct={pct} />
      <Text>{" " + pct + "%"}</Text>
      {!narrow && <Text dimColor>{" (" + fmtTokens(used) + "/" + fmtTokens(contextWindow) + ")"}</Text>}
      {cost > 0 && (<><Separator /><Text>{"$" + cost.toFixed(4)}</Text></>)}
      {!narrow && turnCount != null && turnCount > 0 && (<><Separator /><Text dimColor>{turnCount + " turns"}</Text></>)}
    </Box>
  );
}

export const StatusBar = React.memo(StatusBarInner);
```

- [ ] **Step 3: 写 `src/tui-ink/ui-preview.tsx`(渲染 StatusBar 多状态)**

```tsx
import React from "react";
import { render, Box, Text } from "ink";
import { StatusBar } from "./components/StatusBar.js";

function Preview(): React.ReactElement {
  return (
    <Box flexDirection="column" gap={1}>
      <Text>— StatusBar —</Text>
      <StatusBar model="claude-sonnet-4-6" mode="normal" inputTokens={1200} outputTokens={600} cost={0.0042} turnCount={3} />
      <StatusBar model="claude-opus-4-8" mode="yolo" inputTokens={150000} outputTokens={30000} cost={0.21} turnCount={12} />
      <Text>— 中文样例(CJK 对齐目测) —</Text>
      <StatusBar model="深度模型 4" mode="plan" inputTokens={5000} outputTokens={2000} cost={0} />
    </Box>
  );
}
const { unmount } = render(<Preview />);
setTimeout(() => unmount(), 1500);
```

- [ ] **Step 4: 运行 preview**

Run: `npx tsx src/tui-ink/ui-preview.tsx`
Expected: 渲染 3 行状态栏,含 context 色块进度条;无崩溃。记录输出。

- [ ] **Step 5: 修 App.tsx 传入新 props（保持编译）**

`App.tsx` 里 `<StatusBar>` 调用处补 `turnCount={state.turnCount}`（contextWindow 用默认）。仅此一处接线,避免本 task 引入 tsc 错误。

- [ ] **Step 6: 门禁**

`npx tsc --noEmit` → 0；`npx tsc -p tsconfig.build.json --noEmit` → 0；`node scripts/run-tests.js` → 全过。

- [ ] **Step 7: 提交**

```bash
git add src/tui-ink/components/StatusBar.tsx src/tui-ink/ui-preview.tsx src/tui-ink/App.tsx
git commit -m "feat(ink-ux T2): 富状态栏（原生 ink + context 进度条 + 响应式）"
```

---

## Task 3: 工具 + diff(ToolCall 原生化 / ToolList 折叠 / DiffView / detailMode)

**Files:**
- Create: `src/tui-ink/components/DiffView.tsx`
- Modify: `src/tui-ink/components/ToolCall.tsx`
- Modify: `src/tui-ink/components/ToolList.tsx`
- Modify: `src/tui-ink/ui-preview.tsx`(追加)

**Interfaces:**
- Consumes: `ToolCallState`(types.ts);renderer 导出的 `toToolLabel(name)`、`formatDuration(ms)`(纯文本,从 src/renderer.js)。
- Produces:
  - `DiffView(props: { tool: ToolCallState; width?: number }): React.ReactElement | null`
  - `ToolCall(props: { tool: ToolCallState; detail?: boolean }): React.ReactElement`
  - `ToolList(props: { tools: ToolCallState[]; detail?: boolean }): React.ReactElement | null`

- [ ] **Step 1: 读现有 ToolCall/ToolList/FileDiffPreview 确认输入摘要/diff 数据来源**

Run: `Read src/tui-ink/components/ToolCall.tsx`、`Read src/tui-ink/components/FileDiffPreview.tsx`
（确认 diff 数据从哪取:tool.data 里的 diff 字段或 formatFileModificationNotice 的输出。沿用既有取数逻辑,只改渲染为原生。）

- [ ] **Step 2: 写 `src/tui-ink/components/DiffView.tsx`**

```tsx
import React from "react";
import { Box, Text } from "ink";
import type { ToolCallState } from "../types.js";

/** Extract +/- diff lines from a tool result. Returns null when not a diff-bearing tool. */
function extractDiffLines(tool: ToolCallState): string[] | null {
  const data = tool.data as { diff?: string; added?: number; removed?: number } | undefined;
  if (!data || typeof data.diff !== "string" || data.diff.length === 0) return null;
  return data.diff.split("\n");
}

export interface DiffViewProps {
  tool: ToolCallState;
  width?: number;
}

/** Native-ink diff: dashed top/bottom frame, +green / -red lines. */
export function DiffView({ tool }: DiffViewProps): React.ReactElement | null {
  const lines = extractDiffLines(tool);
  if (!lines) return null;
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" borderLeft={false} borderRight={false}>
      {lines.map((ln, i) => {
        const color = ln.startsWith("+") ? "green" : ln.startsWith("-") ? "red" : undefined;
        return <Text key={i} color={color} dimColor={color === undefined}>{ln}</Text>;
      })}
    </Box>
  );
}
```

- [ ] **Step 3: 重写 `src/tui-ink/components/ToolCall.tsx`(原生 + detail)**

```tsx
import React from "react";
import { Box, Text } from "ink";
import type { ToolCallState } from "../types.js";
// eslint-disable-next-line -- pure text formatters reused from the legacy renderer
import { toToolLabel, formatDuration } from "../../renderer.js";
import { DiffView } from "./DiffView.js";

export interface ToolCallProps {
  tool: ToolCallState;
  detail?: boolean;
}

function statusIcon(status: ToolCallState["status"]): { icon: string; color: string } {
  if (status === "running") return { icon: "⟳", color: "yellow" };
  if (status === "error") return { icon: "✗", color: "red" };
  return { icon: "✓", color: "green" };
}

function inputSummary(input: Record<string, unknown>): string {
  const s = JSON.stringify(input);
  if (!s || s === "{}") return "";
  return s.length > 60 ? s.slice(0, 57) + "…" : s;
}

export function ToolCall({ tool, detail = false }: ToolCallProps): React.ReactElement {
  const { icon, color } = statusIcon(tool.status);
  const label = toToolLabel(tool.name) as string;
  const dur = tool.durationMs ? " " + (formatDuration(tool.durationMs) as string) : "";
  const summary = inputSummary(tool.input);
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color}>{icon + " "}</Text>
        <Text>{label}</Text>
        {summary ? <Text dimColor>{" " + summary}</Text> : null}
        {dur ? <Text dimColor>{dur}</Text> : null}
        {tool.status === "error" && tool.error ? <Text color="red">{"  " + tool.error.message}</Text> : null}
      </Box>
      {detail ? <DiffView tool={tool} /> : null}
    </Box>
  );
}
```

- [ ] **Step 4: 重写 `src/tui-ink/components/ToolList.tsx`(同名折叠 + detail 透传)**

```tsx
import React from "react";
import { Box, Text } from "ink";
import type { ToolCallState } from "../types.js";
import { ToolCall } from "./ToolCall.js";
// eslint-disable-next-line -- pure text formatter reused
import { toToolLabel } from "../../renderer.js";

export interface ToolListProps {
  tools: ToolCallState[];
  detail?: boolean;
}

/** Collapse consecutive same-name DONE tools into "✓ Label ×N" when not in detail mode. */
export function ToolList({ tools, detail = false }: ToolListProps): React.ReactElement | null {
  if (tools.length === 0) return null;
  if (detail) {
    return (<Box flexDirection="column">{tools.map((t, i) => <ToolCall key={i} tool={t} detail />)}</Box>);
  }
  const out: React.ReactElement[] = [];
  let i = 0;
  while (i < tools.length) {
    const t = tools[i]!;
    let run = 1;
    while (i + run < tools.length && tools[i + run]!.name === t.name && tools[i + run]!.status === "done" && t.status === "done") run++;
    if (run > 1) {
      out.push(<Box key={i}><Text color="green">{"✓ "}</Text><Text>{toToolLabel(t.name) as string}</Text><Text dimColor>{" ×" + run}</Text></Box>);
      i += run;
    } else {
      out.push(<ToolCall key={i} tool={t} detail={false} />);
      i += 1;
    }
  }
  return <Box flexDirection="column">{out}</Box>;
}
```

- [ ] **Step 5: ui-preview 追加 ToolList/DiffView 样例**

在 `src/tui-ink/ui-preview.tsx` 的 Preview 里追加:一组 running/done/error 工具 + 一个带 `data.diff` 的工具,分别用 `detail={false}` 和 `detail` 渲染。（用 mock ToolCallState 数组。）

- [ ] **Step 6: 运行 preview**

Run: `npx tsx src/tui-ink/ui-preview.tsx`
Expected: 工具行(图标+标签+摘要+耗时)、同名折叠 `✓ Read ×3`、detail 模式显示 diff frame。无崩溃。

- [ ] **Step 7: 门禁 + 提交**

门禁全过后:
```bash
git add src/tui-ink/components/DiffView.tsx src/tui-ink/components/ToolCall.tsx src/tui-ink/components/ToolList.tsx src/tui-ink/ui-preview.tsx
git commit -m "feat(ink-ux T3): 工具调用原生化 + 同名折叠 + DiffView + detail 模式"
```

---

## Task 4: reducer/types 改造(committedTurns / detailMode / commandPalette)

**Files:**
- Modify: `src/tui-ink/types.ts`
- Modify: `src/tui-ink/reducer.ts`
- Test: `test/tui-ink-reducer-redesign.test.ts`
- Modify: `scripts/run-tests.js`

**Interfaces:**
- Produces(types.ts 新增/改):
  ```ts
  export interface CommittedTurn {
    userText: string;
    assistantText: string;
    thinking: string;
    tools: ToolCallState[];
    interrupted: boolean;
    error: string | null;
  }
  // AppState 新增字段:
  //   committedTurns: CommittedTurn[];
  //   detailMode: boolean;
  //   commandPalette: { open: boolean; query: string } | null;
  // 保留 messages 以兼容(标记 deprecated),App 改用 committedTurns。
  // 新 actions:
  export interface CommitTurnAction { type: "commit_turn" }
  export interface ToggleDetailAction { type: "toggle_detail" }
  export interface OpenPaletteAction { type: "open_palette"; query: string }
  export interface UpdatePaletteAction { type: "update_palette"; query: string }
  export interface ClosePaletteAction { type: "close_palette" }
  ```
- Consumes: 现有 reducer 的 turn.completed/turn.interrupted 处理逻辑。

- [ ] **Step 1: 写失败测试 `test/tui-ink-reducer-redesign.test.ts`**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { reducer } from "../src/tui-ink/reducer.js";
import { createInitialState } from "../src/tui-ink/types.js";

test("commit_turn snapshots active turn into committedTurns", () => {
  let s = createInitialState({ model: "m", permissionMode: "normal" });
  s = reducer(s, { type: "submit_input", text: "hello" });
  s = reducer(s, { type: "turn_start" });
  s = reducer(s, { type: "engine_event", event: { type: "message.delta", delta: "hi" } });
  s = reducer(s, { type: "engine_event", event: { type: "tool.start", name: "file.read", input: {} } });
  s = reducer(s, { type: "engine_event", event: { type: "tool.result", name: "file.read", isError: false, durationMs: 5 } });
  s = reducer(s, { type: "engine_event", event: { type: "turn.completed", text: "hi", usage: null, context: "" } });
  assert.equal(s.committedTurns.length, 1);
  assert.equal(s.committedTurns[0].userText, "hello");
  assert.equal(s.committedTurns[0].assistantText, "hi");
  assert.equal(s.committedTurns[0].tools.length, 1);
  assert.equal(s.committedTurns[0].tools[0].status, "done");
  assert.equal(s.isStreaming, false);
  assert.equal(s.currentTurnText, "");
  assert.equal(s.currentTools.length, 0);
});

test("toggle_detail flips detailMode", () => {
  let s = createInitialState();
  assert.equal(s.detailMode, false);
  s = reducer(s, { type: "toggle_detail" });
  assert.equal(s.detailMode, true);
  s = reducer(s, { type: "toggle_detail" });
  assert.equal(s.detailMode, false);
});

test("palette open/update/close", () => {
  let s = createInitialState();
  assert.equal(s.commandPalette, null);
  s = reducer(s, { type: "open_palette", query: "/mo" });
  assert.equal(s.commandPalette?.open, true);
  assert.equal(s.commandPalette?.query, "/mo");
  s = reducer(s, { type: "update_palette", query: "/mod" });
  assert.equal(s.commandPalette?.query, "/mod");
  s = reducer(s, { type: "close_palette" });
  assert.equal(s.commandPalette, null);
});

test("interrupted turn commits with interrupted flag", () => {
  let s = createInitialState();
  s = reducer(s, { type: "submit_input", text: "go" });
  s = reducer(s, { type: "turn_start" });
  s = reducer(s, { type: "engine_event", event: { type: "message.delta", delta: "partial" } });
  s = reducer(s, { type: "engine_event", event: { type: "turn.interrupted" } });
  assert.equal(s.committedTurns.length, 1);
  assert.equal(s.committedTurns[0].interrupted, true);
  assert.equal(s.committedTurns[0].assistantText, "partial");
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --import tsx --test test/tui-ink-reducer-redesign.test.ts`
Expected: FAIL（committedTurns/detailMode/commandPalette 不存在,actions 未处理）

- [ ] **Step 3: 改 `src/tui-ink/types.ts`**

加 `CommittedTurn` 接口(见 Interfaces);`AppState` 加 `committedTurns: CommittedTurn[]`、`detailMode: boolean`、`commandPalette: { open: boolean; query: string } | null`;加 5 个新 action 接口并并入 `AppAction` 联合;`createInitialState` 里初始化 `committedTurns: [], detailMode: false, commandPalette: null`。保留 `messages` 字段(初始 `[]`)以免破坏其它引用。

- [ ] **Step 4: 改 `src/tui-ink/reducer.ts`**

- `turn.completed`:在清空 current* 之前,构造一个 `CommittedTurn`（userText 取本轮提交的用户输入——见下注、assistantText=state.currentTurnText、thinking=state.currentThinking、tools=state.currentTools、interrupted=false、error=null）push 进 `committedTurns`,再清空 current*。
- `turn.interrupted`:同样 push 快照,interrupted=true。
- `turn.failed`:push 快照 error=currentError(其实是 event.error.message),其余照旧设 currentError。
- userText 来源:`submit_input` 时把文本存到一个 state 字段 `pendingUserText`（types 里加 `pendingUserText: string`,初始 "");commit 时读它。或更简单:`submit_input` 直接 push 一个"半轮"——但为保持单测里 userText 正确,用 `pendingUserText` 方案:`submit_input` 设 `pendingUserText = action.text`;commit_turn 类逻辑读 `pendingUserText`。
- 新 actions:`commit_turn`(手动提交,App 可能不用,留作完备)、`toggle_detail`(翻转 detailMode)、`open_palette`/`update_palette`/`close_palette`(维护 commandPalette)。
- 保持 reducer 纯函数;新建数组/对象,不原地改。

- [ ] **Step 5: 运行确认通过**

Run: `node --import tsx --test test/tui-ink-reducer-redesign.test.ts`
Expected: PASS (4 tests)。同时跑旧 reducer 测试 `node --import tsx --test test/tui-ink-reducer.test.ts` 确认未回归(若旧测试断言了 turn.completed 后 messages 行为,按需调整为 committedTurns——若调整,在本 step 一并改并说明)。

- [ ] **Step 6: 加测试到 scripts/run-tests.js**

追加 `'test/tui-ink-reducer-redesign.test.ts'`。

- [ ] **Step 7: 门禁 + 提交**

```bash
git add src/tui-ink/types.ts src/tui-ink/reducer.ts test/tui-ink-reducer-redesign.test.ts scripts/run-tests.js
git commit -m "feat(ink-ux T4): reducer 升级 committedTurns/detailMode/commandPalette + 单测"
```

---

## Task 5: 布局骨架(App 三段式 + Static + ConversationTurn)

**Files:**
- Create: `src/tui-ink/components/ConversationTurn.tsx`
- Modify: `src/tui-ink/App.tsx`
- Modify: `src/tui-ink/ui-preview.tsx`(追加 ConversationTurn 样例)

**Interfaces:**
- Consumes: `CommittedTurn`(T4)、`ToolList`(T3)、`TextStream`/`ThinkingBlock`(现有)、`detailMode`(state)。
- Produces: `ConversationTurn(props: { turn: CommittedTurn; detail?: boolean }): React.ReactElement`

- [ ] **Step 1: 写 `src/tui-ink/components/ConversationTurn.tsx`**

```tsx
import React from "react";
import { Box, Text } from "ink";
import type { CommittedTurn } from "../types.js";
import { ToolList } from "./ToolList.js";
import { TextStream } from "./TextStream.js";

export interface ConversationTurnProps {
  turn: CommittedTurn;
  detail?: boolean;
}

/** Renders one completed turn (final snapshot, no animation). */
export function ConversationTurn({ turn, detail = false }: ConversationTurnProps): React.ReactElement {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="cyan" bold>{"You "}</Text>
        <Text>{turn.userText}</Text>
      </Box>
      {turn.thinking ? <Text dimColor>{turn.thinking}</Text> : null}
      {turn.tools.length > 0 ? <ToolList tools={turn.tools} detail={detail} /> : null}
      {turn.assistantText ? <TextStream text={turn.assistantText} /> : null}
      {turn.interrupted ? <Text color="yellow">{"↑ interrupted"}</Text> : null}
      {turn.error ? <Text color="red">{"Error: " + turn.error}</Text> : null}
    </Box>
  );
}
```

- [ ] **Step 2: 重写 `src/tui-ink/App.tsx` 渲染结构为三段式**

读现有 App.tsx,保留:useReducer、引擎驱动 handleSubmit、审批桥(dispatchRef/wrappedResolve)、useGlobalKeybindings 接线。仅**替换 return 的 JSX**为:
```tsx
return (
  <Box flexDirection="column">
    <Static items={state.committedTurns}>
      {(turn, i) => <ConversationTurn key={i} turn={turn} detail={state.detailMode} />}
    </Static>
    <Box flexDirection="column">
      {state.currentThinking ? <ThinkingBlock text={state.currentThinking} /> : null}
      {state.currentTools.length > 0 ? <ToolList tools={state.currentTools} detail={state.detailMode} /> : null}
      {state.currentTurnText ? <TextStream text={state.currentTurnText} /> : null}
      {state.isWaiting ? <SpinnerLine startTime={waitStartRef.current} /> : null}
    </Box>
    {state.pendingApproval ? <ApprovalPrompt approval={state.pendingApproval} /> : null}
    {state.currentError ? <Text color="red">{"Error: " + state.currentError}</Text> : null}
    {state.statusMessage ? <Text dimColor>{state.statusMessage}</Text> : null}
    <Box flexDirection="column">
      <UserInput value={input} onChange={setInput} onSubmit={handleSubmit} disabled={state.isStreaming} completions={completions} />
      <StatusBar model={state.model} mode={state.permissionMode} inputTokens={state.inputTokens} outputTokens={state.outputTokens} cost={state.cost} turnCount={state.turnCount} />
    </Box>
  </Box>
);
```
注:`waitStartRef` 用一个 useRef 记录 turn_start 时间戳(若现有已有等价物则复用)。CommandPalette 接线在 T6 之后(本 task 先不挂 palette)。`Static` 的 children render prop 在 ink 是 `(item, index) => ReactNode`。

- [ ] **Step 3: ui-preview 追加 ConversationTurn 样例**

mock 一个 CommittedTurn(含 user/assistant/tools/中文文本)渲染。

- [ ] **Step 4: 运行 preview + app-preview**

Run: `npx tsx src/tui-ink/ui-preview.tsx`（看 ConversationTurn）;`npx tsx src/tui-ink/app-preview.tsx`（mock-engine 跑一轮,确认 Static 提交 + 活动区 + 底部状态栏布局正常,无重复渲染末轮）。

- [ ] **Step 5: 门禁 + 提交**

```bash
git add src/tui-ink/components/ConversationTurn.tsx src/tui-ink/App.tsx src/tui-ink/ui-preview.tsx
git commit -m "feat(ink-ux T5): 三段式布局 + Static 提交历史 + ConversationTurn"
```

---

## Task 6: 命令面板(CommandPalette)+ 接线

**Files:**
- Create: `src/tui-ink/components/CommandPalette.tsx`
- Modify: `src/tui-ink/App.tsx`(挂 palette + 输入联动)
- Modify: `src/tui-ink/ui-preview.tsx`(追加)

**Interfaces:**
- Consumes: `Select`/`SelectItem`(T1)、`computeCompletions`(现有 completions.ts)、命令 registry 的 description（若可得;否则 description 省略）。
- Produces: `CommandPalette(props: { query: string; commandNames: string[]; skillNames: string[]; onPick: (value: string) => void; onClose: () => void }): React.ReactElement | null`

- [ ] **Step 1: 写 `src/tui-ink/components/CommandPalette.tsx`**

```tsx
import React from "react";
import { Box, Text, useInput, useStdin } from "ink";
import { Select, type SelectItem } from "../ui/index.js";
import { computeCompletions } from "../completions.js";

export interface CommandPaletteProps {
  query: string;
  commandNames: string[];
  skillNames: string[];
  onPick: (value: string) => void;
  onClose: () => void;
}

export function CommandPalette({ query, commandNames, skillNames, onPick, onClose }: CommandPaletteProps): React.ReactElement | null {
  const { isRawModeSupported } = useStdin();
  const matches = computeCompletions(query, commandNames, skillNames);
  // Esc closes the palette (Select handles up/down/enter).
  useInput((_input, key) => { if (key.escape) onClose(); }, { isActive: isRawModeSupported });
  if (matches.length === 0) return null;
  const items: SelectItem[] = matches.map((m) => ({ label: m, value: m }));
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text dimColor>{"commands (esc to close)"}</Text>
      <Select items={items} onSelect={onPick} isFocused />
    </Box>
  );
}
```

- [ ] **Step 2: App.tsx 接线 palette**

- UserInput 的 onChange 里:若新值以 `/` 开头 → dispatch `open_palette`/`update_palette`（query=值);否则若 palette 开着 → `close_palette`。
- 在活动区上方、UserInput 之上渲染 `state.commandPalette?.open ? <CommandPalette query={state.commandPalette.query} commandNames={...} skillNames={...} onPick={v => { setInput(v + " "); dispatch(close_palette) }} onClose={() => dispatch(close_palette)} /> : null`。
- commandNames/skillNames 来源:App 已有 `completionNames`（F5 传入)或从 run.tsx 传入;若现无,加一个 prop。
- 与审批互斥:palette 仅在 `!pendingApproval` 时渲染。
- 全局键盘:palette 开时 useGlobalKeybindings 的 isActive 设 false（沿用 F4 互斥）。

- [ ] **Step 3: ui-preview 追加 CommandPalette**

mock query="/" + 一组命令/skill 名渲染。

- [ ] **Step 4: 运行 preview + 门禁**

`npx tsx src/tui-ink/ui-preview.tsx`;门禁全过。

- [ ] **Step 5: 提交**

```bash
git add src/tui-ink/components/CommandPalette.tsx src/tui-ink/App.tsx src/tui-ink/ui-preview.tsx
git commit -m "feat(ink-ux T6): 斜杠命令面板（Select 下拉 + 输入联动 + 互斥）"
```

---

## Task 7: 菜单式审批(ApprovalPrompt 改造,保留审批桥)+ Ctrl+R + 收尾

**Files:**
- Modify: `src/tui-ink/components/ApprovalPrompt.tsx`
- Modify: `src/tui-ink/keybindings.tsx`
- Modify: `src/tui-ink/App.tsx`(Ctrl+R 接线)
- Modify: `src/tui-ink/ui-preview.tsx` / `src/tui-ink/input-preview.tsx`(审批菜单预览)

**Interfaces:**
- Consumes: `Select`(T1)、`DiffView`(T3)、`PendingApproval`(types)。
- 保留 ApprovalPrompt 的 props `{ approval: PendingApproval }` 不变(App/run.tsx 接线不动)。

- [ ] **Step 1: 读现有 ApprovalPrompt 确认审批桥**

Run: `Read src/tui-ink/components/ApprovalPrompt.tsx`
确认现有的 `resolvedRef` 一次性守卫 + `setImmediate(() => approval.resolve(answer))` 延迟逻辑。改造**只替换 UI(useInput 读 y/n/a → Select 菜单)**,保留 resolvedRef + setImmediate。

- [ ] **Step 2: 改造 `src/tui-ink/components/ApprovalPrompt.tsx` 用 Select**

```tsx
import React, { useRef } from "react";
import { Box, Text } from "ink";
import type { PendingApproval, ToolCallState } from "../types.js";
import { Select, type SelectItem } from "../ui/index.js";
import { DiffView } from "./DiffView.js";

export interface ApprovalPromptProps {
  approval: PendingApproval;
}

const ITEMS: SelectItem[] = [
  { label: "Approve", value: "approve", hotkey: "y" },
  { label: "Approve & always allow this tool", value: "always", hotkey: "a" },
  { label: "Deny", value: "deny", hotkey: "n" },
];

function summarise(input: Record<string, unknown>): string {
  try { const j = JSON.stringify(input); return j.length > 80 ? j.slice(0, 77) + "…" : j; } catch { return ""; }
}

export function ApprovalPrompt({ approval }: ApprovalPromptProps): React.ReactElement {
  const resolvedRef = useRef(false);
  // Build a synthetic ToolCallState so DiffView can render a pending edit's diff.
  const asTool: ToolCallState = { name: approval.toolName, input: approval.toolInput, status: "running", data: approval.toolInput };

  const onSelect = (value: string) => {
    if (resolvedRef.current) return;
    if (value !== "approve" && value !== "always" && value !== "deny") return;
    resolvedRef.current = true;
    const answer = value as "approve" | "always" | "deny";
    // RISK 1: defer so the engine generator resumes AFTER ink's render cycle.
    setImmediate(() => approval.resolve(answer));
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Box>
        <Text color="yellow" bold>{"? Approve tool: "}</Text>
        <Text>{approval.toolName}</Text>
      </Box>
      <Text dimColor>{summarise(approval.toolInput)}</Text>
      <DiffView tool={asTool} />
      <Select items={ITEMS} onSelect={onSelect} isFocused />
    </Box>
  );
}
```
注:DiffView 对非 diff 工具返回 null,所以普通工具审批不显示 diff;file.edit 类若 toolInput 含 diff 字段才显示。保留延迟 resolve + 守卫——**这是关键回归点**。

- [ ] **Step 3: keybindings 加 Ctrl+R**

`src/tui-ink/keybindings.tsx`:`useGlobalKeybindings` opts 加 `onToggleDetail: () => void`;useInput 里加 `if (key.ctrl && input === "r") { onToggleDetail(); return; }`。

- [ ] **Step 4: App.tsx 接 Ctrl+R**

`useGlobalKeybindings({ ..., onToggleDetail: () => dispatch({ type: "toggle_detail" }), isActive: !state.pendingApproval && !state.commandPalette?.open })`。

- [ ] **Step 5: input-preview 追加菜单审批预览**

在 `src/tui-ink/input-preview.tsx`(或 ui-preview)挂一个 mock approval(含 toolInput.diff 样例),渲染 ApprovalPrompt,确认菜单 + diff 渲染;mock resolve 打印答案验证延迟触发。

- [ ] **Step 6: 全门禁 + 真实启动冒烟**

- `npx tsc --noEmit` → 0;`npx tsc -p tsconfig.build.json --noEmit` → 0
- `node scripts/run-tests.js` → 全过 0 fail
- `npx tsc -p tsconfig.build.json && node dist/cli.js --version` → hax-agent v1.6.0;`rm -rf dist`
- `npx tsx src/cli.ts --legacy --help` 不崩(回退路径)
- `npx tsx src/cli.ts --help` 不崩(默认 ink)
- `npx tsx src/tui-ink/app-preview.tsx` mock-engine 跑通

- [ ] **Step 7: cli.ts cast 复查 + 人工测试清单**

`grep -cE '\(.* as any\)|as never' src/cli.ts src/tui-ink/run.tsx` 确认未新增。在报告里列出人工 TTY 测试清单(见下)。

- [ ] **Step 8: 提交**

```bash
git add src/tui-ink/components/ApprovalPrompt.tsx src/tui-ink/keybindings.tsx src/tui-ink/App.tsx src/tui-ink/input-preview.tsx src/tui-ink/ui-preview.tsx
git commit -m "feat(ink-ux T7): 菜单式审批（Select+DiffView,保留审批桥）+ Ctrl+R 详细模式 + 收尾"
```

---

## 人工 TTY 测试清单(实施后,人在 Windows Terminal + cmd 验证)

1. 默认 ink 启动渲染三段式;`--legacy` 回退 readline
2. 富状态栏:model/mode/context 进度条/cost/turns;resize 窗口看响应式(窄屏隐藏次要字段)
3. 流式渲染:token 逐步出现,完成轮转入 Static 历史(上翻 scrollback 可见)
4. 工具:折叠一行、同名 `×N` 折叠;Ctrl+R 切详细模式显示 diff
5. DiffView:file.edit/write 的 +/- 行、边框
6. 命令面板:输入 `/` 弹出 Select,↑↓ 导航,Enter 填入,Esc 关闭
7. 菜单审批:工具审批弹菜单,↑↓/Enter 选,y/a/n 快捷键;选后引擎正确恢复(不挂起、不双触发);file.edit 审批内嵌 diff
8. 键盘:Shift+Tab 切模式(状态栏实时更新)、Ctrl+L 清屏、Ctrl+C 中断/双击退出、方向键历史
9. CJK:中文输入/输出/状态栏对齐正确,无错位

## Self-Review 结果

- **Spec 覆盖**:模块1→T1;模块2→T5;模块3→T3;模块4→T6(命令面板)+T7(审批);模块5→T2(状态栏)+T4(reducer);键盘→T7。全覆盖。
- **占位符**:无 TBD/TODO;所有代码步骤含完整代码。
- **类型一致**:ToolCall/ToolList 加 `detail?` 透传一致;CommittedTurn 字段在 T4 定义、T5 消费一致;Select 的 SelectItem/onSelect 签名在 T1 定义、T6/T7 消费一致;ApprovalPrompt props 不变(T7 仅改内部)。
- **范围**:7 task,叶子→根,每个独立可测可提交;`--ink` 全程可跑,`--legacy` 保留。
