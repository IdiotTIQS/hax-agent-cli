"use strict";

/**
 * Notebook export formats for HaxAgent sessions.
 *
 *   - Jupyter (.ipynb)
 *   - Observable HQ
 *   - Markdown cells (plain .md with code cells)
 *
 * Mapping:
 *   user messages        → markdown cells
 *   assistant messages   → markdown cells (with fenced code for any embedded code)
 *   tool-call entries    → code cells (the call itself)
 *   tool-result entries  → code cell outputs or markdown cells with the result
 */

// ── helpers ──────────────────────────────────────────────────────────────

function safeStr(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") return JSON.stringify(v, null, 2);
  return String(v);
}

function escapeJsonString(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

function uuid4() {
  // Simple RFC 4122 v4 UUID generator (no crypto dependency for portability)
  const hex = "0123456789abcdef";
  const tpl = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
  let result = "";
  for (let i = 0; i < tpl.length; i++) {
    const c = tpl[i];
    if (c === "x") {
      result += hex[(Math.random() * 16) | 0];
    } else if (c === "y") {
      result += hex[((Math.random() * 4) | 0) + 8];
    } else {
      result += c;
    }
  }
  return result;
}

function isoNow() {
  return new Date().toISOString();
}

function detectLanguage(content) {
  // Heuristic: look at first line for language hints
  if (!content) return "plaintext";
  const first = content.trim().split("\n")[0] || "";
  if (/^[\[{]/.test(first)) return "json";
  if (/^(def |from |print\()/.test(first)) return "python";
  if (/^(import\s+(os|sys|re|json|math|datetime|pathlib|typing|collections|itertools|functools)\b)/.test(first)) return "python";
  if (/^(import|export|const|let|var|function|class|async)\b/.test(first)) return "javascript";
  if (/^(#!|echo |ls |cd |git |npm |yarn |docker |curl |wget )/.test(first)) return "shell";
  if (/^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(first)) return "sql";
  if (/^[<{].*[>}]/.test(first) && /^[<\w]/.test(first)) return "html";
  return "plaintext";
}

// ── Jupyter notebook (.ipynb) ────────────────────────────────────────────

/**
 * Build a single Jupyter notebook cell.
 *
 * @param {"markdown"|"code"} cellType
 * @param {string|string[]}   source     Single string or array of lines
 * @param {object[]}          [outputs]  Output objects (for code cells)
 * @param {string}            [id]       Cell id
 * @returns {object} Jupyter cell object
 */
function buildJupyterCell(cellType, source, outputs, id) {
  const sourceArr = typeof source === "string" ? [source] : source;
  const cell = {
    cell_type: cellType,
    metadata: {},
    source: sourceArr,
  };
  if (id) cell.id = id;
  if (cellType === "code") {
    cell.outputs = outputs || [];
    cell.execution_count = null;
  }
  return cell;
}

/**
 * Convert a session to a Jupyter .ipynb notebook object.
 *
 * Tool calls become code cells; tool data becomes output.
 * User/assistant messages become markdown cells.
 *
 * @param {object} session  Session-like: { id, entries(), metadata()?, updatedAt? }
 * @param {object} [options] { title?, kernelName?, kernelDisplayName?, language? }
 * @returns {object} Full .ipynb JSON object ready for JSON.stringify.
 */
function exportAsJupyterNotebook(session, options = {}) {
  const entries = typeof session.entries === "function" ? session.entries() : [];
  const metadata = typeof session.metadata === "function" ? session.metadata() : {};
  const title = options.title || metadata?.projectName || "Hax Agent Session";
  const kernelName = options.kernelName || "python3";
  const kernelDisplayName = options.kernelDisplayName || "Python 3";
  const language = options.language || "python";

  const cells = [];

  // Title cell
  cells.push(
    buildJupyterCell("markdown", ["# " + title + "\n", "\n", "Exported at: " + isoNow() + "\n"], null, uuid4())
  );

  for (const entry of entries) {
    const role = String(entry.role || "").toLowerCase();

    if (role === "tool") {
      // Tool result becomes code cell output; the call becomes the source
      const callSource = entry.name ? entry.name + "()" : "tool_call()";
      const outputText = entry.isError
        ? "Error: " + safeStr(entry.data !== undefined ? entry.data : entry.content || "")
        : safeStr(entry.data !== undefined ? entry.data : entry.content || "");

      const outputType = entry.isError ? "error" : "execute_result";
      const outputContent = typeof outputText === "string" ? [outputText + "\n"] : [JSON.stringify(outputText, null, 2) + "\n"];

      cells.push(
        buildJupyterCell(
          "code",
          ["# Tool: " + (entry.name || "tool") + "\n", callSource + "\n"],
          [
            {
              output_type: outputType,
              execution_count: null,
              data: {
                "text/plain": outputContent,
              },
              metadata: {},
            },
          ],
          uuid4()
        )
      );
    } else {
      // User or assistant → markdown cell
      const roleLabel = role === "user" ? "**You**" : role === "assistant" ? "**Assistant**" : "**" + role + "**";
      const content = safeStr(entry.content || "");
      const mdSource = roleLabel + "\n\n" + content + "\n";
      cells.push(buildJupyterCell("markdown", [mdSource], null, uuid4()));
    }
  }

  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: {
        display_name: kernelDisplayName,
        language: language,
        name: kernelName,
      },
      language_info: {
        name: language,
        file_extension: "." + language,
        mimetype: "text/x-" + language,
      },
      haxagent: {
        session_id: session.id || "",
        exported_at: isoNow(),
        message_count: entries.length,
      },
    },
    cells,
  };
}

// ── Observable HQ notebook ───────────────────────────────────────────────

/**
 * Build an Observable HQ cell.
 *
 * @param {"md"|"js"|"omd"} type     Observable cell type
 * @param {string}         value     Cell content
 * @param {string}         [name]    Variable name (js cells)
 * @returns {object} Observable cell object
 */
function buildObservableCell(type, value, name) {
  const cell = { type, value };
  if (name) cell.name = name;
  return cell;
}

/**
 * Convert a session to an Observable HQ notebook format.
 *
 * @param {object} session  Session-like object.
 * @param {object} [options] { title? }
 * @returns {object} Observable notebook JSON object.
 */
function exportAsObservableNotebook(session, options = {}) {
  const entries = typeof session.entries === "function" ? session.entries() : [];
  const metadata = typeof session.metadata === "function" ? session.metadata() : {};
  const title = options.title || "Hax Agent Session";
  const now = isoNow();

  const cells = [];

  // Title
  cells.push(buildObservableCell("md", "# " + title));

  // Metadata cell
  cells.push(
    buildObservableCell(
      "md",
      [
        "> **Session ID:** `" + (session.id || "") + "`",
        "> **Messages:** " + entries.length,
        "> **Exported:** " + now,
      ].join("\n")
    )
  );

  // Import Observable stdlib
  cells.push(
    buildObservableCell("js", "import {md, html, Inputs, require} from \"@observablehq/runtime\"", "imports")
  );

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const role = String(entry.role || "").toLowerCase();

    if (role === "tool") {
      // Tool call as JS cell + result as markdown
      const toolName = entry.name || "tool";
      const resultText = safeStr(entry.data !== undefined ? entry.data : entry.content || "");
      const cellName = "tool_" + i;

      cells.push(
        buildObservableCell(
          "js",
          "// " + toolName + "()" + (entry.isError ? " [ERROR]" : "") + "\n" +
            "// Result:\n" +
            "// " + resultText.split("\n").join("\n// "),
          cellName
        )
      );

      cells.push(
        buildObservableCell(
          "md",
          "**Tool `" + toolName + "` result:**\n\n```\n" + resultText + "\n```"
        )
      );
    } else if (role === "user") {
      cells.push(buildObservableCell("md", "### You\n\n" + safeStr(entry.content || "")));
    } else if (role === "assistant") {
      cells.push(
        buildObservableCell("md", "### Assistant\n\n" + safeStr(entry.content || ""))
      );
    } else {
      cells.push(
        buildObservableCell("md", "### " + role + "\n\n" + safeStr(entry.content || ""))
      );
    }
  }

  return {
    version: 1,
    title: title,
    files: [],
    nodes: cells.map((cell, idx) => ({
      id: idx,
      ...cell,
    })),
    pinning: {},
    resolvedRefs: {},
  };
}

// ── Markdown cells (.md with code-cell annotations) ─────────────────────

/**
 * Convert a session to a markdown document where tool calls appear as
 * fenced code blocks annotated with their result.
 *
 * @param {object} session  Session-like object.
 * @param {object} [options] { title?, includeMetadata? }
 * @returns {string} Markdown string.
 */
function exportAsMarkdownCells(session, options = {}) {
  const entries = typeof session.entries === "function" ? session.entries() : [];
  const metadata = typeof session.metadata === "function" ? session.metadata() : {};
  const title = options.title || "Hax Agent Session";
  const includeMetadata = options.includeMetadata !== false;
  const now = isoNow();

  const lines = [];

  lines.push("# " + title);
  lines.push("");

  if (includeMetadata) {
    lines.push("| Key | Value |");
    lines.push("| --- | --- |");
    lines.push("| Session ID | `" + (session.id || "") + "` |");
    lines.push("| Messages | " + entries.length + " |");
    lines.push("| Exported | " + now + " |");
    if (metadata?.projectName) {
      lines.push("| Project | " + metadata.projectName + " |");
    }
    lines.push("");
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const role = String(entry.role || "").toLowerCase();

    if (role === "user") {
      lines.push("## You");
      lines.push("");
      lines.push(safeStr(entry.content || ""));
      lines.push("");
    } else if (role === "assistant") {
      lines.push("## Assistant");
      lines.push("");
      const content = safeStr(entry.content || "");
      lines.push(content);
      lines.push("");
    } else if (role === "tool") {
      const toolName = entry.name || "tool";
      const resultData = entry.data !== undefined ? entry.data : entry.content;
      const resultStr = safeStr(resultData);
      const lang = detectLanguage(resultStr);

      lines.push("## Tool: `" + toolName + "`");
      lines.push("");

      if (entry.isError) {
        lines.push("> **Error**");
        lines.push("");
      }

      // Tool call as code cell
      lines.push("```");
      lines.push(entry.name || "tool_call");
      lines.push("```");
      lines.push("");

      // Tool result as output
      lines.push("**Result:**");
      lines.push("");
      lines.push("```" + lang);
      lines.push(resultStr);
      lines.push("```");
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ── exports ──────────────────────────────────────────────────────────────

module.exports = {
  exportAsJupyterNotebook,
  exportAsObservableNotebook,
  exportAsMarkdownCells,
  // Exported for testing
  buildJupyterCell,
  buildObservableCell,
  detectLanguage,
};
