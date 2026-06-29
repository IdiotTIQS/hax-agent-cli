/**
 * completions.ts — pure slash/skill completion helper.
 *
 * Mirrors the completer logic from cli.ts: if the current input starts with
 * "/" match against command names and skill names (lowercased prefix match).
 * Returns "/"-prefixed candidates. No React, no side-effects — unit-testable.
 */

/**
 * Compute completions for the current input line.
 *
 * @param value        - The current text in the input box.
 * @param commandNames - Slash command names WITHOUT leading "/" (e.g. ["help", "clear", "model"]).
 * @param skillNames   - Skill names WITHOUT leading "/" (e.g. ["deep-research", "code-review"]).
 * @returns            - Matching candidates WITH leading "/" (e.g. ["/help", "/history"]).
 *                       Empty array if value doesn't start with "/".
 */
export function computeCompletions(
  value: string,
  commandNames: string[],
  skillNames: string[],
): string[] {
  if (!value.startsWith("/")) return [];

  // Slice off the leading "/" for prefix matching.
  const prefix = value.slice(1).toLowerCase();

  const all = [...commandNames, ...skillNames];

  return all
    .filter((name) => name.toLowerCase().startsWith(prefix))
    .map((name) => `/${name}`);
}
