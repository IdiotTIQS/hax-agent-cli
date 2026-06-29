import React from "react";
import { Text } from "ink";

/** Status-bar separator: dim vertical bar with surrounding spaces. */
export function Separator(): React.ReactElement {
  return <Text dimColor>{" │ "}</Text>;
}
