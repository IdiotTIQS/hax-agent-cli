/**
 * ToolList — renders a list of ToolCall components with same-name collapsing.
 *
 * When `detail` is false (default), consecutive same-name DONE tools are
 * collapsed into a single line:  ✓ Label ×N
 *
 * When `detail` is true, every tool is rendered individually with DiffView
 * shown for tools that carry diff data.
 *
 * The `detail` prop is forwarded to each ToolCall so DiffView visibility is
 * consistent throughout the list.
 */
import React from "react";
import { Box, Text } from "ink";
import type { ToolCallState } from "../types.js";
import { ToolCall } from "./ToolCall.js";
// eslint-disable-next-line -- pure text formatter reused from the legacy renderer
import { toToolLabel } from "../../renderer.js";

export interface ToolListProps {
  tools: ToolCallState[];
  /** When true, skip collapsing and show every tool with its DiffView. */
  detail?: boolean;
}

/**
 * Collapse consecutive same-name DONE tools into "✓ Label ×N".
 * Running / error tools are never collapsed — they each get their own row.
 */
export function ToolList({ tools, detail = false }: ToolListProps): React.ReactElement | null {
  if (tools.length === 0) return null;

  // In detail mode, render every tool individually
  if (detail) {
    return (
      <Box flexDirection="column">
        {tools.map((t, i) => (
          <ToolCall key={i} tool={t} detail />
        ))}
      </Box>
    );
  }

  // Normal mode: collapse consecutive same-name done tools
  const out: React.ReactElement[] = [];
  let i = 0;
  while (i < tools.length) {
    const t = tools[i]!;

    // Count how many consecutive same-name done tools follow (including this one)
    let run = 1;
    while (
      i + run < tools.length &&
      tools[i + run]!.name === t.name &&
      tools[i + run]!.status === "done" &&
      t.status === "done"
    ) {
      run++;
    }

    if (run > 1) {
      // Collapsed row
      out.push(
        <Box key={i}>
          <Text color="green">{"✓ "}</Text>
          <Text>{toToolLabel(t.name) as string}</Text>
          <Text dimColor>{" ×" + run}</Text>
        </Box>,
      );
      i += run;
    } else {
      out.push(<ToolCall key={i} tool={t} detail={false} />);
      i += 1;
    }
  }

  return <Box flexDirection="column">{out}</Box>;
}

export default ToolList;
