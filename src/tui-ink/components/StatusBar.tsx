/**
 * StatusBar — single-line session metadata bar.
 *
 * Color approach: ink color props (option b) for new chrome — no ANSI escape
 * strings needed here since we're building fresh layout with ink primitives.
 *
 * Props: model, mode, inputTokens, outputTokens, cost.
 * Replaces the old refreshPrompt() line at the bottom of the terminal.
 */
import React from "react";
import { Box, Text } from "ink";

export interface StatusBarProps {
  model: string;
  mode: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export function StatusBar({
  model,
  mode,
  inputTokens,
  outputTokens,
  cost,
}: StatusBarProps): React.ReactElement {
  const totalTokens = inputTokens + outputTokens;
  const costStr = cost > 0 ? `$${cost.toFixed(4)}` : "$0.0000";

  return (
    <Box flexDirection="row" gap={1}>
      <Text color="cyan">{model || "no model"}</Text>
      <Text color="gray">│</Text>
      <Text color="yellow">{mode}</Text>
      <Text color="gray">│</Text>
      <Text color="gray">{totalTokens}t</Text>
      <Text color="gray">│</Text>
      <Text color="green">{costStr}</Text>
    </Box>
  );
}

export default StatusBar;
