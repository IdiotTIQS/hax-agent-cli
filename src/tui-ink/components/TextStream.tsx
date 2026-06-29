/**
 * TextStream — renders the full accumulated assistant text through renderMarkdown.
 *
 * Color approach: option (a) — renderMarkdown produces pre-formatted ANSI strings
 * which ink <Text> renders correctly by passing them through.
 *
 * Props: text (full accumulated assistant text for the current turn).
 * Uses ink useStdout for terminal columns, falls back to 80.
 */
import React from "react";
import { Text, useStdout } from "ink";
import { renderMarkdown } from "../markdown.js";

export interface TextStreamProps {
  text: string;
}

export function TextStream({ text }: TextStreamProps): React.ReactElement | null {
  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 80;

  if (!text) return null;

  // renderMarkdown returns an ANSI-escaped string; ink <Text> passes it through.
  const rendered = renderMarkdown(text, columns);

  return <Text>{rendered}</Text>;
}

export default TextStream;
