"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const { createStorage, listSessions } = require("./memory");
const {
  PermissionManager,
  SAFE_SHELL_COMMANDS,
  DANGEROUS_SHELL_COMMANDS,
} = require("./permissions");
const {
  loadAllSkills,
  createSkillifySkill,
  getSkillUsageStats,
} = require("./skills");
const { createTeamRuntime } = require("./teams/runtime");
const { createLocalToolRegistry } = require("./tools");

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "coverage", ".hax-agent"]);
const MAX_TREE_DEPTH = 4;
const MAX_TREE_ENTRIES = 500;
const MAX_RECENT_SESSIONS = 30;
const MAX_SEARCH_FILES = 2000;
const MAX_SEARCH_RESULTS = 200;
const MAX_SEARCH_FILE_BYTES = 512 * 1024;
const MAX_PREVIEW_BYTES = 512 * 1024;
const MAX_DIFF_BYTES = 200 * 1024;
const MOCK_ASSISTANT_PREFIX = "I’m in local mock mode right now";

function findTranscriptSession(settings, sessionId) {
  const requestedId = String(sessionId || "").trim();
  if (!requestedId) return null;

  const transcriptSessions = getSessionRecords(settings);
  const exactMatches = transcriptSessions.filter((session) => session.id === requestedId);
  const exactMatch = pickSessionMatch(exactMatches, settings.projectRoot);

  if (exactMatch) return exactMatch;

  const prefixMatches = transcriptSessions.filter((session) => session.id.startsWith(requestedId));
  return pickSessionMatch(prefixMatches, settings.projectRoot);
}

function readWorkspaceTree(projectRoot) {
  let entryCount = 0;

  function walk(directory, depth) {
    if (depth > MAX_TREE_DEPTH || entryCount >= MAX_TREE_ENTRIES) return [];

    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return [];
    }

    return entries
      .filter((entry) => !shouldIgnoreEntry(entry))
      .sort(sortDirectoryEntries)
      .slice(0, Math.max(0, MAX_TREE_ENTRIES - entryCount))
      .map((entry) => {
        entryCount += 1;
        const fullPath = path.join(directory, entry.name);
        const relativePath = normalizeSlashes(path.relative(projectRoot, fullPath));
        const node = {
          name: entry.name,
          path: relativePath || ".",
          type: entry.isDirectory() ? "directory" : "file",
        };

        if (entry.isDirectory()) {
          node.children = walk(fullPath, depth + 1);
        }

        return node;
      });
  }

  return walk(projectRoot, 0);
}

function searchWorkspaceContent(projectRoot, options = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  const query = String(options.query || "").trim();
  const caseSensitive = options.caseSensitive === true;
  const maxResults = clampPositiveInteger(options.maxResults, MAX_SEARCH_RESULTS, 1, MAX_SEARCH_RESULTS);
  const maxFiles = clampPositiveInteger(options.maxFiles, MAX_SEARCH_FILES, 1, MAX_SEARCH_FILES);
  const matches = [];
  let scannedFiles = 0;
  let truncated = false;

  if (!query) {
    return { projectRoot: root, query, matches, scannedFiles, truncated: false };
  }

  const needle = caseSensitive ? query : query.toLowerCase();

  function walk(directory) {
    if (matches.length >= maxResults || scannedFiles >= maxFiles) {
      truncated = true;
      return;
    }

    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort(sortDirectoryEntries);

    for (const entry of entries) {
      if (matches.length >= maxResults || scannedFiles >= maxFiles) {
        truncated = true;
        return;
      }

      if (shouldIgnoreEntry(entry)) continue;

      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      const stat = safeStat(fullPath);
      if (!stat || stat.size > MAX_SEARCH_FILE_BYTES) continue;

      scannedFiles += 1;
      let content;
      try {
        content = fs.readFileSync(fullPath, "utf8");
      } catch {
        continue;
      }

      if (content.includes("\0")) continue;

      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const haystack = caseSensitive ? line : line.toLowerCase();
        const column = haystack.indexOf(needle);
        if (column === -1) continue;

        matches.push({
          path: normalizeSlashes(path.relative(root, fullPath)),
          line: index + 1,
          column: column + 1,
          text: line.length > 240 ? `${line.slice(0, 237)}...` : line,
        });

        if (matches.length >= maxResults) {
          truncated = true;
          return;
        }
      }
    }
  }

  walk(root);

  return { projectRoot: root, query, matches, scannedFiles, truncated };
}

function readWorkspaceFile(projectRoot, options = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  const requestedPath = String(options.path || "");
  const resolvedPath = resolveWorkspacePath(root, requestedPath);
  const stat = safeStat(resolvedPath);

  if (!stat || !stat.isFile()) {
    throw new Error(`Path is not a file: ${requestedPath}`);
  }

  if (stat.size > MAX_PREVIEW_BYTES) {
    return {
      projectRoot: root,
      path: normalizeSlashes(path.relative(root, resolvedPath)),
      bytes: stat.size,
      truncated: true,
      content: "",
      lines: [],
    };
  }

  const content = fs.readFileSync(resolvedPath, "utf8");
  if (content.includes("\0")) {
    throw new Error(`Cannot preview binary file: ${requestedPath}`);
  }

  return {
    projectRoot: root,
    path: normalizeSlashes(path.relative(root, resolvedPath)),
    bytes: stat.size,
    truncated: false,
    content,
    lines: content.split(/\r?\n/).map((text, index) => ({ number: index + 1, text })),
  };
}

function resolveWorkspacePath(root, requestedPath) {
  const resolved = path.resolve(root, requestedPath || ".");
  const relative = path.relative(root, resolved);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return resolved;
  }
  throw new Error(`Path escapes workspace root: ${requestedPath}`);
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function clampPositiveInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function shouldIgnoreEntry(entry) {
  if (entry.name.startsWith(".") && entry.name !== ".github") return true;
  return entry.isDirectory() && IGNORED_DIRS.has(entry.name);
}

function sortDirectoryEntries(left, right) {
  if (left.isDirectory() !== right.isDirectory()) {
    return left.isDirectory() ? -1 : 1;
  }

  return left.name.localeCompare(right.name);
}

function readSessionList(settings, options = {}) {
  const sessionRecords = getSessionRecords(settings);
  const currentProjectRoot = options.currentProjectRoot === undefined ? settings.projectRoot : options.currentProjectRoot;

  return sessionRecords.map((session) => {
    const entries = session.entries();
    const summary = summarizeTranscriptEntries(entries);
    const metadata = typeof session.metadata === "function" ? session.metadata() : null;
    const projectRoot = metadata?.projectRoot || "";

    if (!summary) return null;

    return {
      id: session.id,
      updatedAt: session.updatedAt,
      preview: summary.preview,
      title: summary.title,
      messageCount: entries.length,
      projectRoot,
      projectName: metadata?.projectName || (projectRoot ? path.basename(projectRoot) : "未归属"),
      projectScope: getSessionProjectScope(projectRoot, currentProjectRoot),
    };
  }).filter(Boolean).slice(0, MAX_RECENT_SESSIONS);
}

function getSessionRecords(settings) {
  migrateLegacySessionRecords(settings);
  const sessionRecords = listSessions(settings);
  const seen = new Set();

  return sessionRecords.map((session) => {
    if (seen.has(session.id)) return null;
    seen.add(session.id);
    return session;
  }).filter(Boolean);
}

function migrateLegacySessionRecords(settings) {
  const legacySettings = createLegacySessionSettings(settings);
  if (!legacySettings) return { migrated: 0, skipped: 0, failed: 0 };

  const primarySessions = listSessions(settings);
  const currentProjectRoot = settings.projectRoot || process.cwd();
  const primaryDirectory = createStorage(settings).sessionDirectory;
  const legacySessions = listSessions(legacySettings);
  const result = { migrated: 0, skipped: 0, failed: 0 };

  for (const legacySession of legacySessions) {
    const sameProjectAlreadyMigrated = primarySessions.some((session) => (
      session.id === legacySession.id && sessionBelongsToProject(session, currentProjectRoot)
    ));

    if (sameProjectAlreadyMigrated) {
      result.skipped += 1;
      continue;
    }

    try {
      fs.mkdirSync(primaryDirectory, { recursive: true });
      const targetPath = getMigratedTranscriptPath(primaryDirectory, legacySession.path, currentProjectRoot);
      fs.copyFileSync(legacySession.path, targetPath);
      primarySessions.push({
        id: path.basename(targetPath, ".jsonl"),
        path: targetPath,
        metadata: legacySession.metadata,
      });
      result.migrated += 1;
    } catch {
      result.failed += 1;
    }
  }

  return result;
}

function createLegacySessionSettings(settings) {
  const legacySessionDirectory = path.join(settings.projectRoot || process.cwd(), ".hax-agent", "sessions");
  if (pathsEqual(settings.sessions?.directory, legacySessionDirectory)) return null;

  return {
    ...settings,
    sessions: {
      ...(settings.sessions || {}),
      directory: legacySessionDirectory,
    },
  };
}

function getMigratedTranscriptPath(primaryDirectory, legacyPath, projectRoot) {
  const fileName = path.basename(legacyPath);
  const directPath = path.join(primaryDirectory, fileName);
  if (!fs.existsSync(directPath)) return directPath;

  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  const suffix = crypto.createHash("sha256")
    .update(`${projectRoot}\0${legacyPath}`)
    .digest("hex")
    .slice(0, 8);
  let candidate = path.join(primaryDirectory, `${baseName}-${suffix}${extension}`);
  let counter = 2;

  while (fs.existsSync(candidate)) {
    candidate = path.join(primaryDirectory, `${baseName}-${suffix}-${counter}${extension}`);
    counter += 1;
  }

  return candidate;
}

function pickSessionMatch(matches, projectRoot) {
  if (matches.length === 0) return null;

  const projectMatches = matches.filter((session) => sessionBelongsToProject(session, projectRoot));
  if (projectMatches.length === 1) return projectMatches[0];
  if (matches.length === 1) return matches[0];
  return null;
}

function sessionBelongsToProject(session, projectRoot) {
  try {
    const metadata = typeof session.metadata === "function" ? session.metadata() : null;
    return pathsEqual(metadata?.projectRoot, projectRoot);
  } catch {
    return false;
  }
}

function getSessionProjectScope(sessionProjectRoot, currentProjectRoot) {
  if (!sessionProjectRoot) return "unassigned";
  if (pathsEqual(sessionProjectRoot, currentProjectRoot)) return "current";
  return "other";
}

function pathsEqual(left, right) {
  const normalize = (value) => path.resolve(String(value || "")).toLowerCase();
  return Boolean(left && right) && normalize(left) === normalize(right);
}

function summarizeTranscriptEntries(entries) {
  const chatEntries = entries.filter((entry) => entry.role === "user" || entry.role === "assistant");
  if (chatEntries.length === 0 || isMockTranscript(chatEntries)) return null;

  const userMessages = chatEntries
    .filter((entry) => entry.role === "user")
    .map((entry) => normalizePreviewText(entry.content))
    .filter(Boolean);
  const latestUserMessage = userMessages.at(-1);
  const firstUserMessage = userMessages[0];
  const preview = latestUserMessage || normalizePreviewText(chatEntries.at(-1)?.content) || "(empty session)";

  return {
    title: truncateText(firstUserMessage || preview, 48),
    preview: truncateText(preview, 90),
  };
}

function isMockTranscript(entries) {
  const hasOnlyMockAssistantReplies = entries
    .filter((entry) => entry.role === "assistant")
    .every((entry) => String(entry.content || "").startsWith(MOCK_ASSISTANT_PREFIX));
  const hasAssistantReply = entries.some((entry) => entry.role === "assistant");

  return hasAssistantReply && hasOnlyMockAssistantReplies;
}

function normalizePreviewText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncateText(value, maxLength) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function readGitStatus(projectRoot) {
  return new Promise((resolve) => {
    runGit(projectRoot, ["status", "--porcelain=v1", "--branch"]).then((result) => {
      if (result.exitCode !== 0) {
        resolve({
          available: false,
          branch: "none",
          ahead: 0,
          behind: 0,
          changed: 0,
          raw: result.stderr || result.stdout,
        });
        return;
      }

      const lines = result.stdout.split(/\r?\n/).filter(Boolean);
      const branchLine = lines.find((line) => line.startsWith("## ")) || "";
      const branch = parseGitBranch(branchLine);
      const files = parseGitStatusFiles(lines.filter((line) => !line.startsWith("## ")));

      resolve({
        available: true,
        branch: branch.name,
        ahead: branch.ahead,
        behind: branch.behind,
        changed: files.length,
        files,
        raw: result.stdout,
      });
    }).catch((error) => {
      resolve({
        available: false,
        branch: "none",
        ahead: 0,
        behind: 0,
        changed: 0,
        raw: error.message,
      });
    });
  });
}

async function readGitDiff(projectRoot, options = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  const filePath = String(options.path || "");
  const resolvedPath = resolveWorkspacePath(root, filePath);
  const relativePath = normalizeSlashes(path.relative(root, resolvedPath));
  const diffParts = [];

  const staged = await runGit(root, ["diff", "--cached", "--", relativePath]);
  const unstaged = await runGit(root, ["diff", "--", relativePath]);

  if (staged.exitCode === 0 && staged.stdout.trim()) {
    diffParts.push(`# staged\n${staged.stdout}`);
  }
  if (unstaged.exitCode === 0 && unstaged.stdout.trim()) {
    diffParts.push(`# unstaged\n${unstaged.stdout}`);
  }

  let diff = diffParts.join("\n");

  if (!diff.trim() && safeStat(resolvedPath)?.isFile()) {
    const content = fs.readFileSync(resolvedPath, "utf8");
    if (!content.includes("\0")) {
      diff = synthesizeUntrackedDiff(relativePath, content);
    }
  }

  const truncated = Buffer.byteLength(diff, "utf8") > MAX_DIFF_BYTES;
  if (truncated) {
    diff = diff.slice(0, MAX_DIFF_BYTES) + "\n...diff truncated...\n";
  }

  return {
    projectRoot: root,
    path: relativePath,
    diff,
    truncated,
  };
}

function synthesizeUntrackedDiff(filePath, content) {
  const lines = content.split(/\r?\n/).slice(0, 400);
  return [
    `diff --git a/${filePath} b/${filePath}`,
    "new file mode 100644",
    "index 0000000..0000000",
    "--- /dev/null",
    `+++ b/${filePath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
  ].join("\n");
}

function parseGitStatusFiles(lines) {
  return lines.map((line) => {
    const rawStatus = line.slice(0, 2);
    const rawPath = line.slice(3);
    const renameParts = rawPath.split(" -> ");
    const filePath = renameParts.at(-1) || rawPath;
    return {
      path: normalizeSlashes(filePath),
      previousPath: renameParts.length > 1 ? normalizeSlashes(renameParts[0]) : "",
      index: rawStatus[0],
      worktree: rawStatus[1],
      status: summarizeGitFileStatus(rawStatus),
    };
  }).filter((item) => item.path);
}

function summarizeGitFileStatus(rawStatus) {
  if (rawStatus === "??") return "untracked";
  if (rawStatus.includes("D")) return "deleted";
  if (rawStatus.includes("R")) return "renamed";
  if (rawStatus.includes("A")) return "added";
  if (rawStatus.includes("M")) return "modified";
  return "changed";
}

function readSkillsSnapshot(projectRoot) {
  const skillify = createSkillifySkill([]);
  const usageStats = getSkillUsageStats();
  const skills = [skillify, ...loadAllSkills(projectRoot)].map((skill) => {
    const usage = usageStats[skill.name] || {};
    return {
      name: skill.name,
      displayName: skill.displayName || skill.name,
      description: skill.description || '',
      whenToUse: skill.whenToUse || '',
      allowedTools: Array.isArray(skill.allowedTools) ? skill.allowedTools : [],
      source: skill.source || 'custom',
      baseDir: skill.baseDir || '',
      isHidden: Boolean(skill.isHidden),
      userInvocable: skill.userInvocable !== false,
      usageCount: Number(usage.usageCount || 0),
      lastUsedAt: usage.lastUsedAt || null,
      usageScore: Number((usage.usageCount || 0)),
    };
  });

  skills.sort((left, right) => {
    if (right.usageScore !== left.usageScore) return right.usageScore - left.usageScore;
    return left.displayName.localeCompare(right.displayName);
  });

  return {
    projectRoot,
    total: skills.length,
    visible: skills.filter((skill) => !skill.isHidden).length,
    skills,
  };
}

function readToolSnapshot(projectRoot, settings) {
  const registry = createLocalToolRegistry({
    root: projectRoot,
    shellPolicy: settings.tools?.shell,
  });

  const tools = registry.list().map((tool) => ({
    name: tool.name,
    description: tool.description || '',
    inputSchema: tool.inputSchema || null,
  }));

  return {
    projectRoot,
    total: tools.length,
    tools,
  };
}

function readPermissionSnapshot(projectRoot, settings) {
  const persistPath = path.join(projectRoot, ".hax-agent", "permissions.json");
  const manager = new PermissionManager({
    mode: settings.permissions?.mode || "normal",
    locale: settings.ui?.locale,
    persistPath,
  });

  try {
    const raw = fs.readFileSync(persistPath, "utf8");
    const persisted = JSON.parse(raw);
    if (persisted && typeof persisted === "object") {
      if (persisted.mode) manager.mode = persisted.mode;
      if (Array.isArray(persisted.alwaysAllow)) {
        manager._alwaysAllow = new Set(persisted.alwaysAllow);
      }
      if (Array.isArray(persisted.alwaysDeny)) {
        manager._alwaysDeny = new Set(persisted.alwaysDeny);
      }
    }
  } catch {
    // No persisted overrides yet.
  }

  const summary = manager.getSummary();

  return {
    projectRoot,
    ...summary,
    counts: {
      auto: summary.toolPermissions.filter((item) => item.level === "auto").length,
      dynamic: summary.toolPermissions.filter((item) => item.level === "dynamic").length,
      ask: summary.toolPermissions.filter((item) => item.level === "ask").length,
      dangerous: summary.toolPermissions.filter((item) => item.level === "dangerous").length,
    },
    shellCommands: {
      safe: Array.from(SAFE_SHELL_COMMANDS).sort(),
      dangerous: Array.from(DANGEROUS_SHELL_COMMANDS).sort(),
    },
    toolPermissions: summary.toolPermissions.map((item) => ({
      tool: item.tool,
      level: item.level,
    })),
  };
}

function readTeamSnapshot(projectRoot, settings) {
  const runtime = createTeamRuntime({ projectRoot, settings });
  const teams = runtime.listTeams();
  let activeTeam = null;

  if (teams.length > 0) {
    try {
      activeTeam = runtime.loadTeam(teams[0].name);
    } catch {
      activeTeam = null;
    }
  }

  return {
    projectRoot,
    teams,
    activeTeam,
  };
}

function runGit(cwd, args) {
  return new Promise((resolve) => {
    const child = spawn("git", args, {
      cwd,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => resolve({ exitCode: 1, stdout, stderr: error.message }));
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

function parseGitBranch(line) {
  const clean = line.replace(/^##\s+/, "");
  const [namePart, metaPart = ""] = clean.split("...");
  const meta = metaPart || namePart;
  const aheadMatch = meta.match(/ahead\s+(\d+)/);
  const behindMatch = meta.match(/behind\s+(\d+)/);

  return {
    name: namePart.replace(/\s+\[.*\]$/, "") || "unknown",
    ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
    behind: behindMatch ? Number(behindMatch[1]) : 0,
  };
}

function normalizeSlashes(value) {
  return value.replace(/\\/g, "/");
}

function sanitizeSettings(settings) {
  if (!settings || typeof settings !== "object") return settings;
  const clone = JSON.parse(JSON.stringify(settings));

  if (clone.agent?.apiKey) {
    clone.agent.apiKey = "***";
  }

  return clone;
}

module.exports = {
  findTranscriptSession,
  migrateLegacySessionRecords,
  readSessionList,
  readGitDiff,
  readWorkspaceFile,
  readSkillsSnapshot,
  readToolSnapshot,
  readPermissionSnapshot,
  readTeamSnapshot,
  readGitStatus,
  pathsEqual,
  sanitizeSettings,
  searchWorkspaceContent,
  readWorkspaceTree,
  summarizeTranscriptEntries,
};
