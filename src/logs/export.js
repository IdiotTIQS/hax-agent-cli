'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { THEME, ANSI } = require('../renderer');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_EXPORT_FILES = 20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safely flatten an object to CSV-safe strings.
 * @param {*} value
 * @returns {string}
 */
function csvEscape(value) {
  if (value == null) return '';
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Build a standard set of CSV columns from log entries.
 * @param {object[]} entries
 * @returns {string[]}
 */
function inferCsvColumns(entries) {
  const columns = new Set();
  for (const entry of entries) {
    for (const key of Object.keys(entry)) {
      if (key !== 'raw' && typeof entry[key] !== 'object') {
        columns.add(key);
      }
    }
  }
  // Ensure standard order
  const priority = ['timestamp', 'level', 'source', 'message', 'sessionId', 'toolName', 'type', 'result', 'durationMs'];
  const ordered = priority.filter((col) => columns.has(col));
  for (const col of [...columns].sort()) {
    if (!ordered.includes(col)) {
      ordered.push(col);
    }
  }
  return ordered;
}

/**
 * Format a timestamp for text display.
 * @param {string|null} ts
 * @returns {string}
 */
function formatTs(ts) {
  if (!ts) return '-'.repeat(19);
  const t = String(ts).replace('T', ' ').slice(0, 19);
  return t;
}

/**
 * Build an HTML page with styled log entries.
 * @param {object[]} entries
 * @returns {string} full HTML document
 */
function buildHtmlDocument(entries) {
  const now = new Date().toISOString();
  const rows = entries.map((entry, idx) => {
    const level = entry.level || 'info';
    const levelClass = `level-${level}`;
    const ts = formatTs(entry.timestamp);
    const source = entry.source || '-';
    const message = entry.message || '';
    const escaped = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<tr class="${levelClass}">
      <td class="idx">${idx + 1}</td>
      <td class="ts">${escaped(ts)}</td>
      <td class="level">${escaped(level.toUpperCase())}</td>
      <td class="source">${escaped(source)}</td>
      <td class="message">${escaped(message)}</td>
    </tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HaxAgent Log Export — ${now}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace; background: #0d1117; color: #c9d1d9; padding: 20px; }
    h1 { color: #58a6ff; margin-bottom: 8px; font-size: 1.4em; }
    .meta { color: #8b949e; font-size: 0.85em; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85em; }
    th { background: #161b22; color: #8b949e; text-align: left; padding: 8px 10px; border-bottom: 2px solid #30363d; position: sticky; top: 0; }
    td { padding: 6px 10px; border-bottom: 1px solid #21262d; }
    tr:hover { background: #161b22; }
    .idx { color: #484f58; width: 50px; text-align: right; }
    .ts { color: #8b949e; width: 170px; white-space: nowrap; }
    .level { width: 70px; font-weight: 600; }
    .source { color: #8b949e; width: 120px; }
    .message { word-break: break-word; }
    .level-debug { color: #8b949e; }
    .level-info { color: #58a6ff; }
    .level-warn { color: #d2991d; }
    .level-error { color: #f85149; }
    .level-critical { color: #fff; background: #f85149; }
  </style>
</head>
<body>
  <h1>HaxAgent Log Export</h1>
  <p class="meta">Generated: ${now} &mdash; ${entries.length} entries</p>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Timestamp</th>
        <th>Level</th>
        <th>Source</th>
        <th>Message</th>
      </tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Export log entries as JSON.
 *
 * @param {object[]} logs - log entries
 * @param {string} outputPath - file path to write to
 * @param {object} [options]
 * @param {boolean} [options.pretty=true] - pretty-print JSON
 * @returns {Promise<{path: string, size: number, count: number}>}
 */
async function exportAsJson(logs, outputPath, options = {}) {
  if (!Array.isArray(logs)) {
    throw new TypeError('exportAsJson: logs must be an array');
  }

  const pretty = options.pretty !== false;
  const json = pretty
    ? JSON.stringify(logs, null, 2)
    : JSON.stringify(logs);

  const dir = path.dirname(outputPath);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(outputPath, json, 'utf8');

  return {
    path: outputPath,
    size: Buffer.byteLength(json, 'utf8'),
    count: logs.length,
  };
}

/**
 * Export log entries as CSV.
 *
 * @param {object[]} logs - log entries
 * @param {string} outputPath - file path to write to
 * @param {object} [options]
 * @param {string[]} [options.columns] - explicit column order
 * @returns {Promise<{path: string, size: number, count: number}>}
 */
async function exportAsCsv(logs, outputPath, options = {}) {
  if (!Array.isArray(logs)) {
    throw new TypeError('exportAsCsv: logs must be an array');
  }

  const columns = Array.isArray(options.columns) && options.columns.length > 0
    ? options.columns
    : inferCsvColumns(logs);

  const lines = [columns.map(csvEscape).join(',')];

  for (const entry of logs) {
    const row = columns.map((col) => csvEscape(entry[col]));
    lines.push(row.join(','));
  }

  const csv = lines.join('\n');

  const dir = path.dirname(outputPath);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(outputPath, csv, 'utf8');

  return {
    path: outputPath,
    size: Buffer.byteLength(csv, 'utf8'),
    count: logs.length,
  };
}

/**
 * Export log entries as human-readable plain text.
 *
 * @param {object[]} logs - log entries
 * @param {string} outputPath - file path to write to
 * @returns {Promise<{path: string, size: number, count: number}>}
 */
async function exportAsText(logs, outputPath) {
  if (!Array.isArray(logs)) {
    throw new TypeError('exportAsText: logs must be an array');
  }

  const lines = [];
  lines.push(`HaxAgent Log Export — ${new Date().toISOString()}`);
  lines.push(`Total entries: ${logs.length}`);
  lines.push('='.repeat(80));
  lines.push('');

  for (const entry of logs) {
    const level = (entry.level || 'info').toUpperCase().padEnd(8, ' ');
    const ts = formatTs(entry.timestamp);
    const source = (entry.source || '-').padEnd(14, ' ');
    const message = entry.message || '';

    let line = `[${ts}] ${level} ${source} ${message}`;

    if (entry.toolName) line += `  tool=${entry.toolName}`;
    if (entry.sessionId) line += `  sid=${entry.sessionId}`;
    if (entry.durationMs != null) line += `  ${entry.durationMs}ms`;
    if (entry.result) line += `  result=${entry.result}`;

    lines.push(line);
  }

  const text = lines.join('\n');

  const dir = path.dirname(outputPath);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(outputPath, text, 'utf8');

  return {
    path: outputPath,
    size: Buffer.byteLength(text, 'utf8'),
    count: logs.length,
  };
}

/**
 * Export log entries as a styled HTML document.
 *
 * @param {object[]} logs - log entries
 * @param {string} outputPath - file path to write to (.html)
 * @returns {Promise<{path: string, size: number, count: number}>}
 */
async function exportAsHtml(logs, outputPath) {
  if (!Array.isArray(logs)) {
    throw new TypeError('exportAsHtml: logs must be an array');
  }

  const html = buildHtmlDocument(logs);

  const dir = path.dirname(outputPath);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(outputPath, html, 'utf8');

  return {
    path: outputPath,
    size: Buffer.byteLength(html, 'utf8'),
    count: logs.length,
  };
}

/**
 * Convenience: filter logs from an aggregator and export in one step.
 *
 * @param {object} aggregator - LogAggregator instance
 * @param {object} filterOptions - options for aggregator.filter()
 * @param {'json'|'csv'|'text'|'html'} format
 * @param {string} outputPath
 * @returns {Promise<{path: string, size: number, count: number}>}
 */
async function exportFiltered(aggregator, filterOptions, format, outputPath) {
  if (!aggregator || typeof aggregator.filter !== 'function') {
    throw new TypeError('exportFiltered: aggregator must be a LogAggregator instance');
  }

  const logs = await aggregator.filter(filterOptions);

  switch (format) {
    case 'json':
      return exportAsJson(logs, outputPath);
    case 'csv':
      return exportAsCsv(logs, outputPath);
    case 'text':
      return exportAsText(logs, outputPath);
    case 'html':
      return exportAsHtml(logs, outputPath);
    default:
      throw new TypeError(`exportFiltered: unsupported format "${format}". Use json, csv, text, or html.`);
  }
}

/**
 * Rotate exported log files, keeping only the most recent N files.
 * Files are matched by a prefix pattern within a directory.
 *
 * @param {string} outputDir - directory containing exports
 * @param {number} [maxFiles=20] - maximum files to retain
 * @param {object} [options]
 * @param {string} [options.prefix='log-export-'] - filename prefix to match for rotation
 * @returns {Promise<{deleted: string[], retained: string[]}>}
 */
async function rotateExport(outputDir, maxFiles = DEFAULT_MAX_EXPORT_FILES, options = {}) {
  const prefix = options.prefix || 'log-export-';
  const max = Number.isSafeInteger(maxFiles) && maxFiles > 0 ? maxFiles : DEFAULT_MAX_EXPORT_FILES;

  let files;
  try {
    files = await fsp.readdir(outputDir);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { deleted: [], retained: [] };
    }
    throw err;
  }

  // Filter to files matching the prefix
  const matching = files
    .filter((f) => f.startsWith(prefix))
    .map((f) => path.join(outputDir, f));

  // Sort by modification time (oldest first)
  const withStats = await Promise.all(
    matching.map(async (filePath) => {
      try {
        const stat = await fsp.stat(filePath);
        return { path: filePath, mtime: stat.mtime };
      } catch (_) {
        return null;
      }
    })
  );

  const valid = withStats.filter(Boolean).sort((a, b) => a.mtime - b.mtime);

  // Delete oldest files if exceeding the max
  const toDelete = valid.slice(0, Math.max(0, valid.length - max));
  const retained = valid.slice(Math.max(0, valid.length - max));

  for (const { path: filePath } of toDelete) {
    try {
      await fsp.unlink(filePath);
    } catch (_) {
      // Best effort
    }
  }

  return {
    deleted: toDelete.map((f) => f.path),
    retained: retained.map((f) => f.path),
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  exportAsJson,
  exportAsCsv,
  exportAsText,
  exportAsHtml,
  exportFiltered,
  rotateExport,
  csvEscape,
  inferCsvColumns,
  formatTs,
};
