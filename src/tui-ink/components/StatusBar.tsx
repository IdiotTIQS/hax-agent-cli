/**
 * StatusBar — rich session metadata bar (Task 2 rewrite).
 *
 * Features:
 *  - Native ink rendering (Box/Text) with Separator from ui primitives.
 *  - useTerminalSize for responsive narrow layout (< 70 cols hides secondary fields).
 *  - ContextBar: mini 8-segment progress bar (green/yellow/red) for context window usage.
 *  - React.memo wrapping to avoid re-renders when unrelated state changes.
 *
 * Props:
 *  - model, mode, inputTokens, outputTokens, cost (original)
 *  - turnCount?  — number of completed turns (optional, hidden when 0)
 *  - contextWindow? — total context window size in tokens (default 200000)
 */
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

export default StatusBar;
