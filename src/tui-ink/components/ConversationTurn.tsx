/**
 * ConversationTurn.tsx — renders one fully-committed conversation turn.
 *
 * Used inside <Static> in App.tsx so ink never re-renders completed turns.
 * The component is intentionally stateless (pure snapshot rendering).
 *
 * Renders:
 *  - "You" label + user message text
 *  - Optional thinking block (dimmed)
 *  - Optional tool list (detail-mode aware)
 *  - Optional assistant text (via TextStream for markdown)
 *  - Interrupted / error badges
 */

import React from "react";
import { Box, Text } from "ink";
import type { CommittedTurn } from "../types.js";
import { ToolList } from "./ToolList.js";
import { TextStream } from "./TextStream.js";

export interface ConversationTurnProps {
  turn: CommittedTurn;
  detail?: boolean;
}

/** Renders one completed turn (final snapshot, no animation). */
export function ConversationTurn({ turn, detail = false }: ConversationTurnProps): React.ReactElement {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* User message */}
      <Box>
        <Text color="cyan" bold>{"You "}</Text>
        <Text>{turn.userText}</Text>
      </Box>

      {/* Thinking (dimmed, shown when present) */}
      {turn.thinking ? (
        <Box marginLeft={4}>
          <Text dimColor>{turn.thinking}</Text>
        </Box>
      ) : null}

      {/* Tool calls */}
      {turn.tools.length > 0 ? (
        <ToolList tools={turn.tools} detail={detail} />
      ) : null}

      {/* Assistant text */}
      {turn.assistantText ? (
        <TextStream text={turn.assistantText} />
      ) : null}

      {/* Interrupted badge */}
      {turn.interrupted ? (
        <Text color="yellow">{"↑ interrupted"}</Text>
      ) : null}

      {/* Error badge */}
      {turn.error ? (
        <Text color="red">{"Error: " + turn.error}</Text>
      ) : null}
    </Box>
  );
}
