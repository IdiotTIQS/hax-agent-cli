/**
 * UserInput — the interactive chat input line.
 *
 * Wraps ink-text-input for the editable text area and adds:
 *   - Arrow-Up/Down history navigation via InputHistory from src/session.ts.
 *   - A simple completion list rendered below the input (list only; selecting
 *     is handled by Tab — F5 will wire that if desired; for now list is passive).
 *   - A disabled mode that renders the line as read-only while streaming.
 *
 * Arrow key handling notes:
 *   ink-text-input@6 uses useInput internally and consumes Left/Right for cursor
 *   movement. It does NOT consume Up/Down (those are not text-cursor keys).
 *   We add a second useInput that listens for Up/Down to drive InputHistory.
 *   Ink allows multiple concurrent useInput consumers — each receives every
 *   keypress; they don't "steal" from each other. So the two consumers coexist
 *   cleanly: TextInput handles Left/Right/Backspace/Delete/text; ours handles
 *   Up/Down.
 *
 *   When `disabled` is true we pass `focus={false}` to TextInput, silencing its
 *   internal useInput. We also gate our own useInput so it does nothing.
 */

import React, { useRef } from "react";
import { Box, Text, useInput, useStdin } from "ink";
import TextInput from "ink-text-input";
import { InputHistory } from "../../session.js";

export interface UserInputProps {
  /** Current controlled value of the input box. */
  value: string;
  /** Called on every keystroke to update the value. */
  onChange: (v: string) => void;
  /** Called when Enter is pressed. Receives the submitted text. */
  onSubmit: (v: string) => void;
  /**
   * When true (streaming in progress) the input does not accept keystrokes.
   * TextInput is rendered read-only (focus=false) and the history hook is
   * bypassed.
   */
  disabled?: boolean;
  /**
   * Completions computed by the parent (via computeCompletions).
   * Rendered as a passive list below the input line when non-empty.
   */
  completions?: string[];
  /** Prompt prefix shown before the text input. Defaults to "> ". */
  promptLabel?: string;
}

export function UserInput({
  value,
  onChange,
  onSubmit,
  disabled = false,
  completions = [],
  promptLabel = "> ",
}: UserInputProps): React.ReactElement {
  // One InputHistory instance per mount — persists across renders.
  const historyRef = useRef<InputHistory>(new InputHistory(1000));

  // isRawModeSupported is false when stdin is not a TTY (CI/pipe/debug).
  // Guard useInput to avoid "Raw mode not supported" throws.
  const { isRawModeSupported } = useStdin();
  const inputActive = isRawModeSupported && !disabled;

  // Arrow-Up/Down history navigation.
  // useInput is always called (hooks rule), but the handler is a no-op when
  // disabled so we don't interfere with the approval prompt or other active inputs.
  useInput(
    (_input, key) => {
      if (key.upArrow) {
        const next = historyRef.current.up(value);
        onChange(next);
        return;
      }

      if (key.downArrow) {
        const next = historyRef.current.down(value);
        onChange(next);
        return;
      }
    },
    { isActive: inputActive },
  );

  function handleSubmit(submitted: string): void {
    if (disabled) return;
    const trimmed = submitted.trim();
    if (trimmed) {
      historyRef.current.add(trimmed);
    }
    historyRef.current.reset();
    onSubmit(submitted);
  }

  return (
    <Box flexDirection="column">
      {/* Input line */}
      <Box flexDirection="row">
        <Text color={disabled ? "gray" : "cyan"}>{promptLabel}</Text>
        {disabled ? (
          // Read-only placeholder while streaming — show dimmed current value.
          <Text color="gray">{value || "…"}</Text>
        ) : (
          <TextInput
            value={value}
            onChange={onChange}
            onSubmit={handleSubmit}
            focus={isRawModeSupported}
            showCursor={isRawModeSupported}
          />
        )}
      </Box>

      {/* Completion suggestions */}
      {!disabled && completions.length > 0 && (
        <Box flexDirection="column" marginLeft={2}>
          {completions.slice(0, 8).map((c) => (
            <Text key={c} color="gray" dimColor>
              {c}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

export default UserInput;
