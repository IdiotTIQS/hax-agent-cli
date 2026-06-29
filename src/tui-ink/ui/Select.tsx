import React, { useState } from "react";
import { Box, Text, useInput, useStdin } from "ink";
import { nextIndex, matchHotkey, type SelectItem } from "./select-state.js";

export interface SelectProps {
  items: SelectItem[];
  onSelect: (value: string) => void;
  isFocused?: boolean;
  initialIndex?: number;
}

/**
 * Single-select menu. Arrow keys navigate (wrap), Enter confirms, hotkey
 * letters jump+confirm. Native ink rendering (CJK-safe). Caller controls
 * focus via isFocused (default true); useInput guarded for non-TTY.
 */
export function Select({ items, onSelect, isFocused = true, initialIndex = 0 }: SelectProps): React.ReactElement {
  const [index, setIndex] = useState(initialIndex);
  const { isRawModeSupported } = useStdin();

  useInput(
    (input, key) => {
      if (key.upArrow) { setIndex((i) => nextIndex(i, items.length, -1)); return; }
      if (key.downArrow) { setIndex((i) => nextIndex(i, items.length, 1)); return; }
      if (key.return) { const it = items[index]; if (it) onSelect(it.value); return; }
      const hk = matchHotkey(items, input);
      if (hk !== -1) { setIndex(hk); const it = items[hk]; if (it) onSelect(it.value); }
    },
    { isActive: isFocused && isRawModeSupported },
  );

  return (
    <Box flexDirection="column">
      {items.map((it, i) => {
        const selected = i === index;
        return (
          <Box key={it.value}>
            <Text color={selected ? "cyan" : undefined}>{selected ? "❯ " : "  "}{it.label}</Text>
            {it.hotkey ? <Text dimColor>{" (" + it.hotkey + ")"}</Text> : null}
            {it.description ? <Text dimColor>{"  " + it.description}</Text> : null}
          </Box>
        );
      })}
    </Box>
  );
}
