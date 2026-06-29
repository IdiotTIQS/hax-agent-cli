/**
 * CommandPalette.tsx — slash-command picker (Task T6).
 *
 * Renders a rounded-border dropdown of matching slash commands/skills based on
 * the current input query. Select handles ↑↓/Enter navigation; useInput handles
 * Esc to close. Returns null when there are no matches (hides itself cleanly).
 *
 * Non-TTY guard: ink throws during useInput hook registration in non-TTY
 * environments even when isActive=false. We split the interactive layer into a
 * child component that is only mounted when isRawModeSupported is true; the
 * non-interactive display layer always renders, so the preview harness works.
 */
import React from "react";
import { Box, Text, useInput, useStdin } from "ink";
import { Select, type SelectItem } from "../ui/index.js";
import { computeCompletions } from "../completions.js";

export interface CommandPaletteProps {
  query: string;
  commandNames: string[];
  skillNames: string[];
  onPick: (value: string) => void;
  onClose: () => void;
}

/** Interactive layer — only mounted in real TTY sessions. */
function PaletteInput({
  items,
  onPick,
  onClose,
}: {
  items: SelectItem[];
  onPick: (value: string) => void;
  onClose: () => void;
}): React.ReactElement {
  // Esc closes the palette; Select handles ↑↓/Enter.
  useInput((_input, key) => {
    if (key.escape) onClose();
  });
  return <Select items={items} onSelect={onPick} isFocused />;
}

/** Display-only list — rendered in both TTY and non-TTY (preview harness). */
function PaletteList({ items }: { items: SelectItem[] }): React.ReactElement {
  return (
    <Box flexDirection="column">
      {items.map((it, i) => (
        <Box key={it.value}>
          <Text color={i === 0 ? "cyan" : undefined}>{i === 0 ? "❯ " : "  "}{it.label}</Text>
        </Box>
      ))}
    </Box>
  );
}

export function CommandPalette({
  query,
  commandNames,
  skillNames,
  onPick,
  onClose,
}: CommandPaletteProps): React.ReactElement | null {
  const { isRawModeSupported } = useStdin();
  const matches = computeCompletions(query, commandNames, skillNames);

  if (matches.length === 0) return null;

  const items: SelectItem[] = matches.map((m) => ({ label: m, value: m }));

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text dimColor>{"commands (esc to close)"}</Text>
      {isRawModeSupported ? (
        <PaletteInput items={items} onPick={onPick} onClose={onClose} />
      ) : (
        <PaletteList items={items} />
      )}
    </Box>
  );
}
