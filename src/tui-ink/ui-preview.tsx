/**
 * ui-preview.tsx — Task 2 preview harness.
 *
 * Renders StatusBar in multiple states (normal/yolo/plan, various context
 * usage levels) plus a CJK sample row. Unmounts after 1.5 s.
 *
 * Run: npx tsx src/tui-ink/ui-preview.tsx
 */
import React from "react";
import { render, Box, Text } from "ink";
import { StatusBar } from "./components/StatusBar.js";

function Preview(): React.ReactElement {
  return (
    <Box flexDirection="column" gap={1}>
      <Text>{"— StatusBar —"}</Text>
      <StatusBar
        model="claude-sonnet-4-6"
        mode="normal"
        inputTokens={1200}
        outputTokens={600}
        cost={0.0042}
        turnCount={3}
      />
      <StatusBar
        model="claude-opus-4-8"
        mode="yolo"
        inputTokens={150000}
        outputTokens={30000}
        cost={0.21}
        turnCount={12}
      />
      <Text>{"— 中文样例(CJK 对齐目测) —"}</Text>
      <StatusBar
        model="深度模型 4"
        mode="plan"
        inputTokens={5000}
        outputTokens={2000}
        cost={0}
      />
    </Box>
  );
}

const { unmount } = render(<Preview />);
setTimeout(() => unmount(), 1500);
