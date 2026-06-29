/**
 * ThinkingBlock — renders accumulated thinking/reasoning text in dim gray.
 *
 * Color approach: ink color props (option b). Empty text renders nothing.
 *
 * Props: text (accumulated thinking string for the current turn).
 */
import React from "react";
import { Box, Text } from "ink";

export interface ThinkingBlockProps {
  text: string;
}

export function ThinkingBlock({ text }: ThinkingBlockProps): React.ReactElement | null {
  if (!text) return null;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="gray" dimColor>
        💭 {text}
      </Text>
    </Box>
  );
}

export default ThinkingBlock;
