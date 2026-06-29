/**
 * DiffView — native ink diff renderer for file.edit tool results.
 *
 * Extracts +/- diff lines from tool.data.diff (the raw unified-style diff
 * string written by the file.edit tool). Lines starting with "+ " are green,
 * "- " are red, context lines are dim. Renders nothing when the tool has no
 * diff data.
 *
 * Field confirmed: tool.data.diff (string) — see renderer.ts
 * formatEditModificationNotice, which parses `data.diff` at line 594.
 */
import React from "react";
import { Box, Text } from "ink";
import type { ToolCallState } from "../types.js";

/**
 * Extract displayable diff lines from a ToolCallState.
 * Returns null when the tool has no diff data (non-edit tools return null
 * so DiffView can short-circuit to null).
 */
function extractDiffLines(tool: ToolCallState): string[] | null {
  const data = tool.data as { diff?: string } | undefined;
  if (!data || typeof data.diff !== "string" || data.diff.length === 0) return null;
  return data.diff.split("\n");
}

export interface DiffViewProps {
  tool: ToolCallState;
  width?: number;
}

/**
 * Native-ink diff renderer: top/bottom single-line border, +green / -red
 * lines, context lines dim. Returns null when the tool carries no diff.
 */
export function DiffView({ tool }: DiffViewProps): React.ReactElement | null {
  const lines = extractDiffLines(tool);
  if (!lines) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      borderLeft={false}
      borderRight={false}
    >
      {lines.map((ln, i) => {
        if (ln.startsWith("+ ")) {
          return (
            <Text key={i} color="green">
              {ln}
            </Text>
          );
        }
        if (ln.startsWith("- ")) {
          return (
            <Text key={i} color="red">
              {ln}
            </Text>
          );
        }
        return (
          <Text key={i} dimColor>
            {ln}
          </Text>
        );
      })}
    </Box>
  );
}

export default DiffView;
