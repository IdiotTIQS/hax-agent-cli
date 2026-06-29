/**
 * ToolCall — native ink rendering for a single tool call.
 *
 * Status icons:
 *   ⟳ yellow  — running
 *   ✓ green   — done
 *   ✗ red     — error
 *
 * Pure text formatters (toToolLabel, formatDuration) are reused from
 * renderer.ts for label/duration text; rendering is 100% native ink elements.
 *
 * The optional `detail` prop controls whether DiffView is shown beneath a
 * done tool (for file.edit results that carry a diff string).
 */
import React from "react";
import { Box, Text } from "ink";
import type { ToolCallState } from "../types.js";
// eslint-disable-next-line -- pure text formatters reused from the legacy renderer
import { toToolLabel, formatDuration } from "../../renderer.js";
import { DiffView } from "./DiffView.js";

export interface ToolCallProps {
  tool: ToolCallState;
  /** When true, show DiffView beneath done tools that carry diff data. */
  detail?: boolean;
}

function statusIcon(status: ToolCallState["status"]): { icon: string; color: string } {
  if (status === "running") return { icon: "⟳", color: "yellow" };
  if (status === "error") return { icon: "✗", color: "red" };
  return { icon: "✓", color: "green" };
}

/**
 * Produce a short human-readable summary of the tool input.
 * Avoids leaking secrets (content/key/token/password fields are skipped).
 */
function inputSummary(input: Record<string, unknown>): string {
  // Prefer a path field for file tools — most readable
  if (typeof input.path === "string") return input.path;
  if (typeof input.command === "string") {
    const args = Array.isArray(input.args)
      ? (input.args as unknown[]).join(" ")
      : "";
    const full = args ? `${input.command} ${args}` : input.command;
    return full.length > 60 ? full.slice(0, 57) + "…" : full;
  }
  // Generic fallback: first displayable scalar entry
  for (const [k, v] of Object.entries(input)) {
    if (/key|token|secret|password|content|env/i.test(k)) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      const s = String(v);
      return s.length > 60 ? s.slice(0, 57) + "…" : s;
    }
  }
  return "";
}

export function ToolCall({ tool, detail = false }: ToolCallProps): React.ReactElement {
  const { icon, color } = statusIcon(tool.status);
  const label = toToolLabel(tool.name) as string;
  // formatDuration returns e.g. " in 42ms" or "" — prefix is already included
  const dur = tool.durationMs != null ? (formatDuration(tool.durationMs) as string) : "";
  const summary = inputSummary(tool.input);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color}>{icon + " "}</Text>
        <Text>{label}</Text>
        {summary ? <Text dimColor>{" " + summary}</Text> : null}
        {dur ? <Text dimColor>{dur}</Text> : null}
        {tool.status === "error" && tool.error ? (
          <Text color="red">{"  " + tool.error.message}</Text>
        ) : null}
      </Box>
      {detail && tool.status === "done" ? <DiffView tool={tool} /> : null}
    </Box>
  );
}

export default ToolCall;
