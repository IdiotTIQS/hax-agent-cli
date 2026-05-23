'use strict';

// ---------------------------------------------------------------------------
// ANSI color constants
// ---------------------------------------------------------------------------

const ANSI = {
  RESET: '\x1b[0m',
  BOLD: '\x1b[1m',
  DIM: '\x1b[2m',
  ITALIC: '\x1b[3m',
  RED: '\x1b[31m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
  MAGENTA: '\x1b[35m',
  CYAN: '\x1b[36m',
  WHITE: '\x1b[37m',
  BG_RED: '\x1b[41m',
  BG_GREEN: '\x1b[42m',
  BG_YELLOW: '\x1b[43m',
};

// ---------------------------------------------------------------------------
// Unicode box-drawing characters (extended set)
// ---------------------------------------------------------------------------

const BOX = {
  H: '─',
  V: '│',
  TL: '┌',
  TR: '┐',
  BL: '└',
  BR: '┘',
  HD: '┬',
  HU: '┴',
  VL: '├',
  VR: '┤',
  CR: '┼',

  // Double-line
  DH: '═',
  DV: '║',
  DTL: '╔',
  DTR: '╗',
  DBL: '╚',
  DBR: '╝',

  // Rounded
  RH: '╭',
  RTR: '╮',
  RBL: '╯',
  RBR: '╰',

  // Arrows
  ARROW_R: '→',
  ARROW_L: '←',
  ARROW_U: '↑',
  ARROW_D: '↓',
  ARROW_RD: '↘',

  // Blocks
  BLOCK: '█',
  DARK: '▓',
  MEDIUM: '▒',
  LIGHT: '░',
  LHALF: '▌',
  RHALF: '▐',

  // Tree
  TREE_V: '│',
  TREE_L: '├',
  TREE_E: '└',
  TREE_H: '─',
  TREE_T: '┬',
  TREE_BULLET: '•',
  TREE_DIAMOND: '◆',
  TREE_RIGHT: '├',
  TREE_LAST: '└',
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Clamp a number between lo and hi.
 */
function clamp(val, lo, hi) {
  return Math.max(lo, Math.min(hi, val));
}

/**
 * Repeat a character n times.
 */
function repeat(ch, n) {
  if (n <= 0) return '';
  return ch.repeat(Math.floor(n));
}

/**
 * Pad string to the right to given length.
 */
function padRight(str, len) {
  const s = String(str);
  return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

/**
 * Pad string to the left to given length.
 */
function padLeft(str, len) {
  const s = String(str);
  return s.length >= len ? s : ' '.repeat(len - s.length) + s;
}

/**
 * Truncate a string to maxLen, appending ellipsis if needed.
 */
function truncate(str, maxLen) {
  if (!str || typeof str !== 'string') return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

/**
 * Get an ANSI color for a confidence value (0.0-1.0).
 */
function confidenceColor(confidence, useAnsi) {
  if (!useAnsi) return '';
  if (confidence >= 0.8) return ANSI.GREEN;
  if (confidence >= 0.6) return ANSI.CYAN;
  if (confidence >= 0.4) return ANSI.YELLOW;
  if (confidence >= 0.2) return ANSI.MAGENTA;
  return ANSI.RED;
}

/**
 * Get a Unicode icon matching the decision type.
 */
function decisionIcon(type) {
  switch (type) {
    case 'tool_selection': return '⚙';  // gear
    case 'response_path': return '➡';  // arrow right
    case 'error_recovery': return '⚠'; // warning
    case 'strategy': return '♦';       // diamond
    case 'general':
    default: return '●';               // circle
  }
}

/**
 * Format a timestamp for display.
 */
function formatTs(ts) {
  if (!ts) return 'unknown';
  try {
    const d = new Date(ts);
    return d.toISOString().replace('T', ' ').slice(0, 19);
  } catch (_) {
    return String(ts).slice(0, 19);
  }
}

/**
 * Render a "confidence bar" using block characters.
 */
function confidenceBar(confidence, width, useAnsi) {
  const w = clamp(width || 10, 4, 40);
  const filled = Math.round(clamp(confidence, 0, 1) * w);
  const empty = w - filled;

  let bar = '';
  // Use gradient blocks for filled portion
  const filledStr = repeat(BOX.BLOCK, filled);
  const emptyStr = repeat(BOX.LIGHT, empty);

  if (useAnsi) {
    const color = confidenceColor(confidence, true);
    bar = `${color}${filledStr}${ANSI.RESET}${ANSI.DIM}${emptyStr}${ANSI.RESET}`;
  } else {
    bar = `${filledStr}${emptyStr}`;
  }

  return bar;
}

/**
 * Render a success/failure indicator.
 */
function outcomeIndicator(outcome, useAnsi) {
  if (!outcome) return '?';
  if (outcome.success === true) {
    return useAnsi ? `${ANSI.GREEN}✓${ANSI.RESET}` : '✓';
  }
  if (outcome.success === false) {
    return useAnsi ? `${ANSI.RED}✗${ANSI.RESET}` : '✗';
  }
  return '—'; // em dash for unknown
}

// ---------------------------------------------------------------------------
// DecisionTreeRenderer
// ---------------------------------------------------------------------------

/**
 * Visualizes agent decision trees using Unicode box-drawing characters
 * and ANSI colors. Works with decision objects from DecisionTracer.
 *
 * Usage:
 *   const renderer = new DecisionTreeRenderer({ useAnsi: true });
 *   const tree = tracer.getDecisionTree('session-abc');
 *   console.log(renderer.renderTree(tree.decisions));
 *   console.log(renderer.renderTimeline(tree.decisions));
 *   console.log(renderer.renderGraph(tree.decisions));
 *   console.log(renderer.renderStats(tree.decisions));
 */
class DecisionTreeRenderer {
  /**
   * @param {object} [options]
   * @param {boolean} [options.useAnsi=true] - enable ANSI color output
   * @param {number} [options.maxWidth=100] - maximum output width
   * @param {number} [options.maxDepth=10] - maximum tree depth
   * @param {boolean} [options.collapseByDefault=false] - start with collapsed nodes
   * @param {number} [options.collapseAfter=8] - auto-collapse nodes after this count
   */
  constructor(options = {}) {
    this._useAnsi = options.useAnsi !== false;
    this._maxWidth = clamp(options.maxWidth || 100, 40, 300);
    this._maxDepth = clamp(options.maxDepth || 10, 1, 50);
    this._collapseByDefault = options.collapseByDefault === true;
    this._collapseAfter = clamp(options.collapseAfter || 8, 1, 100);
  }

  // ---------------------------------------------------------------------------
  // renderTree — hierarchical decision tree with branching
  // ---------------------------------------------------------------------------

  /**
   * Render decisions as a hierarchical tree grouped by decision type,
   * showing branching choices and alternatives.
   *
   * @param {object[]} decisions - array of decision objects
   * @param {object} [options]
   * @param {boolean} [options.collapsed] - collapse long branches
   * @param {boolean} [options.showAlternatives] - display alternatives under each node
   * @param {boolean} [options.showConfidence] - show confidence bars
   * @param {boolean} [options.showOutcome] - annotate with outcome indicators
   * @param {string} [options.title] - optional tree title
   * @returns {string} formatted decision tree
   */
  renderTree(decisions, options = {}) {
    const opts = {
      collapsed: options.collapsed !== undefined ? options.collapsed : this._collapseByDefault,
      showAlternatives: options.showAlternatives !== false,
      showConfidence: options.showConfidence !== false,
      showOutcome: options.showOutcome !== false,
      title: options.title || '',
    };

    const decs = Array.isArray(decisions) ? [...decisions] : [];
    if (decs.length === 0) {
      return opts.title
        ? `${opts.title}\n${BOX.TREE_E}${BOX.TREE_H}${BOX.TREE_H} (no decisions)`
        : '(no decisions)';
    }

    // Sort by timestamp
    decs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Group decisions by type for hierarchical tree
    const groups = this._groupByType(decs);
    const lines = [];

    if (opts.title) {
      if (this._useAnsi) {
        lines.push(`${ANSI.BOLD}${ANSI.CYAN}${opts.title}${ANSI.RESET}`);
      } else {
        lines.push(opts.title);
      }
      lines.push(repeat(BOX.H, Math.min(opts.title.length + 8, this._maxWidth)));
    }

    // Root node
    const rootLabel = `Session Decisions (${decs.length})`;
    lines.push(rootLabel);

    // Render each type group as a branch
    const groupKeys = Object.keys(groups);
    for (let gi = 0; gi < groupKeys.length; gi++) {
      const type = groupKeys[gi];
      const typeDecs = groups[type];
      const isLastGroup = gi === groupKeys.length - 1;
      const branchPrefix = isLastGroup
        ? `${BOX.TREE_E}${BOX.TREE_H}${BOX.TREE_H} `
        : `${BOX.TREE_L}${BOX.TREE_H}${BOX.TREE_H} `;
      const childPrefix = isLastGroup ? '    ' : `${BOX.TREE_V}   `;

      // Type branch header
      const icon = decisionIcon(type);
      const typeLabel = this._formatTypeName(type);
      const countStr = `(${typeDecs.length})`;
      let header = `${branchPrefix}${icon} ${typeLabel} ${countStr}`;
      if (this._useAnsi) {
        header = isLastGroup
          ? `${BOX.TREE_E}${BOX.TREE_H}${BOX.TREE_H} ${ANSI.BOLD}${icon} ${typeLabel}${ANSI.RESET} ${ANSI.DIM}${countStr}${ANSI.RESET}`
          : `${BOX.TREE_L}${BOX.TREE_H}${BOX.TREE_H} ${ANSI.BOLD}${icon} ${typeLabel}${ANSI.RESET} ${ANSI.DIM}${countStr}${ANSI.RESET}`;
      }
      lines.push(header);

      // Render each decision in this type group
      const showCount = opts.collapsed
        ? Math.min(typeDecs.length, this._collapseAfter)
        : typeDecs.length;

      for (let di = 0; di < showCount; di++) {
        const dec = typeDecs[di];
        const isLastDec = di === showCount - 1;
        const decBranch = isLastDec
          ? `${BOX.TREE_E}${BOX.TREE_H}${BOX.TREE_H} `
          : `${BOX.TREE_L}${BOX.TREE_H}${BOX.TREE_H} `;
        const decChild = isLastDec ? '    ' : `${BOX.TREE_V}   `;

        lines.push(`${childPrefix}${decBranch}${this._renderDecisionNode(dec, opts)}`);

        // Render alternatives as sub-branches
        if (opts.showAlternatives && Array.isArray(dec.alternatives) && dec.alternatives.length > 0) {
          const alts = dec.alternatives;
          const maxAlts = Math.min(alts.length, 5);
          for (let ai = 0; ai < maxAlts; ai++) {
            const alt = alts[ai];
            const isLastAlt = ai === maxAlts - 1 && (maxAlts >= alts.length || ai === 4);
            const altBranch = isLastAlt
              ? `${BOX.TREE_E}${BOX.TREE_H}${BOX.TREE_H} `
              : `${BOX.TREE_L}${BOX.TREE_H}${BOX.TREE_H} `;
            const chosen = dec.outcome && dec.outcome.chosen === alt.id;

            let altLine;
            if (chosen && this._useAnsi) {
              altLine = `${ANSI.GREEN}${alt.id || alt.description}${ANSI.RESET} ${ANSI.DIM}(chosen)${ANSI.RESET}`;
            } else if (chosen) {
              altLine = `${alt.id || alt.description} (chosen)`;
            } else if (this._useAnsi) {
              altLine = `${ANSI.DIM}${alt.id || alt.description}${ANSI.RESET}`;
            } else {
              altLine = `${alt.id || alt.description}`;
            }

            if (alt.score != null) {
              altLine += ` [score: ${alt.score.toFixed(2)}]`;
            }

            lines.push(`${childPrefix}${decChild}${altBranch}${altLine}`);
          }

          if (alts.length > 5) {
            const remaining = alts.length - 5;
            const moreBranch = `${BOX.TREE_E}${BOX.TREE_H}${BOX.TREE_H} `;
            lines.push(`${childPrefix}${decChild}${moreBranch}${ANSI.DIM}(... ${remaining} more alternatives)${ANSI.RESET}`);
          }
        }
      }

      // Show collapse indicator if there are more decisions hidden
      if (opts.collapsed && typeDecs.length > this._collapseAfter) {
        const hidden = typeDecs.length - this._collapseAfter;
        const collapseBranch = `${BOX.TREE_E}${BOX.TREE_H}${BOX.TREE_H} `;
        lines.push(`${childPrefix}${collapseBranch}${ANSI.DIM}(... ${hidden} more decisions collapsed)${ANSI.RESET}`);
      }
    }

    // Footer
    lines.push('');
    if (this._useAnsi) {
      lines.push(`${ANSI.DIM}${repeat(BOX.H, 20)}${ANSI.RESET}`);
    } else {
      lines.push(repeat(BOX.H, 20));
    }

    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // renderTimeline — chronological timeline of decisions
  // ---------------------------------------------------------------------------

  /**
   * Render a chronological timeline showing decisions in order
   * with visual indicators for type, confidence, and outcome.
   *
   * @param {object[]} decisions - array of decision objects
   * @param {object} [options]
   * @param {boolean} [options.showConfidence] - show confidence bars
   * @param {boolean} [options.showRationale] - include rationale text
   * @param {boolean} [options.compact] - compact single-line-per-decision mode
   * @param {string} [options.title] - optional timeline title
   * @returns {string} formatted timeline
   */
  renderTimeline(decisions, options = {}) {
    const opts = {
      showConfidence: options.showConfidence !== false,
      showRationale: options.showRationale !== false,
      compact: options.compact === true,
      title: options.title || '',
    };

    const decs = Array.isArray(decisions) ? [...decisions] : [];
    if (decs.length === 0) {
      return opts.title ? `${opts.title}\n(no decisions)` : '(no decisions)';
    }

    decs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const lines = [];

    if (opts.title) {
      if (this._useAnsi) {
        lines.push(`${ANSI.BOLD}${ANSI.CYAN}${opts.title}${ANSI.RESET}`);
      } else {
        lines.push(opts.title);
      }
      lines.push(repeat(BOX.H, Math.min(opts.title.length + 8, this._maxWidth)));
    }

    // Timeline header
    const timeWidth = 19;
    const typeWidth = 16;
    const confWidth = 12;
    const agentWidth = 12;

    if (!opts.compact) {
      const header = `${padRight('Time', timeWidth)} ${padRight('Type', typeWidth)} ${padRight('Agent', agentWidth)} ${padRight('Conf', confWidth)} Outcome  Chosen`;
      if (this._useAnsi) {
        lines.push(`${ANSI.BOLD}${header}${ANSI.RESET}`);
      } else {
        lines.push(header);
      }
    }

    for (let i = 0; i < decs.length; i++) {
      const dec = decs[i];

      if (opts.compact) {
        // Compact: single-line with timeline connector
        const isLast = i === decs.length - 1;
        const connector = isLast
          ? `${BOX.TREE_E}${BOX.TREE_H}`
          : `${BOX.TREE_L}${BOX.TREE_H}`;
        const result = outcomeIndicator(dec.outcome, this._useAnsi);
        const ts = formatTs(dec.timestamp).slice(11, 19); // HH:MM:SS
        const confBar = opts.showConfidence ? ` ${confidenceBar(dec.confidence, 6, this._useAnsi)}` : '';

        let compactLine = `${connector} ${ts} ${result} `;
        const chosen = dec.outcome && dec.outcome.chosen ? truncate(dec.outcome.chosen, 40) : 'N/A';

        if (this._useAnsi) {
          const color = confidenceColor(dec.confidence, this._useAnsi);
          compactLine += `${color}${chosen}${ANSI.RESET}`;
          compactLine += ` ${ANSI.DIM}[${dec.type}]${ANSI.RESET}${confBar}`;
        } else {
          compactLine += `${chosen} [${dec.type}]${confBar}`;
        }

        lines.push(compactLine);
      } else {
        // Full line
        const ts = formatTs(dec.timestamp);
        const typeLabel = this._formatTypeName(dec.type);
        const agent = truncate(dec.agentId || 'unknown', 10);
        const outcome = outcomeIndicator(dec.outcome, this._useAnsi);
        const chosen = dec.outcome && dec.outcome.chosen
          ? truncate(dec.outcome.chosen, 30)
          : 'N/A';

        const confBar = opts.showConfidence
          ? confidenceBar(dec.confidence, 10, this._useAnsi)
          : '';

        // Build the line with colors
        let line;
        if (this._useAnsi) {
          const color = confidenceColor(dec.confidence, this._useAnsi);
          line = `${ANSI.DIM}${ts}${ANSI.RESET} ${color}${padRight(typeLabel, typeWidth)}${ANSI.RESET} ${padRight(agent, agentWidth)} ${confBar} ${outcome}  ${color}${chosen}${ANSI.RESET}`;
        } else {
          line = `${padRight(ts, timeWidth)} ${padRight(typeLabel, typeWidth)} ${padRight(agent, agentWidth)} ${padRight(confBar, confWidth + 2)} ${outcome}  ${chosen}`;
        }
        lines.push(line);

        // Rationale line
        if (opts.showRationale && dec.rationale) {
          const rationaleText = truncate(dec.rationale, this._maxWidth - 4);
          if (this._useAnsi) {
            lines.push(`  ${ANSI.DIM}${ANSI.ITALIC}${rationaleText}${ANSI.RESET}`);
          } else {
            lines.push(`  ${rationaleText}`);
          }
        }

        // Spacer between entries (except after last)
        if (i < decs.length - 1) {
          lines.push('');
        }
      }
    }

    lines.push('');
    if (this._useAnsi) {
      lines.push(`${ANSI.DIM}${decs.length} decisions  |  ${formatTs(decs[0].timestamp)} → ${formatTs(decs[decs.length - 1].timestamp)}${ANSI.RESET}`);
    } else {
      lines.push(`${decs.length} decisions  |  ${formatTs(decs[0].timestamp)} → ${formatTs(decs[decs.length - 1].timestamp)}`);
    }

    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // renderGraph — graph visualization of decision relationships
  // ---------------------------------------------------------------------------

  /**
   * Render a dependency/relationship graph showing how decisions connect.
   * Decisions are connected by type, agent, and temporal proximity.
   *
   * @param {object[]} decisions - array of decision objects
   * @param {object} [options]
   * @param {string} [options.groupBy] - 'type' | 'agent' | 'time' (default: 'type')
   * @param {boolean} [options.showEdges] - show connecting edges
   * @param {string} [options.title] - optional graph title
   * @returns {string} formatted graph
   */
  renderGraph(decisions, options = {}) {
    const opts = {
      groupBy: options.groupBy || 'type',
      showEdges: options.showEdges !== false,
      title: options.title || '',
    };

    const decs = Array.isArray(decisions) ? [...decisions] : [];
    if (decs.length === 0) {
      return opts.title ? `${opts.title}\n(no decisions)` : '(no decisions)';
    }

    decs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const lines = [];

    if (opts.title) {
      if (this._useAnsi) {
        lines.push(`${ANSI.BOLD}${ANSI.CYAN}${opts.title}${ANSI.RESET}`);
      } else {
        lines.push(opts.title);
      }
      lines.push(repeat(BOX.H, Math.min(opts.title.length + 8, this._maxWidth)));
    }

    // Group decisions
    let groups;
    if (opts.groupBy === 'agent') {
      groups = this._groupByAgent(decs);
    } else if (opts.groupBy === 'time') {
      groups = this._groupByTime(decs);
    } else {
      groups = this._groupByType(decs);
    }

    const groupKeys = Object.keys(groups);
    const nodeWidth = 30;

    // Render each group as a "cluster"
    for (let gi = 0; gi < groupKeys.length; gi++) {
      const key = groupKeys[gi];
      const groupDecs = groups[key];
      const isLastGroup = gi === groupKeys.length - 1;

      // Group header
      let groupHeader;
      if (this._useAnsi) {
        groupHeader = `${ANSI.BOLD}${ANSI.CYAN}${BOX.DTL}${repeat(BOX.DH, nodeWidth - 2)}${BOX.DTR}${ANSI.RESET}`;
      } else {
        groupHeader = `${BOX.DTL}${repeat(BOX.DH, nodeWidth - 2)}${BOX.DTR}`;
      }
      lines.push(groupHeader);

      const headerLabel = truncate(key, nodeWidth - 4);
      if (this._useAnsi) {
        lines.push(`${BOX.DV} ${ANSI.BOLD}${padRight(headerLabel, nodeWidth - 2)}${ANSI.RESET} ${BOX.DV}`);
      } else {
        lines.push(`${BOX.DV} ${padRight(headerLabel, nodeWidth - 2)} ${BOX.DV}`);
      }

      // Separator
      if (this._useAnsi) {
        lines.push(`${ANSI.DIM}${BOX.VL}${repeat(BOX.H, nodeWidth)}${BOX.VR}${ANSI.RESET}`);
      } else {
        lines.push(`${BOX.VL}${repeat(BOX.H, nodeWidth)}${BOX.VR}`);
      }

      // Render nodes within this group
      const visibleCount = Math.min(groupDecs.length, this._collapseAfter);
      for (let di = 0; di < visibleCount; di++) {
        const dec = groupDecs[di];
        const isLastNode = di === visibleCount - 1 && (visibleCount >= groupDecs.length || di >= this._collapseAfter - 1);
        const connector = isLastNode
          ? `${BOX.TREE_E}${BOX.TREE_H}`
          : `${BOX.VL}${BOX.TREE_H}${BOX.TREE_H}`;

        const result = outcomeIndicator(dec.outcome, this._useAnsi);
        const chosen = truncate(dec.outcome && dec.outcome.chosen ? dec.outcome.chosen : '?', nodeWidth - 10);

        let nodeLine;
        const color = confidenceColor(dec.confidence, this._useAnsi);
        if (this._useAnsi) {
          nodeLine = `${connector} ${result} ${color}${chosen}${ANSI.RESET}`;
        } else {
          nodeLine = `${connector} ${result} ${chosen}`;
        }

        // Add confidence bar
        const confBar = confidenceBar(dec.confidence, 6, this._useAnsi);
        nodeLine += ` ${confBar}`;

        lines.push(nodeLine);
      }

      // Edges between groups (show connections)
      if (opts.showEdges && gi < groupKeys.length - 1) {
        const nextKey = groupKeys[gi + 1];
        const nextGroup = groups[nextKey];
        const edgeCount = Math.min(groupDecs.length, nextGroup.length);
        if (edgeCount > 0) {
          const edgeLine = `${BOX.V} ${ANSI.DIM}${repeat(BOX.ARROW_D, 3)} ${edgeCount} connection(s) to "${truncate(nextKey, 20)}"${ANSI.RESET}`;
          lines.push(edgeLine);
        }
      }

      // Bottom of group box
      if (this._useAnsi) {
        lines.push(`${ANSI.DIM}${BOX.DBL}${repeat(BOX.DH, nodeWidth - 2)}${BOX.DBR}${ANSI.RESET}`);
      } else {
        lines.push(`${BOX.DBL}${repeat(BOX.DH, nodeWidth - 2)}${BOX.DBR}`);
      }

      if (gi < groupKeys.length - 1) {
        lines.push(`${ANSI.DIM}${BOX.V}${ANSI.RESET}`);
      }
    }

    // Legend
    lines.push('');
    if (this._useAnsi) {
      lines.push(`Legend: ${ANSI.GREEN}✓${ANSI.RESET}=success ${ANSI.RED}✗${ANSI.RESET}=failure ${ANSI.GREEN}█${ANSI.RESET}=high ${ANSI.YELLOW}█${ANSI.RESET}=med ${ANSI.RED}█${ANSI.RESET}=low confidence`);
    } else {
      lines.push('Legend: ✓=success ✗=failure █=confidence');
    }

    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // renderStats — statistical overview of decisions
  // ---------------------------------------------------------------------------

  /**
   * Render a statistical overview with charts summarizing decision data.
   *
   * @param {object[]} decisions - array of decision objects
   * @param {object} [options]
   * @param {string} [options.title] - optional stats title
   * @param {boolean} [options.showCharts] - include inline bar/sparkline charts
   * @param {boolean} [options.showDetails] - show per-decision detail rows
   * @returns {string} formatted statistics
   */
  renderStats(decisions, options = {}) {
    const opts = {
      title: options.title || '',
      showCharts: options.showCharts !== false,
      showDetails: options.showDetails === true,
    };

    const decs = Array.isArray(decisions) ? [...decisions] : [];
    if (decs.length === 0) {
      return opts.title ? `${opts.title}\n(no decisions)` : '(no decisions)';
    }

    const lines = [];

    // Title
    if (opts.title) {
      if (this._useAnsi) {
        lines.push(`${ANSI.BOLD}${ANSI.CYAN}╔${repeat('═', Math.min(opts.title.length + 6, this._maxWidth - 4))}╗${ANSI.RESET}`);
        lines.push(`${ANSI.BOLD}${ANSI.CYAN}║  ${opts.title}  ║${ANSI.RESET}`);
        lines.push(`${ANSI.BOLD}${ANSI.CYAN}╚${repeat('═', Math.min(opts.title.length + 6, this._maxWidth - 4))}╝${ANSI.RESET}`);
      } else {
        lines.push(repeat('=', this._maxWidth));
        lines.push(`  ${opts.title}`);
        lines.push(repeat('=', this._maxWidth));
      }
      lines.push('');
    }

    // ---- Compute statistics ----
    const total = decs.length;
    const confidences = decs.map((d) => d.confidence).filter((c) => c != null);
    const avgConf = confidences.length > 0
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : null;

    const minConf = confidences.length > 0 ? Math.min(...confidences) : null;
    const maxConf = confidences.length > 0 ? Math.max(...confidences) : null;

    // Type distribution
    const typeCounts = {};
    for (const d of decs) {
      typeCounts[d.type] = (typeCounts[d.type] || 0) + 1;
    }

    // Success/failure rates
    let successCount = 0;
    let failureCount = 0;
    let unknownOutcome = 0;
    for (const d of decs) {
      if (d.outcome && d.outcome.success === true) successCount++;
      else if (d.outcome && d.outcome.success === false) failureCount++;
      else unknownOutcome++;
    }
    const knownOutcomes = successCount + failureCount;
    const successRate = knownOutcomes > 0 ? successCount / knownOutcomes : null;

    // Confidence distribution (low/med/high)
    const confBuckets = { low: 0, medium: 0, high: 0 };
    for (const c of confidences) {
      if (c < 0.4) confBuckets.low++;
      else if (c < 0.7) confBuckets.medium++;
      else confBuckets.high++;
    }

    // Time range
    const times = decs.map((d) => new Date(d.timestamp).getTime());
    const startTime = Math.min(...times);
    const endTime = Math.max(...times);
    const durationMs = endTime - startTime;

    // Agent distribution
    const agentCounts = {};
    for (const d of decs) {
      const agent = d.agentId || 'unknown';
      agentCounts[agent] = (agentCounts[agent] || 0) + 1;
    }

    // ---- Render sections ----

    // Section 1: Overview panel
    lines.push(this._statsSection('Overview'));
    lines.push('');
    lines.push(`  Total decisions:        ${total}`);
    lines.push(`  Unique agents:          ${Object.keys(agentCounts).length}`);
    lines.push(`  Time span:              ${formatTs(new Date(startTime).toISOString())} → ${formatTs(new Date(endTime).toISOString())}`);
    lines.push(`  Duration:               ${(durationMs / 1000).toFixed(1)}s`);
    lines.push(`  Avg confidence:         ${avgConf != null ? (avgConf * 100).toFixed(1) + '%' : 'N/A'}`);
    lines.push(`  Confidence range:       ${minConf != null ? (minConf * 100).toFixed(0) + '%' : '?'} - ${maxConf != null ? (maxConf * 100).toFixed(0) + '%' : '?'}`);
    if (successRate != null) {
      const srStr = (successRate * 100).toFixed(1) + '%';
      if (this._useAnsi) {
        lines.push(`  Success rate:           ${ANSI.GREEN}${srStr}${ANSI.RESET} (${successCount}/${knownOutcomes})`);
      } else {
        lines.push(`  Success rate:           ${srStr} (${successCount}/${knownOutcomes})`);
      }
    } else {
      lines.push(`  Success rate:           N/A (no outcomes recorded)`);
    }
    lines.push('');

    // Section 2: Type distribution table
    lines.push(this._statsSection('Decision Type Distribution'));
    lines.push('');
    const typeEntries = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
    const maxTypeCount = Math.max(...Object.values(typeCounts));
    const maxTypeWidth = Math.max(...typeEntries.map(([t]) => t.length)) + 2;

    for (const [type, count] of typeEntries) {
      const pct = ((count / total) * 100).toFixed(1);
      const barWidth = 20;
      const filled = Math.round((count / maxTypeCount) * barWidth);

      let typeLine = `  ${padRight(this._formatTypeName(type), maxTypeWidth)} `;
      if (opts.showCharts) {
        if (this._useAnsi) {
          typeLine += `${ANSI.CYAN}${repeat(BOX.BLOCK, filled)}${ANSI.RESET}`;
          typeLine += `${ANSI.DIM}${repeat(BOX.LIGHT, barWidth - filled)}${ANSI.RESET}`;
        } else {
          typeLine += `${repeat(BOX.BLOCK, filled)}${repeat(BOX.LIGHT, barWidth - filled)}`;
        }
      }
      typeLine += ` ${count} (${pct}%)`;
      lines.push(typeLine);
    }
    lines.push('');

    // Section 3: Confidence distribution
    lines.push(this._statsSection('Confidence Distribution'));
    lines.push('');

    if (confidences.length > 0 && opts.showCharts) {
      // Sparkline of confidences
      const sparkWidth = Math.min(40, this._maxWidth - 4);
      const sparkChars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
      let spark = '  ';
      const step = Math.max(1, Math.floor(confidences.length / sparkWidth));
      for (let i = 0; i < sparkWidth && i * step < confidences.length; i++) {
        const c = confidences[i * step];
        const idx = Math.min(7, Math.floor(c * 8));
        if (this._useAnsi) {
          spark += confidenceColor(c, true) + sparkChars[idx] + ANSI.RESET;
        } else {
          spark += sparkChars[idx];
        }
      }
      lines.push(spark);
    }

    lines.push(`  High confidence (≥ 0.7):    ${confBuckets.high}  ${repeat(BOX.BLOCK, Math.min(confBuckets.high, 30))}`);
    lines.push(`  Medium confidence (0.4-0.7):  ${confBuckets.medium}  ${repeat(BOX.MEDIUM, Math.min(confBuckets.medium, 30))}`);
    lines.push(`  Low confidence (< 0.4):       ${confBuckets.low}  ${repeat(BOX.LIGHT, Math.min(confBuckets.low, 30))}`);
    lines.push('');

    // Section 4: Agents visual
    lines.push(this._statsSection('Agent Activity'));
    lines.push('');

    const agentEntries = Object.entries(agentCounts).sort((a, b) => b[1] - a[1]);
    const maxAgentCount = Math.max(...Object.values(agentCounts));
    for (const [agent, count] of agentEntries) {
      const barFilled = Math.round((count / maxAgentCount) * 25);
      let agentLine = `  ${padRight(truncate(agent, 20), 22)} `;
      if (this._useAnsi) {
        agentLine += `${ANSI.BLUE}${repeat(BOX.BLOCK, barFilled)}${ANSI.RESET} ${count}`;
      } else {
        agentLine += `${repeat(BOX.BLOCK, barFilled)} ${count}`;
      }
      lines.push(agentLine);
    }
    lines.push('');

    // Section 5: Detail rows (optional)
    if (opts.showDetails) {
      lines.push(this._statsSection('Per-Decision Detail'));
      lines.push('');

      for (const d of decs) {
        const result = outcomeIndicator(d.outcome, this._useAnsi);
        const ts = formatTs(d.timestamp);
        const typeName = truncate(this._formatTypeName(d.type), 14);
        const chosen = truncate(d.outcome && d.outcome.chosen ? d.outcome.chosen : '-', 25);
        const conf = (d.confidence * 100).toFixed(0) + '%';

        if (this._useAnsi) {
          const color = confidenceColor(d.confidence, this._useAnsi);
          lines.push(`  ${result} ${ANSI.DIM}${ts}${ANSI.RESET} ${color}${padRight(typeName, 15)}${ANSI.RESET} ${padRight(chosen, 26)} ${color}${padLeft(conf, 4)}${ANSI.RESET}`);
        } else {
          lines.push(`  ${result} ${ts} ${padRight(typeName, 15)} ${padRight(chosen, 26)} ${padLeft(conf, 4)}`);
        }
      }
      lines.push('');
    }

    // Footer
    lines.push(repeat(BOX.H, Math.min(40, this._maxWidth)));
    lines.push(`Generated: ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`);

    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Render a single decision node for the tree view.
   */
  _renderDecisionNode(decision, opts) {
    const conf = decision.confidence != null ? decision.confidence : 0.5;
    const result = outcomeIndicator(decision.outcome, this._useAnsi);
    const chosen = decision.outcome && decision.outcome.chosen
      ? truncate(decision.outcome.chosen, 30)
      : 'N/A';

    let node = `${result} ${chosen}`;

    if (opts.showConfidence) {
      node += ` ${confidenceBar(conf, 6, this._useAnsi)}`;
      node += ` ${(conf * 100).toFixed(0)}%`;
    }

    if (opts.showOutcome && decision.outcome && decision.outcome.success !== null) {
      const status = decision.outcome.success ? 'ok' : 'fail';
      if (this._useAnsi) {
        node += ` ${ANSI.DIM}[${status}]${ANSI.RESET}`;
      } else {
        node += ` [${status}]`;
      }
    }

    return node;
  }

  /**
   * Group decisions by type.
   */
  _groupByType(decisions) {
    const groups = {};
    for (const d of decisions) {
      const type = d.type || 'general';
      if (!groups[type]) groups[type] = [];
      groups[type].push(d);
    }
    return groups;
  }

  /**
   * Group decisions by agent.
   */
  _groupByAgent(decisions) {
    const groups = {};
    for (const d of decisions) {
      const agent = d.agentId || 'unknown';
      if (!groups[agent]) groups[agent] = [];
      groups[agent].push(d);
    }
    return groups;
  }

  /**
   * Group decisions by time window (hour buckets).
   */
  _groupByTime(decisions) {
    const groups = {};
    for (const d of decisions) {
      try {
        const dt = new Date(d.timestamp);
        const hour = dt.toISOString().slice(0, 13) + ':00'; // YYYY-MM-DDTHH:00
        if (!groups[hour]) groups[hour] = [];
        groups[hour].push(d);
      } catch (_) {
        if (!groups.unknown) groups.unknown = [];
        groups.unknown.push(d);
      }
    }
    return groups;
  }

  /**
   * Format a decision type string for display.
   */
  _formatTypeName(type) {
    if (!type) return 'General';
    return type
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /**
   * Render a section header with a double-line border.
   */
  _statsSection(title) {
    if (this._useAnsi) {
      return `${ANSI.BOLD}${ANSI.WHITE}  ${title}  ${ANSI.RESET}`;
    }
    return `  ${title}`;
  }
}

module.exports = { DecisionTreeRenderer, ANSI, BOX };
