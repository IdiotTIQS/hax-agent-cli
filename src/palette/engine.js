"use strict";

/**
 * VS Code-style command palette for HaxAgent.
 *
 * CommandPalette provides a full-screen interactive command palette
 * with fuzzy search, keyboard navigation, and provider-based command
 * registration.
 *
 * Usage:
 *   const palette = new CommandPalette({ output: process.stdout, input: process.stdin });
 *   palette.registerProvider({
 *     name: "Commands",
 *     getItems: () => [...],
 *   });
 *   const result = await palette.open();
 *
 * Navigation:
 *   Arrow Up/Down  — move selection
 *   Enter          — execute selected command
 *   Esc            — close palette
 *   Ctrl+C         — close palette
 *   Page Up/Down   — scroll page
 *   Home/End       — jump to first/last result
 */

const readline = require("node:readline");
const { FuzzySearcher } = require("./search");

const MAX_VISIBLE_ITEMS = 12;
const MIN_QUERY_LENGTH = 0;

/**
 * ANSI escape sequences for terminal control.
 */
const ANSI = {
  clearScreen: "\x1B[2J",
  cursorHome: "\x1B[H",
  cursorHide: "\x1B[?25l",
  cursorShow: "\x1B[?25h",
  altScreenOn: "\x1B[?1049h",
  altScreenOff: "\x1B[?1049l",
  clearLine: "\x1B[2K",
  reset: "\x1B[0m",
  bold: "\x1B[1m",
  dim: "\x1B[2m",
  italic: "\x1B[3m",
  underline: "\x1B[4m",
  inverse: "\x1B[7m",
};

/**
 * Theme colors for the palette UI.
 */
const THEME = {
  accent: "\x1B[36m",
  dim: "\x1B[2m\x1B[37m",
  muted: "\x1B[90m",
  heading: "\x1B[1m\x1B[36m",
  border: "\x1B[36m",
  highlight: "\x1B[7m\x1B[1m",
  match: "\x1B[33m\x1B[1m",
  category: "\x1B[35m",
  shortcut: "\x1B[90m",
  error: "\x1B[31m",
  success: "\x1B[32m",
  warning: "\x1B[33m",
};

/**
 * Interactive command palette.
 */
class CommandPalette {
  /**
   * @param {object} [options]
   * @param {NodeJS.WritableStream} [options.output=process.stdout] - Output stream
   * @param {NodeJS.ReadableStream} [options.input=process.stdin] - Input stream
   * @param {string} [options.placeholder="Type to search..."] - Placeholder text
   * @param {string} [options.title="Command Palette"] - Palette title
   * @param {number} [options.maxVisible=12] - Max visible items
   * @param {object} [options.context] - Context passed to provider getItems and actions
   */
  constructor(options = {}) {
    this._output = options.output || process.stdout;
    this._input = options.input || process.stdin;
    this._placeholder = options.placeholder || "Type to search...";
    this._title = options.title || "Command Palette";
    this._maxVisible = options.maxVisible || MAX_VISIBLE_ITEMS;
    this._context = options.context || {};

    this._providers = [];
    this._searcher = new FuzzySearcher({ maxResults: 100 });
    this._rl = null;
    this._keypressHandler = null;

    // State
    this._isOpen = false;
    this._isTTY = Boolean(this._output.isTTY && this._input.isTTY);
    this._columns = this._output.columns || 80;
    this._rows = this._output.rows || 24;

    // Palette state
    this._query = "";
    this._results = [];
    this._selectedIndex = 0;
    this._scrollOffset = 0;
    this._allItems = [];

    // Promise resolution
    this._resolve = null;
    this._reject = null;
  }

  /**
   * Register a command provider.
   * A provider must have `name` and `getItems(context)` methods.
   *
   * @param {{ name: string, getItems: Function }} provider
   * @returns {CommandPalette} this
   */
  registerProvider(provider) {
    if (!provider || typeof provider.getItems !== "function") {
      throw new Error("Provider must implement getItems(context) method");
    }
    if (typeof provider.name !== "string") {
      throw new Error("Provider must have a name");
    }

    this._providers.push(provider);
    this._refreshItems();
    return this;
  }

  /**
   * Open the command palette UI.
   * Returns a promise that resolves with the selected item (or null if cancelled).
   *
   * @returns {Promise<object|null>} The selected palette item, or null
   */
  open() {
    if (this._isOpen) {
      return Promise.resolve(null);
    }

    this._isOpen = true;
    this._query = "";
    this._results = [];
    this._selectedIndex = 0;
    this._scrollOffset = 0;

    // Collect all items from all providers
    this._refreshItems();

    // Show the initial list (all items, ranked by score order)
    this._results = this._searcher.rank(this._allItems, "");
    this._selectedIndex = 0;
    this._scrollOffset = 0;

    // Enter alternate screen
    if (this._isTTY) {
      this._write(ANSI.altScreenOn);
      this._write(ANSI.cursorHide);
    }

    this._setupReadline();
    this._render();

    return new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
  }

  /**
   * Close the palette UI and clean up.
   *
   * @param {object|null} result - The selected item or null
   */
  close(result) {
    this._isOpen = false;

    // Clean up readline
    if (this._rl) {
      this._rl.close();
      this._rl = null;
    }

    if (this._input && this._keypressHandler) {
      this._input.removeListener("keypress", this._keypressHandler);
      this._keypressHandler = null;
    }

    // Exit alternate screen
    if (this._isTTY) {
      this._write(ANSI.cursorShow);
      this._write(ANSI.altScreenOff);
    }

    if (this._resolve) {
      this._resolve(result || null);
      this._resolve = null;
      this._reject = null;
    }
  }

  /**
   * Search available commands by query string.
   * Updates the result list and re-renders the UI.
   *
   * @param {string} query - The search query
   * @returns {Array<{item: object, score: number}>} The search results
   */
  search(query) {
    this._query = query || "";

    if (this._query.length < MIN_QUERY_LENGTH) {
      this._results = this._searcher.rank(this._allItems, "");
    } else {
      this._results = this._searcher.search(this._query, this._allItems);
    }

    this._selectedIndex = 0;
    this._scrollOffset = 0;

    if (this._isOpen) {
      this._render();
    }

    return this._results;
  }

  /**
   * Select and execute a specific command by its item object.
   *
   * @param {object} command - The palette item to execute
   * @returns {*} The result of the command's action
   */
  select(command) {
    if (!command || typeof command.action !== "function") {
      return null;
    }

    try {
      return command.action();
    } catch (err) {
      if (this._isOpen) {
        this._write(
          `\n${THEME.error}  Error executing command: ${err.message}${ANSI.reset}\n`
        );
      }
      return null;
    }
  }

  /**
   * Execute the currently selected item.
   */
  _executeSelection() {
    const result = this._results[this._selectedIndex];
    if (!result) return;

    try {
      const item = result.item;
      if (typeof item.action === "function") {
        this.close(item);
      }
    } catch (err) {
      // Keep palette open on error, show message
      this._render();
    }
  }

  /**
   * Rebuild the internal item list from all registered providers.
   */
  _refreshItems() {
    this._allItems = [];

    for (const provider of this._providers) {
      try {
        const items = provider.getItems(this._context);
        if (Array.isArray(items)) {
          this._allItems.push(...items);
        }
      } catch (err) {
        // Skip providers that fail
      }
    }

    // Deduplicate by id
    const seen = new Set();
    this._allItems = this._allItems.filter((item) => {
      if (!item || !item.id) return false;
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }

  // ── Rendering ──────────────────────────────────────────────────

  /**
   * Render the full palette UI.
   */
  _render() {
    if (!this._isTTY) {
      this._renderPlainText();
      return;
    }

    this._write(ANSI.clearScreen + ANSI.cursorHome);

    const lines = [];
    const w = Math.min(this._columns, 120);

    // Header
    lines.push(this._buildHeader(w));
    lines.push("");

    // Search bar
    lines.push(this._buildSearchBar(w));
    lines.push("");

    // Results
    lines.push(...this._buildResults(w));
    lines.push("");

    // Footer with stats and hint
    lines.push(this._buildFooter(w));

    // Write all lines
    for (const line of lines) {
      this._write(line + "\n");
    }

    // Clear remaining lines
    this._clearRemaining(lines.length);
  }

  /**
   * Render plain text for non-TTY environments.
   */
  _renderPlainText() {
    const lines = [];

    if (this._query) {
      lines.push(`> ${this._query}`);
    } else {
      lines.push(this._title);
    }

    lines.push("-".repeat(Math.min(this._columns || 80, 60)));

    if (this._results.length === 0 && this._query) {
      lines.push("  No results found.");
    } else {
      const maxShow = Math.min(this._results.length, 20);
      for (let i = 0; i < maxShow; i++) {
        const r = this._results[i];
        const marker = i === this._selectedIndex ? " > " : "   ";
        const shortcut = r.item.shortcut ? ` [${r.item.shortcut}]` : "";
        const cat = r.item.category ? ` [${r.item.category}]` : "";
        lines.push(`${marker}${r.item.name}${shortcut}${cat}`);
        if (i === this._selectedIndex && r.item.description) {
          lines.push(`     ${r.item.description}`);
        }
      }
    }

    this._write("\n" + lines.join("\n") + "\n");
  }

  /**
   * Build the header line.
   *
   * @param {number} w - Terminal width
   * @returns {string}
   */
  _buildHeader(w) {
    const headerText = `  ${THEME.heading}${this._title}${ANSI.reset}`;
    const statText = this._query
      ? `${this._results.length} results`
      : `${this._allItems.length} commands`;
    const padded = headerText + " ".repeat(Math.max(2, w - headerText.length - statText.length - 2)) + THEME.muted + statText + ANSI.reset;
    return padded;
  }

  /**
   * Build the search bar.
   *
   * @param {number} w - Terminal width
   * @returns {string}
   */
  _buildSearchBar(w) {
    const promptWidth = Math.min(w - 6, 60);
    const displayQuery = this._query.length > promptWidth - 3
      ? "..." + this._query.slice(-(promptWidth - 6))
      : this._query;

    let bar = `  ${THEME.accent}${ANSI.bold}⌘${ANSI.reset} `;

    if (this._query) {
      bar += displayQuery;
      // Cursor indicator
      bar += THEME.inverse + " " + ANSI.reset;
    } else {
      bar += THEME.dim + this._placeholder + ANSI.reset;
    }

    return bar;
  }

  /**
   * Build the results list.
   *
   * @param {number} w - Terminal width
   * @returns {string[]}
   */
  _buildResults(w) {
    const lines = [];

    if (this._results.length === 0 && this._query.length > 0) {
      lines.push(`  ${THEME.dim}No results found for "${this._query}"${ANSI.reset}`);
      return lines;
    }

    const visibleEnd = Math.min(
      this._results.length,
      this._scrollOffset + this._maxVisible
    );

    // Show scroll-up indicator
    if (this._scrollOffset > 0) {
      lines.push(`  ${THEME.dim}... ${this._scrollOffset} more above ...${ANSI.reset}`);
    }

    for (let i = this._scrollOffset; i < visibleEnd; i++) {
      const result = this._results[i];
      const item = result.item;
      const isSelected = i === this._selectedIndex;

      // Highlight matching characters in name
      const highlightedName = this._highlightName(item, this._query);

      // Category badge
      const category = item.category
        ? `  ${THEME.category}${item.category}${ANSI.reset}`
        : "";

      // Shortcut badge
      const shortcut = item.shortcut
        ? `  ${THEME.shortcut}${item.shortcut}${ANSI.reset}`
        : "";

      // Description (truncated)
      const maxDescWidth = Math.max(20, w - highlightedName.length - category.length - shortcut.length - 12);
      const desc = item.description ? this._truncateText(item.description, maxDescWidth) : "";

      if (isSelected) {
        lines.push(
          `  ${THEME.highlight} ${highlightedName} ${ANSI.reset}${category}${shortcut}`
        );
        if (desc) {
          lines.push(`    ${THEME.dim}${desc}${ANSI.reset}`);
        }
      } else {
        lines.push(
          `  ${THEME.accent}${highlightedName}${ANSI.reset}${category}${shortcut}  ${THEME.muted}${desc}${ANSI.reset}`
        );
      }
    }

    // Show scroll-down indicator
    if (visibleEnd < this._results.length) {
      lines.push(
        `  ${THEME.dim}... ${this._results.length - visibleEnd} more below ...${ANSI.reset}`
      );
    }

    return lines;
  }

  /**
   * Build the footer line.
   *
   * @param {number} w - Terminal width
   * @returns {string}
   */
  _buildFooter(w) {
    const hints = [
      `${THEME.muted}↑↓${ANSI.reset} Navigate`,
      `${THEME.muted}Enter${ANSI.reset} Select`,
      `${THEME.muted}Esc${ANSI.reset} Close`,
    ];

    if (this._results.length > 0) {
      const idx = this._selectedIndex + 1;
      const total = this._results.length;
      hints.push(`${THEME.muted}${idx}/${total}${ANSI.reset}`);
    }

    return `  ${hints.join("    ")}`;
  }

  /**
   * Highlight matching characters in a name using ANSI escape codes.
   *
   * @param {object} item - The palette item
   * @param {string} query - The search query
   * @returns {string} The highlighted name
   */
  _highlightName(item, query) {
    if (!query || query.length === 0) {
      return item.name;
    }

    const { text, matches } = this._searcher.highlight(item, query);

    if (matches.length === 0) {
      return text;
    }

    // Build highlighted string
    let result = "";
    let lastEnd = 0;

    for (const match of matches) {
      const { start, end } = match;
      // Text before this match
      result += text.slice(lastEnd, start);
      // Highlighted match
      result += THEME.match + text.slice(start, end) + ANSI.reset + THEME.accent;
      lastEnd = end;
    }

    // Remaining text after last match
    result += text.slice(lastEnd);

    return result;
  }

  /**
   * Truncate text to fit within a given width, adding ellipsis if needed.
   *
   * @param {string} text - Text to truncate
   * @param {number} maxWidth - Maximum width
   * @returns {string}
   */
  _truncateText(text, maxWidth) {
    if (!text || maxWidth <= 0) return "";
    if (text.length <= maxWidth) return text;

    // Account for ANSI codes
    let visible = 0;
    let inEscape = false;
    let result = "";

    for (const ch of text) {
      if (ch === "\x1B") {
        inEscape = true;
        result += ch;
      } else if (inEscape) {
        result += ch;
        if (ch === "m") {
          inEscape = false;
        }
      } else {
        if (visible < maxWidth - 3) {
          result += ch;
          visible++;
        } else {
          break;
        }
      }
    }

    return result + "...";
  }

  /**
   * Clear remaining terminal lines.
   *
   * @param {number} lineCount - Number of lines already rendered
   */
  _clearRemaining(lineCount) {
    if (!this._isTTY) return;
    const remaining = Math.max(0, this._rows - lineCount);
    for (let i = 0; i < remaining; i++) {
      this._write(ANSI.clearLine + "\n");
    }
  }

  // ── Keyboard Navigation ────────────────────────────────────────

  /**
   * Set up readline and keypress event handling.
   */
  _setupReadline() {
    if (!this._input.isTTY) return;

    const rl = readline.createInterface({
      input: this._input,
      escapeCodeTimeout: 50,
    });

    this._rl = rl;
    readline.emitKeypressEvents(this._input, rl);

    const handler = (str, key) => {
      if (!this._isOpen) return;

      if (key.ctrl && key.name === "c") {
        this.close(null);
        return;
      }

      this._handleKeypress(str, key);
    };

    this._keypressHandler = handler;
    this._input.on("keypress", handler);
  }

  /**
   * Handle a keypress event.
   *
   * @param {string} str - The character string
   * @param {object} key - The key object from readline
   */
  _handleKeypress(str, key) {
    switch (key.name) {
      case "up":
      case "k":
        this._navigateUp();
        break;

      case "down":
      case "j":
        this._navigateDown();
        break;

      case "pageup":
        this._navigatePageUp();
        break;

      case "pagedown":
        this._navigatePageDown();
        break;

      case "home":
        this._navigateTop();
        break;

      case "end":
        this._navigateBottom();
        break;

      case "return":
      case "enter":
        this._executeSelection();
        break;

      case "escape":
        this.close(null);
        break;

      case "backspace":
      case "delete":
        this._handleBackspace();
        break;

      default:
        // Handle printable characters
        if (str && str.length === 1 && !key.ctrl && !key.meta) {
          this._handleInput(str);
        }
        break;
    }
  }

  /**
   * Move selection up by one.
   */
  _navigateUp() {
    if (this._results.length === 0) return;
    this._selectedIndex = Math.max(0, this._selectedIndex - 1);
    this._adjustScroll();
    this._render();
  }

  /**
   * Move selection down by one.
   */
  _navigateDown() {
    if (this._results.length === 0) return;
    this._selectedIndex = Math.min(
      this._results.length - 1,
      this._selectedIndex + 1
    );
    this._adjustScroll();
    this._render();
  }

  /**
   * Move selection up by one page.
   */
  _navigatePageUp() {
    if (this._results.length === 0) return;
    this._selectedIndex = Math.max(
      0,
      this._selectedIndex - this._maxVisible
    );
    this._adjustScroll();
    this._render();
  }

  /**
   * Move selection down by one page.
   */
  _navigatePageDown() {
    if (this._results.length === 0) return;
    this._selectedIndex = Math.min(
      this._results.length - 1,
      this._selectedIndex + this._maxVisible
    );
    this._adjustScroll();
    this._render();
  }

  /**
   * Jump to the first item.
   */
  _navigateTop() {
    this._selectedIndex = 0;
    this._scrollOffset = 0;
    this._render();
  }

  /**
   * Jump to the last item.
   */
  _navigateBottom() {
    if (this._results.length === 0) return;
    this._selectedIndex = this._results.length - 1;
    this._scrollOffset = Math.max(
      0,
      this._results.length - this._maxVisible
    );
    this._render();
  }

  /**
   * Adjust scroll offset to keep the selection visible.
   */
  _adjustScroll() {
    if (this._selectedIndex < this._scrollOffset) {
      this._scrollOffset = this._selectedIndex;
    } else if (this._selectedIndex >= this._scrollOffset + this._maxVisible) {
      this._scrollOffset = this._selectedIndex - this._maxVisible + 1;
    }
  }

  /**
   * Handle a printable character input.
   *
   * @param {string} char - The character
   */
  _handleInput(char) {
    this._query += char;
    this.search(this._query);
  }

  /**
   * Handle backspace.
   */
  _handleBackspace() {
    if (this._query.length > 0) {
      this._query = this._query.slice(0, -1);
      this.search(this._query);
    }
  }

  // ── Utilities ──────────────────────────────────────────────────

  /**
   * Write data to the output stream.
   *
   * @param {string} data
   */
  _write(data) {
    this._output.write(data);
  }

  /**
   * Get the current set of items from all registered providers.
   * Useful for inspecting what's available without opening the palette.
   *
   * @returns {Array<object>} All palette items
   */
  getItems() {
    return [...this._allItems];
  }

  /**
   * Get the current search results.
   *
   * @returns {Array<{item: object, score: number}>}
   */
  getResults() {
    return [...this._results];
  }

  /**
   * Check if the palette is currently open.
   *
   * @returns {boolean}
   */
  isOpen() {
    return this._isOpen;
  }
}

module.exports = { CommandPalette, ANSI, THEME };
