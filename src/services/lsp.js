"use strict";

/**
 * LSP (Lightweight Symbol Parser) — read-only code intelligence.
 * Provides symbol extraction, go-to-definition, find-references for JS/TS/Python.
 * Ported from OpenHarness services/lsp/.
 */

const fs = require("fs");
const path = require("path");

const SKIP = new Set([".git", "node_modules", ".venv", "venv", "__pycache__", ".hax-agent"]);
const EXT_MAP = { ".js": "js", ".mjs": "js", ".cjs": "js", ".jsx": "js", ".ts": "ts", ".tsx": "ts", ".py": "python", ".pyw": "python" };

class Symbol {
  constructor(o) { Object.assign(this, o); }
}

function detectLanguage(fp) { return EXT_MAP[path.extname(String(fp)).toLowerCase()] || "text"; }

function iterFiles(root, lang) {
  const files = [];
  const exts = lang ? Object.entries(EXT_MAP).filter(([, l]) => l === lang).map(([e]) => e) : Object.keys(EXT_MAP);
  function walk(dir) { try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (SKIP.has(e.name)) continue; const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (exts.includes(path.extname(e.name).toLowerCase())) files.push(p); } } catch (_) {} }
  walk(root);
  return files.sort();
}

function listSymbols(fp) {
  const lang = detectLanguage(fp);
  const code = fs.readFileSync(fp, "utf-8");
  if (lang === "python") return _pySymbols(code, fp);
  return _jsSymbols(code, fp);
}

function _jsSymbols(code, fp) {
  const syms = [];
  // class ClassName
  for (const m of code.matchAll(/class\s+(\w+)/g)) syms.push(new Symbol({ name: m[1], kind: "class", path: fp, line: _line(code, m.index), signature: `class ${m[1]}` }));
  // function name()
  for (const m of code.matchAll(/function\s+(\w+)\s*\((.*?)\)/g)) syms.push(new Symbol({ name: m[1], kind: "function", path: fp, line: _line(code, m.index), signature: `function ${m[1]}(${m[2]})` }));
  // const arrow = () =>
  for (const m of code.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(.*?\)\s*=>/g)) syms.push(new Symbol({ name: m[1], kind: "function", path: fp, line: _line(code, m.index), signature: `const ${m[1]} = (...) =>` }));
  return syms;
}

function _pySymbols(code, fp) {
  const syms = [];
  for (const m of code.matchAll(/^class\s+(\w+)/gm)) syms.push(new Symbol({ name: m[1], kind: "class", path: fp, line: _line(code, m.index), signature: `class ${m[1]}` }));
  for (const m of code.matchAll(/^def\s+(\w+)\s*\((.*?)\)/gm)) syms.push(new Symbol({ name: m[1], kind: "function", path: fp, line: _line(code, m.index), signature: `def ${m[1]}(${m[2]})` }));
  return syms;
}

function goToDefinition(root, symbol) {
  if (!symbol) return [];
  const results = [];
  for (const f of iterFiles(root)) for (const s of listSymbols(f)) if (s.name === symbol) results.push(s);
  return results;
}

function findReferences(root, symbol) {
  if (!symbol) return [];
  const re = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  const refs = [];
  for (const f of iterFiles(root)) {
    const lines = fs.readFileSync(f, "utf-8").split("\n");
    for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) { re.lastIndex = 0; refs.push({ path: f, line: i + 1, text: lines[i].trim() }); }
  }
  return refs;
}

function workspaceSearch(root, query) {
  const q = String(query).toLowerCase();
  if (!q) return [];
  const results = [];
  for (const f of iterFiles(root)) for (const s of listSymbols(f)) if (s.name.toLowerCase().includes(q)) results.push(s);
  return results;
}

function _line(code, idx) { return (code.slice(0, idx).match(/\n/g) || []).length + 1; }

module.exports = { Symbol, listSymbols, goToDefinition, findReferences, workspaceSearch, detectLanguage, iterFiles };
