import assert from "node:assert/strict";
import test from "node:test";
import { nextIndex, matchHotkey, type SelectItem } from "../src/tui-ink/ui/select-state.js";

test("nextIndex wraps forward", () => {
  assert.equal(nextIndex(0, 3, 1), 1);
  assert.equal(nextIndex(2, 3, 1), 0); // wrap
});
test("nextIndex wraps backward", () => {
  assert.equal(nextIndex(0, 3, -1), 2); // wrap
  assert.equal(nextIndex(2, 3, -1), 1);
});
test("nextIndex handles empty/single", () => {
  assert.equal(nextIndex(0, 0, 1), 0);
  assert.equal(nextIndex(0, 1, 1), 0);
});
test("matchHotkey finds first-letter hint", () => {
  const items: SelectItem[] = [
    { label: "Approve", value: "approve", hotkey: "y" },
    { label: "Deny", value: "deny", hotkey: "n" },
  ];
  assert.equal(matchHotkey(items, "n"), 1);
  assert.equal(matchHotkey(items, "Y"), 0); // case-insensitive
  assert.equal(matchHotkey(items, "z"), -1);
});
