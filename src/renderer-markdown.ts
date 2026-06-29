import { ANSI, THEME } from './renderer-ansi.js';

// Hoisted regexes for _renderInline -- compiled once, reused on every text token.
const RE_BOLD = /^\*\*(.+?)\*\*/;
const RE_ITALIC = /^\*(.+?)\*/;
const RE_CODE = /^`([^`]+)`/;
const RE_STRIKETHROUGH = /^~~(.+?)~~/;
const RE_LINK = /^\[([^\]]+)\]\(([^)]+)\)/;

/**
 * Fast linear scan for the next markdown special character.
 * Uses indexOf chains so the JIT can inline each call.
 */
function findNextSpecial(text, start, end) {
  let idx = -1;
  let tmp;
  tmp = text.indexOf('*', start);
  if (tmp !== -1 && tmp < end) idx = idx === -1 ? tmp : tmp < idx ? tmp : idx;
  tmp = text.indexOf('`', start);
  if (tmp !== -1 && tmp < end) idx = idx === -1 ? tmp : tmp < idx ? tmp : idx;
  tmp = text.indexOf('[', start);
  if (tmp !== -1 && tmp < end) idx = idx === -1 ? tmp : tmp < idx ? tmp : idx;
  tmp = text.indexOf('~', start);
  if (tmp !== -1 && tmp < end) idx = idx === -1 ? tmp : tmp < idx ? tmp : idx;
  return idx;
}

class MarkdownRenderer {
  constructor(columns = 80) {
    this.columns = columns;
  }

  _isTableRow(l) { return l && /^\|.*\|$/.test(l.trim()); }
  _isTableSep(l) { return l && /^\|[\s\-:|]+\|$/.test(l.trim()); }

  render(text) {
    if (!text) return '';
    const lines = text.split('\n');
    const output = [];

    let inCodeBlock = false;
    let codeLang = '';
    let codeLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('```')) {
        if (inCodeBlock) {
          output.push(this._renderCodeBlock(codeLines, codeLang));
          codeLines = [];
          codeLang = '';
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
          codeLang = line.slice(3).trim();
        }
        continue;
      }

      if (inCodeBlock) {
        codeLines.push(line);
        continue;
      }

      if (line.match(/^#{1,6}\s/)) {
        output.push(this._renderHeading(line));
        continue;
      }

      if (line.match(/^[-*+]\s/) || line.match(/^\d+\.\s/)) {
        output.push(this._renderListItem(line));
        continue;
      }

      if (line.match(/^>\s/)) {
        output.push(this._renderBlockquote(line));
        continue;
      }

      if (line.match(/^---+$/)) {
        output.push(this._renderHr());
        continue;
      }

      // Table detection: header | sep | data...
      if (this._isTableRow(line) && i + 2 < lines.length && this._isTableSep(lines[i + 1]) && this._isTableRow(lines[i + 2])) {
        const header = line;
        const sep = lines[i + 1];
        const dataRows = [];
        i += 2; // skip to first data row
        dataRows.push(lines[i]);
        while (i + 1 < lines.length && this._isTableRow(lines[i + 1])) {
          i++;
          dataRows.push(lines[i]);
        }
        output.push(this._renderTable(header, dataRows));
        continue;
      }

      if (line.trim() === '') {
        output.push('');
        continue;
      }

      output.push(this._renderInline(line));
    }

    if (inCodeBlock && codeLines.length > 0) {
      output.push(this._renderCodeBlock(codeLines, codeLang));
    }

    return output.join('\n');
  }

  _renderHeading(line) {
    const match = line.match(/^(#{1,6})\s+(.*)/);
    if (!match) return this._renderInline(line);
    const level = match[1].length;
    const text = this._renderInline(match[2]);
    const prefix = level === 1 ? '▎ ' : level === 2 ? '┃ ' : '│ ';
    return `\n${THEME.heading}${prefix}${text}${ANSI.reset}`;
  }

  _renderCodeBlock(lines, lang) {
    const width = Math.min(this.columns - 4, 100);
    const topBorder = `${THEME.border}╭${'─'.repeat(width)}╮${ANSI.reset}`;
    const bottomBorder = `${THEME.border}╰${'─'.repeat(width)}╯${ANSI.reset}`;
    const langLabel = lang ? `${THEME.dim} ${lang}${ANSI.reset}` : '';

    const rendered = [topBorder + langLabel];
    for (const line of lines) {
      const content = line.length > width - 2 ? line.slice(0, width - 5) + '...' : line;
      rendered.push(`${THEME.border}│${ANSI.reset} ${THEME.codeText}${content.padEnd(width - 1)}${ANSI.reset}${THEME.border}│${ANSI.reset}`);
    }
    rendered.push(bottomBorder);

    return rendered.join('\n');
  }

  _renderListItem(line) {
    const match = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)/);
    if (!match) return this._renderInline(line);
    const indent = match[1];
    const marker = match[2];
    const text = this._renderInline(match[3]);
    const displayMarker = /^\d+$/.test(marker) ? `${marker}.` : marker;
    return `${indent}${THEME.list}${displayMarker}${ANSI.reset} ${text}`;
  }

  _renderBlockquote(line) {
    const text = line.replace(/^>\s*/, '');
    return `${THEME.dim}▎ ${this._renderInline(text)}${ANSI.reset}`;
  }

  _renderHr() {
    const width = Math.min(this.columns - 2, 60);
    return `${THEME.hr}${'─'.repeat(width)}${ANSI.reset}`;
  }

  _renderTable(header, dataRows) {
    const parse = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    const hdr = parse(header);
    const rows = dataRows.map(parse);
    const allRows = [hdr, ...rows];

    const colWidths = hdr.map((_, ci) =>
      Math.min(40, Math.max(3, ...allRows.map(r => r[ci] ? r[ci].length : 0)))
    );
    const pad = (text, w) => text + ' '.repeat(Math.max(0, w - text.length));
    const border = THEME.border || THEME.dim;

    const result = [];
    // Top border
    result.push(border + '┌' + colWidths.map(w => '─'.repeat(w + 2)).join('┬') + '┐' + ANSI.reset);
    // Header row
    const hdrCells = hdr.map((c, ci) => THEME.bold + pad(c, colWidths[ci]) + ANSI.reset);
    result.push(border + '│ ' + ANSI.reset + hdrCells.join(' ' + border + '│ ' + ANSI.reset) + ' ' + border + '│' + ANSI.reset);
    // Separator
    result.push(border + '├' + colWidths.map(w => '─'.repeat(w + 2)).join('┼') + '┤' + ANSI.reset);
    // Data rows
    for (const row of rows) {
      const cells = row.map((c, ci) => pad(c, colWidths[ci]));
      result.push(border + '│ ' + ANSI.reset + cells.join(' ' + border + '│ ' + ANSI.reset) + ' ' + border + '│' + ANSI.reset);
    }
    // Bottom
    result.push(border + '└' + colWidths.map(w => '─'.repeat(w + 2)).join('┴') + '┘' + ANSI.reset);
    return result.join('\n');
  }

  _renderInline(text) {
    if (!text) return '';
    let result = '';
    let cursor = 0;
    const len = text.length;

    while (cursor < len) {
      const ch = text[cursor];

      if (ch === '*') {
        if (text[cursor + 1] === '*' && text[cursor + 2] === '~') {
          result += ch;
          cursor += 1;
          continue;
        }

        const boldMatch = RE_BOLD.exec(text.slice(cursor));
        if (boldMatch && boldMatch.index === 0 && boldMatch[1].length > 0) {
          result += `${THEME.bold}${boldMatch[1]}${ANSI.reset}`;
          cursor += boldMatch[0].length;
          continue;
        }

        const italicMatch = RE_ITALIC.exec(text.slice(cursor));
        if (italicMatch && italicMatch.index === 0 && italicMatch[1].length > 0) {
          result += `${THEME.italic}${italicMatch[1]}${ANSI.reset}`;
          cursor += italicMatch[0].length;
          continue;
        }

        result += ch;
        cursor += 1;
        continue;
      }

      if (ch === '`') {
        const codeMatch = RE_CODE.exec(text.slice(cursor));
        if (codeMatch && codeMatch.index === 0) {
          result += `${THEME.codeText}${codeMatch[1]}${ANSI.reset}`;
          cursor += codeMatch[0].length;
          continue;
        }
        result += ch;
        cursor += 1;
        continue;
      }

      if (ch === '~') {
        const strikethroughMatch = RE_STRIKETHROUGH.exec(text.slice(cursor));
        if (strikethroughMatch && strikethroughMatch.index === 0) {
          result += `${ANSI.strikethrough}${strikethroughMatch[1]}${ANSI.reset}`;
          cursor += strikethroughMatch[0].length;
          continue;
        }
        result += ch;
        cursor += 1;
        continue;
      }

      if (ch === '[') {
        const linkMatch = RE_LINK.exec(text.slice(cursor));
        if (linkMatch && linkMatch.index === 0) {
          result += `${THEME.link}${linkMatch[1]}${ANSI.reset}`;
          cursor += linkMatch[0].length;
          continue;
        }
        result += ch;
        cursor += 1;
        continue;
      }

      // Fast path: scan ahead for the next special character via indexOf
      const specialIdx = findNextSpecial(text, cursor + 1, len);
      if (specialIdx === -1) {
        result += text.slice(cursor);
        break;
      }
      result += text.slice(cursor, specialIdx);
      cursor = specialIdx;
    }

    return result;
  }
}

function styled(color, text) {
  return `${color}${text}${ANSI.reset}`;
}

export { MarkdownRenderer, styled };
