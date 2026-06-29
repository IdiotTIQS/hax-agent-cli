/**
 * Skills System — SKILL.md loading, registration, and intent matching.
 * Ported from OpenHarness skills/loader.py + registry.py.
 */

import fs from "fs";
import path from "path";
import os from "os";

// === Skill Definition ===

class Skill {
  constructor(opts = {}) {
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
  getPrompt() { return this.content; }

  /** Get prompt for a slash command invocation. */
  getPromptForCommand(args = []) {
    let p = this.content;
    if (args.length > 0) p = `Execute skill "${this.name}" with arguments: ${args.join(", ")}\n\n${p}`;
    return [{ text: p }];
  }
}

// === Skill Registry ===

class SkillRegistry {
  constructor() { this._skills = new Map(); }

  register(skill) {
    if (!(skill instanceof Skill)) throw new Error("Expected Skill instance");
    if (this._skills.has(skill.name)) return; // Skip duplicates
    this._skills.set(skill.name, skill);
  }

  get(name) { return this._skills.get(name) || null; }
  list() { return [...this._skills.values()]; }
  get size() { return this._skills.size; }

  /** Find skills matching a query by name, description, or content keywords. */
  search(query, limit = 5) {
    const q = String(query).toLowerCase();
    const scored = [];
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
  matchByCommand(cmd) {
    const c = String(cmd).toLowerCase();
    for (const skill of this._skills.values()) {
      if (skill.commandName === c) return skill;
      if (skill.aliases.includes(c)) return skill;
    }
    return null;
  }

  /** Build system prompt with all registered skills. */
  buildSystemPrompt() {
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
const SKILL_DIRS = {
  project: [".hax-agent/skills", ".claude/skills", ".agents/skills"],
};

/** Load skills from a directory containing SKILL.md subdirectories. */
function loadSkillsFromDir(dir, source = "project") {
  const skills = [];
  if (!fs.existsSync(dir)) return skills;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(dir, entry.name, SKILL_FILE);
    if (!fs.existsSync(skillPath)) continue;

    try {
      const raw = fs.readFileSync(skillPath, "utf-8");
      const { frontmatter, body } = parseFrontmatter(raw);
      skills.push(new Skill({
        name: frontmatter.name || entry.name,
        displayName: frontmatter.display_name || frontmatter.name || entry.name,
        description: frontmatter.description || "",
        content: body,
        source,
        dir: path.join(dir, entry.name),
        isHidden: frontmatter.hidden === true,
        commandName: frontmatter.command || null,
        aliases: frontmatter.aliases || [],
        disableModelInvocation: frontmatter.disable_model_invocation === true,
      }));
    } catch (_) { /* skip invalid skills */ }
  }
  return skills;
}

/** Parse YAML frontmatter from markdown (--- ... ---). */
function parseFrontmatter(raw) {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };
  const fm = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      let val = line.slice(idx + 1).trim();
      if (val === "true") val = true;
      else if (val === "false") val = false;
      fm[key] = val;
    }
  }
  return { frontmatter: fm, body: match[2].trim() };
}

/** Load all skills (user + project). */
function loadSkillRegistry(cwd = process.cwd()) {
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
