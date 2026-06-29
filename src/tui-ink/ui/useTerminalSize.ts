import { useEffect, useState } from "react";

export interface TerminalSize {
  columns: number;
  rows: number;
}

/**
 * Tracks terminal dimensions, updating on resize. Falls back to 80x24 when
 * stdout is not a TTY (pipes/CI). Listener cleaned up on unmount.
 */
export function useTerminalSize(): TerminalSize {
  const read = (): TerminalSize => ({
    columns: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  });
  const [size, setSize] = useState<TerminalSize>(read);
  useEffect(() => {
    const onResize = () => setSize(read());
    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
    };
  }, []);
  return size;
}
