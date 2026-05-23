'use strict';

// ---------------------------------------------------------------------------
// ANSI color constants
// ---------------------------------------------------------------------------

const ANSI = {
  RESET: '\x1b[0m',
  BOLD: '\x1b[1m',
  DIM: '\x1b[2m',
  ITALIC: '\x1b[3m',
  UNDERLINE: '\x1b[4m',
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
  BG_BLUE: '\x1b[44m',
};

// ---------------------------------------------------------------------------
// Unicode characters
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
  DH: '═',
  DV: '║',
  ARROW_R: '→',
  ARROW_D: '↓',
  BLOCK: '█',
  DARK: '▓',
  MEDIUM: '▒',
  LIGHT: '░',
  TREE_V: '│',
  TREE_L: '├',
  TREE_E: '└',
  TREE_H: '─',
  BULLET: '•',
  DIAMOND: '◆',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(val, lo, hi) {
  return Math.max(lo, Math.min(hi, val));
}

function repeat(ch, n) {
  if (n <= 0) return '';
  return ch.repeat(Math.floor(n));
}

function padRight(str, len) {
  const s = String(str);
  return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

function padLeft(str, len) {
  const s = String(str);
  return s.length >= len ? s : ' '.repeat(len - s.length) + s;
}

function truncate(str, maxLen) {
  if (!str || typeof str !== 'string') return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

function formatTs(ts) {
  if (!ts) return 'unknown';
  try {
    return new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
  } catch (_) {
    return String(ts).slice(0, 19);
  }
}

/**
 * Parse a timestamp-like value into epoch ms, or 0 if unparseable.
 */
function tsToMs(ts) {
  try {
    const d = new Date(ts);
    const ms = d.getTime();
    return Number.isFinite(ms) ? ms : 0;
  } catch (_) {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// FlowRenderer
// ---------------------------------------------------------------------------

/**
 * Visualizes agent conversation flows including message sequences,
 * tool call chains, agent handoffs, error paths, and token usage.
 *
 * Usage:
 *   const renderer = new FlowRenderer({ useAnsi: true });
 *   console.log(renderer.renderMessageFlow(session));
 *   console.log(renderer.renderToolSequence(session));
 *   console.log(renderer.renderAgentHandoff(teamSession));
 *   console.log(renderer.renderErrorPath(session));
 *   console.log(renderer.renderTokenFlow(session));
 */
class FlowRenderer {
  /**
   * @param {object} [options]
   * @param {boolean} [options.useAnsi=true] - enable ANSI color output
   * @param {number} [options.maxWidth=100] - maximum output width
   * @param {number} [options.maxMessages=50] - max messages to display per flow
   * @param {boolean} [options.compact=false] - use compact display mode
   */
  constructor(options = {}) {
    this._useAnsi = options.useAnsi !== false;
    this._maxWidth = clamp(options.maxWidth || 100, 40, 300);
    this._maxMessages = clamp(options.maxMessages || 50, 5, 500);
    this._compact = options.compact === true;
  }

  // ---------------------------------------------------------------------------
  // renderMessageFlow — agent / user / tool message sequence
  // ---------------------------------------------------------------------------

  /**
   * Render a chronological flow of messages between agents, users, and tools.
   *
   * Expected session shape:
   * {
   *   id: string,
   *   messages: Array<{
   *     role: 'user'|'assistant'|'tool'|'system',
   *     content: string,
   *     timestamp?: string,
   *     agentId?: string,
   *     toolCalls?: Array<{ name: string, args?: object, result?: any }>,
   *     error?: Error|string
   *   }>
   * }
   *
   * @param {object} session - session object with messages
   * @param {object} [options]
   * @param {boolean} [options.showContent] - include message content previews
   * @param {number} [options.maxContentLen] - truncation length for content
   * @param {string} [options.title] - optional title
   * @returns {string} formatted message flow
   */
  renderMessageFlow(session, options = {}) {
    const opts = {
      showContent: options.showContent !== false,
      maxContentLen: options.maxContentLen || 60,
      title: options.title || '',
    };

    const messages = this._extractMessages(session);
    if (messages.length === 0) {
      return opts.title ? `${opts.title}\n(no messages)` : '(no messages)';
    }

    const displayMsgs = messages.slice(0, this._maxMessages);
    const lines = [];

    // Title
    if (opts.title) {
      if (this._useAnsi) {
        lines.push(`${ANSI.BOLD}${ANSI.CYAN}${opts.title}${ANSI.RESET}`);
      } else {
        lines.push(opts.title);
      }
      lines.push(repeat(BOX.H, Math.min(opts.title.length + 8, this._maxWidth)));
    }

    // Session header
    const sessionId = session && session.id ? session.id : 'unknown';
    if (this._useAnsi) {
      lines.push(`${ANSI.DIM}Session: ${sessionId} | Messages: ${messages.length}${ANSI.RESET}`);
    } else {
      lines.push(`Session: ${sessionId} | Messages: ${messages.length}`);
    }
    lines.push('');

    // Render each message
    for (let i = 0; i < displayMsgs.length; i++) {
      const msg = displayMsgs[i];
      const isLast = i === displayMsgs.length - 1;
      const connector = isLast ? `${BOX.TREE_E}${BOX.TREE_H}` : `${BOX.TREE_L}${BOX.TREE_H}`;
      const role = msg.role || 'unknown';
      const roleIcon = this._roleIcon(role);
      const colorFn = this._roleColorFn(role);

      // Timestamp
      const ts = msg.timestamp ? formatTs(msg.timestamp).slice(11, 19) : '--:--:--';

      // Message header line
      let headerLine = connector;
      if (this._useAnsi) {
        headerLine += ` ${ANSI.DIM}${ts}${ANSI.RESET} ${colorFn(roleIcon)} ${colorFn(padRight(role.toUpperCase(), 10))}`;
      } else {
        headerLine += ` ${ts} ${roleIcon} ${padRight(role.toUpperCase(), 10)}`;
      }

      // Agent info
      if (msg.agentId) {
        headerLine += this._useAnsi
          ? ` ${ANSI.DIM}[agent: ${truncate(msg.agentId, 15)}]${ANSI.RESET}`
          : ` [agent: ${truncate(msg.agentId, 15)}]`;
      }

      // Error indicator
      if (msg.error) {
        headerLine += this._useAnsi
          ? ` ${ANSI.BG_RED}${ANSI.WHITE} ERROR ${ANSI.RESET}`
          : ' [ERROR]';
      }

      lines.push(headerLine);

      // Content preview
      if (opts.showContent && msg.content) {
        const contentPreview = truncate(
          typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          opts.maxContentLen
        );
        if (this._useAnsi) {
          lines.push(`${BOX.V}   ${ANSI.DIM}${ANSI.ITALIC}${contentPreview}${ANSI.RESET}`);
        } else {
          lines.push(`${BOX.V}   ${contentPreview}`);
        }
      }

      // Tool calls
      if (Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0) {
        for (let ti = 0; ti < msg.toolCalls.length; ti++) {
          const tc = msg.toolCalls[ti];
          const isLastTool = ti === msg.toolCalls.length - 1;
          const toolConnector = isLastTool ? `${BOX.TREE_E}${BOX.TREE_H}` : `${BOX.TREE_L}${BOX.TREE_H}`;
          let toolLine = `${BOX.V}   ${toolConnector} `;

          if (this._useAnsi) {
            toolLine += `${ANSI.CYAN}${ANSI.BOLD}${tc.name || 'tool'}${ANSI.RESET}`;
          } else {
            toolLine += `[${tc.name || 'tool'}]`;
          }

          if (tc.args) {
            const argsStr = typeof tc.args === 'string'
              ? truncate(tc.args, 40)
              : truncate(JSON.stringify(tc.args), 40);
            toolLine += this._useAnsi
              ? ` ${ANSI.DIM}(${argsStr})${ANSI.RESET}`
              : ` (${argsStr})`;
          }

          if (tc.result !== undefined) {
            toolLine += this._useAnsi
              ? ` ${ANSI.GREEN}✓${ANSI.RESET}`
              : ' ✓';
          }

          lines.push(toolLine);
        }
      }

      // Spacer between messages (compact mode skips)
      if (!this._compact && i < displayMsgs.length - 1) {
        lines.push(`${BOX.V}`);
      }
    }

    // Footer
    if (messages.length > this._maxMessages) {
      const hidden = messages.length - this._maxMessages;
      lines.push(`${BOX.V}`);
      if (this._useAnsi) {
        lines.push(`${BOX.TREE_E}${BOX.TREE_H}${BOX.TREE_H} ${ANSI.DIM}(... ${hidden} more messages)${ANSI.RESET}`);
      } else {
        lines.push(`${BOX.TREE_E}${BOX.TREE_H}${BOX.TREE_H} (... ${hidden} more messages)`);
      }
    }

    lines.push('');

    // Legend
    if (this._useAnsi) {
      lines.push(`${ANSI.DIM}Roles: ${ANSI.BLUE}◆ User${ANSI.RESET} ${ANSI.DIM}|${ANSI.RESET} ${ANSI.GREEN}◆ Agent${ANSI.RESET} ${ANSI.DIM}|${ANSI.RESET} ${ANSI.CYAN}◆ Tool${ANSI.RESET} ${ANSI.DIM}|${ANSI.RESET} ${ANSI.MAGENTA}◆ System${ANSI.RESET}`);
    }

    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // renderToolSequence — tool call sequence diagram
  // ---------------------------------------------------------------------------

  /**
   * Render a sequence diagram showing tool calls in chronological order,
   * with input/output arrows and timing relationships.
   *
   * @param {object} session - session with messages containing toolCalls
   * @param {object} [options]
   * @param {boolean} [options.showArgs] - show tool call arguments
   * @param {boolean} [options.showResults] - show tool call results
   * @param {boolean} [options.showTiming] - show timing between calls
   * @param {string} [options.title] - optional title
   * @returns {string} formatted tool sequence diagram
   */
  renderToolSequence(session, options = {}) {
    const opts = {
      showArgs: options.showArgs !== false,
      showResults: options.showResults === true,
      showTiming: options.showTiming !== false,
      title: options.title || '',
    };

    // Extract all tool calls from messages
    const toolCalls = [];
    const messages = this._extractMessages(session);

    for (const msg of messages) {
      if (Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0) {
        for (const tc of msg.toolCalls) {
          toolCalls.push({
            name: tc.name || 'unknown',
            args: tc.args,
            result: tc.result,
            timestamp: msg.timestamp || null,
            agentId: msg.agentId || null,
            error: tc.error || null,
          });
        }
      }
    }

    if (toolCalls.length === 0) {
      return opts.title ? `${opts.title}\n(no tool calls)` : '(no tool calls)';
    }

    const lines = [];

    // Title
    if (opts.title) {
      if (this._useAnsi) {
        lines.push(`${ANSI.BOLD}${ANSI.CYAN}${opts.title}${ANSI.RESET}`);
      } else {
        lines.push(opts.title);
      }
      lines.push(repeat(BOX.H, Math.min(opts.title.length + 8, this._maxWidth)));
    }

    const sessionId = session && session.id ? session.id : 'unknown';
    if (this._useAnsi) {
      lines.push(`${ANSI.DIM}Session: ${sessionId} | Tool Calls: ${toolCalls.length}${ANSI.RESET}`);
    } else {
      lines.push(`Session: ${sessionId} | Tool Calls: ${toolCalls.length}`);
    }
    lines.push('');

    // Render each tool call as a "lifeline" in the sequence
    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i];
      const isLast = i === toolCalls.length - 1;
      const orderNum = String(i + 1).padStart(2, '0');

      // Timing info relative to previous call
      let timingStr = '';
      if (opts.showTiming && i > 0) {
        const prevMs = tsToMs(toolCalls[i - 1].timestamp);
        const currMs = tsToMs(tc.timestamp);
        if (prevMs > 0 && currMs > 0) {
          const deltaMs = currMs - prevMs;
          if (deltaMs >= 0) {
            const deltaStr = deltaMs < 1000
              ? `${deltaMs}ms`
              : `${(deltaMs / 1000).toFixed(1)}s`;
            timingStr = ` [+${deltaStr}]`;
          }
        }
      }

      // Build the tool call box (header)
      const boxWidth = this._compact ? 50 : 70;
      const topBorder = `${BOX.TL}${repeat(BOX.H, boxWidth - 2)}${BOX.TR}`;
      const bottomBorder = `${BOX.BL}${repeat(BOX.H, boxWidth - 2)}${BOX.BR}`;

      let headerText;
      if (this._useAnsi) {
        headerText = `${ANSI.CYAN}${ANSI.BOLD}${BOX.DV} #${orderNum} ${tc.name}${ANSI.RESET}`;
      } else {
        headerText = `${BOX.V} #${orderNum} ${tc.name}`;
      }

      // Pad the header to box width
      const headerNoAnsi = ` #${orderNum} ${tc.name}`;
      const headerPadding = boxWidth - headerNoAnsi.length - 2; // -2 for borders
      if (this._useAnsi) {
        lines.push(`  ${ANSI.DIM}${topBorder}${ANSI.RESET}`);
        lines.push(`  ${headerText}${' '.repeat(Math.max(0, headerPadding))}${ANSI.DIM}${BOX.DV}${ANSI.RESET}${timingStr}`);
      } else {
        lines.push(`  ${topBorder}`);
        lines.push(`  ${headerText}${' '.repeat(Math.max(0, headerPadding))}${BOX.V}${timingStr}`);
      }

      // Args display
      if (opts.showArgs && tc.args !== undefined && tc.args !== null) {
        const argsStr = typeof tc.args === 'string'
          ? tc.args
          : JSON.stringify(tc.args);
        const truncatedArgs = truncate(argsStr, boxWidth - 18);

        if (this._useAnsi) {
          lines.push(`  ${ANSI.DIM}${BOX.DV}${ANSI.RESET} Args: ${ANSI.DIM}${truncatedArgs}${ANSI.RESET}`);
        } else {
          lines.push(`  ${BOX.V} Args: ${truncatedArgs}`);
        }
      }

      // Result display
      if (opts.showResults && tc.result !== undefined) {
        const resultStr = typeof tc.result === 'string'
          ? tc.result
          : JSON.stringify(tc.result);
        const truncatedResult = truncate(resultStr, boxWidth - 18);

        if (tc.error) {
          if (this._useAnsi) {
            lines.push(`  ${ANSI.DIM}${BOX.DV}${ANSI.RESET} ${ANSI.RED}Error: ${truncatedResult}${ANSI.RESET}`);
          } else {
            lines.push(`  ${BOX.V} Error: ${truncatedResult}`);
          }
        } else {
          if (this._useAnsi) {
            lines.push(`  ${ANSI.DIM}${BOX.DV}${ANSI.RESET} ${ANSI.GREEN}Result: ${truncatedResult}${ANSI.RESET}`);
          } else {
            lines.push(`  ${BOX.V} Result: ${truncatedResult}`);
          }
        }
      }

      // Agent attribution
      if (tc.agentId) {
        if (this._useAnsi) {
          lines.push(`  ${ANSI.DIM}${BOX.DV}${ANSI.RESET} ${ANSI.DIM}by ${tc.agentId}${ANSI.RESET}`);
        } else {
          lines.push(`  ${BOX.V} by ${tc.agentId}`);
        }
      }

      // Bottom border
      if (this._useAnsi) {
        lines.push(`  ${ANSI.DIM}${bottomBorder}${ANSI.RESET}`);
      } else {
        lines.push(`  ${bottomBorder}`);
      }

      // Arrow between calls (if not last)
      if (i < toolCalls.length - 1) {
        if (this._useAnsi) {
          lines.push(`  ${ANSI.DIM}${BOX.DV}${ANSI.RESET}`);
        } else {
          lines.push(`  ${BOX.V}`);
        }
      }
    }

    lines.push('');

    // Summary
    const uniqueTools = new Set(toolCalls.map((t) => t.name)).size;
    const errorCount = toolCalls.filter((t) => t.error).length;
    if (this._useAnsi) {
      lines.push(`${ANSI.DIM}${toolCalls.length} calls to ${uniqueTools} unique tool(s)${errorCount > 0 ? ` | ${ANSI.RED}${errorCount} error(s)${ANSI.RESET}` : ''}${ANSI.RESET}`);
    } else {
      lines.push(`${toolCalls.length} calls to ${uniqueTools} unique tool(s)${errorCount > 0 ? ` | ${errorCount} error(s)` : ''}`);
    }

    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // renderAgentHandoff — agent-to-agent handoff flow
  // ---------------------------------------------------------------------------

  /**
   * Render a handoff diagram showing interactions between multiple agents.
   *
   * Expected teamSession shape:
   * {
   *   id: string,
   *   agents: Array<{
   *     id: string,
   *     name: string,
   *     role?: string,
   *     handoffs?: Array<{
   *       from: string,
   *       to: string,
   *       timestamp?: string,
   *       context?: string,
   *       reason?: string
   *     }>
   *   }>,
   *   handoffs?: Array<{
   *     from: string, to: string, timestamp?: string,
   *     context?: string, reason?: string
   *   }>
   * }
   *
   * @param {object} teamSession - team session with agents and handoffs
   * @param {object} [options]
   * @param {boolean} [options.showContext] - show handoff context/reason
   * @param {string} [options.title] - optional title
   * @returns {string} formatted handoff diagram
   */
  renderAgentHandoff(teamSession, options = {}) {
    const opts = {
      showContext: options.showContext !== false,
      title: options.title || '',
    };

    if (!teamSession) {
      return opts.title ? `${opts.title}\n(no session)` : '(no session)';
    }

    // Collect agents and handoffs
    const agents = Array.isArray(teamSession.agents) ? teamSession.agents : [];
    const handoffs = Array.isArray(teamSession.handoffs)
      ? teamSession.handoffs
      : [];

    // Also extract handoffs from agent objects
    const allHandoffs = [...handoffs];
    for (const agent of agents) {
      if (Array.isArray(agent.handoffs)) {
        for (const h of agent.handoffs) {
          allHandoffs.push(h);
        }
      }
    }

    // Sort handoffs by timestamp
    allHandoffs.sort((a, b) => tsToMs(a.timestamp) - tsToMs(b.timestamp));

    const lines = [];

    // Title
    if (opts.title) {
      if (this._useAnsi) {
        lines.push(`${ANSI.BOLD}${ANSI.CYAN}╔${repeat('═', Math.min(opts.title.length + 6, 60))}╗${ANSI.RESET}`);
        lines.push(`${ANSI.BOLD}${ANSI.CYAN}║  ${opts.title}  ║${ANSI.RESET}`);
        lines.push(`${ANSI.BOLD}${ANSI.CYAN}╚${repeat('═', Math.min(opts.title.length + 6, 60))}╝${ANSI.RESET}`);
      } else {
        lines.push(repeat('=', this._maxWidth));
        lines.push(`  ${opts.title}`);
        lines.push(repeat('=', this._maxWidth));
      }
      lines.push('');
    }

    // Session info
    const sessionId = teamSession.id || 'unknown';
    if (this._useAnsi) {
      lines.push(`${ANSI.DIM}Team Session: ${sessionId} | Agents: ${agents.length} | Handoffs: ${allHandoffs.length}${ANSI.RESET}`);
    } else {
      lines.push(`Team Session: ${sessionId} | Agents: ${agents.length} | Handoffs: ${allHandoffs.length}`);
    }
    lines.push('');

    // ---- Agent roster ----
    if (agents.length > 0) {
      lines.push(this._sectionHeader('Agents'));
      lines.push('');

      const agentBoxWidth = 30;
      for (const agent of agents) {
        const topB = `${BOX.TL}${repeat(BOX.H, agentBoxWidth - 2)}${BOX.TR}`;
        const botB = `${BOX.BL}${repeat(BOX.H, agentBoxWidth - 2)}${BOX.BR}`;
        const name = truncate(agent.name || agent.id, agentBoxWidth - 8);
        const role = agent.role ? truncate(agent.role, agentBoxWidth - 12) : '';

        if (this._useAnsi) {
          lines.push(`  ${ANSI.DIM}${topB}${ANSI.RESET}`);
          lines.push(`  ${ANSI.DIM}${BOX.DV}${ANSI.RESET} ${ANSI.BOLD}${ANSI.BLUE}${name}${ANSI.RESET}${' '.repeat(Math.max(0, agentBoxWidth - name.length - 6))}${ANSI.DIM}${BOX.DV}${ANSI.RESET}`);
          if (role) {
            lines.push(`  ${ANSI.DIM}${BOX.DV}${ANSI.RESET} ${ANSI.DIM}${role}${ANSI.RESET}${' '.repeat(Math.max(0, agentBoxWidth - role.length - 6))}${ANSI.DIM}${BOX.DV}${ANSI.RESET}`);
          }
          lines.push(`  ${ANSI.DIM}${botB}${ANSI.RESET}`);
        } else {
          lines.push(`  ${topB}`);
          lines.push(`  ${BOX.V} ${name}${' '.repeat(Math.max(0, agentBoxWidth - name.length - 4))}${BOX.V}`);
          if (role) {
            lines.push(`  ${BOX.V} ${role}${' '.repeat(Math.max(0, agentBoxWidth - role.length - 4))}${BOX.V}`);
          }
          lines.push(`  ${botB}`);
        }
        lines.push('');
      }
    }

    // ---- Handoff flow ----
    if (allHandoffs.length > 0) {
      lines.push(this._sectionHeader('Handoff Sequence'));
      lines.push('');

      // Build a timeline with left-to-right agent columns
      const agentIds = agents.map((a) => a.id || a.name);
      const colWidth = Math.max(12, Math.floor((this._maxWidth - 10) / Math.max(1, agentIds.length)));

      // Agent column headers
      let headerLine = '  ';
      for (const id of agentIds) {
        headerLine += padRight(truncate(id, colWidth - 2), colWidth);
      }
      if (this._useAnsi) {
        lines.push(`${ANSI.BOLD}${headerLine}${ANSI.RESET}`);
      } else {
        lines.push(headerLine);
      }

      // Separator
      lines.push(`  ${repeat(BOX.H, colWidth * Math.max(1, agentIds.length))}`);

      // Render each handoff as a row
      for (const h of allHandoffs) {
        let row = '  ';
        for (const id of agentIds) {
          const cellContent = this._handoffCell(h, id, colWidth);
          row += cellContent;
        }
        lines.push(row);

        // Show context below
        if (opts.showContext && h.context) {
          if (this._useAnsi) {
            lines.push(`    ${ANSI.DIM}${ANSI.ITALIC}→ ${truncate(h.context, this._maxWidth - 8)}${ANSI.RESET}`);
          } else {
            lines.push(`    → ${truncate(h.context, this._maxWidth - 8)}`);
          }
        }
      }

      lines.push('');
    }

    // ---- Summary ----
    lines.push(this._sectionHeader('Handoff Summary'));
    lines.push('');

    // Count handoffs per agent pair
    const pairCounts = {};
    for (const h of allHandoffs) {
      const key = `${h.from || '?'} → ${h.to || '?'}`;
      pairCounts[key] = (pairCounts[key] || 0) + 1;
    }

    for (const [pair, count] of Object.entries(pairCounts)) {
      const bar = repeat(BOX.BLOCK, Math.min(count, 30));
      if (this._useAnsi) {
        lines.push(`  ${ANSI.CYAN}${pair}${ANSI.RESET} ${ANSI.DIM}${bar}${ANSI.RESET} (${count})`);
      } else {
        lines.push(`  ${pair} ${bar} (${count})`);
      }
    }

    // Most active agent (by handoffs sent)
    const sentCounts = {};
    const receivedCounts = {};
    for (const h of allHandoffs) {
      sentCounts[h.from] = (sentCounts[h.from] || 0) + 1;
      receivedCounts[h.to] = (receivedCounts[h.to] || 0) + 1;
    }

    const topSender = Object.entries(sentCounts).sort((a, b) => b[1] - a[1])[0];
    const topReceiver = Object.entries(receivedCounts).sort((a, b) => b[1] - a[1])[0];

    if (topSender || topReceiver) {
      lines.push('');
      if (topSender) lines.push(`  Top handoff source: ${topSender[0]} (${topSender[1]} sent)`);
      if (topReceiver) lines.push(`  Top handoff target: ${topReceiver[0]} (${topReceiver[1]} received)`);
    }

    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // renderErrorPath — highlight error paths in message flow
  // ---------------------------------------------------------------------------

  /**
   * Render the message/tool flow with error paths highlighted in red.
   * Only messages/tools involved in error chains are shown by default.
   *
   * @param {object} session - session object with messages
   * @param {object} [options]
   * @param {boolean} [options.showAll] - show all messages, not just error paths
   * @param {boolean} [options.showStackTrace] - include stack trace snippets
   * @param {string} [options.title] - optional title
   * @returns {string} formatted error path visualization
   */
  renderErrorPath(session, options = {}) {
    const opts = {
      showAll: options.showAll !== false,
      showStackTrace: options.showStackTrace === true,
      title: options.title || '',
    };

    const messages = this._extractMessages(session);
    if (messages.length === 0) {
      return opts.title ? `${opts.title}\n(no messages)` : '(no messages)';
    }

    // Identify messages with errors or error-related content
    const errorMessages = messages.map((msg, idx) => {
      const hasError = !!(msg.error);
      const hasErrorToolCall = Array.isArray(msg.toolCalls)
        && msg.toolCalls.some((tc) => tc.error);
      const hasErrorContent = typeof msg.content === 'string'
        && /error|fail|exception|timeout|reject/i.test(msg.content);
      const hasErrorInResult = Array.isArray(msg.toolCalls)
        && msg.toolCalls.some((tc) => {
          if (tc.result && typeof tc.result === 'object' && tc.result.error) return true;
          if (typeof tc.result === 'string' && /error|fail/i.test(tc.result)) return true;
          return false;
        });

      return {
        msg,
        index: idx,
        isError: hasError || hasErrorToolCall || hasErrorContent || hasErrorInResult,
        errorTypes: {
          direct: hasError,
          toolError: hasErrorToolCall,
          contentError: hasErrorContent,
          resultError: hasErrorInResult,
        },
      };
    });

    const errorMsgs = errorMessages.filter((e) => e.isError);
    const displayMsgs = opts.showAll ? errorMessages : errorMsgs;

    if (errorMsgs.length === 0) {
      const okStr = this._useAnsi
        ? `${ANSI.GREEN}No errors detected in session.${ANSI.RESET}`
        : 'No errors detected in session.';
      return opts.title ? `${opts.title}\n${okStr}` : okStr;
    }

    const lines = [];

    // Title banner
    if (opts.title) {
      if (this._useAnsi) {
        lines.push(`${ANSI.BOLD}${ANSI.RED}▌ ${opts.title} ▐${ANSI.RESET}`);
      } else {
        lines.push(`▌ ${opts.title} ▐`);
      }
      lines.push('');
    }

    // Summary bar
    const sessionId = session && session.id ? session.id : 'unknown';
    const errorRate = messages.length > 0
      ? ((errorMsgs.length / messages.length) * 100).toFixed(1)
      : '0.0';
    if (this._useAnsi) {
      lines.push(`${ANSI.BG_RED}${ANSI.WHITE} ERROR PATH ANALYSIS ${ANSI.RESET}`);
      lines.push(`${ANSI.DIM}Session: ${sessionId} | ${errorMsgs.length}/${messages.length} messages affected (${errorRate}%)${ANSI.RESET}`);
    } else {
      lines.push('ERROR PATH ANALYSIS');
      lines.push(`Session: ${sessionId} | ${errorMsgs.length}/${messages.length} messages affected (${errorRate}%)`);
    }
    lines.push('');

    // Error path tree
    for (let i = 0; i < Math.min(displayMsgs.length, this._maxMessages); i++) {
      const entry = displayMsgs[i];
      const isLast = i === Math.min(displayMsgs.length, this._maxMessages) - 1;
      const connector = isLast ? `${BOX.TREE_E}${BOX.TREE_H}` : `${BOX.TREE_L}${BOX.TREE_H}`;
      const msg = entry.msg;
      const role = msg.role || 'unknown';

      // Error badges
      const badges = [];
      if (entry.errorTypes.direct) badges.push(this._useAnsi ? `${ANSI.BG_RED} ERROR ${ANSI.RESET}` : '[ERROR]');
      if (entry.errorTypes.toolError) badges.push(this._useAnsi ? `${ANSI.BG_YELLOW} TOOL-ERR ${ANSI.RESET}` : '[TOOL-ERR]');
      if (entry.errorTypes.contentError) badges.push(this._useAnsi ? `${ANSI.BG_YELLOW} ERR-MSG ${ANSI.RESET}` : '[ERR-MSG]');
      if (entry.errorTypes.resultError) badges.push(this._useAnsi ? `${ANSI.BG_YELLOW} BAD-RSLT ${ANSI.RESET}` : '[BAD-RSLT]');

      const ts = msg.timestamp ? formatTs(msg.timestamp).slice(11, 19) : '--:--:--';

      let headerLine = connector;
      if (entry.isError && this._useAnsi) {
        headerLine += ` ${ANSI.RED}${ANSI.BOLD}${ts} [${role.toUpperCase()}]${ANSI.RESET}`;
      } else if (this._useAnsi) {
        headerLine += ` ${ANSI.DIM}${ts} [${role.toUpperCase()}]${ANSI.RESET}`;
      } else {
        headerLine += ` ${ts} [${role.toUpperCase()}]`;
      }

      headerLine += ` ${badges.join(' ')}`;
      lines.push(headerLine);

      // Error details
      if (entry.isError) {
        const errorIndent = isLast ? '    ' : `${BOX.TREE_V}   `;

        if (msg.error) {
          const errMsg = typeof msg.error === 'string'
            ? msg.error
            : (msg.error.message || JSON.stringify(msg.error));
          if (this._useAnsi) {
            lines.push(`${errorIndent}${ANSI.RED}${BOX.TREE_E}${BOX.TREE_H} Error: ${truncate(errMsg, this._maxWidth - 16)}${ANSI.RESET}`);
          } else {
            lines.push(`${errorIndent}${BOX.TREE_E}${BOX.TREE_H} Error: ${truncate(errMsg, this._maxWidth - 16)}`);
          }
        }

        // Tool call errors
        if (Array.isArray(msg.toolCalls)) {
          for (const tc of msg.toolCalls) {
            if (tc.error) {
              const tcErr = typeof tc.error === 'string'
                ? tc.error
                : (tc.error.message || JSON.stringify(tc.error));
              if (this._useAnsi) {
                lines.push(`${errorIndent}${BOX.TREE_E}${BOX.TREE_H} ${ANSI.RED}${tc.name}: ${truncate(tcErr, this._maxWidth - 22)}${ANSI.RESET}`);
              } else {
                lines.push(`${errorIndent}${BOX.TREE_E}${BOX.TREE_H} ${tc.name}: ${truncate(tcErr, this._maxWidth - 22)}`);
              }
            }
          }
        }
      }
    }

    // Error type summary
    lines.push('');
    const directErrors = errorMsgs.filter((e) => e.errorTypes.direct).length;
    const toolErrors = errorMsgs.filter((e) => e.errorTypes.toolError).length;
    const contentErrors = errorMsgs.filter((e) => e.errorTypes.contentError).length;
    const resultErrors = errorMsgs.filter((e) => e.errorTypes.resultError).length;

    const maxErr = Math.max(directErrors, toolErrors, contentErrors, resultErrors, 1);

    if (this._useAnsi) {
      lines.push(`${ANSI.DIM}Error Type Breakdown:${ANSI.RESET}`);
      lines.push(`  Direct errors:   ${ANSI.RED}${repeat(BOX.BLOCK, Math.round((directErrors / maxErr) * 20))}${ANSI.RESET} ${directErrors}`);
      lines.push(`  Tool errors:     ${ANSI.YELLOW}${repeat(BOX.BLOCK, Math.round((toolErrors / maxErr) * 20))}${ANSI.RESET} ${toolErrors}`);
      lines.push(`  Content flags:   ${ANSI.YELLOW}${repeat(BOX.BLOCK, Math.round((contentErrors / maxErr) * 20))}${ANSI.RESET} ${contentErrors}`);
      lines.push(`  Bad results:     ${ANSI.YELLOW}${repeat(BOX.BLOCK, Math.round((resultErrors / maxErr) * 20))}${ANSI.RESET} ${resultErrors}`);
    } else {
      lines.push('Error Type Breakdown:');
      lines.push(`  Direct errors:   ${repeat(BOX.BLOCK, Math.round((directErrors / maxErr) * 20))} ${directErrors}`);
      lines.push(`  Tool errors:     ${repeat(BOX.BLOCK, Math.round((toolErrors / maxErr) * 20))} ${toolErrors}`);
      lines.push(`  Content flags:   ${repeat(BOX.BLOCK, Math.round((contentErrors / maxErr) * 20))} ${contentErrors}`);
      lines.push(`  Bad results:     ${repeat(BOX.BLOCK, Math.round((resultErrors / maxErr) * 20))} ${resultErrors}`);
    }

    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // renderTokenFlow — token usage over time
  // ---------------------------------------------------------------------------

  /**
   * Render token usage over time, showing input/output tokens per turn
   * with a sparkline and cumulative totals.
   *
   * Expected session shape:
   * {
   *   id: string,
   *   messages: Array<{ role, content, timestamp? }>,
   *   tokens?: Array<{
   *     input: number,
   *     output: number,
   *     total?: number,
   *     timestamp?: string
   *   }>
   * }
   *
   * @param {object} session - session with token usage data
   * @param {object} [options]
   * @param {boolean} [options.showSparkline] - include sparkline chart
   * @param {boolean} [options.showPerMessage] - show per-message token counts
   * @param {string} [options.title] - optional title
   * @returns {string} formatted token usage chart
   */
  renderTokenFlow(session, options = {}) {
    const opts = {
      showSparkline: options.showSparkline !== false,
      showPerMessage: options.showPerMessage === true,
      title: options.title || '',
    };

    if (!session) {
      return opts.title ? `${opts.title}\n(no session data)` : '(no session data)';
    }

    // Extract token data from session
    const tokenEntries = this._extractTokens(session);

    if (tokenEntries.length === 0) {
      return opts.title
        ? `${opts.title}\n(no token data available)`
        : '(no token data available)';
    }

    const lines = [];

    // Title
    if (opts.title) {
      if (this._useAnsi) {
        lines.push(`${ANSI.BOLD}${ANSI.CYAN}╔${repeat('═', Math.min(opts.title.length + 6, 60))}╗${ANSI.RESET}`);
        lines.push(`${ANSI.BOLD}${ANSI.CYAN}║  ${opts.title}  ║${ANSI.RESET}`);
        lines.push(`${ANSI.BOLD}${ANSI.CYAN}╚${repeat('═', Math.min(opts.title.length + 6, 60))}╝${ANSI.RESET}`);
      } else {
        lines.push(repeat('=', 60));
        lines.push(`  ${opts.title}`);
        lines.push(repeat('=', 60));
      }
      lines.push('');
    }

    const sessionId = session.id || 'unknown';
    if (this._useAnsi) {
      lines.push(`${ANSI.DIM}Session: ${sessionId} | Entries: ${tokenEntries.length}${ANSI.RESET}`);
    } else {
      lines.push(`Session: ${sessionId} | Entries: ${tokenEntries.length}`);
    }
    lines.push('');

    // Compute aggregates
    let totalInput = 0;
    let totalOutput = 0;
    const inputValues = [];
    const outputValues = [];
    const totalValues = [];

    for (const entry of tokenEntries) {
      const inp = entry.input || 0;
      const out = entry.output || 0;
      const ttl = entry.total != null ? entry.total : inp + out;

      totalInput += inp;
      totalOutput += out;
      inputValues.push(inp);
      outputValues.push(out);
      totalValues.push(ttl);
    }

    const totalTokens = totalInput + totalOutput;

    // ---- Summary panel ----
    lines.push(this._sectionHeader('Token Summary'));
    lines.push('');

    if (this._useAnsi) {
      lines.push(`${ANSI.BOLD}Total Tokens${ANSI.RESET}`);
    } else {
      lines.push('Total Tokens');
    }
    lines.push(`  Input:    ${totalInput.toLocaleString()}`);
    lines.push(`  Output:   ${totalOutput.toLocaleString()}`);
    lines.push(`  Combined: ${ANSI.BOLD}${totalTokens.toLocaleString()}${ANSI.RESET}`);

    if (tokenEntries.length > 0) {
      const avgInput = Math.round(totalInput / tokenEntries.length);
      const avgOutput = Math.round(totalOutput / tokenEntries.length);
      lines.push('');
      lines.push(`  Avg input/turn:   ${avgInput.toLocaleString()}`);
      lines.push(`  Avg output/turn:  ${avgOutput.toLocaleString()}`);
      lines.push(`  Turns:            ${tokenEntries.length}`);
    }
    lines.push('');

    // ---- Input vs Output bar ----
    lines.push(this._sectionHeader('Input vs Output Ratio'));
    lines.push('');

    const barWidth = 40;
    const maxTokenType = Math.max(totalInput, totalOutput, 1);
    const inputBarLen = Math.round((totalInput / maxTokenType) * barWidth);
    const outputBarLen = Math.round((totalOutput / maxTokenType) * barWidth);

    if (this._useAnsi) {
      lines.push(`  Input:  ${ANSI.BLUE}${repeat(BOX.BLOCK, inputBarLen)}${ANSI.RESET}${ANSI.DIM}${repeat(BOX.LIGHT, barWidth - inputBarLen)}${ANSI.RESET} ${totalInput.toLocaleString()}`);
      lines.push(`  Output: ${ANSI.GREEN}${repeat(BOX.BLOCK, outputBarLen)}${ANSI.RESET}${ANSI.DIM}${repeat(BOX.LIGHT, barWidth - outputBarLen)}${ANSI.RESET} ${totalOutput.toLocaleString()}`);
    } else {
      lines.push(`  Input:  ${repeat(BOX.BLOCK, inputBarLen)}${repeat(BOX.LIGHT, barWidth - inputBarLen)} ${totalInput.toLocaleString()}`);
      lines.push(`  Output: ${repeat(BOX.BLOCK, outputBarLen)}${repeat(BOX.LIGHT, barWidth - outputBarLen)} ${totalOutput.toLocaleString()}`);
    }
    lines.push('');

    // ---- Sparkline ----
    if (opts.showSparkline && totalValues.length > 0) {
      lines.push(this._sectionHeader('Token Usage Over Time'));
      lines.push('');

      const sparkWidth = Math.min(50, this._maxWidth - 12);
      const sparkChars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
      const maxTotal = Math.max(...totalValues, 1);
      const step = Math.max(1, Math.floor(totalValues.length / sparkWidth));

      // Input sparkline
      let inputSpark = '  In:  ';
      for (let i = 0; i < sparkWidth && i * step < inputValues.length; i++) {
        const v = inputValues[i * step];
        const idx = Math.min(7, Math.floor((v / Math.max(...inputValues, 1)) * 8));
        inputSpark += this._useAnsi
          ? `${ANSI.BLUE}${sparkChars[idx]}${ANSI.RESET}`
          : sparkChars[idx];
      }
      lines.push(inputSpark);

      // Output sparkline
      let outputSpark = '  Out: ';
      for (let i = 0; i < sparkWidth && i * step < outputValues.length; i++) {
        const v = outputValues[i * step];
        const idx = Math.min(7, Math.floor((v / Math.max(...outputValues, 1)) * 8));
        outputSpark += this._useAnsi
          ? `${ANSI.GREEN}${sparkChars[idx]}${ANSI.RESET}`
          : sparkChars[idx];
      }
      lines.push(outputSpark);

      // Combined sparkline
      let totalSpark = '  All: ';
      for (let i = 0; i < sparkWidth && i * step < totalValues.length; i++) {
        const v = totalValues[i * step];
        const idx = Math.min(7, Math.floor((v / maxTotal) * 8));
        totalSpark += this._useAnsi
          ? `${ANSI.CYAN}${sparkChars[idx]}${ANSI.RESET}`
          : sparkChars[idx];
      }
      lines.push(totalSpark);

      lines.push(`        start${' '.repeat(Math.max(0, sparkWidth - 10))}end`);
      lines.push('');
    }

    // ---- Per-message detail ----
    if (opts.showPerMessage) {
      lines.push(this._sectionHeader('Per-Turn Token Detail'));
      lines.push('');

      // Header
      const hdr = `  ${padRight('#', 4)} ${padRight('Time', 9)} ${padRight('Input', 10)} ${padRight('Output', 10)} ${padRight('Total', 10)}`;
      if (this._useAnsi) {
        lines.push(`${ANSI.DIM}${hdr}${ANSI.RESET}`);
      } else {
        lines.push(hdr);
      }
      lines.push(`  ${repeat(BOX.H, 46)}`);

      let cumulativeIn = 0;
      let cumulativeOut = 0;

      for (let i = 0; i < Math.min(tokenEntries.length, 30); i++) {
        const entry = tokenEntries[i];
        const inp = entry.input || 0;
        const out = entry.output || 0;
        const ttl = entry.total != null ? entry.total : inp + out;
        cumulativeIn += inp;
        cumulativeOut += out;

        const ts = entry.timestamp
          ? formatTs(entry.timestamp).slice(11, 19)
          : '--:--:--';

        if (this._useAnsi) {
          lines.push(`  ${padRight(`#${i + 1}`, 4)} ${ANSI.DIM}${ts}${ANSI.RESET} ${padRight(inp.toLocaleString(), 10)} ${padRight(out.toLocaleString(), 10)} ${padRight(ttl.toLocaleString(), 10)}`);
        } else {
          lines.push(`  ${padRight(`#${i + 1}`, 4)} ${ts} ${padRight(inp.toLocaleString(), 10)} ${padRight(out.toLocaleString(), 10)} ${padRight(ttl.toLocaleString(), 10)}`);
        }
      }

      if (tokenEntries.length > 30) {
        lines.push(`  ${ANSI.DIM}... ${tokenEntries.length - 30} more entries${ANSI.RESET}`);
      }

      lines.push(`  ${repeat(BOX.H, 46)}`);
      lines.push(`  ${padRight('Cum.', 4)} ${' '.repeat(9)} ${padRight(cumulativeIn.toLocaleString(), 10)} ${padRight(cumulativeOut.toLocaleString(), 10)} ${padRight((cumulativeIn + cumulativeOut).toLocaleString(), 10)}`);
      lines.push('');
    }

    // ---- Cost estimate (assuming GPT-4-level pricing for reference) ----
    lines.push(this._sectionHeader('Cost Estimate (reference rates)'));
    lines.push('');

    // Approximate rates per 1K tokens (not exact; illustrative)
    const inputRate = 0.003;  // $3/MTok
    const outputRate = 0.015; // $15/MTok
    const estCost = (totalInput / 1000) * inputRate + (totalOutput / 1000) * outputRate;

    if (this._useAnsi) {
      lines.push(`  Input cost:  $${(totalInput / 1000 * inputRate).toFixed(4)}  ($${inputRate}/1K tokens)`);
      lines.push(`  Output cost: $${(totalOutput / 1000 * outputRate).toFixed(4)}  ($${outputRate}/1K tokens)`);
      lines.push(`  ${ANSI.BOLD}Estimated:  $${estCost.toFixed(4)}${ANSI.RESET}`);
    } else {
      lines.push(`  Input cost:  $${(totalInput / 1000 * inputRate).toFixed(4)}  ($${inputRate}/1K tokens)`);
      lines.push(`  Output cost: $${(totalOutput / 1000 * outputRate).toFixed(4)}  ($${outputRate}/1K tokens)`);
      lines.push(`  Estimated:  $${estCost.toFixed(4)}`);
    }

    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Extract messages array from a session object in various shapes.
   */
  _extractMessages(session) {
    if (!session) return [];
    if (Array.isArray(session.messages)) return session.messages;
    if (Array.isArray(session)) return session;
    return [];
  }

  /**
   * Extract token usage entries from a session object.
   */
  _extractTokens(session) {
    if (!session) return [];

    // Direct tokens array
    if (Array.isArray(session.tokens)) return session.tokens;

    // Extract from messages with token metadata
    const messages = this._extractMessages(session);
    const entries = [];

    for (const msg of messages) {
      if (msg.tokens) {
        if (typeof msg.tokens === 'object' && !Array.isArray(msg.tokens)) {
          entries.push({
            input: msg.tokens.input || 0,
            output: msg.tokens.output || 0,
            total: msg.tokens.total,
            timestamp: msg.timestamp || null,
          });
        }
      }
      // Fallback: estimate tokens from content length (rough: ~4 chars per token)
      if (entries.length === 0 && msg.content) {
        const contentLen = typeof msg.content === 'string'
          ? msg.content.length
          : JSON.stringify(msg.content).length;
        entries.push({
          input: Math.round(contentLen / 4),
          output: 0,
          timestamp: msg.timestamp || null,
        });
      }
    }

    return entries;
  }

  /**
   * Return a Unicode icon for a message role.
   */
  _roleIcon(role) {
    switch (role) {
      case 'user': return BOX.DIAMOND;
      case 'assistant':
      case 'agent': return BOX.BULLET;
      case 'tool': return '⚙';
      case 'system': return '■';
      default: return '?';
    }
  }

  /**
   * Return an ANSI color function for a role.
   */
  _roleColorFn(role) {
    if (!this._useAnsi) return (s) => s;
    switch (role) {
      case 'user': return (s) => `${ANSI.BLUE}${s}${ANSI.RESET}`;
      case 'assistant':
      case 'agent': return (s) => `${ANSI.GREEN}${s}${ANSI.RESET}`;
      case 'tool': return (s) => `${ANSI.CYAN}${s}${ANSI.RESET}`;
      case 'system': return (s) => `${ANSI.MAGENTA}${s}${ANSI.RESET}`;
      default: return (s) => s;
    }
  }

  /**
   * Render a cell in the handoff grid for a specific agent column.
   */
  _handoffCell(handoff, agentId, width) {
    const isFrom = handoff.from === agentId;
    const isTo = handoff.to === agentId;

    if (isFrom && isTo) {
      return padRight('● (self)', width);
    }
    if (isFrom) {
      const arrow = `${BOX.ARROW_R} `;
      const remaining = width - 1;
      return this._useAnsi
        ? `${ANSI.GREEN}${arrow}${ANSI.RESET}${' '.repeat(Math.max(0, remaining))}`
        : `${arrow}${' '.repeat(Math.max(0, remaining))}`;
    }
    if (isTo) {
      const padding = width - 2;
      const arrow = `${BOX.ARROW_R}`;
      return this._useAnsi
        ? `${' '.repeat(Math.max(0, padding))}${ANSI.BLUE}${arrow}${ANSI.RESET}`
        : `${' '.repeat(Math.max(0, padding))}${arrow}`;
    }
    return padRight('', width);
  }

  /**
   * Render a section header.
   */
  _sectionHeader(title) {
    if (this._useAnsi) {
      return `${ANSI.BOLD}${ANSI.UNDERLINE}${title}${ANSI.RESET}`;
    }
    return title;
  }
}

module.exports = { FlowRenderer, ANSI, BOX };
