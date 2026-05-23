"use strict";

/**
 * Blog / documentation export formats for HaxAgent sessions.
 *
 *   - Blog post
 *   - Tutorial (step-by-step)
 *   - Documentation (API/guide)
 *   - Changelog entry
 *
 * All support Hugo, Jekyll, and generic markdown frontmatter.
 */

// ── helpers ──────────────────────────────────────────────────────────────

function safeStr(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") return JSON.stringify(v, null, 2);
  return String(v);
}

function isoNow() {
  return new Date().toISOString();
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toISOString().split("T")[0];
  } catch {
    return iso;
  }
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ── frontmatter builders ─────────────────────────────────────────────────

/**
 * Build frontmatter block for the requested static-site generator.
 *
 * @param {"hugo"|"jekyll"|"generic"} format
 * @param {object} fields              Key-value pairs for the frontmatter
 * @returns {string} Delimited frontmatter string
 */
function buildFrontmatter(format, fields) {
  const separator = format === "jekyll" ? "---" : "---";

  // Filter out undefined/null values
  const cleanFields = {};
  for (const [key, val] of Object.entries(fields)) {
    if (val !== undefined && val !== null) {
      cleanFields[key] = val;
    }
  }

  const lines = [separator];

  if (format === "hugo") {
    lines.push(_buildTomlFrontmatter(cleanFields));
  } else {
    // Jekyll and generic use YAML-style
    lines.push(_buildYamlFrontmatter(cleanFields));
  }

  lines.push(separator);
  return lines.join("\n");
}

function _buildYamlFrontmatter(fields) {
  const lines = [];
  for (const [key, val] of Object.entries(fields)) {
    if (Array.isArray(val)) {
      lines.push(key + ":");
      for (const item of val) {
        lines.push("  - " + _yamlValue(item));
      }
    } else if (typeof val === "object" && val !== null) {
      lines.push(key + ":");
      for (const [subKey, subVal] of Object.entries(val)) {
        lines.push("  " + subKey + ": " + _yamlValue(subVal));
      }
    } else {
      lines.push(key + ": " + _yamlValue(val));
    }
  }
  return lines.join("\n");
}

function _buildTomlFrontmatter(fields) {
  const lines = [];
  for (const [key, val] of Object.entries(fields)) {
    if (Array.isArray(val)) {
      lines.push(key + " = [" + val.map((v) => _tomlValue(v)).join(", ") + "]");
    } else if (typeof val === "object" && val !== null) {
      lines.push("[" + key + "]");
      for (const [subKey, subVal] of Object.entries(val)) {
        lines.push(subKey + " = " + _tomlValue(subVal));
      }
    } else {
      lines.push(key + " = " + _tomlValue(val));
    }
  }
  return lines.join("\n");
}

function _yamlValue(v) {
  if (typeof v === "string") {
    // Quote if it contains special chars
    if (/[:\{\}\[\],&*#?|!%@`]/.test(v) || v.includes("\n")) {
      return '"' + v.replace(/"/g, '\\"') + '"';
    }
    return v;
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  return '"' + String(v) + '"';
}

function _tomlValue(v) {
  if (typeof v === "string") return '"' + v.replace(/"/g, '\\"') + '"';
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (v instanceof Date) return v.toISOString();
  return '"' + String(v) + '"';
}

// ── content builders ─────────────────────────────────────────────────────

/**
 * Extract all tool-related entries from a session as a summary map.
 */
function extractToolsSummary(entries) {
  const tools = new Map();
  for (const entry of entries) {
    const role = String(entry.role || "").toLowerCase();
    if (role === "tool" && entry.name) {
      const existing = tools.get(entry.name) || { count: 0, errors: 0 };
      existing.count++;
      if (entry.isError) existing.errors++;
      tools.set(entry.name, existing);
    }
  }
  return tools;
}

/**
 * Render entries in "prose" style (user/assistant only, tool results inline).
 */
function renderProseMessages(entries) {
  const lines = [];
  for (const entry of entries) {
    const role = String(entry.role || "").toLowerCase();

    if (role === "user") {
      lines.push("## " + safeStr(entry.content || "").split("\n")[0].slice(0, 80));
      lines.push("");
      lines.push(safeStr(entry.content || ""));
      lines.push("");
    } else if (role === "assistant") {
      lines.push(safeStr(entry.content || ""));
      lines.push("");
    } else if (role === "tool") {
      // Inline tool results as blockquotes
      const prefix = entry.isError ? "> **Error** - " : "> **Result** - ";
      const dataStr = safeStr(
        entry.data !== undefined
          ? typeof entry.data === "string"
            ? entry.data.slice(0, 500)
            : JSON.stringify(entry.data).slice(0, 500)
          : ""
      );
      lines.push(prefix + "`" + (entry.name || "tool") + "`: " + dataStr);
      lines.push("");
    }
  }
  return lines.join("\n");
}

/**
 * Render entries as a step-by-step tutorial.
 */
function renderTutorialSteps(entries) {
  const lines = [];
  let stepNum = 0;

  for (const entry of entries) {
    const role = String(entry.role || "").toLowerCase();

    if (role === "user") {
      stepNum++;
      lines.push("## Step " + stepNum + ": " + _extractStepTitle(entry.content));
      lines.push("");
      lines.push(safeStr(entry.content || ""));
      lines.push("");
    } else if (role === "assistant") {
      lines.push("### Explanation");
      lines.push("");
      lines.push(safeStr(entry.content || ""));
      lines.push("");
    } else if (role === "tool") {
      const toolName = entry.name ? "`" + entry.name + "`" : "tool";
      lines.push("### Tool: " + toolName);
      lines.push("");

      if (entry.isError) {
        lines.push("> **Warning:** This tool call encountered an error.");
        lines.push("");
      }

      const dataStr = safeStr(entry.data !== undefined ? entry.data : entry.content || "");
      const lang = _detectDataLanguage(dataStr);
      lines.push("```" + lang);
      lines.push(dataStr.slice(0, 2000));
      lines.push("```");
      lines.push("");
    }
  }
  return lines.join("\n");
}

function _extractStepTitle(content) {
  if (!content) return "User Request";
  const firstLine = content.trim().split("\n")[0];
  if (firstLine.length > 80) return firstLine.slice(0, 77) + "...";
  return firstLine;
}

function _detectDataLanguage(data) {
  if (!data) return "";
  const trimmed = data.trim();
  if (/^[\[{]/.test(trimmed)) return "json";
  if (/^#!/.test(trimmed) || /^(echo|ls|cd|git|npm|yarn|docker)/.test(trimmed)) return "bash";
  if (/^(import|export|const|let|var|function|class)/.test(trimmed)) return "javascript";
  return "";
}

/**
 * Render documentation-style content: extracting code blocks, showing
 * inputs/outputs, and building API-style doc.
 */
function renderDocContent(entries) {
  const lines = [];

  lines.push("## Overview");
  lines.push("");
  lines.push("This session demonstrates the following workflow:");
  lines.push("");

  const toolsUsed = extractToolsSummary(entries);
  if (toolsUsed.size > 0) {
    lines.push("### Tools Used");
    lines.push("");
    lines.push("| Tool | Calls | Errors |");
    lines.push("| --- | --- | --- |");
    for (const [name, info] of toolsUsed) {
      lines.push("| `" + name + "` | " + info.count + " | " + info.errors + " |");
    }
    lines.push("");
  }

  lines.push("## Session Content");
  lines.push("");

  for (const entry of entries) {
    const role = String(entry.role || "").toLowerCase();

    if (role === "user") {
      lines.push("### Input");
      lines.push("");
      lines.push(safeStr(entry.content || ""));
      lines.push("");
    } else if (role === "assistant") {
      lines.push("### Response");
      lines.push("");
      lines.push(safeStr(entry.content || ""));
      lines.push("");
    } else if (role === "tool") {
      lines.push("#### Tool Call: `" + (entry.name || "unknown") + "`");
      lines.push("");

      if (entry.isError) {
        lines.push("> **Status:** Error");
        lines.push("");
      }

      const dataStr = safeStr(entry.data !== undefined ? entry.data : entry.content || "");
      const lang = _detectDataLanguage(dataStr);
      lines.push("```" + lang);
      lines.push(dataStr.slice(0, 3000));
      lines.push("```");
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Render a changelog-style entry.
 */
function renderChangelogContent(entries, version, releaseDate) {
  const lines = [];

  lines.push("## [" + (version || "Unreleased") + "] - " + formatDate(releaseDate || isoNow()));
  lines.push("");

  const changes = _categorizeChanges(entries);

  if (changes.added.length > 0) {
    lines.push("### Added");
    for (const item of changes.added) {
      lines.push("- " + item.slice(0, 200));
    }
    lines.push("");
  }

  if (changes.changed.length > 0) {
    lines.push("### Changed");
    for (const item of changes.changed) {
      lines.push("- " + item.slice(0, 200));
    }
    lines.push("");
  }

  if (changes.fixed.length > 0) {
    lines.push("### Fixed");
    for (const item of changes.fixed) {
      lines.push("- " + item.slice(0, 200));
    }
    lines.push("");
  }

  if (changes.other.length > 0) {
    lines.push("### Other");
    for (const item of changes.other) {
      lines.push("- " + item.slice(0, 200));
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("### Session Context");
  lines.push("");
  lines.push("| Key | Value |");
  lines.push("| --- | --- |");
  lines.push("| Messages | " + entries.length + " |");

  const toolsUsed = extractToolsSummary(entries);
  if (toolsUsed.size > 0) {
    const toolNames = Array.from(toolsUsed.keys()).map((n) => "`" + n + "`").join(", ");
    lines.push("| Tools Used | " + toolNames + " |");
  }
  lines.push("");

  return lines.join("\n");
}

function _categorizeChanges(entries) {
  const result = { added: [], changed: [], fixed: [], other: [] };

  for (const entry of entries) {
    const role = String(entry.role || "").toLowerCase();
    const content = safeStr(entry.content || "").trim();
    if (!content) continue;

    if (role === "assistant") {
      // Try to categorize based on keywords in assistant messages
      const lower = content.toLowerCase();
      if (/\b(add|added|adds|implement|implemented|create|created|introduce)\b/.test(lower)) {
        result.added.push(content);
      } else if (/\b(fix|fixed|fixes|resolve|resolved|bug|patch|hotfix)\b/.test(lower)) {
        result.fixed.push(content);
      } else if (/\b(change|changed|update|updated|modify|modified|improve|refactor)\b/.test(lower)) {
        result.changed.push(content);
      } else {
        result.other.push(content);
      }
    } else if (role === "tool") {
      const toolName = (entry.name || "").toLowerCase();
      if (toolName.includes("fix") || toolName.includes("bug")) {
        result.fixed.push("Tool `" + entry.name + "` executed");
      } else if (toolName.includes("add") || toolName.includes("create")) {
        result.added.push("Tool `" + entry.name + "` executed");
      } else if (toolName.includes("update") || toolName.includes("change")) {
        result.changed.push("Tool `" + entry.name + "` executed");
      } else {
        result.other.push("Tool `" + entry.name + "` executed");
      }
    }
  }

  return result;
}

// ── public API ───────────────────────────────────────────────────────────

/**
 * Export a session as a formatted blog post.
 *
 * @param {object} session  Session-like: { id, entries(), metadata()?, updatedAt? }
 * @param {object} [options]
 *   { title?, author?, date?, tags?, categories?, summary?,
 *     format?: "hugo"|"jekyll"|"generic", includeFrontmatter?: boolean,
 *     draft?: boolean }
 * @returns {string} Markdown blog post string.
 */
function exportAsBlogPost(session, options = {}) {
  const entries = typeof session.entries === "function" ? session.entries() : [];
  const metadata = typeof session.metadata === "function" ? session.metadata() : {};
  const now = isoNow();
  const title = options.title || metadata?.projectName || "Session Transcript";
  const author = options.author || "";
  const date = options.date || formatDate(session.updatedAt || now);
  const tags = options.tags || [];
  const categories = options.categories || [];
  const summary = options.summary || "";
  const format = options.format || "generic";
  const includeFrontmatter = options.includeFrontmatter !== false;
  const draft = options.draft === true;

  const parts = [];

  if (includeFrontmatter) {
    const fmFields = {
      title: title,
      date: date,
      draft: draft || undefined,
    };
    if (author) fmFields.author = author;
    if (tags.length > 0) fmFields.tags = tags;
    if (categories.length > 0) fmFields.categories = categories;
    if (summary) fmFields.summary = summary;
    fmFields.slug = options.slug || slugify(title);
    fmFields.type = "post";
    fmFields.session_id = session.id || undefined;
    fmFields.message_count = entries.length;

    parts.push(buildFrontmatter(format, fmFields));
    parts.push("");
  }

  parts.push("# " + title);
  parts.push("");

  if (summary) {
    parts.push("> " + summary);
    parts.push("");
  }

  parts.push(renderProseMessages(entries));

  parts.push("---");
  parts.push("");
  parts.push(
    "_Exported from HaxAgent session `" + (session.id || "") + "` (" +
      entries.length + " messages)._"
  );

  return parts.join("\n");
}

/**
 * Export a session as a step-by-step tutorial.
 *
 * @param {object} session  Session-like object.
 * @param {object} [options]
 *   { title?, author?, date?, tags?, difficulty?,
 *     format?: "hugo"|"jekyll"|"generic", includeFrontmatter?: boolean,
 *     estimatedTime?, prerequisites? }
 * @returns {string} Markdown tutorial string.
 */
function exportAsTutorial(session, options = {}) {
  const entries = typeof session.entries === "function" ? session.entries() : [];
  const metadata = typeof session.metadata === "function" ? session.metadata() : {};
  const now = isoNow();
  const title = options.title || "How to: " + (metadata?.projectName || "Use HaxAgent");
  const author = options.author || "";
  const date = options.date || formatDate(session.updatedAt || now);
  const tags = options.tags || [];
  const format = options.format || "generic";
  const includeFrontmatter = options.includeFrontmatter !== false;
  const difficulty = options.difficulty || "intermediate";
  const estimatedTime = options.estimatedTime || "";
  const prerequisites = options.prerequisites || [];

  const parts = [];

  if (includeFrontmatter) {
    const fmFields = {
      title: title,
      date: date,
      type: "tutorial",
      difficulty: difficulty,
      slug: options.slug || slugify(title),
    };
    if (author) fmFields.author = author;
    if (tags.length > 0) fmFields.tags = tags;
    const catVal = options.categories || [];
    if (catVal.length > 0) fmFields.categories = catVal;
    if (estimatedTime) fmFields.estimated_time = estimatedTime;
    if (prerequisites.length > 0) fmFields.prerequisites = prerequisites;
    fmFields.session_id = session.id || undefined;
    fmFields.message_count = entries.length;

    parts.push(buildFrontmatter(format, fmFields));
    parts.push("");
  }

  parts.push("# " + title);
  parts.push("");

  // Tutorial header
  parts.push("| | |");
  parts.push("| --- | --- |");
  parts.push("| **Difficulty** | " + difficulty + " |");
  if (estimatedTime) parts.push("| **Estimated Time** | " + estimatedTime + " |");
  if (prerequisites.length > 0) parts.push("| **Prerequisites** | " + prerequisites.join(", ") + " |");
  parts.push("");

  // Prerequisites section
  if (prerequisites.length > 0) {
    parts.push("## Prerequisites");
    parts.push("");
    for (const prereq of prerequisites) {
      parts.push("- " + prereq);
    }
    parts.push("");
  }

  // Step-by-step content
  parts.push(renderTutorialSteps(entries));

  // Wrap up
  parts.push("## Summary");
  parts.push("");
  parts.push(
    "This tutorial covered " +
      entries.filter((e) => String(e.role).toLowerCase() === "user").length +
      " steps using HaxAgent to accomplish the task."
  );
  parts.push("");

  parts.push("---");
  parts.push(
    "_Exported from HaxAgent session `" + (session.id || "") + "`._"
  );

  return parts.join("\n");
}

/**
 * Export a session as API or guide documentation.
 *
 * @param {object} session  Session-like object.
 * @param {object} [options]
 *   { title?, format?: "hugo"|"jekyll"|"generic", includeFrontmatter?: boolean,
 *     docType?: "api"|"guide"|"reference", weight?, parent? }
 * @returns {string} Markdown documentation string.
 */
function exportAsDocumentation(session, options = {}) {
  const entries = typeof session.entries === "function" ? session.entries() : [];
  const metadata = typeof session.metadata === "function" ? session.metadata() : {};
  const now = isoNow();
  const title = options.title || (metadata?.projectName || "Session") + " Documentation";
  const format = options.format || "generic";
  const includeFrontmatter = options.includeFrontmatter !== false;
  const docType = options.docType || "guide";
  const weight = options.weight;
  const parent = options.parent || "";

  const parts = [];

  if (includeFrontmatter) {
    const fmFields = {
      title: title,
      date: formatDate(now),
      type: "docs",
      doc_type: docType,
      slug: options.slug || slugify(title),
    };
    if (weight !== undefined) fmFields.weight = weight;
    if (parent) fmFields.parent = parent;
    if (options.tags) fmFields.tags = options.tags;
    fmFields.session_id = session.id || undefined;
    fmFields.message_count = entries.length;

    parts.push(buildFrontmatter(format, fmFields));
    parts.push("");
  }

  parts.push("# " + title);
  parts.push("");

  // Documentation breadcrumb / context
  if (parent) {
    parts.push("> Parent: " + parent);
    parts.push("");
  }

  parts.push(renderDocContent(entries));

  parts.push("---");
  parts.push(
    "_Generated from HaxAgent session `" + (session.id || "") + "`._"
  );

  return parts.join("\n");
}

/**
 * Export a session as a changelog entry.
 *
 * @param {object} session  Session-like object.
 * @param {object} [options]
 *   { title?, version?, format?: "hugo"|"jekyll"|"generic",
 *     includeFrontmatter?: boolean, releaseDate? }
 * @returns {string} Markdown changelog entry string.
 */
function exportAsChangelog(session, options = {}) {
  const entries = typeof session.entries === "function" ? session.entries() : [];
  const now = isoNow();
  const version = options.version || "Unreleased";
  const releaseDate = options.releaseDate || formatDate(now);
  const format = options.format || "generic";
  const includeFrontmatter = options.includeFrontmatter !== false;

  const parts = [];

  if (includeFrontmatter) {
    const fmFields = {
      title: "Release " + version,
      date: releaseDate,
      type: "changelog",
      version: version,
      session_id: session.id || undefined,
      message_count: entries.length,
    };

    parts.push(buildFrontmatter(format, fmFields));
    parts.push("");
  }

  parts.push(renderChangelogContent(entries, version, releaseDate));

  return parts.join("\n");
}

// ── exports ──────────────────────────────────────────────────────────────

module.exports = {
  exportAsBlogPost,
  exportAsTutorial,
  exportAsDocumentation,
  exportAsChangelog,
  // Exported for testing
  buildFrontmatter,
  extractToolsSummary,
  formatDate,
  slugify,
};
