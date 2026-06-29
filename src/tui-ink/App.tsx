import React from "react";
import { Box, Text } from "ink";

/**
 * Minimal ink App skeleton (Stage E).
 *
 * This is the seed of the ink-based TUI that will replace the readline +
 * ResponseRenderer + TUI stack in Stage F. It is intentionally NOT wired into
 * cli.ts yet — the existing readline loop remains the live interface. This
 * component only proves the ink + React + TS(NodeNext, jsx:react-jsx)
 * toolchain runs under both dev (tsx) and build (tsc -> node).
 */
export interface AppProps {
  name?: string;
}

export function App({ name = "HaxAgent" }: AppProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text color="green">
        ink TUI online — {name}
      </Text>
    </Box>
  );
}

export default App;
