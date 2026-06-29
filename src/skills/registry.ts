/**
 * Skills System — SKILL.md loading, registration, and intent matching.
 * Ported from OpenHarness skills/loader.py + registry.py.
 */

import fs from "fs";
import path from "path";
import os from "os";

// === Skill Definition ===

interface SkillOptions {
  name?: string;
  displayName?: string;
  description?: string;
  content?: string;
  source?: string;
  dir?: string;
  isHidden?: boolean;
  commandName?: string | null;
  aliases?: string[];
  disableModelInvocation?: boolean;
}

class Skill {
  name: string;
  displayName: string;
  description: string;
  content: string;
  source: string;
  dir: string;
  isHidden: boolean;
  commandName: string | null;
  aliases: string[];
  disableModelInvocation: boolean;

  constructor(opts: SkillOptions = {}) {
    this.name = opts.name || "";
    this.displayName = opts.displayName || this.name;
    this.description = opts.description || "";
    this.content = opts.content || "";
    this.source = opts.source || "unknown"; // "bundled" | "user" | "project"
    this.dir = opts.dir || "";
    this.isHidden = !!opts.isHidden;
    this.commandName = opts.commandName || null;
    this.aliases = opts.aliases || [];
    this.disableModelInvocation = !!opts.disableModelInvocation;
  }

  /** Get the skill prompt for sending to the model. */
  getPrompt(): string { return this.content; }

  /** Get prompt for a slash command invocation. */
  getPromptForCommand(args: string[] = []): Array<{ text: string }> {
    let p = this.content;
    if (args.length > 0) p = `Execute skill "${this.name}" with arguments: ${args.join(", ")}\n\n${p}`;
    return [{ text: p }];
  }
}

// === Skill Registry ===

class SkillRegistry {
  private _skills: Map<string, Skill>;

  constructor() { this._skills = new Map(); }

  register(skill: Skill): void {
    if (!(skill instanceof Skill)) throw new Error("Expected Skill instance");
    if (this._skills.has(skill.name)) return;
    this._skills.set(skill.name, skill);
  }

  get(name: string): Skill | null { return this._skills.get(name) || null; }
  list(): Skill[] { return [...this._skills.values()]; }
  get size(): number { return this._skills.size; }

  /** Find skills matching a query by name, description, or content keywords. */
  search(query: string, limit = 5): Skill[] {
    const q = String(query).toLowerCase();
    const scored: Array<{ skill: Skill; score: number }> = [];
    for (const skill of this._skills.values()) {
      if (skill.isHidden) continue;
      let score = 0;
      if (skill.name.toLowerCase().includes(q)) score += 10;
      if (skill.displayName.toLowerCase().includes(q)) score += 8;
      if (skill.description.toLowerCase().includes(q)) score += 5;
      for (const kw of q.split(/\s+/)) {
        if (skill.content.toLowerCase().includes(kw)) score += 1;
      }
      if (score > 0) scored.push({ skill, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(s => s.skill);
  }

  /** Match skill by explicit command name. */
  matchByCommand(cmd: string): Skill | null {
    const c = String(cmd).toLowerCase();
    for (const skill of this._skills.values()) {
      if (skill.commandName === c) return skill;
      if (skill.aliases.includes(c)) return skill;
    }
    return null;
  }

  /** Build system prompt with all registered skills. */
  buildSystemPrompt(): string {
    const skills = this.list().filter(s => !s.isHidden);
    if (!skills.length) return "";
    const lines = ["<available_skills>"];
    for (const s of skills) {
      lines.push(`<skill>\n<name>${s.name}</name>\n<description>${s.description}</description>\n</skill>`);
    }
    lines.push("</available_skills>");
    return lines.join("\n");
  }
}

// === Skill Loading ===

const SKILL_FILE = "SKILL.md";
const SKILL_DIRS: Record<string, string[]> = {
  project: [".hax-agent/skills", ".claude/skills", ".agents/skills"],
};

interface FrontmatterValue {
  [key: string]: string | boolean | string[];
}

interface ParsedFrontmatter {
  frontmatter: FrontmatterValue;
  body: string;
}

/** Load skills from a directory containing SKILL.md subdirectories. */
function loadSkillsFromDir(dir: string, source = "project"): Skill[] {
  const skills: Skill[] = [];
  if (!fs.existsSync(dir)) return skills;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(dir, entry.name, SKILL_FILE);
    if (!fs.existsSync(skillPath)) continue;

    try {
      const raw = fs.readFileSync(skillPath, "utf-8");
      const { frontmatter, body } = parseFrontmatter(raw);
      const fmName = frontmatter["name"];
      const fmDisplayName = frontmatter["display_name"];
      const fmDesc = frontmatter["description"];
      const fmHidden = frontmatter["hidden"];
      const fmCommand = frontmatter["command"];
      const fmAliases = frontmatter["aliases"];
      const fmDisable = frontmatter["disable_model_invocation"];
      skills.push(new Skill({
        name: (typeof fmName === "string" ? fmName : null) || entry.name,
        displayName: (typeof fmDisplayName === "string" ? fmDisplayName : null) || (typeof fmName === "string" ? fmName : null) || entry.name,
        description: typeof fmDesc === "string" ? fmDesc : "",
        content: body,
        source,
        dir: path.join(dir, entry.name),
        isHidden: fmHidden === true,
        commandName: typeof fmCommand === "string" ? fmCommand : null,
        aliases: Array.isArray(fmAliases) ? fmAliases : [],
        disableModelInvocation: fmDisable === true,
      }));
    } catch (_) { /* skip invalid skills */ }
  }
  return skills;
}

/** Parse YAML frontmatter from markdown (--- ... ---). */
function parseFrontmatter(raw: string): ParsedFrontmatter {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };
  const fm: FrontmatterValue = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      let val: string | boolean = line.slice(idx + 1).trim();
      if (val === "true") val = true;
      else if (val === "false") val = false;
      fm[key] = val;
    }
  }
  return { frontmatter: fm, body: match[2].trim() };
}

/** Load all skills (user + project). */
function loadSkillRegistry(cwd = process.cwd()): SkillRegistry {
  const registry = new SkillRegistry();

  // User-level: ~/.haxagent/skills/
  const userDir = path.join(os.homedir(), ".haxagent", "skills");
  for (const s of loadSkillsFromDir(userDir, "user")) registry.register(s);

  // Project-level: .hax-agent/skills/, .claude/skills/
  for (const dir of SKILL_DIRS.project) {
    for (const s of loadSkillsFromDir(path.join(cwd, dir), "project")) registry.register(s);
  }

  return registry;
}

export { Skill, SkillRegistry, loadSkillsFromDir, loadSkillRegistry, parseFrontmatter };
