/**
 * Prompt Management — CLAUDE.md / system prompt assembly.
 * Ported from OpenHarness prompts/ pattern.
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const PROMPT_FILES = ["CLAUDE.md", "AGENTS.md", "HAX.md", "README.md"];
const MAX_PROMPT_CHARS = 20000;

/** Load project-level context from CLAUDE.md / AGENTS.md files */
function loadProjectContext(cwd = process.cwd()) {
  const sources = [];
  let current = path.resolve(cwd);

  while (current !== path.dirname(current)) {
    for (const fn of PROMPT_FILES) {
      const fp = path.join(current, fn);
      if (fs.existsSync(fp)) {
        try {
          const content = fs.readFileSync(fp, "utf-8").slice(0, MAX_PROMPT_CHARS);
          sources.push({ file: fp, content });
        } catch (_) {}
      }
    }
    current = path.dirname(current);
  }
  return sources;
}

/** Build environment context section for system prompt */
function buildEnvironmentContext() {
  const parts = [];
  parts.push(`OS: ${process.platform} ${process.arch}`);
  parts.push(`Shell: ${process.env.SHELL || "unknown"}`);
  parts.push(`Workspace: ${process.cwd()}`);
  parts.push(`Date: ${new Date().toISOString().split("T")[0]}`);

  if (process.env.VIRTUAL_ENV) parts.push(`venv: ${process.env.VIRTUAL_ENV}`);
  if (process.env.CONDA_DEFAULT_ENV) parts.push(`conda: ${process.env.CONDA_DEFAULT_ENV}`);

  try {
    const gitBranch = execSync("git branch --show-current 2>/dev/null", { encoding: "utf-8", timeout: 3000 }).trim();
    if (gitBranch) parts.push(`Git branch: ${gitBranch}`);
  } catch (_) {}

  return parts.join("\n");
}

/** Assemble the full system prompt from components */
function buildFullSystemPrompt(basePrompt, options = {}) {
  const sections = [];

  // 1. Base system prompt
  if (basePrompt) sections.push(basePrompt);

  // 2. Project context
  if (!options.skipProjectContext) {
    const sources = loadProjectContext(options.cwd);
    if (sources.length) {
      sections.push("\n<project_context>");
      for (const { file, content } of sources.slice(0, 2)) {
        sections.push(`<!-- source: ${file} -->\n${content}`);
      }
      sections.push("</project_context>");
    }
  }

  // 3. Environment context
  if (!options.skipEnvironment) {
    sections.push(`\n<environment>\n${buildEnvironmentContext()}\n</environment>`);
  }

  // 4. Personalization rules
  if (options.personalizationMarkdown) {
    sections.push(`\n<personalization>\n${options.personalizationMarkdown}\n</personalization>`);
  }

  // 5. Skills
  if (options.skillsXml) {
    sections.push(`\n${options.skillsXml}`);
  }

  return sections.filter(Boolean).join("\n");
}

export { loadProjectContext, buildEnvironmentContext, buildFullSystemPrompt, PROMPT_FILES };
