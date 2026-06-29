/**
 * ToolCall — renders a single tool call in running / done / error state.
 *
 * Color approach:
 *  - option (a): formatToolStart / formatToolSuccessDetail return pre-formatted
 *    ANSI strings which ink <Text> renders correctly.
 *  - option (b): status icons (✓ ✗ ⟳) use ink color props for new chrome.
 *
 * Props: tool (ToolCallState from types.ts / F1).
 * Also renders FileDiffPreview when the tool is a file modification.
 */
import React from "react";
import { Box, Text } from "ink";
import {
  formatToolStart,
  formatToolSuccessDetail,
  toToolLabel,
  formatDuration,
} from "../../renderer.js";
import type { ToolCallState } from "../types.js";
import { FileDiffPreview } from "./FileDiffPreview.js";

export interface ToolCallProps {
  tool: ToolCallState;
}

/**
 * Adapts a ToolCallState to the ToolChunk shape expected by renderer formatters.
 */
function toChunk(tool: ToolCallState) {
  return {
    name: tool.name,
    input: tool.input,
    isError: tool.status === "error",
    data: tool.data as Record<string, unknown> | undefined,
    error: tool.error,
    durationMs: tool.durationMs,
  };
}

export function ToolCall({ tool }: ToolCallProps): React.ReactElement {
  const chunk = toChunk(tool);
  const label = toToolLabel(tool.name);

  if (tool.status === "running") {
    // Running: show formatToolStart output (ANSI passthrough, option a)
    const startLine = formatToolStart(chunk);
    return (
      <Box flexDirection="column">
        <Text>
          <Text color="yellow">⟳ </Text>
          <Text>{startLine}</Text>
        </Text>
      </Box>
    );
  }

  if (tool.status === "error") {
    const errMsg = tool.error?.message ?? "unknown error";
    return (
      <Box flexDirection="column">
        <Text>
          <Text color="red">✗ </Text>
          <Text color="red">{label}</Text>
          <Text color="gray"> — </Text>
          <Text color="red">{errMsg}</Text>
        </Text>
      </Box>
    );
  }

  // done
  const detail = formatToolSuccessDetail(chunk);
  const durationStr = formatDuration(tool.durationMs);

  return (
    <Box flexDirection="column">
      <Text>
        <Text color="green">✓ </Text>
        <Text color="green">{label}</Text>
        <Text color="gray"> done{durationStr}</Text>
        {detail ? <Text color="gray"> — {detail}</Text> : null}
      </Text>
      <FileDiffPreview tool={tool} />
    </Box>
  );
}

export default ToolCall;
