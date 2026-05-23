"use strict";

/**
 * Pre-built context templates for common AI-assisted development scenarios.
 *
 * Each template defines:
 *   - sections:    Ordered list of section descriptors, each with:
 *       { name: string, description: string, required?: boolean }
 *   - tokenBudget: Default token budget for this scenario
 *   - priority:    Base priority (higher = more important to include first)
 *   - format:      "system" | "prefix" | "tool" — preferred placement
 */

// ── CODE_REVIEW_CONTEXT ──────────────────────────────────────

const CODE_REVIEW_CONTEXT = Object.freeze({
  name: "code_review",
  description: "Context for code review scenarios — changed files with diffs and related tests",
  tokenBudget: 14000,
  priority: 90,
  format: "prefix",
  sections: Object.freeze([
    {
      name: "Changed Files",
      key: "changedFiles",
      description: "List of files modified, added, or deleted in this changeset",
      required: true,
      maxTokens: 3000,
    },
    {
      name: "Git Diff",
      key: "gitDiff",
      description: "The unified diff of all changes",
      required: true,
      maxTokens: 8000,
    },
    {
      name: "Related Tests",
      key: "relatedTests",
      description: "Test files related to the changed files (by path heuristics)",
      required: false,
      maxTokens: 4000,
    },
    {
      name: "Project Conventions",
      key: "conventions",
      description: "Code style, naming conventions, and architectural patterns",
      required: false,
      maxTokens: 2000,
    },
    {
      name: "Recent Commits",
      key: "recentCommits",
      description: "Recent commit messages for context on the change history",
      required: false,
      maxTokens: 2000,
    },
  ]),
});

// ── BUG_FIX_CONTEXT ─────────────────────────────────────────

const BUG_FIX_CONTEXT = Object.freeze({
  name: "bug_fix",
  description: "Context for debugging — error logs, stack traces, recent changes, and related files",
  tokenBudget: 15000,
  priority: 95,
  format: "prefix",
  sections: Object.freeze([
    {
      name: "Error Information",
      key: "errorInfo",
      description: "Error messages, stack traces, and exception details",
      required: true,
      maxTokens: 6000,
    },
    {
      name: "Recent Changes",
      key: "recentChanges",
      description: "Files and commits changed recently that may have introduced the bug",
      required: true,
      maxTokens: 4000,
    },
    {
      name: "Related Files",
      key: "relatedFiles",
      description: "Source files associated with the error location and stack trace",
      required: true,
      maxTokens: 6000,
    },
    {
      name: "Dependencies",
      key: "dependencies",
      description: "Relevant package/dependency information (versions, updates)",
      required: false,
      maxTokens: 2000,
    },
    {
      name: "Test Files",
      key: "testFiles",
      description: "Test files related to the affected code paths",
      required: false,
      maxTokens: 3000,
    },
  ]),
});

// ── FEATURE_CONTEXT ─────────────────────────────────────────

const FEATURE_CONTEXT = Object.freeze({
  name: "feature",
  description: "Context for building new features — project structure, dependencies, and conventions",
  tokenBudget: 12000,
  priority: 85,
  format: "prefix",
  sections: Object.freeze([
    {
      name: "Project Structure",
      key: "projectStructure",
      description: "Directory layout, key directories, and entry points",
      required: true,
      maxTokens: 4000,
    },
    {
      name: "Dependencies",
      key: "dependencies",
      description: "Available libraries, frameworks, and their versions",
      required: true,
      maxTokens: 3000,
    },
    {
      name: "Conventions",
      key: "conventions",
      description: "Code style, naming rules, patterns, and architectural decisions",
      required: false,
      maxTokens: 3000,
    },
    {
      name: "Related Files",
      key: "relatedFiles",
      description: "Existing files in areas adjacent to the feature",
      required: false,
      maxTokens: 4000,
    },
    {
      name: "Configuration",
      key: "configuration",
      description: "Relevant config files, environment variables, and settings",
      required: false,
      maxTokens: 2000,
    },
  ]),
});

// ── REFACTOR_CONTEXT ────────────────────────────────────────

const REFACTOR_CONTEXT = Object.freeze({
  name: "refactor",
  description: "Context for refactoring — code structure, dependencies, and test coverage",
  tokenBudget: 14000,
  priority: 80,
  format: "prefix",
  sections: Object.freeze([
    {
      name: "Code Structure",
      key: "codeStructure",
      description: "Module graph, import/export relationships, class hierarchies",
      required: true,
      maxTokens: 5000,
    },
    {
      name: "Dependencies",
      key: "dependencies",
      description: "Package dependencies and their usage across the codebase",
      required: true,
      maxTokens: 3000,
    },
    {
      name: "Test Coverage",
      key: "testCoverage",
      description: "Current test files and their relationship to source code",
      required: false,
      maxTokens: 4000,
    },
    {
      name: "Affected Files",
      key: "affectedFiles",
      description: "Files that import or depend on the refactored code",
      required: true,
      maxTokens: 4000,
    },
    {
      name: "Conventions",
      key: "conventions",
      description: "Project conventions that constrain the refactor",
      required: false,
      maxTokens: 2000,
    },
  ]),
});

// ── EXPLAIN_CONTEXT ─────────────────────────────────────────

const EXPLAIN_CONTEXT = Object.freeze({
  name: "explain",
  description: "Context for explaining code — file contents, imports, and documentation",
  tokenBudget: 10000,
  priority: 75,
  format: "prefix",
  sections: Object.freeze([
    {
      name: "File Contents",
      key: "fileContents",
      description: "The full or selected file contents to explain",
      required: true,
      maxTokens: 6000,
    },
    {
      name: "Imports / Exports",
      key: "imports",
      description: "Imported modules and exported symbols",
      required: false,
      maxTokens: 2000,
    },
    {
      name: "Documentation",
      key: "documentation",
      description: "Related documentation, comments, and README sections",
      required: false,
      maxTokens: 3000,
    },
    {
      name: "Dependencies",
      key: "dependencies",
      description: "Libraries and modules referenced by the code",
      required: false,
      maxTokens: 2000,
    },
    {
      name: "Usage Examples",
      key: "usageExamples",
      description: "Call sites, test usages, or example invocations",
      required: false,
      maxTokens: 3000,
    },
  ]),
});

// ── DEPLOY_CONTEXT ──────────────────────────────────────────

const DEPLOY_CONTEXT = Object.freeze({
  name: "deploy",
  description: "Context for deployment — configuration, environment, and recent changes",
  tokenBudget: 10000,
  priority: 70,
  format: "system",
  sections: Object.freeze([
    {
      name: "Configuration",
      key: "configuration",
      description: "Build config, deploy config, environment variables",
      required: true,
      maxTokens: 4000,
    },
    {
      name: "Environment",
      key: "environment",
      description: "Target environment details (platform, runtime, region)",
      required: true,
      maxTokens: 2000,
    },
    {
      name: "Recent Changes",
      key: "recentChanges",
      description: "Commits and diffs since last deployment",
      required: true,
      maxTokens: 4000,
    },
    {
      name: "Dependencies",
      key: "dependencies",
      description: "Packages and their versions being deployed",
      required: false,
      maxTokens: 2000,
    },
    {
      name: "Changelog",
      key: "changelog",
      description: "Human-readable changelog or release notes",
      required: false,
      maxTokens: 2000,
    },
  ]),
});

// ── Template registry ────────────────────────────────────────

/** @type {Map<string, object>} */
const TEMPLATE_REGISTRY = new Map();

function _register(template) {
  TEMPLATE_REGISTRY.set(template.name, template);
  // Also register common aliases
  if (template.name === "code_review") TEMPLATE_REGISTRY.set("review", template);
  if (template.name === "bug_fix") TEMPLATE_REGISTRY.set("debug", template);
  if (template.name === "explain") TEMPLATE_REGISTRY.set("understand", template);
  if (template.name === "deploy") TEMPLATE_REGISTRY.set("release", template);
}

_register(CODE_REVIEW_CONTEXT);
_register(BUG_FIX_CONTEXT);
_register(FEATURE_CONTEXT);
_register(REFACTOR_CONTEXT);
_register(EXPLAIN_CONTEXT);
_register(DEPLOY_CONTEXT);

// ── Public helpers ───────────────────────────────────────────

/**
 * Resolve a template by name, with optional alias matching.
 * @param {string} name
 * @returns {object|undefined}
 */
function getTemplate(name) {
  return TEMPLATE_REGISTRY.get(String(name || "").toLowerCase().trim());
}

/**
 * List all registered template names.
 * @returns {string[]}
 */
function listTemplates() {
  return [...new Set([...TEMPLATE_REGISTRY.keys()])];
}

/**
 * Detect the best matching template for a user query via keyword heuristics.
 * @param {string} query
 * @returns {object|null} The best-matching template, or null if no match
 */
function detectTemplate(query) {
  const q = String(query || "").toLowerCase().trim();
  if (q.length === 0) return null;

  const detectors = [
    { template: BUG_FIX_CONTEXT,       keywords: ["bug", "error", "crash", "exception", "fix", "debug", "broken", "fail", "stack trace", "traceback", "regression"] },
    { template: CODE_REVIEW_CONTEXT,    keywords: ["review", "pr", "pull request", "diff", "change", "patch", "approve", "merge request"] },
    { template: REFACTOR_CONTEXT,       keywords: ["refactor", "restructure", "clean up", "cleanup", "reorganize", "extract", "simplify", "rename", "move module"] },
    { template: FEATURE_CONTEXT,        keywords: ["feature", "add", "implement", "create", "new", "build", "support for", "introduce"] },
    { template: DEPLOY_CONTEXT,         keywords: ["deploy", "release", "publish", "ship", "production", "staging", "ci/cd", "ci", "cd"] },
    { template: EXPLAIN_CONTEXT,        keywords: ["explain", "what does", "how does", "understand", "describe", "walkthrough", "documentation", "document"] },
  ];

  let best = null;
  let bestScore = 0;

  for (const { template, keywords } of detectors) {
    let score = 0;
    for (const kw of keywords) {
      if (q.includes(kw)) {
        score += kw.length >= 4 ? 3 : 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = template;
    }
  }

  return bestScore > 0 ? best : null;
}

/**
 * Build a context object for a template by filling in provided data.
 * @param {object} template - A template object from this module
 * @param {object} data - Key-value map of section key to content string
 * @param {{ placement?: string, tokenBudget?: number }} [options]
 * @returns {{
 *   template: string,
 *   sections: Array<{ name: string, key: string, content: string, required: boolean, maxTokens?: number }>,
 *   placement: string,
 *   tokenBudget: number,
 * }}
 */
function buildTemplateContext(template, data, options = {}) {
  if (!template || !template.sections) {
    return { template: "unknown", sections: [], placement: "prefix", tokenBudget: 10000 };
  }

  const filled = template.sections
    .map(sec => ({
      name: sec.name,
      key: sec.key,
      content: data[sec.key] !== undefined ? String(data[sec.key]) : (sec.required ? `[${sec.name} not available]` : ""),
      required: !!sec.required,
      maxTokens: sec.maxTokens,
    }))
    .filter(sec => sec.content.length > 0);

  return {
    template: template.name,
    sections: filled,
    placement: options.placement || template.format || "prefix",
    tokenBudget: options.tokenBudget || template.tokenBudget || 10000,
  };
}

module.exports = {
  CODE_REVIEW_CONTEXT,
  BUG_FIX_CONTEXT,
  FEATURE_CONTEXT,
  REFACTOR_CONTEXT,
  EXPLAIN_CONTEXT,
  DEPLOY_CONTEXT,
  getTemplate,
  listTemplates,
  detectTemplate,
  buildTemplateContext,
};
