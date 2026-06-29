/**
 * components-preview.tsx — Visual inspection harness for F3 ink components.
 *
 * Run with: `npx tsx src/tui-ink/components-preview.tsx`
 *
 * Renders each component with realistic mock props so a human can visually
 * verify the output. Unmounts automatically after ~1.5s.
 */
import React from "react";
import { render, Box, Text } from "ink";
import type { ToolCallState } from "./types.js";
import { StatusBar } from "./components/StatusBar.js";
import { SpinnerLine } from "./components/SpinnerLine.js";
import { ThinkingBlock } from "./components/ThinkingBlock.js";
import { TextStream } from "./components/TextStream.js";
import { ToolCall } from "./components/ToolCall.js";
import { ToolList } from "./components/ToolList.js";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const mockRunning: ToolCallState = {
  name: "shell.run",
  input: { command: "npm", args: ["test"] },
  status: "running",
};

const mockDone: ToolCallState = {
  name: "file.read",
  input: { path: "src/renderer.ts" },
  status: "done",
  durationMs: 42,
  data: {
    path: "src/renderer.ts",
    content: "// ...",
    bytes: 18432,
  },
};

const mockError: ToolCallState = {
  name: "file.write",
  input: { path: "src/output.ts" },
  status: "error",
  durationMs: 12,
  error: { code: "EACCES", message: "Permission denied" },
};

const mockFileDone: ToolCallState = {
  name: "file.write",
  input: { path: "src/utils.ts" },
  status: "done",
  durationMs: 88,
  data: {
    path: "src/utils.ts",
    bytes: 2048,
    change: {
      operation: "update",
      added: 5,
      removed: 2,
      preview: [
        { line: 12, marker: "-", text: "const x = 1;" },
        { line: 12, marker: "+", text: "const x = 42;" },
      ],
    },
  },
};

const mockMarkdown = `# Hello from HaxAgent

This is **bold**, _italic_, and \`inline code\`.

\`\`\`ts
const greet = (name: string) => \`Hello, \${name}!\`;
\`\`\`

- Item one
- Item two
- Item three`;

const mockThinking = "Let me think about how to approach this refactor...";

const tools: ToolCallState[] = [mockRunning, mockDone, mockError, mockFileDone];

// ---------------------------------------------------------------------------
// Preview root component
// ---------------------------------------------------------------------------

function Preview(): React.ReactElement {
  return (
    <Box flexDirection="column" gap={1} padding={1}>
      {/* Divider helper */}
      <Text color="gray">{"─".repeat(60)}</Text>
      <Text bold color="cyan">StatusBar</Text>
      <StatusBar
        model="claude-sonnet-4-6"
        mode="normal"
        inputTokens={1234}
        outputTokens={567}
        cost={0.0042}
      />

      <Text color="gray">{"─".repeat(60)}</Text>
      <Text bold color="cyan">SpinnerLine</Text>
      <SpinnerLine
        verb="Analyzing"
        label="src/renderer.ts"
        startTime={Date.now() - 3500}
        tokenCount={128}
      />

      <Text color="gray">{"─".repeat(60)}</Text>
      <Text bold color="cyan">ThinkingBlock</Text>
      <ThinkingBlock text={mockThinking} />

      <Text color="gray">{"─".repeat(60)}</Text>
      <Text bold color="cyan">TextStream (markdown)</Text>
      <TextStream text={mockMarkdown} />

      <Text color="gray">{"─".repeat(60)}</Text>
      <Text bold color="cyan">ToolCall — running</Text>
      <ToolCall tool={mockRunning} />

      <Text color="gray">{"─".repeat(60)}</Text>
      <Text bold color="cyan">ToolCall — done (file.read)</Text>
      <ToolCall tool={mockDone} />

      <Text color="gray">{"─".repeat(60)}</Text>
      <Text bold color="cyan">ToolCall — error</Text>
      <ToolCall tool={mockError} />

      <Text color="gray">{"─".repeat(60)}</Text>
      <Text bold color="cyan">ToolCall — done with FileDiffPreview</Text>
      <ToolCall tool={mockFileDone} />

      <Text color="gray">{"─".repeat(60)}</Text>
      <Text bold color="cyan">ToolList (all 4 tools)</Text>
      <ToolList tools={tools} />

      <Text color="gray">{"─".repeat(60)}</Text>
      <Text color="gray" dimColor>Preview ends — unmounting in ~1.5s</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Render and auto-unmount
// ---------------------------------------------------------------------------

const { unmount, waitUntilExit } = render(<Preview />);
setTimeout(() => unmount(), 1500);
await waitUntilExit();
