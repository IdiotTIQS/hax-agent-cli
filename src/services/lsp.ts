/**
 * LSP (Lightweight Symbol Parser) — read-only code intelligence.
 * Provides symbol extraction, go-to-definition, find-references for JS/TS/Python.
 * Ported from OpenHarness services/lsp/.
 */

import fs from "fs";
import path from "path";

const SKIP = new Set([".git", "node_modules", ".venv", "venv", "__pycache__", ".hax-agent"]);
const EXT_MAP = { ".js": "js", ".mjs": "js", ".cjs": "js", ".jsx": "js", ".ts": "ts", ".tsx": "ts", ".py": "python", ".pyw": "python" };

/**
 * A parsed code symbol (class/function). Renamed internally to LspSymbol
 * to avoid shadowing the built-in Symbol type; re-exported as Symbol.
 */
class LspSymbol {
  name: string;
  kind: string;
  path: string;
  line: number;
  signature: string;

  constructor(o: { name: string; kind: string; path: string; line: number; signature: string }) {
    this.name = o.name;
    this.kind = o.kind;
    this.path = o.path;
    this.line = o.line;
    this.signature = o.signature;
  }
}

function detectLanguage(fp: string): string { return (EXT_MAP as Record<string, string>)[path.extname(String(fp)).toLowerCase()] || "text"; }

function iterFiles(root: string, lang?: string): string[] {
  const files: string[] = [];
  const exts = lang ? Object.entries(EXT_MAP).filter(([, l]) => l === lang).map(([e]) => e) : Object.keys(EXT_MAP);
  function walk(dir: string) { try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (SKIP.has(e.name)) continue; const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (exts.includes(path.extname(e.name).toLowerCase())) files.push(p); } } catch (_) {} }
  walk(root);
  return files.sort();
}

function listSymbols(fp: string): LspSymbol[] {
  const lang = detectLanguage(fp);
  const code = fs.readFileSync(fp, "utf-8");
  if (lang === "python") return _pySymbols(code, fp);
  return _jsSymbols(code, fp);
}

function _jsSymbols(code: string, fp: string): LspSymbol[] {
  const syms: LspSymbol[] = [];
  // class ClassName
  for (const m of code.matchAll(/class\s+(\w+)/g)) syms.push(new LspSymbol({ name: m[1], kind: "class", path: fp, line: _line(code, m.index!), signature: `class ${m[1]}` }));
  // function name()
  for (const m of code.matchAll(/function\s+(\w+)\s*\((.*?)\)/g)) syms.push(new LspSymbol({ name: m[1], kind: "function", path: fp, line: _line(code, m.index!), signature: `function ${m[1]}(${m[2]})` }));
  // const arrow = () =>
  for (const m of code.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(.*?\)\s*=>/g)) syms.push(new LspSymbol({ name: m[1], kind: "function", path: fp, line: _line(code, m.index!), signature: `const ${m[1]} = (...) =>` }));
  return syms;
}

function _pySymbols(code: string, fp: string): LspSymbol[] {
  const syms: LspSymbol[] = [];
  for (const m of code.matchAll(/^class\s+(\w+)/gm)) syms.push(new LspSymbol({ name: m[1], kind: "class", path: fp, line: _line(code, m.index!), signature: `class ${m[1]}` }));
  for (const m of code.matchAll(/^def\s+(\w+)\s*\((.*?)\)/gm)) syms.push(new LspSymbol({ name: m[1], kind: "function", path: fp, line: _line(code, m.index!), signature: `def ${m[1]}(${m[2]})` }));
  return syms;
}

/**
 * Find symbol definitions across the workspace.
 * @param root - workspace root
 * @param symbol - symbol name to find
 * @param file - optional file path filter (only return defs in this file)
 * @param line - optional source line hint (reserved; not yet used for ranking)
 */
function goToDefinition(root: string, symbol: string, file: string | null = null, line: number | null = null): LspSymbol[] {
  if (!symbol) return [];
  const results: LspSymbol[] = [];
  const fileFilter = file ? String(file).replace(/\\/g, "/") : null;
  for (const f of iterFiles(root)) {
    if (fileFilter && !f.replace(/\\/g, "/").endsWith(fileFilter)) continue;
    for (const s of listSymbols(f)) if (s.name === symbol) results.push(s);
  }
  return results;
}

function findReferences(root: string, symbol: string): Array<{ path: string; line: number; text: string }> {
  if (!symbol) return [];
  const re = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  const refs: Array<{ path: string; line: number; text: string }> = [];
  for (const f of iterFiles(root)) {
    const lines = fs.readFileSync(f, "utf-8").split("\n");
    for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) { re.lastIndex = 0; refs.push({ path: f, line: i + 1, text: lines[i].trim() }); }
  }
  return refs;
}

function workspaceSearch(root: string, query: string): LspSymbol[] {
  const q = String(query).toLowerCase();
  if (!q) return [];
  const results: LspSymbol[] = [];
  for (const f of iterFiles(root)) for (const s of listSymbols(f)) if (s.name.toLowerCase().includes(q)) results.push(s);
  return results;
}

function _line(code: string, idx: number): number { return (code.slice(0, idx).match(/\n/g) || []).length + 1; }

export { LspSymbol as Symbol, listSymbols, goToDefinition, findReferences, workspaceSearch, detectLanguage, iterFiles };
