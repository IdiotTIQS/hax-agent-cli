"use strict";

const DEFAULT_TOKEN_BUDGET = 12000;
const TOKEN_ESTIMATE_CHARS_PER_TOKEN = 4;
const TRUNCATION_WARNING = "\n[Context truncated due to token budget.]";

/**
 * Injects structured context into prompts with token-budget awareness.
 *
 * Smart placement chooses where to inject:
 *   - system  — prepended to the system prompt
 *   - prefix  — before the user message
 *   - tool    — as a synthetic tool result (after user message)
 */
class ContextInjector {
  /**
   * @param {{ tokenBudget?: number, placement?: "system"|"prefix"|"tool" }} [options]
   */
  constructor(options = {}) {
    this.tokenBudget = Number.isSafeInteger(options.tokenBudget) && options.tokenBudget > 0
      ? options.tokenBudget
      : DEFAULT_TOKEN_BUDGET;
    this.defaultPlacement = ["system", "prefix", "tool"].includes(options.placement)
      ? options.placement
      : "prefix";
  }

  // ── Public API ────────────────────────────────────────────

  /**
   * Inject arbitrary context blocks into a prompt.
   * @param {string} prompt - The user prompt
   * @param {Array<{ label: string, content: string, priority?: number }>} context - Context blocks
   * @param {{ placement?: string, tokenBudget?: number }} [options]
   * @returns {{ prompt: string, contextBlocks: Array, tokensUsed: number, truncated: boolean }}
   */
  inject(prompt, context, options = {}) {
    const budget = this._resolveBudget(options);
    const placement = options.placement || this.defaultPlacement;
    const blocks = this._normalizeBlocks(context);
    const sorted = this._sortByPriority(blocks);
    const { included, tokensUsed, truncated } = this._budgetSorted(sorted, budget);

    return {
      prompt,
      contextBlocks: included,
      tokensUsed,
      truncated,
      placement,
      get systemPrompt() {
        return this._renderSystemPrompt(included);
      },
      get prefixContext() {
        return this._renderPrefix(included);
      },
      get toolResult() {
        return this._renderToolResult(included);
      },
      _renderPlacement(pl) {
        return this.renderPlacement(pl, included);
      },
    };
  }

  /**
   * Inject file contents as context.
   * @param {string} prompt
   * @param {Array<{ path: string, snippet?: string, content?: string, score?: number }>} relevantFiles
   * @param {{ ... }} [options]
   * @returns {{ prompt: string, formattedContext: string, tokensUsed: number, truncated: boolean }}
   */
  injectFileContext(prompt, relevantFiles, options = {}) {
    const files = Array.isArray(relevantFiles) ? relevantFiles : [];
    const budget = this._resolveBudget(options);

    if (files.length === 0) {
      return { prompt, formattedContext: "", tokensUsed: 0, truncated: false };
    }

    const blocks = files.map((f, i) => {
      const label = f.path || `file-${i}`;
      const content = f.snippet || f.content || "";
      const priority = f.score !== undefined ? f.score : 10;
      return { label: `File: ${label}`, content, priority };
    });

    const result = this.inject(prompt, blocks, { ...options, tokenBudget: budget });
    return {
      prompt: result.prompt,
      formattedContext: this.renderPlacement(options.placement || this.defaultPlacement, result.contextBlocks),
      tokensUsed: result.tokensUsed,
      truncated: result.truncated,
    };
  }

  /**
   * Inject git status / diff information.
   * @param {string} prompt
   * @param {{ branch?: string, status?: string, diff?: string, log?: string, changedFiles?: string[] }} gitInfo
   * @param {{ ... }} [options]
   * @returns {{ prompt: string, formattedContext: string, tokensUsed: number, truncated: boolean }}
   */
  injectGitContext(prompt, gitInfo, options = {}) {
    const info = gitInfo || {};
    const budget = this._resolveBudget(options);

    const blocks = [];
    if (info.branch) {
      blocks.push({ label: "Git Branch", content: info.branch, priority: 15 });
    }
    if (info.status) {
      blocks.push({ label: "Git Status", content: info.status, priority: 14 });
    }
    if (info.diff) {
      blocks.push({ label: "Git Diff", content: info.diff, priority: 13 });
    }
    if (info.changedFiles && info.changedFiles.length > 0) {
      blocks.push({ label: "Changed Files", content: info.changedFiles.join("\n"), priority: 12 });
    }
    if (info.log) {
      blocks.push({ label: "Recent Commits", content: info.log, priority: 11 });
    }

    if (blocks.length === 0) {
      return { prompt, formattedContext: "", tokensUsed: 0, truncated: false };
    }

    const result = this.inject(prompt, blocks, { ...options, tokenBudget: budget });
    return {
      prompt: result.prompt,
      formattedContext: this.renderPlacement(options.placement || this.defaultPlacement, result.contextBlocks),
      tokensUsed: result.tokensUsed,
      truncated: result.truncated,
    };
  }

  /**
   * Inject dependency information.
   * @param {string} prompt
   * @param {{ name?: string, version?: string, dependencies?: object, devDependencies?: object, ecosystems?: object }} deps
   * @param {{ ... }} [options]
   * @returns {{ prompt: string, formattedContext: string, tokensUsed: number, truncated: boolean }}
   */
  injectDependencyContext(prompt, deps, options = {}) {
    const info = deps || {};
    const budget = this._resolveBudget(options);

    const blocks = [];
    if (info.name || info.version) {
      const pkgParts = [];
      if (info.name) pkgParts.push(`Package: ${info.name}`);
      if (info.version) pkgParts.push(`Version: ${info.version}`);
      blocks.push({ label: "Package Info", content: pkgParts.join("\n"), priority: 10 });
    }
    if (info.dependencies && Object.keys(info.dependencies).length > 0) {
      blocks.push({
        label: "Dependencies",
        content: Object.entries(info.dependencies)
          .map(([name, ver]) => `- ${name}: ${ver}`)
          .join("\n"),
        priority: 9,
      });
    }
    if (info.devDependencies && Object.keys(info.devDependencies).length > 0) {
      blocks.push({
        label: "Dev Dependencies",
        content: Object.entries(info.devDependencies)
          .map(([name, ver]) => `- ${name}: ${ver}`)
          .join("\n"),
        priority: 8,
      });
    }
    if (info.ecosystems && typeof info.ecosystems === "object") {
      for (const [eco, ecoDeps] of Object.entries(info.ecosystems)) {
        if (ecoDeps && typeof ecoDeps === "object" && Object.keys(ecoDeps).length > 0) {
          blocks.push({
            label: `Dependencies (${eco})`,
            content: Object.entries(ecoDeps)
              .slice(0, 20)
              .map(([name, ver]) => `- ${name}: ${typeof ver === "string" ? ver : JSON.stringify(ver)}`)
              .join("\n"),
            priority: 7,
          });
        }
      }
    }

    if (blocks.length === 0) {
      return { prompt, formattedContext: "", tokensUsed: 0, truncated: false };
    }

    const result = this.inject(prompt, blocks, { ...options, tokenBudget: budget });
    return {
      prompt: result.prompt,
      formattedContext: this.renderPlacement(options.placement || this.defaultPlacement, result.contextBlocks),
      tokensUsed: result.tokensUsed,
      truncated: result.truncated,
    };
  }

  /**
   * Inject conversation history.
   * @param {string} prompt
   * @param {Array<{ role: string, content: string, timestamp?: string }>} history
   * @param {{ ... }} [options]
   * @returns {{ prompt: string, formattedContext: string, tokensUsed: number, truncated: boolean }}
   */
  injectHistoryContext(prompt, history, options = {}) {
    const entries = Array.isArray(history) ? history : [];
    const budget = this._resolveBudget(options);

    if (entries.length === 0) {
      return { prompt, formattedContext: "", tokensUsed: 0, truncated: false };
    }

    // Build as a single block to avoid fragmentation
    const content = entries
      .map((entry, i) => {
        const role = entry.role || "unknown";
        const time = entry.timestamp ? ` [${entry.timestamp}]` : "";
        return `[${i + 1}] ${role}${time}: ${this._truncateText(entry.content || "", 500)}`;
      })
      .join("\n");

    const blocks = [{ label: "Conversation History", content, priority: 20 }];

    const result = this.inject(prompt, blocks, { ...options, tokenBudget: budget });
    return {
      prompt: result.prompt,
      formattedContext: this.renderPlacement(options.placement || this.defaultPlacement, result.contextBlocks),
      tokensUsed: result.tokensUsed,
      truncated: result.truncated,
    };
  }

  /**
   * Inject project overview information.
   * @param {string} prompt
   * @param {{ name?: string, type?: string, languages?: string[], root?: string, overview?: object, tree?: object[], entryPoints?: string[] }} projectInfo
   * @param {{ ... }} [options]
   * @returns {{ prompt: string, formattedContext: string, tokensUsed: number, truncated: boolean }}
   */
  injectProjectContext(prompt, projectInfo, options = {}) {
    const info = projectInfo || {};
    const budget = this._resolveBudget(options);

    const blocks = [];

    if (info.name || info.type) {
      const parts = [];
      if (info.name) parts.push(`Project: ${info.name}`);
      if (info.type) parts.push(`Type: ${info.type}`);
      blocks.push({ label: "Project Identity", content: parts.join("\n"), priority: 25 });
    }

    if (info.languages && info.languages.length > 0) {
      blocks.push({ label: "Languages", content: info.languages.join(", "), priority: 20 });
    }

    if (info.root) {
      blocks.push({ label: "Project Root", content: info.root, priority: 19 });
    }

    if (info.entryPoints && info.entryPoints.length > 0) {
      blocks.push({ label: "Entry Points", content: info.entryPoints.join("\n"), priority: 18 });
    }

    if (info.overview && typeof info.overview === "object") {
      const overview = info.overview;
      const lines = [];
      if (overview.totalFiles !== undefined) lines.push(`Total files: ${overview.totalFiles}`);
      if (overview.totalLines !== undefined) lines.push(`Total lines: ${overview.totalLines}`);
      if (overview.testFiles !== undefined) lines.push(`Test files: ${overview.testFiles}`);
      if (overview.docFiles !== undefined) lines.push(`Doc files: ${overview.docFiles}`);
      if (overview.estimatedCoverage !== undefined) lines.push(`Estimated coverage: ${overview.estimatedCoverage}`);
      if (overview.mainSourceDirs && overview.mainSourceDirs.length > 0) {
        lines.push(`Source dirs: ${overview.mainSourceDirs.join(", ")}`);
      }
      if (lines.length > 0) {
        blocks.push({ label: "Project Overview", content: lines.join("\n"), priority: 17 });
      }
    }

    if (info.tree && Array.isArray(info.tree) && info.tree.length > 0) {
      const treeContent = this._renderFileTree(info.tree, 0, 4);
      blocks.push({ label: "File Tree", content: treeContent, priority: 10 });
    }

    if (blocks.length === 0) {
      return { prompt, formattedContext: "", tokensUsed: 0, truncated: false };
    }

    const result = this.inject(prompt, blocks, { ...options, tokenBudget: budget });
    return {
      prompt: result.prompt,
      formattedContext: this.renderPlacement(options.placement || this.defaultPlacement, result.contextBlocks),
      tokensUsed: result.tokensUsed,
      truncated: result.truncated,
    };
  }

  // ── Placement rendering ────────────────────────────────────

  /**
   * Render context blocks for a specific placement strategy.
   * @param {"system"|"prefix"|"tool"} placement
   * @param {Array<{ label: string, content: string }>} blocks
   * @returns {string}
   */
  renderPlacement(placement, blocks) {
    if (blocks.length === 0) return "";

    switch (placement) {
      case "system":
        return blocks.map(b => `## ${b.label}\n${b.content}`).join("\n\n");

      case "prefix":
        return [
          "<context-injection>",
          "The following context is relevant to the user's query.",
          "",
          ...blocks.map(b => `### ${b.label}\n${b.content}`),
          "</context-injection>",
        ].join("\n");

      case "tool":
        return [
          "## Tool Result: auto_context",
          "Available context for the user's request:",
          "",
          ...blocks.map(b => `### ${b.label}\n${b.content}`),
          "",
          "Use this context only if relevant to the query.",
        ].join("\n");

      default:
        return blocks.map(b => `## ${b.label}\n${b.content}`).join("\n\n");
    }
  }

  // ── Internal helpers ───────────────────────────────────────

  /**
   * @param {Array<{ label: string, content: string, priority?: number }>} context
   * @returns {Array<{ label: string, content: string, priority: number }>}
   */
  _normalizeBlocks(context) {
    return (Array.isArray(context) ? context : [])
      .filter(b => b && typeof b.content === "string" && b.content.trim().length > 0)
      .map((b, i) => ({
        label: b.label || `context-${i}`,
        content: b.content,
        priority: typeof b.priority === "number" ? b.priority : 0,
      }));
  }

  _sortByPriority(blocks) {
    return [...blocks].sort((a, b) => b.priority - a.priority);
  }

  _budgetSorted(sorted, budget) {
    const included = [];
    let tokensUsed = 0;
    let truncated = false;

    for (const block of sorted) {
      const blockTokens = this._estimateTokens(block.label) + this._estimateTokens(block.content);
      const separatorTokens = 3; // Approximate overhead for formatting

      if (tokensUsed + blockTokens + separatorTokens <= budget) {
        included.push(block);
        tokensUsed += blockTokens + separatorTokens;
      } else if (tokensUsed < budget) {
        // Partial fit: try to truncate
        const available = budget - tokensUsed - separatorTokens;
        if (available > 20) {
          const truncatedContent = this._truncateToTokens(block.content, available);
          included.push({ ...block, content: truncatedContent + TRUNCATION_WARNING });
          tokensUsed = budget;
          truncated = true;
        }
        break;
      } else {
        truncated = true;
        break;
      }
    }

    return { included, tokensUsed, truncated };
  }

  _resolveBudget(options) {
    return Number.isSafeInteger(options.tokenBudget) && options.tokenBudget > 0
      ? options.tokenBudget
      : this.tokenBudget;
  }

  _estimateTokens(text) {
    return Math.ceil(String(text || "").length / TOKEN_ESTIMATE_CHARS_PER_TOKEN);
  }

  _truncateToTokens(text, maxTokens) {
    const chars = String(text || "");
    const maxChars = Math.max(0, maxTokens * TOKEN_ESTIMATE_CHARS_PER_TOKEN - TRUNCATION_WARNING.length);
    if (chars.length <= maxChars) return chars;
    return chars.slice(0, Math.max(0, maxChars));
  }

  _truncateText(text, maxLength) {
    const s = String(text || "");
    if (s.length <= maxLength) return s;
    return s.slice(0, maxLength - 1) + "…";
  }

  _renderFileTree(nodes, depth, maxDepth) {
    if (depth > maxDepth) return "";
    const lines = [];
    for (const node of nodes) {
      if (!node) continue;
      const indent = "  ".repeat(depth);
      if (node.type === "directory" || node.children) {
        lines.push(`${indent}${node.name}/`);
        if (node.children && Array.isArray(node.children)) {
          lines.push(this._renderFileTree(node.children, depth + 1, maxDepth));
        }
      } else {
        const name = node.name || node.path || "(unknown)";
        lines.push(`${indent}${name}`);
      }
    }
    return lines.filter(Boolean).join("\n");
  }
}

module.exports = {
  ContextInjector,
};
