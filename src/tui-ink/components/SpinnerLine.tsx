/**
 * SpinnerLine — braille-spinner at 80ms with elapsed time and token count.
 *
 * Color approach: mix of ink color props (new chrome) and raw strings.
 * SPINNER_FRAMES / SPINNER_VERBS reused from src/renderer.js (option a for
 * the frames data, option b for ink color rendering).
 *
 * Props: verb (optional, random from SPINNER_VERBS), label, startTime, tokenCount.
 * Cleans up the interval on unmount.
 */
import React, { useState, useEffect, useRef } from "react";
import { Text } from "ink";
import { SPINNER_FRAMES, SPINNER_VERBS } from "../../renderer.js";

export interface SpinnerLineProps {
  verb?: string;
  label?: string;
  startTime: number;
  tokenCount?: number;
}

export function SpinnerLine({
  verb,
  label,
  startTime,
  tokenCount = 0,
}: SpinnerLineProps): React.ReactElement {
  // Pick a stable random verb once on mount — useRef so it doesn't change per
  // render, but doesn't cause an extra render either.
  const stableVerb = useRef<string>(
    verb ?? SPINNER_VERBS[Math.floor(Math.random() * SPINNER_VERBS.length)]
  );

  const [frameIndex, setFrameIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setFrameIndex((i) => (i + 1) % SPINNER_FRAMES.length);
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 80);
    return () => clearInterval(id); // CLEAR on unmount
  }, [startTime]);

  const frame = SPINNER_FRAMES[frameIndex];
  const elapsedStr = elapsed > 0 ? ` ${elapsed}s` : "";
  const tokenStr = tokenCount > 0 ? ` ${tokenCount} tokens` : "";
  const labelStr = label ? ` ${label}` : "";

  return (
    <Text>
      <Text color="cyan">{frame}</Text>
      {" "}
      <Text bold>{stableVerb.current}</Text>
      <Text color="gray">{labelStr}{elapsedStr}{tokenStr}</Text>
    </Text>
  );
}

export default SpinnerLine;
