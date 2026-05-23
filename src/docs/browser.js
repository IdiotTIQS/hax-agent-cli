"use strict";

const readline = require("node:readline");
const { ANSI, THEME, stripAnsi } = require("../renderer");
const { buildSearchIndex, search, fuzzyMatch, getSuggestions } = require("./search");
const {
  COMMANDS_DOCS,
  TOOLS_DOCS,
  PLUGINS_DOCS,
  CONFIG_DOCS,
  API_DOCS,
  EXAMPLES,
} = require("./content");

/**
 * Interactive documentation browser for HaxAgent.
 *
 * Navigation:
 *   Arrow Up/Down  — move selection
 *   Enter          — select item / drill into section
 *   Esc            — go back to previous view
 *   /              — enter search mode
 *   q              — quit browser
 *   h              — show help overlay
 *
 * Views: main menu, section list, topic detail, search results.
 */

const SECTION = {
  COMMANDS: { id: "commands", title: "Commands", icon: "/", docs: COMMANDS_DOCS },
  TOOLS: { id: "tools", title: "Tools", icon: "@", docs: TOOLS_DOCS },
  PLUGINS: { id: "plugins", title: "Plugins", icon: "#", docs: PLUGINS_DOCS },
  CONFIG: { id: "config", title: "Configuration", icon: "*", docs: CONFIG_DOCS },
  API: { id: "api", title: "API Reference", icon: "&", docs: API_DOCS },
  EXAMPLES: { id: "examples", title: "Examples", icon: ">", docs: EXAMPLES },
};

const ALL_SECTIONS = Object.values(SECTION);

const MAX_LIST_ITEMS = 20;

class DocBrowser {
  constructor(stream = process.stdout, input = process.stdin) {
    this._output = stream;
    this._input = input;
    this._rl = null;
    this._columns = stream.columns || 80;
    this._rows = stream.rows || 24;
    this._isTTY = Boolean(stream.isTTY && input.isTTY);

    // Navigation state
    this._viewStack = []; // [{type, section, listIndex, scrollOffset}]
    this._currentView = null;
    this._listIndex = 0;
    this._scrollOffset = 0;
    this._searchQuery = "";
    this._searchMode = false;

    // Build searchable index from all docs
    this._index = buildSearchIndex([
      ...COMMANDS_DOCS,
      ...TOOLS_DOCS,
      ...PLUGINS_DOCS,
      ...CONFIG_DOCS,
      ...API_DOCS,
      ...EXAMPLES,
    ]);

    // Running flag
    this._running = false;
  }

  /**
   * Start the interactive documentation browser.
   * Uses the alternate screen buffer for a clean full-screen experience.
   * @returns {Promise<void>} Resolves when the user quits.
   */
  async browse() {
    if (this._running) return;
    this._running = true;

    // Enter alternate screen for clean experience
    if (this._isTTY) {
      this._write(ANSI.altScreenOn);
      this._write(ANSI.cursorHide);
    }

    this._setupReadline();

    return new Promise((resolve) => {
      this._resolve = resolve;
      this._showMainMenu();
    });
  }

  // ── View Management ─────────────────────────────────────────

  _showMainMenu() {
    this._currentView = { type: "main" };
    this._listIndex = 0;
    this._scrollOffset = 0;
    this._renderMainMenu();
  }

  _showSection(sectionKey) {
    const sectionKeyUpper = String(sectionKey).toUpperCase();
    const section = SECTION[sectionKeyUpper];
    if (!section) return;

    this._pushView({ type: "section", section: sectionKey, listIndex: 0, scrollOffset: 0 });
    this._currentView = { type: "section", section: sectionKey };
    this._listIndex = 0;
    this._scrollOffset = 0;
    this._renderSectionList(section);
  }

  _showTopic(topicId) {
    // Search across all sections for the topic
    let doc = null;
    for (const section of ALL_SECTIONS) {
      doc = section.docs.find((d) => d.id === topicId);
      if (doc) break;
    }

    if (!doc) {
      this._showError("Topic not found: " + topicId);
      return;
    }

    // Don't push to stack if same detail re-opened
    this._pushView({ type: "detail", docId: topicId, scrollOffset: 0 });
    this._currentView = { type: "detail", docId: topicId };
    this._scrollOffset = 0;
    this._renderDetail(doc);
  }

  _showSearch() {
    this._searchMode = true;
    this._searchQuery = "";
    this._pushView({ type: "search", query: "", results: [], scrollOffset: 0 });
    this._currentView = { type: "search", query: "", results: [] };
    this._scrollOffset = 0;
    this._renderSearchBar();
  }

  _goBack() {
    if (this._viewStack.length <= 1) {
      // Back at main menu, just re-render
      this._viewStack = [];
      this._showMainMenu();
      return;
    }

    // Pop current view
    this._viewStack.pop();
    const prev = this._viewStack[this._viewStack.length - 1];

    if (!prev) {
      this._showMainMenu();
      return;
    }

    this._currentView = { ...prev };
    this._listIndex = prev.listIndex || 0;
    this._scrollOffset = prev.scrollOffset || 0;

    if (prev.type === "main") {
      this._renderMainMenu();
    } else if (prev.type === "section") {
      this._renderSectionList(SECTION[prev.section]);
    } else if (prev.type === "detail") {
      const doc = this._findDocById(prev.docId);
      if (doc) this._renderDetail(doc);
      else this._showMainMenu();
    } else if (prev.type === "search") {
      this._searchMode = true;
      this._searchQuery = prev.query || "";
      this._renderSearchResults(prev.results || []);
    }
  }

  _pushView(view) {
    this._viewStack.push(view);
  }

  _findDocById(id) {
    for (const section of ALL_SECTIONS) {
      const doc = section.docs.find((d) => d.id === id);
      if (doc) return doc;
    }
    return null;
  }

  // ── Command Dispatch ─────────────────────────────────────────

  _dispatchNavigation(key) {
    const view = this._currentView;
    if (!view) return;

    switch (view.type) {
      case "main":
        this._handleMainNav(key);
        break;
      case "section":
        this._handleSectionNav(key);
        break;
      case "detail":
        this._handleDetailNav(key);
        break;
      case "search":
        this._handleSearchNav(key);
        break;
    }
  }

  _handleMainNav(key) {
    if (key === "up") {
      this._listIndex = Math.max(0, this._listIndex - 1);
      this._renderMainMenu();
    } else if (key === "down") {
      this._listIndex = Math.min(ALL_SECTIONS.length - 1, this._listIndex + 1);
      this._renderMainMenu();
    } else if (key === "enter") {
      const section = ALL_SECTIONS[this._listIndex];
      if (section) this._showSection(section.id);
    } else if (key === "/") {
      this._showSearch();
    }
  }

  _handleSectionNav(key) {
    const section = SECTION[this._currentView.section];
    if (!section) return;

    const docs = section.docs;
    const maxIndex = docs.length - 1;

    if (key === "up") {
      this._listIndex = Math.max(0, this._listIndex - 1);
      this._renderSectionList(section);
    } else if (key === "down") {
      this._listIndex = Math.min(maxIndex, this._listIndex + 1);
      this._renderSectionList(section);
    } else if (key === "enter") {
      const doc = docs[this._listIndex];
      if (doc) this._showTopic(doc.id);
    } else if (key === "/") {
      this._showSearch();
    }
  }

  _handleDetailNav(key) {
    if (key === "/") {
      this._showSearch();
    }
    // In detail view, only Esc (goBack) and q (quit) are handled at top level
  }

  _handleSearchNav(key) {
    if (key === "up") {
      if (this._currentView.results && this._currentView.results.length > 0) {
        this._listIndex = Math.max(0, this._listIndex - 1);
        this._scrollOffset = Math.max(0, this._listIndex - this._visibleItems());
        this._renderSearchResults(this._currentView.results);
      }
    } else if (key === "down") {
      if (this._currentView.results && this._currentView.results.length > 0) {
        this._listIndex = Math.min(
          this._currentView.results.length - 1,
          this._listIndex + 1,
        );
        if (this._listIndex >= this._scrollOffset + this._visibleItems()) {
          this._scrollOffset = this._listIndex - this._visibleItems() + 1;
        }
        this._renderSearchResults(this._currentView.results);
      }
    } else if (key === "enter") {
      if (this._currentView.results && this._currentView.results[this._listIndex]) {
        this._searchMode = false;
        const entry = this._currentView.results[this._listIndex].entry;
        this._showTopic(entry.id);
      }
    }
  }

  _processSearchInput(char) {
    this._searchQuery += char;

    const results = search(this._searchQuery, this._index, { limit: 20 });

    // Update current view
    this._currentView.query = this._searchQuery;
    this._currentView.results = results;
    this._listIndex = 0;
    this._scrollOffset = 0;

    this._renderSearchResults(results);
  }

  _processSearchBackspace() {
    if (this._searchQuery.length > 0) {
      this._searchQuery = this._searchQuery.slice(0, -1);
    }

    const results = this._searchQuery.length > 0
      ? search(this._searchQuery, this._index, { limit: 20 })
      : [];

    this._currentView.query = this._searchQuery;
    this._currentView.results = results;
    this._listIndex = 0;
    this._scrollOffset = 0;

    this._renderSearchResults(results);
  }

  _exitSearchMode() {
    this._searchMode = false;
    this._searchQuery = "";
    this._goBack();
  }

  // ── Rendering ───────────────────────────────────────────────

  _renderMainMenu() {
    if (!this._isTTY) return;
    this._write(ANSI.cursorHome);

    const w = this._columns;
    const header = this._buildHeader("HaxAgent Documentation", "[↑↓] Navigate  [Enter] Select  [/] Search  [q] Quit");
    const lines = header;

    // Sections
    lines.push("");
    lines.push(`  ${THEME.heading}Topics${ANSI.reset}`);
    lines.push(`  ${THEME.border}${"─".repeat(Math.min(w - 2, 60))}${ANSI.reset}`);

    for (let i = 0; i < ALL_SECTIONS.length; i++) {
      const s = ALL_SECTIONS[i];
      const isSelected = i === this._listIndex;
      const prefix = isSelected ? `${THEME.accent}> ${ANSI.reset}` : "  ";
      const title = isSelected
        ? `${ANSI.inverse} ${s.icon} ${s.title} ${ANSI.reset}`
        : `  ${THEME.accent}${s.icon}${ANSI.reset} ${s.title}`;
      const count = `${THEME.dim}(${s.docs.length} topics)${ANSI.reset}`;
      lines.push(`${prefix}${title}  ${count}`);
    }

    lines.push("");
    lines.push(`  ${THEME.dim}Type / to search all documentation${ANSI.reset}`);

    // Clear screen and render
    this._write(ANSI.clearScreen + ANSI.cursorHome);
    for (const line of lines) {
      this._write(line + "\n");
    }

    // Clear remaining lines
    this._clearRemaining(lines.length);
  }

  _renderSectionList(section) {
    if (!this._isTTY) return;
    this._write(ANSI.cursorHome);

    const w = this._columns;
    const header = this._buildHeader(
      `${section.icon} ${section.title}`,
      "[↑↓] Navigate  [Enter] Open  [Esc] Back  [/] Search  [q] Quit",
    );
    const lines = header;

    lines.push("");
    lines.push(`  ${THEME.heading}${section.title} Reference${ANSI.reset}`);
    lines.push(`  ${THEME.border}${"─".repeat(Math.min(w - 2, 60))}${ANSI.reset}`);

    const docs = section.docs;

    // Paginate: show subset based on scroll offset
    const maxVisible = Math.max(3, this._rows - lines.length - 3);
    const startIdx = this._scrollOffset;
    const endIdx = Math.min(docs.length, startIdx + maxVisible);
    this._maxVisibleItems = maxVisible;

    for (let i = startIdx; i < endIdx; i++) {
      const doc = docs[i];
      const isSelected = i === this._listIndex;

      if (isSelected) {
        lines.push(`  ${THEME.accent}>${ANSI.reset} ${ANSI.inverse} ${doc.title} ${ANSI.reset}`);
        // Show brief description on selected item
        const desc = clipText(doc.description, w - 8);
        lines.push(`    ${THEME.dim}${desc}${ANSI.reset}`);
      } else {
        lines.push(`    ${doc.title}`);
      }
    }

    // Scroll indicator
    if (startIdx > 0) {
      lines.push(`    ${THEME.dim}... (${startIdx} above)${ANSI.reset}`);
    }
    if (endIdx < docs.length) {
      lines.push(`    ${THEME.dim}... (${docs.length - endIdx} more below)${ANSI.reset}`);
    }

    lines.push("");
    lines.push(`  ${THEME.dim}Showing ${startIdx + 1}-${endIdx} of ${docs.length}${ANSI.reset}`);

    this._write(ANSI.clearScreen + ANSI.cursorHome);
    for (const line of lines) {
      this._write(line + "\n");
    }
    this._clearRemaining(lines.length);
  }

  /**
   * Display a specific documentation page.
   * @param {string} topicId - The documentation topic ID.
   */
  showTopic(topicId) {
    const doc = this._findDocById(topicId);
    if (!doc) {
      this._showError("Topic not found: " + topicId);
      return;
    }
    this._renderDetail(doc);
  }

  _renderDetail(doc) {
    if (!this._isTTY) {
      // Plain text fallback
      this._write(`\n${doc.title}\n${doc.description || ""}\n\n`);
      return;
    }

    this._write(ANSI.cursorHome);

    const w = this._columns;
    const header = this._buildHeader(
      doc.title,
      "[Esc] Back  [/] Search  [q] Quit",
    );
    const lines = header;

    lines.push("");

    // Title
    lines.push(`  ${THEME.heading}${doc.title}${ANSI.reset}`);
    lines.push(`  ${THEME.border}${"─".repeat(Math.min(w - 2, 60))}${ANSI.reset}`);
    lines.push("");

    // Description
    if (doc.description) {
      const descLines = wordWrap(doc.description, w - 6);
      for (const dl of descLines) {
        lines.push(`    ${THEME.italic}${dl}${ANSI.reset}`);
      }
      lines.push("");
    }

    const maxVisible = Math.max(5, this._rows - 2);

    // Usage
    if (doc.usage) {
      lines.push(`  ${THEME.bold}Usage${ANSI.reset}`);
      const usageLines = wordWrap(doc.usage, w - 6);
      for (const ul of usageLines) {
        lines.push(`    ${THEME.codeText}${ul}${ANSI.reset}`);
      }
      lines.push("");
    }

    // Arguments (for tools)
    if (Array.isArray(doc.args) && doc.args.length > 0) {
      if (lines.length < maxVisible - 4) {
        lines.push(`  ${THEME.bold}Arguments${ANSI.reset}`);
        for (const arg of doc.args) {
          const required = arg.required ? `${THEME.warning}required${ANSI.reset}` : `${THEME.dim}optional${ANSI.reset}`;
          lines.push(`    ${THEME.accent}${arg.name}${ANSI.reset} (${arg.type}, ${required})`);
          const argDesc = wordWrap(arg.description || "", w - 10);
          for (const ad of argDesc) {
            lines.push(`      ${THEME.dim}${ad}${ANSI.reset}`);
          }
        }
        lines.push("");
      }
    }

    // Settings (for config entries)
    if (Array.isArray(doc.settings) && doc.settings.length > 0) {
      if (lines.length < maxVisible - 3) {
        lines.push(`  ${THEME.bold}Settings${ANSI.reset}`);
        for (const s of doc.settings) {
          const defaultVal = s.default !== undefined ? `[default: ${s.default}]` : "";
          lines.push(`    ${THEME.accent}${s.path}${ANSI.reset}  ${THEME.dim}${s.type}${ANSI.reset}  ${THEME.muted}${defaultVal}${ANSI.reset}`);
          const sDesc = wordWrap(s.description || "", w - 8);
          for (const sd of sDesc) {
            lines.push(`      ${THEME.dim}${sd}${ANSI.reset}`);
          }
          if (s.env && s.env !== s.default) {
            lines.push(`      ${THEME.muted}env: ${s.env}${ANSI.reset}`);
          }
        }
        lines.push("");
      }
    }

    // Examples
    if (Array.isArray(doc.examples) && doc.examples.length > 0) {
      if (lines.length < maxVisible - 3) {
        lines.push(`  ${THEME.bold}Examples${ANSI.reset}`);
        for (const ex of doc.examples) {
          const exLines = wordWrap(ex, w - 8);
          for (const el of exLines) {
            lines.push(`    ${THEME.codeText}${el}${ANSI.reset}`);
          }
        }
        lines.push("");
      }
    }

    // Code block
    if (typeof doc.code === "string") {
      if (lines.length < maxVisible - 6) {
        lines.push(`  ${THEME.bold}Example Code${ANSI.reset}`);
        const codeLines = doc.code.split("\n");
        for (const cl of codeLines) {
          lines.push(`    ${THEME.codeText}${cl.slice(0, w - 6)}${ANSI.reset}`);
        }
        lines.push("");
      }
    }

    // See Also
    if (Array.isArray(doc.seeAlso) && doc.seeAlso.length > 0) {
      const seeAlsoStr = doc.seeAlso.join(", ");
      lines.push(`  ${THEME.bold}See Also:${ANSI.reset} ${THEME.dim}${seeAlsoStr}${ANSI.reset}`);
    }

    // If too much content, indicate truncation
    if (lines.length > this._rows) {
      const truncated = lines.slice(0, this._rows - 3);
      truncated.push(`  ${THEME.dim}... (content truncated to fit screen)${ANSI.reset}`);
      this._write(ANSI.clearScreen + ANSI.cursorHome);
      for (const line of truncated) {
        this._write(line + "\n");
      }
      this._clearRemaining(truncated.length);
    } else {
      this._write(ANSI.clearScreen + ANSI.cursorHome);
      for (const line of lines) {
        this._write(line + "\n");
      }
      this._clearRemaining(lines.length);
    }
  }

  /**
   * Render a documentation section with full formatting.
   * @param {string} key - The section key (commands, tools, plugins, config, api, examples)
   */
  renderSection(key) {
    // Case-insensitive lookup
    const sectionKey = String(key).toUpperCase();
    const section = SECTION[sectionKey] || Object.values(SECTION).find((s) => s.id === String(key).toLowerCase());
    if (!section) {
      this._showError("Unknown section: " + key);
      return;
    }

    this._write(ANSI.clearScreen + ANSI.cursorHome);

    const w = this._columns;
    const lines = [
      "",
      `  ${THEME.heading}${THEME.bold}${section.title}${ANSI.reset}`,
      `  ${THEME.border}${"═".repeat(Math.min(w - 2, 60))}${ANSI.reset}`,
      "",
    ];

    for (const doc of section.docs) {
      lines.push(`  ${THEME.accent}${THEME.bold}${doc.title}${ANSI.reset}`);
      const desc = wordWrap(doc.description || "", w - 6);
      for (const dl of desc) {
        lines.push(`    ${THEME.dim}${dl}${ANSI.reset}`);
      }
      lines.push("");
    }

    for (const line of lines) {
      this._write(line + "\n");
    }
  }

  /**
   * Search all documentation topics.
   * Returns formatted results to the screen.
   * @param {string} query - The search query.
   */
  searchTopics(query) {
    if (!query || !query.trim()) return;

    this._searchQuery = query.trim();
    const results = search(this._searchQuery, this._index, { limit: 30 });
    this._renderSearchResults(results);
  }

  _renderSearchBar() {
    this._write(ANSI.clearScreen + ANSI.cursorHome);

    const header = this._buildHeader("Search Documentation", "[Type to search]  [Enter] Open  [Esc] Cancel  [q] Quit");
    for (const line of header) {
      this._write(line + "\n");
    }

    this._write(`\n  ${THEME.accent}>${ANSI.reset} ${THEME.inverse} ${this._searchQuery || ""} ${ANSI.reset}\n`);
    this._write(`  ${THEME.dim}Start typing to search...${ANSI.reset}\n`);

    this._clearRemaining(header.length + 3);
  }

  _renderSearchResults(results) {
    if (!this._isTTY) {
      this._write(`\n  Search: "${this._searchQuery}"\n`);
      for (let i = 0; i < Math.min(results.length, 10); i++) {
        const r = results[i];
        this._write(`  ${i + 1}. ${r.entry.title} (score: ${r.score.toFixed(1)})\n`);
      }
      this._write("\n");
      return;
    }

    this._write(ANSI.clearScreen + ANSI.cursorHome);

    const header = this._buildHeader("Search Documentation", "[Type to search]  [Enter] Open  [Esc] Cancel  [q] Quit");
    const lines = header;

    // Search bar
    lines.push("");
    lines.push(`  ${THEME.accent}⌘${ANSI.reset} ${THEME.inverse} ${this._searchQuery} ${ANSI.reset}`);
    lines.push(`  ${THEME.border}${"─".repeat(Math.min(this._columns - 2, 60))}${ANSI.reset}`);

    if (results.length === 0 && this._searchQuery.length > 0) {
      lines.push("");
      lines.push(`  ${THEME.warning}No results found for "${this._searchQuery}"${ANSI.reset}`);

      // Try fuzzy suggestions
      const titles = this._index.entries.map((e) => e.title);
      const fuzzy = fuzzyMatch(this._searchQuery, titles, { limit: 5 });
      if (fuzzy.length > 0) {
        lines.push("");
        lines.push(`  ${THEME.dim}Did you mean:${ANSI.reset}`);
        for (const f of fuzzy) {
          lines.push(`    ${THEME.muted}${f.candidate}${ANSI.reset}`);
        }
      }
    } else if (results.length > 0) {
      lines.push("");
      lines.push(`  ${THEME.dim}${results.length} result${results.length === 1 ? "" : "s"} for "${this._searchQuery}"${ANSI.reset}`);
      lines.push("");

      const maxVisible = Math.max(4, this._visibleItems());
      const startIdx = this._scrollOffset;
      const endIdx = Math.min(results.length, startIdx + maxVisible);

      for (let i = startIdx; i < endIdx; i++) {
        const r = results[i];
        const isSelected = i === this._listIndex;
        const prefix = isSelected ? `${THEME.accent}>${ANSI.reset} ` : "  ";
        const title = isSelected ? `${ANSI.inverse} ${r.entry.title} ${ANSI.reset}` : r.entry.title;
        const score = `${THEME.dim}(${r.score.toFixed(1)})${ANSI.reset}`;
        lines.push(`${prefix}${title}  ${score}`);

        // Show snippet
        const desc = clipText(r.entry.description || "", this._columns - 10);
        lines.push(`    ${THEME.dim}${desc}${ANSI.reset}`);
      }

      // Scroll indicators
      if (startIdx > 0) {
        lines.push(`  ${THEME.dim}... (${startIdx} above)${ANSI.reset}`);
      }
      if (endIdx < results.length) {
        lines.push(`  ${THEME.dim}... (${results.length - endIdx} more below)${ANSI.reset}`);
      }
    } else {
      lines.push("");
      lines.push(`  ${THEME.dim}Start typing to search all documentation${ANSI.reset}`);
    }

    // Show suggestions for common searches
    if (this._searchQuery.length >= 2 && results.length > 0) {
      lines.push("");
      lines.push(`  ${THEME.dim}Sections matching:${ANSI.reset}`);
      const suggestions = getSuggestions(this._searchQuery, this._index, { limit: 4 });
      for (const s of suggestions) {
        lines.push(`    ${THEME.muted}${s.title}${ANSI.reset} ${THEME.dim}(${s.reason})${ANSI.reset}`);
      }
    }

    this._write(ANSI.clearScreen + ANSI.cursorHome);
    for (const line of lines) {
      this._write(line + "\n");
    }
    this._clearRemaining(lines.length);
  }

  _showError(message) {
    if (this._isTTY) {
      this._write(ANSI.clearScreen + ANSI.cursorHome);
      this._write(`\n  ${THEME.error}Error: ${message}${ANSI.reset}\n`);
      this._write(`\n  ${THEME.dim}Press any key to go back...${ANSI.reset}\n`);
    } else {
      this._write(`\nError: ${message}\n`);
    }
  }

  _buildHeader(title, help) {
    const w = this._columns;
    const titleText = `HaxAgent Docs`;
    const padded = `  ${THEME.statusLine} ${titleText} ${title} ${ANSI.reset}`;
    const helpText = `  ${THEME.dim}${help}${ANSI.reset}`;
    return [padded, helpText];
  }

  _visibleItems() {
    return Math.max(3, this._rows - 12);
  }

  _clearRemaining(lineCount) {
    if (!this._isTTY) return;
    const remaining = this._rows - lineCount;
    for (let i = 0; i < remaining; i++) {
      this._write(ANSI.clearLine + "\n");
    }
  }

  // ── Readline Setup ──────────────────────────────────────────

  _setupReadline() {
    if (!this._input.isTTY) return;

    const rl = readline.createInterface({
      input: this._input,
      escapeCodeTimeout: 50,
    });

    this._rl = rl;

    readline.emitKeypressEvents(this._input, rl);

    const onKeypress = (str, key) => {
      if (!this._running) return;

      if (key.ctrl && key.name === "c") {
        // Ctrl+C also quits
        this._handleQuit();
        return;
      }

      // In search mode, capture all printable input
      if (this._searchMode) {
        if (key.name === "escape") {
          this._exitSearchMode();
        } else if (key.name === "return" || key.name === "enter") {
          // Enter in search mode opens the selected result
          this._dispatchNavigation("enter");
        } else if (key.name === "backspace" || key.name === "delete") {
          this._processSearchBackspace();
        } else if (key.name === "up") {
          this._dispatchNavigation("up");
        } else if (key.name === "down") {
          this._dispatchNavigation("down");
        } else if (str && str.length === 1 && !key.ctrl && !key.meta) {
          // Printable character
          this._processSearchInput(str);
        }
        return;
      }

      // Normal mode navigation
      switch (key.name) {
        case "up":
        case "k":
          this._dispatchNavigation("up");
          break;
        case "down":
        case "j":
          this._dispatchNavigation("down");
          break;
        case "return":
        case "enter":
          this._dispatchNavigation("enter");
          break;
        case "escape":
          this._goBack();
          break;
        case "q":
          this._handleQuit();
          break;
        case "h":
          // Show help overlay (just re-render main with help)
          if (this._currentView && this._currentView.type !== "search") {
            this._showMainMenu();
          }
          break;
        default:
          // Check for / to enter search mode
          if (str === "/" && this._currentView && this._currentView.type !== "search") {
            this._showSearch();
          }
          break;
      }
    };

    this._input.on("keypress", onKeypress);
    this._keypressHandler = onKeypress;
  }

  /**
   * Clean up readline and exit alternate screen.
   */
  _handleQuit() {
    this._running = false;

    if (this._rl) {
      this._rl.close();
      this._rl = null;
    }

    if (this._input && this._keypressHandler) {
      this._input.removeListener("keypress", this._keypressHandler);
      this._keypressHandler = null;
    }

    if (this._isTTY) {
      this._write(ANSI.cursorShow);
      this._write(ANSI.altScreenOff);
    }

    if (this._resolve) {
      this._resolve();
      this._resolve = null;
    }
  }

  _write(data) {
    this._output.write(data);
  }
}

// ── Utility Helpers ───────────────────────────────────────────

/**
 * Simple word wrapper that splits text at word boundaries to fit within maxWidth.
 */
function wordWrap(text, maxWidth) {
  if (!text) return [""];
  if (maxWidth <= 0) return [text];

  const lines = [];
  const words = text.split(/\s+/);

  let currentLine = "";
  for (const word of words) {
    const strippedWord = stripAnsi(word);
    const strippedLine = stripAnsi(currentLine);

    if (strippedLine.length === 0) {
      currentLine = word;
    } else if (strippedLine.length + 1 + strippedWord.length <= maxWidth) {
      currentLine += " " + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length === 0 ? [""] : lines;
}

/**
 * Clip text to fit within a given width, adding ellipsis if truncated.
 */
function clipText(text, maxWidth) {
  if (!text) return "";
  const stripped = stripAnsi(text);
  if (stripped.length <= maxWidth) return text;

  // Walk through, account for ANSI codes
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

module.exports = { DocBrowser, SECTION, wordWrap, clipText };
