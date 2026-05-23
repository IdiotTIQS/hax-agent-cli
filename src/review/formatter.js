"use strict";

/**
 * ReviewFormatter — formats code review findings for different output channels.
 *
 * Supports four output formats:
 *   - formatAsPRComment:   GitHub / GitLab PR comment (markdown table + summary)
 *   - formatAsChecklist:   actionable task checklist (markdown)
 *   - formatAsReport:      comprehensive review report (markdown sections)
 *   - formatAsInlineComments: line-by-line GitHub review format (JSON array)
 *
 * Severity levels (in decreasing order of importance):
 *   BLOCKER, CRITICAL, MAJOR, MINOR, SUGGESTION
 */

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

const SEVERITY_EMOJI = {
  BLOCKER: "\u{1F6A8}",  // 🚨 (rotating light)
  CRITICAL: "\u{274C}",  // ❌ (cross mark)
  MAJOR: "\u{26A0}\u{FE0F}",   // ⚠️ (warning)
  MINOR: "\u{1F539}",    // 🔹 (small blue diamond)
  SUGGESTION: "\u{1F4A1}",  // 💡 (light bulb)
};

const SEVERITY_LABEL = {
  BLOCKER: "BLOCKER",
  CRITICAL: "CRITICAL",
  MAJOR: "MAJOR",
  MINOR: "MINOR",
  SUGGESTION: "SUGGESTION",
};

/**
 * Group findings by severity.
 * @param {Array} findings
 * @returns {object} { BLOCKER: [], CRITICAL: [], ... }
 */
function groupBySeverity(findings) {
  const groups = { BLOCKER: [], CRITICAL: [], MAJOR: [], MINOR: [], SUGGESTION: [] };
  for (const f of findings) {
    if (groups[f.severity]) {
      groups[f.severity].push(f);
    }
  }
  return groups;
}

/**
 * Group findings by file path.
 * @param {Array} findings
 * @returns {object} { filePath: [ findings ] }
 */
function groupByFile(findings) {
  const groups = {};
  for (const f of findings) {
    const file = f.file || "<unknown>";
    if (!groups[file]) groups[file] = [];
    groups[file].push(f);
  }
  return groups;
}

/**
 * Sort findings: most severe first, then by file, then by line.
 */
function sortFindings(findings) {
  const order = { BLOCKER: 0, CRITICAL: 1, MAJOR: 2, MINOR: 3, SUGGESTION: 4 };
  return [...findings].sort((a, b) => {
    const sa = order[a.severity] !== undefined ? order[a.severity] : 99;
    const sb = order[b.severity] !== undefined ? order[b.severity] : 99;
    if (sa !== sb) return sa - sb;
    if (a.file !== b.file) return (a.file || "").localeCompare(b.file || "");
    return (a.line || 0) - (b.line || 0);
  });
}

/**
 * Build a severity-header row for markdown.
 */
function severityHeader(counts) {
  const parts = [];
  const order = ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "SUGGESTION"];
  for (const sev of order) {
    if (counts[sev] > 0) {
      parts.push(`${SEVERITY_EMOJI[sev]} ${counts[sev]} ${SEVERITY_LABEL[sev]}`);
    }
  }
  return parts.join("  ");
}

// ---------------------------------------------------------------------------
// ReviewFormatter
// ---------------------------------------------------------------------------

class ReviewFormatter {
  /**
   * @param {{ repoUrl?: string, prNumber?: number, footerText?: string }} [options]
   */
  constructor(options = {}) {
    this._options = options;
  }

  /**
   * Format findings as a GitHub PR comment (markdown).
   *
   * Returns a string suitable for posting as a PR review comment.
   * Includes a summary header, a severity-breakdown table, file-by-file
   * detail sections, and an optional footer.
   *
   * @param {Array} findings - array of finding objects
   * @param {{ title?: string, showFileDetails?: boolean, maxFindings?: number }} [options]
   * @returns {string} markdown-formatted PR comment
   */
  formatAsPRComment(findings, options = {}) {
    const opts = { title: "Automated Code Review", showFileDetails: true, maxFindings: 50, ...options };
    const sorted = sortFindings(findings);
    const grouped = groupBySeverity(sorted);
    const counts = {};
    for (const sev of Object.keys(grouped)) {
      counts[sev] = grouped[sev].length;
    }
    const totalFindings = sorted.length;

    const lines = [];

    // Title
    lines.push(`## ${SEVERITY_EMOJI.BLOCKER} ${opts.title}`);
    lines.push("");

    // Summary
    if (totalFindings === 0) {
      lines.push("**All clear!** No issues found in this review. \u{2705}");
      lines.push("");
      return lines.join("\n");
    }

    lines.push(`**${totalFindings} finding(s)** found: ${severityHeader(counts)}`);
    lines.push("");

    // Summary table
    lines.push("| Severity | Count |");
    lines.push("| --- | --- |");
    for (const sev of ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "SUGGESTION"]) {
      if (counts[sev] > 0) {
        lines.push(`| ${SEVERITY_EMOJI[sev]} ${SEVERITY_LABEL[sev]} | ${counts[sev]} |`);
      }
    }
    lines.push("");

    // Detail sections (grouped by file)
    if (opts.showFileDetails && totalFindings > 0) {
      const displayFindings = sorted.slice(0, opts.maxFindings);
      const byFile = groupByFile(displayFindings);

      for (const [file, fileFindings] of Object.entries(byFile)) {
        lines.push(`### ${SEVERITY_EMOJI.MINOR} \`${file}\``);
        lines.push("");
        lines.push("| Severity | Line | Issue | Suggestion |");
        lines.push("| --- | --- | --- | --- |");
        for (const f of fileFindings) {
          const sevEmoji = SEVERITY_EMOJI[f.severity] || "";
          const escapedTitle = (f.title || "").replace(/\|/g, "\\|");
          const escapedSuggestion = (f.suggestion || "").replace(/\|/g, "\\|").substring(0, 100);
          lines.push(`| ${sevEmoji} ${f.severity} | L${f.line} | ${escapedTitle} | ${escapedSuggestion} |`);
        }
        lines.push("");
      }

      if (sorted.length > opts.maxFindings) {
        lines.push(`> _Showing ${opts.maxFindings} of ${sorted.length} findings. Run locally for full details._`);
        lines.push("");
      }
    }

    // Top recommendations
    const recommendations = this._extractRecommendations(sorted);
    if (recommendations.length > 0) {
      lines.push("### Top Recommendations");
      lines.push("");
      for (let i = 0; i < Math.min(recommendations.length, 5); i++) {
        lines.push(`${i + 1}. ${recommendations[i]}`);
      }
      lines.push("");
    }

    // Footer
    if (this._options.footerText) {
      lines.push(`---`);
      lines.push(this._options.footerText);
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Format findings as an actionable checklist (markdown).
   *
   * Each finding becomes a checkbox item. Severity is indicated via emoji.
   * Suitable for pasting into an issue or tracking document.
   *
   * @param {Array} findings - array of finding objects
   * @param {{ groupByFile?: boolean, title?: string }} [options]
   * @returns {string} markdown checklist
   */
  formatAsChecklist(findings, options = {}) {
    const opts = { groupByFile: true, title: "Code Review Checklist", ...options };
    const sorted = sortFindings(findings);

    const lines = [];
    lines.push(`## ${opts.title}`);
    lines.push("");

    if (sorted.length === 0) {
      lines.push("- [x] All items reviewed — no issues found \u{2705}");
      lines.push("");
      return lines.join("\n");
    }

    if (opts.groupByFile) {
      const byFile = groupByFile(sorted);
      for (const [file, fileFindings] of Object.entries(byFile)) {
        lines.push(`### \`${file}\``);
        lines.push("");
        for (const f of fileFindings) {
          const emoji = SEVERITY_EMOJI[f.severity] || "";
          lines.push(`- [ ] ${emoji} **[${f.severity}]** L${f.line}: ${f.title} — _${f.suggestion || "Review needed"}_`);
        }
        lines.push("");
      }
    } else {
      for (const f of sorted) {
        const emoji = SEVERITY_EMOJI[f.severity] || "";
        const fileLabel = f.file ? ` \`${f.file}:${f.line}\`` : "";
        lines.push(`- [ ] ${emoji} **[${f.severity}]**${fileLabel} ${f.title} — _${f.suggestion || "Review needed"}_`);
      }
      lines.push("");
    }

    const total = sorted.length;
    lines.push(`> **${total} item(s)** to review. Check off each item after addressing it.`);
    lines.push("");

    return lines.join("\n");
  }

  /**
   * Format findings as a comprehensive review report (markdown).
   *
   * Includes: overview, per-severity breakdown, per-file details with
   * full message and suggestion text, aggregated recommendations, and a
   * normalized score out of 100.
   *
   * @param {Array} findings - array of finding objects
   * @param {{ score?: number, summary?: string, title?: string }} [options]
   * @returns {string} markdown report
   */
  formatAsReport(findings, options = {}) {
    const opts = { title: "Code Review Report", ...options };
    const sorted = sortFindings(findings);
    const grouped = groupBySeverity(sorted);
    const counts = {};
    for (const sev of Object.keys(grouped)) {
      counts[sev] = grouped[sev].length;
    }
    const total = sorted.length;

    const lines = [];

    // Header
    lines.push(`# ${opts.title}`);
    lines.push("");

    // Score
    if (opts.score !== undefined) {
      const grade = this._gradeFromScore(opts.score);
      lines.push(`**Overall Score:** ${opts.score}/100 (${grade})`);
      lines.push("");
    }

    // Summary line
    if (opts.summary) {
      lines.push(`> ${opts.summary}`);
      lines.push("");
    }

    // Severity overview table
    lines.push("## Severity Breakdown");
    lines.push("");
    lines.push("| Severity | Count | % of Total |");
    lines.push("| --- | --- | --- |");
    for (const sev of ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "SUGGESTION"]) {
      const count = counts[sev] || 0;
      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
      lines.push(`| ${SEVERITY_EMOJI[sev]} ${SEVERITY_LABEL[sev]} | ${count} | ${pct}% |`);
      lines.push("");
      // Detailed listing per severity
      if (count > 0) {
        for (const f of grouped[sev]) {
          const fileInfo = f.file ? `\`${f.file}:${f.line}\`` : `L${f.line}`;
          lines.push(`  - **${f.title}** at ${fileInfo}`);
          lines.push(`    > ${f.message}`);
          if (f.suggestion) {
            lines.push(`    > **Suggestion:** ${f.suggestion}`);
          }
          lines.push("");
        }
      }
    }

    // File overview
    const byFile = groupByFile(sorted);
    if (Object.keys(byFile).length > 0) {
      lines.push("## Files Reviewed");
      lines.push("");
      lines.push("| File | Findings |");
      lines.push("| --- | --- |");
      for (const [file, fileFindings] of Object.entries(byFile)) {
        lines.push(`| \`${file}\` | ${fileFindings.length} |`);
      }
      lines.push("");
    }

    // Recommendations section
    const recommendations = this._extractRecommendations(sorted);
    if (recommendations.length > 0) {
      lines.push("## Recommendations");
      lines.push("");
      for (let i = 0; i < Math.min(recommendations.length, 10); i++) {
        lines.push(`${i + 1}. ${recommendations[i]}`);
      }
      lines.push("");
    }

    // Footer
    lines.push("---");
    lines.push(`_Report generated at ${new Date().toISOString()}_`);
    lines.push("");

    return lines.join("\n");
  }

  /**
   * Format findings as line-by-line inline comments (JSON array).
   *
   * Each item follows the GitHub Pull Request Review Comment format:
   *   { path, line, body, side }
   *
   * This is suitable for use with the GitHub API (POST /repos/.../pulls/.../reviews).
   *
   * @param {Array} findings - array of finding objects
   * @param {{ maxComments?: number }} [options]
   * @returns {Array<{ path: string, line: number, body: string, side: string }>} GitHub inline comments
   */
  formatAsInlineComments(findings, options = {}) {
    const opts = { maxComments: 100, ...options };
    const sorted = sortFindings(findings);
    const comments = [];
    const seen = new Set();

    for (const f of sorted) {
      if (comments.length >= opts.maxComments) break;

      // Deduplicate: one comment per file+line+perspective
      const key = `${f.file}:${f.line}:${f.perspective}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const sevEmoji = SEVERITY_EMOJI[f.severity] || "";
      const body = [
        `${sevEmoji} **${f.severity}** — ${f.title}`,
        "",
        f.message,
        "",
        f.suggestion ? `**Suggestion:** ${f.suggestion}` : "",
      ].filter(Boolean).join("\n");

      comments.push({
        path: f.file || "",
        line: f.line || 1,
        body,
        side: "RIGHT",
      });
    }

    return comments;
  }

  /**
   * Format findings as a plain JSON summary (suitable for machine consumption).
   *
   * @param {Array} findings
   * @param {{ score?: number, summary?: string }} [options]
   * @returns {object} JSON-summary object
   */
  formatAsJSON(findings, options = {}) {
    const grouped = groupBySeverity(findings);
    const byFile = groupByFile(findings);

    return {
      generatedAt: new Date().toISOString(),
      totalFindings: findings.length,
      score: options.score,
      summary: options.summary || "",
      severityBreakdown: {
        BLOCKER: grouped.BLOCKER.length,
        CRITICAL: grouped.CRITICAL.length,
        MAJOR: grouped.MAJOR.length,
        MINOR: grouped.MINOR.length,
        SUGGESTION: grouped.SUGGESTION.length,
      },
      files: Object.keys(byFile).map((file) => ({
        file,
        findingCount: byFile[file].length,
      })),
      findings: findings.map((f) => ({
        file: f.file,
        line: f.line,
        perspective: f.perspective,
        severity: f.severity,
        title: f.title,
        message: f.message,
        suggestion: f.suggestion,
      })),
    };
  }

  // ---- Private helpers ----

  /**
   * Extract unique, sorted recommendations from findings.
   */
  _extractRecommendations(sortedFindings) {
    const seen = new Set();
    const recs = [];
    for (const f of sortedFindings) {
      const rec = f.suggestion || f.message;
      if (rec && !seen.has(rec)) {
        seen.add(rec);
        recs.push(rec);
      }
    }
    return recs.slice(0, 20);
  }

  /**
   * Letter-grade from a 0-100 score.
   */
  _gradeFromScore(score) {
    if (score >= 90) return "A";
    if (score >= 80) return "B";
    if (score >= 70) return "C";
    if (score >= 60) return "D";
    return "F";
  }
}

module.exports = {
  ReviewFormatter,
  groupBySeverity,
  groupByFile,
  sortFindings,
  SEVERITY_EMOJI,
  SEVERITY_LABEL,
};
