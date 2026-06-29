/**
 * QueryContext — shared context across a query run.
 * Tracks task focus, read files, invoked skills, work log, verified state.
 * Ported from OpenHarness engine/query.py QueryContext.
 */

import path from "path";
import fs from "fs";
import os from "os";

const MAX_TRACKED_READ_FILES = 6;
const MAX_TRACKED_SKILLS = 8;
const MAX_TRACKED_WORK_LOG = 10;
const MAX_TRACKED_USER_GOALS = 5;
const MAX_TRACKED_ACTIVE_ARTIFACTS = 8;
const MAX_TRACKED_VERIFIED_WORK = 10;
const MAX_SAFE_COMPLETION_TOKENS = 128000;
const TOOL_INLINE_MAX_CHARS = 8000;

class QueryContext {
  constructor(o = {}) {
    this.cwd = o.cwd || process.cwd();
    this.model = o.model || "";
    this.systemPrompt = o.systemPrompt || "";
    this.maxTokens = o.maxTokens || 8192;
    this.effort = o.effort || null;
    this.contextWindowTokens = o.contextWindowTokens || null;
    this.autoCompactThresholdTokens = o.autoCompactThresholdTokens || null;
    this.maxTurns = o.maxTurns ?? 200;
    this.permissionChecker = o.permissionChecker || null;
    this.hookExecutor = o.hookExecutor || null;
    this.toolMetadata = o.toolMetadata || {};

    // Initialize task focus state
    if (!this.toolMetadata.task_focus_state) {
      this.toolMetadata.task_focus_state = {
        goal: "", recent_goals: [], active_artifacts: [],
        verified_state: [], next_step: "",
      };
    }
    if (!this.toolMetadata.read_file_state) this.toolMetadata.read_file_state = [];
    if (!this.toolMetadata.invoked_skills) this.toolMetadata.invoked_skills = [];
    if (!this.toolMetadata.recent_work_log) this.toolMetadata.recent_work_log = [];
  }

  get taskFocus() { return this.toolMetadata.task_focus_state || {}; }
  get readFiles() { return this.toolMetadata.read_file_state || []; }
  get invokedSkills() { return this.toolMetadata.invoked_skills || []; }
  get workLog() { return this.toolMetadata.recent_work_log || []; }

  /** Append to a capped unique list */
  _appendCapped(bucket, value, limit) {
    const idx = bucket.indexOf(value);
    if (idx >= 0) bucket.splice(idx, 1);
    bucket.push(value);
    while (bucket.length > limit) bucket.shift();
  }

  /** Track a read file operation */
  rememberReadFile(filePath, offset, limit, output) {
    const preview = output.split("\n").slice(0, 6).map(l => l.trim()).filter(Boolean).join(" | ").slice(0, 320);
    const entry = { path: filePath, span: `lines ${offset + 1}-${offset + limit}`, preview, timestamp: Date.now() };
    const bucket = this.toolMetadata.read_file_state;
    const idx = bucket.findIndex(e => e.path === filePath);
    if (idx >= 0) bucket.splice(idx, 1);
    bucket.push(entry);
    while (bucket.length > MAX_TRACKED_READ_FILES) bucket.shift();
  }

  /** Track a skill invocation */
  rememberSkill(skillName) {
    const n = (skillName || "").trim();
    if (!n) return;
    this._appendCapped(this.toolMetadata.invoked_skills, n, MAX_TRACKED_SKILLS);
  }

  /** Track a work log entry */
  rememberWorkLog(entry) {
    if (!entry) return;
    this._appendCapped(this.toolMetadata.recent_work_log, entry.trim().slice(0, 320), MAX_TRACKED_WORK_LOG);
  }

  /** Track verified work */
  rememberVerifiedWork(entry) {
    if (!entry) return;
    this._appendCapped(this.toolMetadata.task_focus_state.verified_state, entry.trim().slice(0, 320), MAX_TRACKED_VERIFIED_WORK);
  }

  /** Set current goal */
  setGoal(goal) {
    const summary = (goal || "").replace(/\s+/g, " ").trim().slice(0, 240);
    if (!summary) return;
    const tf = this.toolMetadata.task_focus_state;
    this._appendCapped(tf.recent_goals, summary, MAX_TRACKED_USER_GOALS);
    tf.goal = summary;
  }

  /** Build context summary for system prompt injection */
  buildContextSummary() {
    const parts = [];
    const tf = this.taskFocus;
    if (tf.goal) parts.push(`Current goal: ${tf.goal}`);
    if (tf.next_step) parts.push(`Next step: ${tf.next_step}`);
    if (tf.active_artifacts.length) parts.push(`Active artifacts: ${tf.active_artifacts.slice(0, 5).join(", ")}`);
    if (this.invokedSkills.length) parts.push(`Invoked skills: ${this.invokedSkills.slice(-5).join(", ")}`);
    if (this.readFiles.length) {
      const files = this.readFiles.slice(-3).map(f => `${f.path} (${f.span})`).join(", ");
      parts.push(`Recently read: ${files}`);
    }
    if (this.workLog.length) {
      const log = this.workLog.slice(-5).join("; ");
      parts.push(`Recent work: ${log}`);
    }
    return parts.length ? parts.join("\n") : "";
  }
}

// === Tool Output Offloading ===

function offloadToolOutput(toolName, toolUseId, output) {
  if (typeof output !== "string") output = JSON.stringify(output);
  if (output.length <= TOOL_INLINE_MAX_CHARS) return { inline: output, file: null };

  const dir = path.join(os.homedir(), ".haxagent", "tool_artifacts");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const safe = toolName.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 80);
  const fp = path.join(dir, `${ts}-${safe}-${Date.now().toString(36)}.txt`);
  fs.writeFileSync(fp, output, "utf-8");

  const preview = output.slice(0, 500);
  const omitted = output.length - preview.length;
  const inline = [
    "[Tool output truncated]",
    `Tool: ${toolName}`, `Original size: ${output.length.toLocaleString()} chars`,
    `Full output saved to: ${fp}`,
    `\nPreview (${preview.length.toLocaleString()} chars):\n${preview}${omitted > 0 ? `\n... ${omitted.toLocaleString()} chars omitted` : ""}`,
  ].join("\n");
  return { inline, file: fp };
}

// === Prompt Too Long Detection ===

// Import typed error classifier from core
import { classifyApiError, isContextTooLongError } from "../core/api/errors.js";

/**
 * Check if an error indicates context/prompt is too long.
 * @deprecated Use isContextTooLongError from core/api/errors instead.
 * Kept for backward compatibility.
 */
function isPromptTooLongError(err) {
  return isContextTooLongError(err);
}

function boundedCompletionTokens(maxTokens, contextWindow) {
  let limit = MAX_SAFE_COMPLETION_TOKENS;
  if (contextWindow && contextWindow > 0) limit = Math.min(limit, contextWindow);
  return Math.max(1, Math.min(maxTokens, limit));
}

// === Image Preprocessing (stub) ===

const IMAGE_PREPROCESS_STATUS = "Converting image to text description via vision model...";

function hasImageBlocks(messages) {
  for (const m of messages) {
    if (Array.isArray(m.content)) {
      for (const b of m.content) if (b && b.type === "image") return true;
    }
  }
  return false;
}

// === Tool Context Tracking ===

function rememberToolContext(ctx, toolName, toolInput, toolOutput) {
  if (!ctx || !(ctx instanceof QueryContext)) return;

  const input = toolInput || {};
  // File read tracking
  if (toolName === "file.read" && input.path) {
    ctx.rememberReadFile(input.path, input.offset || 0, input.limit || 200, typeof toolOutput === "string" ? toolOutput : "");
    ctx.rememberWorkLog(`Read file ${input.path}`);
  }
  // File write/edit tracking
  else if (toolName === "file.write" && input.path) {
    ctx.rememberWorkLog(`Wrote file ${input.path}`);
    ctx.rememberVerifiedWork(`Created/modified ${input.path}`);
  }
  else if (toolName === "file.edit" && input.path) {
    ctx.rememberWorkLog(`Edited file ${input.path}`);
    ctx.rememberVerifiedWork(`Edited ${input.path}`);
  }
  // Shell tracking
  else if (toolName === "shell.run") {
    const cmd = input.command || "";
    const summary = (typeof toolOutput === "string" ? toolOutput : "").split("\n")[0]?.trim().slice(0, 120) || "ran";
    ctx.rememberWorkLog(`Ran ${cmd.slice(0, 160)} [${summary}]`);
    ctx.rememberVerifiedWork(`Ran shell: ${cmd.slice(0, 180)}`);
  }
  // Web search tracking
  else if (toolName === "web.search" && input.query) {
    ctx.rememberVerifiedWork(`Searched web for ${input.query.slice(0, 180)}`);
  }
  else if (toolName === "web.fetch" && input.url) {
    ctx.rememberVerifiedWork(`Fetched ${input.url.slice(0, 180)}`);
  }
  else if (toolName === "file.glob" && input.pattern) {
    ctx.rememberVerifiedWork(`Glob ${input.pattern.slice(0, 180)}`);
  }
  else if (toolName === "skill") {
    ctx.rememberSkill(input.name || "");
    ctx.rememberWorkLog(`Loaded skill ${input.name || ""}`);
  }
}

export {
  QueryContext, offloadToolOutput, isPromptTooLongError,
  boundedCompletionTokens, hasImageBlocks, IMAGE_PREPROCESS_STATUS,
  rememberToolContext,
  MAX_TRACKED_READ_FILES, MAX_TRACKED_SKILLS, MAX_TRACKED_WORK_LOG,
  MAX_TRACKED_USER_GOALS, MAX_SAFE_COMPLETION_TOKENS,
};
