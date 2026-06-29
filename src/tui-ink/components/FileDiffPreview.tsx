/**
 * FileDiffPreview — renders file modification notice lines for file.write /
 * file.edit tool calls.
 *
 * Color approach: option (a) — formatFileModificationNotice returns pre-formatted
 * ANSI strings which ink <Text> renders correctly.
 *
 * Props: tool (ToolCallState). Renders nothing when the tool is not a file
 * modification or when formatFileModificationNotice returns null.
 */
import React from "react";
import { Box, Text } from "ink";
import { formatFileModificationNotice } from "../../renderer.js";
import type { ToolCallState } from "../types.js";

export interface FileDiffPreviewProps {
  tool: ToolCallState;
}

/**
 * Adapts a ToolCallState to the ToolChunk shape expected by formatFileModificationNotice.
 * ToolCallState is a superset in the relevant fields.
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

export function FileDiffPreview({ tool }: FileDiffPreviewProps): React.ReactElement | null {
  const lines = formatFileModificationNotice(toChunk(tool));
  if (!lines || lines.length === 0) return null;

  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        // ANSI strings pass through ink <Text> correctly (option a).
        <Text key={i}>{line}</Text>
      ))}
    </Box>
  );
}

export default FileDiffPreview;
