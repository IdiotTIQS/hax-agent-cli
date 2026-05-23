'use strict';

const { THEME, ANSI, styled } = require('./renderer');
const { PermissionLevel, PERMISSION_LABELS } = require('./permissions');

/**
 * Factory that creates an approval prompt callback for use with the tool registry.
 *
 * @param {{ screen: import('./renderer').TerminalScreen, t: (key: string, vars?: object) => string }} deps
 * @returns {(params: { toolName: string, toolArgs: object, level: string, description: string }) => Promise<'approve'|'deny'|'always_allow'|'always_deny'> | null}
 */
function createApprovalPrompt({ screen, t }) {
  if (!screen.isTTY()) {
    return null;
  }

  return ({ toolName, toolArgs, level, description }) => {
    return new Promise((resolve) => {
      const levelLabel = PERMISSION_LABELS[level] || level;
      const levelColor = level === PermissionLevel.DANGEROUS ? THEME.error
        : level === PermissionLevel.ASK ? THEME.warning : THEME.success;

      screen.write(`\n${levelColor}╭─ ${t('approval.title')} ─────────────────────────────────╮${ANSI.reset}\n`);
      screen.write(`${levelColor}│${ANSI.reset}  ${t('approval.level')}: ${styled(levelColor, levelLabel)}\n`);
      screen.write(`${levelColor}│${ANSI.reset}  ${t('approval.operation')}: ${styled(THEME.bold, toolName)}\n`);

      const descLines = description.split('\n');
      for (const line of descLines) {
        screen.write(`${levelColor}│${ANSI.reset}  ${styled(THEME.dim, line)}\n`);
      }

      screen.write(`${levelColor}│${ANSI.reset}\n`);
      screen.write(`${levelColor}│${ANSI.reset}  ${styled(THEME.promptPrefix, '[Y]')} ${t('approval.allow')}    ${styled(THEME.error, '[N]')} ${t('approval.deny')}\n`);
      screen.write(`${levelColor}│${ANSI.reset}  ${styled(THEME.promptPrefix, '[A]')} ${t('approval.alwaysAllow')}  ${styled(THEME.error, '[D]')} ${t('approval.alwaysDeny')}\n`);
      screen.write(`${levelColor}╰──────────────────────────────────────────────╯${ANSI.reset}\n`);
      screen.write(styled(THEME.dim, t('approval.prompt')) + ' ');

      let resolved = false;

      const onKeyPress = (char, key) => {
        if (!key || resolved) return;
        const c = (char || '').toLowerCase();

        if (c === 'y' || (key.name === 'return' && !char)) {
          resolved = true; cleanup();
          screen.write('Y\n');
          resolve('approve');
        } else if (c === 'n') {
          resolved = true; cleanup();
          screen.write('N\n');
          resolve('deny');
        } else if (c === 'a') {
          resolved = true; cleanup();
          screen.write('A\n');
          resolve('always_allow');
        } else if (c === 'd') {
          resolved = true; cleanup();
          screen.write('D\n');
          resolve('always_deny');
        }
      };

      function cleanup() {
        process.stdin.removeListener('keypress', onKeyPress);
        if (process.stdin.isTTY) {
          try { process.stdin.setRawMode(false); } catch (_) {}
        }
      }

      process.stdin.setRawMode(true);
      process.stdin.on('keypress', onKeyPress);
    });
  };
}

module.exports = { createApprovalPrompt };
