/**
 * Pure markdown → ANSI-string functions for the ink TUI.
 *
 * ink <Text> renders ANSI escape codes correctly, so we produce ANSI strings
 * rather than ink element trees.  The actual rendering logic lives in
 * MarkdownRenderer (renderer-markdown.ts) which is battle-tested; we just
 * expose it as pure functions.
 *
 * CONTRACT for renderMarkdownLine:
 *   - Call it only for single, already-complete, non-fence lines.
 *   - Do NOT call it for ``` fence openers/closers or for lines that are
 *     inside a code block.  The streaming TextStream component (F3) tracks
 *     code-block state itself and passes complete fenced blocks to
 *     renderMarkdown() instead.
 */

import { MarkdownRenderer } from "../renderer-markdown.js";

/**
 * Render a full markdown string (including multi-line fenced code blocks,
 * tables, etc.) to an ANSI-escaped string.
 *
 * @param text    - Markdown source text.
 * @param columns - Terminal width used for code-block borders (default 80).
 * @returns ANSI-escaped string suitable for use inside an ink <Text>.
 */
export function renderMarkdown(text: string, columns = 80): string {
  return new MarkdownRenderer(columns).render(text);
}

/**
 * Render a single, already-complete, non-fence line of markdown to an
 * ANSI-escaped string.
 *
 * This is a convenience wrapper for the streaming text path (TextStream, F3)
 * where lines are flushed one at a time.  Headings, list items, blockquotes,
 * inline bold/italic/code are all handled.
 *
 * CONTRACT: the caller is responsible for NOT passing fence lines (```) or
 * code-body lines here.  Pass accumulated code blocks to renderMarkdown().
 *
 * @param line    - A single complete non-fence line of markdown.
 * @param columns - Terminal width (default 80).
 * @returns ANSI-escaped string for that line.
 */
export function renderMarkdownLine(line: string, columns = 80): string {
  return renderMarkdown(line, columns);
}
