const PermissionLevel = Object.freeze({
  AUTO: 'auto',
  ASK: 'ask',
  DANGEROUS: 'dangerous',
});

const TOOL_PERMISSIONS = {
  'file.read': PermissionLevel.AUTO,
  'file.glob': PermissionLevel.AUTO,
  'file.search': PermissionLevel.AUTO,
  'file.readDirectory': PermissionLevel.AUTO,
  'web.fetch': null,
  'web.search': PermissionLevel.AUTO,
  'file.write': PermissionLevel.ASK,
  'file.edit': PermissionLevel.ASK,
  'file.delete': PermissionLevel.DANGEROUS,
  'shell.run': null,
};

const SAFE_SHELL_COMMANDS = new Set([
  'ls', 'dir', 'cat', 'type', 'echo', 'head', 'tail', 'wc', 'pwd',
  'whoami', 'hostname', 'find', 'grep', 'rg', 'ag', 'git',
  'which', 'where', 'file', 'stat',
  'node', 'npm', 'npx', 'yarn', 'pnpm', 'bun',
  'python', 'python3', 'pip', 'pip3',
  'tsc', 'eslint', 'prettier', 'jest', 'vitest', 'mocha',
  'gh',
]);

const DANGEROUS_SHELL_COMMANDS = new Set([
  'rm', 'rmdir', 'cp', 'mv', 'mkdir', 'touch',
  'docker', 'docker-compose',
  'curl', 'wget',
  'code', 'open', 'start',
]);

const PERMISSION_LABELS = {
  [PermissionLevel.AUTO]: '自动执行',
  [PermissionLevel.ASK]: '需要确认',
  [PermissionLevel.DANGEROUS]: '危险操作',
};

const PERMISSION_COLORS = {
  [PermissionLevel.AUTO]: 'green',
  [PermissionLevel.ASK]: 'yellow',
  [PermissionLevel.DANGEROUS]: 'red',
};

function getShellCommandPermission(command) {
  const normalized = normalizeCommand(command);
  if (DANGEROUS_SHELL_COMMANDS.has(normalized)) {
    return PermissionLevel.DANGEROUS;
  }
  if (SAFE_SHELL_COMMANDS.has(normalized)) {
    return PermissionLevel.AUTO;
  }
  return PermissionLevel.ASK;
}

function normalizeCommand(command) {
  const trimmed = command.trim();
  const hasPathSeparator = trimmed.includes('/') || trimmed.includes('\\');
  const base = hasPathSeparator ? trimmed : trimmed.split(/\s+/)[0];
  const path = require('node:path');
  return path.basename(base).replace(/\.exe$/i, '').toLocaleLowerCase();
}

function getToolPermission(toolName, toolArgs) {
  const mappedLevel = TOOL_PERMISSIONS[toolName];
  if (mappedLevel !== undefined && mappedLevel !== null) {
    return mappedLevel;
  }
  if (toolName === 'web.fetch' && toolArgs?.url) {
    return getWebFetchPermission(toolArgs.url);
  }
  if (toolName === 'shell.run' && toolArgs?.command) {
    return getShellCommandPermission(toolArgs.command);
  }
  return PermissionLevel.ASK;
}

function getWebFetchPermission(url) {
  let parsed;

  try {
    parsed = new URL(String(url));
  } catch {
    return PermissionLevel.ASK;
  }

  if (isPrivateOrLocalHost(parsed.hostname)) {
    return PermissionLevel.ASK;
  }

  return PermissionLevel.AUTO;
}

function isPrivateOrLocalHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');

  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;

  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true;

  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ipv4) return false;

  const octets = ipv4.slice(1).map(Number);
  if (octets.some((part) => part < 0 || part > 255)) return true;

  const [first, second] = octets;
  return (
    first === 10 ||
    first === 127 ||
    first === 0 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function formatToolDescription(toolName, toolArgs) {
  if (toolName === 'file.write') {
    const filePath = toolArgs?.path || 'unknown';
    const content = toolArgs?.content || '';
    const bytes = Buffer.byteLength(content, 'utf8');
    return `写入文件: ${filePath} (${bytes} 字节)`;
  }
  if (toolName === 'file.edit') {
    const filePath = toolArgs?.path || 'unknown';
    const oldStr = (toolArgs?.oldStr || '').slice(0, 60);
    const newStr = (toolArgs?.newStr || '').slice(0, 60);
    return `编辑文件: ${filePath}\n  替换: "${oldStr}" -> "${newStr}"`;
  }
  if (toolName === 'file.delete') {
    const filePath = toolArgs?.path || 'unknown';
    return `删除文件: ${filePath}`;
  }
  if (toolName === 'shell.run') {
    const command = [toolArgs?.command, ...(Array.isArray(toolArgs?.args) ? toolArgs.args : [])].filter(Boolean).join(' ');
    const cwd = toolArgs?.cwd || '.';
    return `执行命令: ${command}\n  工作目录: ${cwd}`;
  }
  if (toolName === 'web.fetch') {
    return `获取网页: ${toolArgs?.url || 'unknown'}`;
  }
  return `${toolName}: ${JSON.stringify(toolArgs || {})}`;
}

class PermissionManager {
  constructor(options = {}) {
    this.globalMode = options.mode || 'normal';
    this._alwaysAllow = new Set();
    this._alwaysDeny = new Set();
    this._persistPath = options.persistPath || null;
    if (this._persistPath) {
      this._loadFromDisk().catch(() => {});
    }
  }

  get mode() {
    return this.globalMode;
  }

  set mode(value) {
    this.globalMode = value;
  }

  isAlwaysAllowed(toolKey) {
    return this._alwaysAllow.has(toolKey);
  }

  isAlwaysDenied(toolKey) {
    return this._alwaysDeny.has(toolKey);
  }

  setAlwaysAllow(toolKey) {
    this._alwaysAllow.add(toolKey);
    this._alwaysDeny.delete(toolKey);
    this._saveToDisk().catch(() => {});
  }

  setAlwaysDeny(toolKey) {
    this._alwaysDeny.add(toolKey);
    this._alwaysAllow.delete(toolKey);
    this._saveToDisk().catch(() => {});
  }

  resetOverrides() {
    this._alwaysAllow.clear();
    this._alwaysDeny.clear();
    this._saveToDisk().catch(() => {});
  }

  setPersistPath(persistPath) {
    this._persistPath = persistPath;
    if (persistPath) {
      this._loadFromDisk().catch(() => {});
    }
  }

  async _saveToDisk() {
    if (!this._persistPath) return;
    const fs = require('node:fs/promises');
    const data = {
      mode: this.globalMode,
      alwaysAllow: Array.from(this._alwaysAllow),
      alwaysDeny: Array.from(this._alwaysDeny),
    };
    await fs.mkdir(require('node:path').dirname(this._persistPath), { recursive: true });
    await fs.writeFile(this._persistPath, JSON.stringify(data, null, 2), 'utf8');
  }

  async _loadFromDisk() {
    if (!this._persistPath) return;
    const fs = require('node:fs/promises');
    try {
      const raw = await fs.readFile(this._persistPath, 'utf8');
      const data = JSON.parse(raw);
      if (data.alwaysAllow) {
        for (const key of data.alwaysAllow) this._alwaysAllow.add(key);
      }
      if (data.alwaysDeny) {
        for (const key of data.alwaysDeny) this._alwaysDeny.add(key);
      }
    } catch (_) {
      // file doesn't exist or is corrupt, use defaults
    }
  }

  getToolKey(toolName, toolArgs) {
    if (toolName === 'shell.run' && toolArgs?.command) {
      return `shell.run:${normalizeCommand(toolArgs.command)}`;
    }
    if (toolName === 'web.fetch' && toolArgs?.url) {
      try {
        const parsed = new URL(String(toolArgs.url));
        if (isPrivateOrLocalHost(parsed.hostname)) {
          return `web.fetch:${parsed.hostname.toLowerCase()}`;
        }
      } catch {
        return 'web.fetch:invalid-url';
      }
    }
    return toolName;
  }

  async checkPermission(toolName, toolArgs, promptFn) {
    if (this.globalMode === 'yolo') {
      return { approved: true, level: PermissionLevel.AUTO, reason: 'yolo模式' };
    }

    const level = getToolPermission(toolName, toolArgs);
    const toolKey = this.getToolKey(toolName, toolArgs);

    if (level === PermissionLevel.AUTO) {
      return { approved: true, level, reason: '自动执行' };
    }

    if (this.isAlwaysDenied(toolKey)) {
      return { approved: false, level, reason: '已被用户永久拒绝' };
    }

    if (this.isAlwaysAllowed(toolKey)) {
      return { approved: true, level, reason: '用户已永久允许' };
    }

    if (!promptFn) {
      return { approved: true, level, reason: '无交互环境，自动批准' };
    }

    const description = formatToolDescription(toolName, toolArgs);
    const result = await promptFn({ toolName, toolArgs, level, description, toolKey });

    if (result === 'always_allow') {
      this.setAlwaysAllow(toolKey);
      return { approved: true, level, reason: '用户永久允许' };
    }
    if (result === 'always_deny') {
      this.setAlwaysDeny(toolKey);
      return { approved: false, level, reason: '用户永久拒绝' };
    }
    if (result === 'approve') {
      return { approved: true, level, reason: '用户批准' };
    }
    return { approved: false, level, reason: '用户拒绝' };
  }

  getSummary() {
    return {
      mode: this.globalMode,
      alwaysAllow: Array.from(this._alwaysAllow),
      alwaysDeny: Array.from(this._alwaysDeny),
      toolPermissions: Object.entries(TOOL_PERMISSIONS).map(([tool, level]) => ({
        tool,
        level: level || 'dynamic',
      })),
    };
  }
}

module.exports = {
  PermissionLevel,
  PermissionManager,
  TOOL_PERMISSIONS,
  SAFE_SHELL_COMMANDS,
  DANGEROUS_SHELL_COMMANDS,
  PERMISSION_LABELS,
  getToolPermission,
  getShellCommandPermission,
  getWebFetchPermission,
  isPrivateOrLocalHost,
  formatToolDescription,
};
