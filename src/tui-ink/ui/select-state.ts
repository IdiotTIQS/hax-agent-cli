export interface SelectItem {
  label: string;
  value: string;
  description?: string;
  hotkey?: string;
}

/** Wrap-around index move. dir +1 = down/next, -1 = up/prev. */
export function nextIndex(current: number, len: number, dir: 1 | -1): number {
  if (len <= 0) return 0;
  return (current + dir + len) % len;
}

/** Index of the item whose hotkey matches `input` (case-insensitive), or -1. */
export function matchHotkey(items: SelectItem[], input: string): number {
  const k = input.toLowerCase();
  return items.findIndex((it) => it.hotkey && it.hotkey.toLowerCase() === k);
}
