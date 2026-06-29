import { ANSI } from './renderer-ansi.js';

function shouldRunPasteAsCommandBatch(input: unknown) {
  const lines = String(input || '').split(/\r?\n/).map((entry: string) => entry.trim()).filter(Boolean);
  return lines.length > 1 && lines.every((entry: string) => entry.startsWith('/') || entry.startsWith('!'));
}

function formatPastedInputSummary(input: unknown) {
  const text = String(input || '');
  const lineCount = text.length === 0 ? 0 : text.split(/\r?\n/).length;
  const charCount = text.length;
  return `Pasted ${lineCount.toLocaleString()} ${lineCount === 1 ? 'line' : 'lines'}, ${charCount.toLocaleString()} ${charCount === 1 ? 'char' : 'chars'}`;
}

function formatPastedInputBadge(input: unknown) {
  const label = ` ${formatPastedInputSummary(input)} `;
  return `${ANSI.bgBrightBlack}${ANSI.brightWhite}${label}${ANSI.reset}`;
}

export {
  formatPastedInputBadge,
  formatPastedInputSummary,
  shouldRunPasteAsCommandBatch,
};
