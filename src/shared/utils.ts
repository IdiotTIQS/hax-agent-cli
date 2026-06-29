// === ANSI escape codes ===
const ESC = "\x1b";
const CSI = `${ESC}[`;

const ANSI = {
  reset: `${CSI}0m`, bold: `${CSI}1m`, dim: `${CSI}2m`, italic: `${CSI}3m`, underline: `${CSI}4m`,
  red: `${CSI}31m`, green: `${CSI}32m`, yellow: `${CSI}33m`, blue: `${CSI}34m`, magenta: `${CSI}35m`, cyan: `${CSI}36m`,
  white: `${CSI}37m`, gray: `${CSI}90m`, brightRed: `${CSI}91m`, brightGreen: `${CSI}92m`,
  clearLine: `${CSI}2K`, clearScreen: `${CSI}2J${CSI}H`,
  cursorTo: (r: number, c: number): string => `${CSI}${r};${c}H`,
  cursorHide: `${CSI}?25l`, cursorShow: `${CSI}?25h`,
} as const;

// === Theme ===
const THEME = {
  reset: ANSI.reset, bold: ANSI.bold, dim: ANSI.dim,
  accent: ANSI.cyan, heading: ANSI.bold + ANSI.cyan,
  success: ANSI.green, warning: ANSI.yellow, error: ANSI.red, info: ANSI.blue,
  spinner: ANSI.cyan, toolIndicator: ANSI.magenta,
  toolSuccess: ANSI.green, toolError: ANSI.red,
  diffAdd: ANSI.green, diffRemove: ANSI.red, diffContext: ANSI.dim,
  codeText: ANSI.yellow, statusLine: ANSI.gray,
};

// === Helpers ===
function stripAnsi(s: string | null | undefined): string { return String(s || "").replace(/\x1b\[[0-9;]*[a-zA-Z]/g, ""); }
function styled(ansi: string, text: string): string { return `${ansi}${text}${ANSI.reset}`; }
function escapeRegex(s: string): string { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

// === JSON helpers ===
function safeJsonParse<T = unknown>(s: string, fallback: T | null = null): T | null { try { return JSON.parse(s) as T; } catch (_) { return fallback; } }
function safeJsonStringify(o: unknown): string { try { return JSON.stringify(o, null, 2); } catch (_) { return String(o); } }

// === String helpers ===
function truncate(s: string | null | undefined, len: number): string { const t = String(s || ""); return t.length > len ? t.slice(0, len - 3) + "..." : t; }
function pluralize(w: string, n: number): string { return n === 1 ? w : w + "s"; }

// === Token estimation (CJK-aware) ===
function estimateStringTokens(s: string | null | undefined): number {
  if (!s) return 0; const t = String(s);
  let cjk = 0, other = 0;
  for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); if ((c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3040 && c <= 0x30FF) || (c >= 0xAC00 && c <= 0xD7AF)) cjk++; else other++; }
  return Math.ceil(cjk / 1.5) + Math.ceil(other / 4.0);
}

export { ANSI, THEME, stripAnsi, styled, escapeRegex, sleep, safeJsonParse, safeJsonStringify, truncate, pluralize, estimateStringTokens };
