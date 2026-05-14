"use strict";

const { SLASH_COMMANDS, SKILLS_SUBCOMMANDS, PERMISSIONS_SUBCOMMANDS, MEMORY_SUBCOMMANDS, TEAM_SUBCOMMANDS } = require("./definitions");

// Self-contained ANSI codes (no dependency on session/renderer)
const A = { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m" };

// Map command name → parsed subcommand list
const SUBCOMMAND_MAP = {
  skills: SKILLS_SUBCOMMANDS,
  permissions: PERMISSIONS_SUBCOMMANDS,
  memory: MEMORY_SUBCOMMANDS,
  team: TEAM_SUBCOMMANDS,
};

/** Parse argHint like '[list|usage]' or '<model-id>' into structured info */
function parseArgHint(hint) {
  if (!hint || typeof hint !== "string") return null;
  const opt = hint.match(/^\[(.+?)\](?:\s|$)/);
  if (opt) return { values: opt[1].split("|").map((s) => s.trim()), isRequired: false };
  const req = hint.match(/^<(.+?)>/);
  if (req) return { values: req[1].split("|").map((s) => s.trim()), isRequired: true };
  return null;
}

// Precompute command registry
const commandMap = new Map();
for (const cmd of SLASH_COMMANDS) {
  const entry = {
    name: cmd.name, aliases: cmd.aliases || [], description: cmd.description || "",
  };
  if (cmd.argHint) { entry.argHint = cmd.argHint; entry.hintInfo = parseArgHint(cmd.argHint); }
  if (SUBCOMMAND_MAP[cmd.name]) {
    entry.subcommands = SUBCOMMAND_MAP[cmd.name];
    entry.hintInfo = { values: SUBCOMMAND_MAP[cmd.name], isRequired: false };
  }
  commandMap.set(cmd.name, entry);
  for (const alias of cmd.aliases || []) commandMap.set(alias, entry);
}

/**
 * Enhanced autocomplete for slash commands.
 *   /t<Tab>         → completes to /tools
 *   /team <Tab>     → shows subcommands: new|spawn|task|run|...
 *   /team ta<Tab>   → completes to /team task
 *   /skills l<Tab>  → completes to /skills list
 *   /<Tab>          → lists all commands
 */
function autoCompleteSlashCommand(rl, session) {
  const line = rl.line;
  if (!line.startsWith("/")) return;

  const trimmed = line.slice(1);
  const spaceIdx = trimmed.indexOf(" ");
  const cmdPart = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const afterCmd = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1);

  if (!cmdPart || !afterCmd) {
    completeCommand(rl, cmdPart);
    return;
  }

  const cmdEntry = commandMap.get(cmdPart);
  if (!cmdEntry || !cmdEntry.hintInfo || !cmdEntry.hintInfo.values.length) return;

  const afterTrimmed = afterCmd.trimEnd();
  const lastSpace = afterTrimmed.lastIndexOf(" ");
  const partial = lastSpace === -1 ? afterTrimmed : afterTrimmed.slice(lastSpace + 1);

  completeSubArg(rl, line, cmdPart, partial, cmdEntry);
}

function completeCommand(rl, partial) {
  const all = [...commandMap.entries()]
    .filter(([n]) => n.length >= 2 && !n.startsWith("?"))
    .map(([name, entry]) => ({
      name, isAlias: entry.name !== name, primary: entry.name,
      description: entry.description, hasSubcommands: !!(entry.subcommands || entry.hintInfo),
    }));

  const seen = new Set();
  const unique = all.filter(c => { const k = c.isAlias ? `alias:${c.name}` : c.name; if (seen.has(k)) return false; seen.add(k); return true; });

  const matches = unique.filter(c => c.name.startsWith(partial));
  if (matches.length === 0) return;

  if (matches.length === 1) {
    const cmd = matches[0];
    rl.line = "/" + cmd.name + " ";
    rl.cursor = rl.line.length;
    rl._refreshLine();
    if (cmd.hasSubcommands) showArgHint(commandMap.get(cmd.name));
    return;
  }

  const cp = commonPrefixStr(matches.map(m => m.name));
  if (cp.length > partial.length) {
    rl.line = "/" + cp;
    // If the common prefix is a complete command name, add trailing space
    if (matches.some(m => m.name === cp)) rl.line += " ";
    rl.cursor = rl.line.length;
    rl._refreshLine();
  }
  showMatchList(matches);
}

function completeSubArg(rl, originalLine, cmdPart, partial, cmdEntry) {
  const choices = cmdEntry.hintInfo.values;
  const matches = choices.filter(c => c.startsWith(partial));

  if (matches.length === 0) { showChoiceList(cmdEntry); return; }

  const lastIdx = originalLine.lastIndexOf(partial);
  if (lastIdx === -1) return;

  if (matches.length === 1) {
    rl.line = originalLine.slice(0, lastIdx) + matches[0] + " ";
    rl.cursor = rl.line.length;
    rl._refreshLine();
    return;
  }

  const cp = commonPrefixStr(matches);
  if (cp.length > partial.length) {
    rl.line = originalLine.slice(0, lastIdx) + cp;
    rl.cursor = rl.line.length;
    rl._refreshLine();
  }
  showSubMatchList(cmdEntry, matches);
}

function commonPrefixStr(strings) {
  return strings.reduce((acc, s) => {
    let i = 0;
    while (i < acc.length && i < s.length && acc[i] === s[i]) i++;
    return s.slice(0, i);
  }, strings[0]);
}

function showArgHint(cmdEntry) {
  const hint = cmdEntry.argHint || (cmdEntry.subcommands ? "[" + cmdEntry.subcommands.join("|") + "]" : "");
  if (!hint) return;
  process.stdout.write(A.reset);
  process.stdout.write(`\n${A.dim}  ${hint}${A.reset}`);
  process.stdout.write(`\x1b[1A\x1b[${process.stdout.columns || 80}C`);
}

function showMatchList(matches) {
  process.stdout.write(A.reset + "\n");
  for (const m of matches.slice(0, 12)) {
    const alias = m.isAlias ? A.dim + "(alias)" + A.reset + " " : "";
    process.stdout.write(`  ${A.bold}/${m.name}${A.reset}  ${A.dim}${alias}${m.description}${A.reset}\n`);
  }
  if (matches.length > 12) process.stdout.write(`  ${A.dim}...and ${matches.length - 12} more${A.reset}\n`);
}

function showSubMatchList(cmdEntry, matches) {
  process.stdout.write(A.reset + "\n");
  const prefix = `  /${cmdEntry.name} `;
  for (const m of matches.slice(0, 12)) {
    process.stdout.write(`  ${A.dim}${prefix}${A.reset}${A.bold}${m}${A.reset}\n`);
  }
  if (matches.length > 12) process.stdout.write(`  ${A.dim}...and ${matches.length - 12} more${A.reset}\n`);
}

function showChoiceList(cmdEntry) {
  process.stdout.write(A.reset + "\n");
  const prefix = `  /${cmdEntry.name} `;
  for (const c of (cmdEntry.subcommands || cmdEntry.hintInfo?.values || []).slice(0, 16)) {
    process.stdout.write(`  ${A.dim}${prefix}${A.reset}${A.bold}${c}${A.reset}\n`);
  }
}

module.exports = { autoCompleteSlashCommand, commandMap };
