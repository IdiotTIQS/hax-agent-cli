/**
 * ToolList — renders a flat list of ToolCall components.
 *
 * Kept simple for F3 (flat list). Collapsing of consecutive identical-name
 * tools is deferred to a future pass — noted in F3 report.
 *
 * Props: tools (array of ToolCallState).
 */
import React from "react";
import { Box } from "ink";
import type { ToolCallState } from "../types.js";
import { ToolCall } from "./ToolCall.js";

export interface ToolListProps {
  tools: ToolCallState[];
}

export function ToolList({ tools }: ToolListProps): React.ReactElement | null {
  if (tools.length === 0) return null;

  return (
    <Box flexDirection="column">
      {tools.map((tool, i) => (
        <ToolCall key={`${tool.name}-${i}`} tool={tool} />
      ))}
    </Box>
  );
}

export default ToolList;
