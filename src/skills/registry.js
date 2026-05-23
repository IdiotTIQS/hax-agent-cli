"use strict";

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { debug } = require('../debug');
const { loadSkillsFromDir, getSkillsPath } = require('./loader');
const { parseFrontmatter, extractDescriptionFromMarkdown, parseArgumentNames } = require('./parser');
const { recordSkillUsage, getSkillUsageStats } = require('./usage');

/**
 * SkillRegistry manages discovering, installing, uninstalling, searching,
 * and updating skills across user and project skill directories.
 *
 * Each installed skill is a directory containing at minimum a SKILL.md file.
 * The registry tracks per-skill usage statistics including install time,
 * update count, and search hits.
 */
class SkillRegistry {
  constructor(projectRoot) {
    this._projectRoot = projectRoot || process.cwd();

    // In-memory tracking for registry-level stats (beyond usage.js counters)
    this._metaTracker = new Map();
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolve the target install directory for a given source.
   * 'user'  -> ~/.hax-agent/skills
   * 'project' -> .hax-agent/skills (relative to projectRoot)
   */
  _resolveTargetDir(source) {
    if (source === 'user' || source === 'userSettings') {
      return path.join(os.homedir(), '.hax-agent', 'skills');
    }
    if (source === 'project' || source === 'projectSettings') {
      return path.resolve(this._projectRoot, '.hax-agent', 'skills');
    }
    throw new Error(`Unknown skill source: ${source}`);
  }

  /**
   * Determine the skill name from a source path.
   * Returns { name, sourceDir } where sourceDir is the directory containing SKILL.md.
   */
  _resolveSkillSource(skillPath) {
    const resolved = path.resolve(skillPath);
    const stat = fs.statSync(resolved);

    if (stat.isFile()) {
      // Single SKILL.md file
      const content = fs.readFileSync(resolved, 'utf-8');
      const { frontmatter } = parseFrontmatter(content);
      const name = frontmatter.name || path.basename(path.dirname(resolved));
      return { name, sourceDir: path.dirname(resolved), isFile: true, frontmatter };
    }

    if (stat.isDirectory()) {
      // Directory — look for SKILL.md inside
      const skillMdPath = path.join(resolved, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) {
        throw new Error(`No SKILL.md found in ${resolved}`);
      }
      const content = fs.readFileSync(skillMdPath, 'utf-8');
      const { frontmatter } = parseFrontmatter(content);
      const name = frontmatter.name || path.basename(resolved);
      return { name, sourceDir: resolved, isFile: false, frontmatter };
    }

    throw new Error(`Unsupported skill path: ${skillPath}`);
  }

  /**
   * Recursively copy a directory.
   */
  _copyDirRecursive(srcDir, destDir) {
    fs.mkdirSync(destDir, { recursive: true });
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);
      if (entry.isDirectory()) {
        this._copyDirRecursive(srcPath, destPath);
      } else if (entry.isSymbolicLink()) {
        fs.copyFileSync(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * UpSert a meta entry for a skill name.  Returns the current meta object.
   */
  _meta(skillName) {
    if (!this._metaTracker.has(skillName)) {
      this._metaTracker.set(skillName, {
        installedAt: null,
        installCount: 0,
        updateCount: 0,
        searchHitCount: 0,
        source: null,
      });
    }
    return this._metaTracker.get(skillName);
  }

  /**
   * Load a single skill from its install directory and return the skill object
   * (mirroring the shape from loadSkillsFromDir) plus registry metadata.
   */
  _loadSkillInfo(skillDirPath, source) {
    const skillFilePath = path.join(skillDirPath, 'SKILL.md');
    if (!fs.existsSync(skillFilePath)) return null;

    const content = fs.readFileSync(skillFilePath, 'utf-8');
    const { frontmatter, content: markdownContent } = parseFrontmatter(content);

    const skillName = frontmatter.name || path.basename(skillDirPath);
    const usageStats = getSkillUsageStats();
    const usage = usageStats[skillName];

    return {
      name: skillName,
      displayName: frontmatter.name || skillName,
      description: frontmatter.description || extractDescriptionFromMarkdown(markdownContent, 'Skill'),
      version: frontmatter.version || '0.0.0',
      author: frontmatter.author || null,
      tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
      arguments: parseArgumentNames(frontmatter.arguments),
      argumentHint: frontmatter['argument-hint'] || undefined,
      allowedTools: Array.isArray(frontmatter['allowed-tools']) ? frontmatter['allowed-tools'] : [],
      whenToUse: frontmatter.when_to_use || undefined,
      userInvocable: frontmatter['user-invocable'] !== false,
      source,
      baseDir: skillDirPath,
      installDir: skillDirPath,
      contentLength: markdownContent.length,
      usageCount: usage ? usage.usageCount : 0,
      lastUsedAt: usage ? usage.lastUsedAt : null,
    };
  }

  /**
   * Look up an installed skill by name across user and project dirs.
   * Returns { name, baseDir, source } or null.
   */
  _findInstalledSkill(skillName) {
    const dirs = [
      { dir: this._resolveTargetDir('user'), source: 'userSettings' },
      { dir: this._resolveTargetDir('project'), source: 'projectSettings' },
    ];

    for (const { dir, source } of dirs) {
      const skillDir = path.join(dir, skillName);
      if (fs.existsSync(skillDir) && fs.existsSync(path.join(skillDir, 'SKILL.md'))) {
        return { name: skillName, baseDir: skillDir, source };
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Install a skill from a file or directory path.
   *
   * @param {string} skillPath - Path to a SKILL.md file or a directory containing SKILL.md.
   * @param {object} [options]
   * @param {'user'|'project'} [options.target='user'] - Where to install.
   * @param {boolean} [options.overwrite=false] - Overwrite an existing installation.
   * @returns {{ name: string, installDir: string, source: string }}
   */
  install(skillPath, { target = 'user', overwrite = false } = {}) {
    const { name, sourceDir, isFile } = this._resolveSkillSource(skillPath);
    const targetRoot = this._resolveTargetDir(target);
    const installDir = path.join(targetRoot, name);

    if (fs.existsSync(installDir) && !overwrite) {
      throw new Error(
        `Skill "${name}" is already installed at ${installDir}. Use overwrite: true to replace.`
      );
    }

    // Clean previous installation if overwriting
    if (fs.existsSync(installDir)) {
      fs.rmSync(installDir, { recursive: true, force: true });
    }

    if (isFile) {
      // Single SKILL.md file — create directory and copy it
      fs.mkdirSync(installDir, { recursive: true });
      fs.copyFileSync(skillPath, path.join(installDir, 'SKILL.md'));
    } else {
      // Directory — copy recursively
      this._copyDirRecursive(sourceDir, installDir);
    }

    // Record install
    const meta = this._meta(name);
    meta.installedAt = Date.now();
    meta.installCount += 1;
    meta.source = target === 'user' ? 'userSettings' : 'projectSettings';
    this._metaTracker.set(name, meta);

    const skillInfo = this._loadSkillInfo(installDir, meta.source);

    debug('skills-registry', `installed skill "${name}" to ${installDir}`);

    return {
      name,
      installDir,
      source: meta.source,
      skill: skillInfo,
    };
  }

  /**
   * Uninstall (remove) an installed skill.
   *
   * @param {string} skillName - Name of the skill to remove.
   * @returns {{ removed: boolean, path: string|null }}
   */
  uninstall(skillName) {
    const installed = this._findInstalledSkill(skillName);

    if (!installed) {
      return { removed: false, path: null };
    }

    fs.rmSync(installed.baseDir, { recursive: true, force: true });

    // Reset meta
    const meta = this._meta(skillName);
    meta.installedAt = null;
    meta.source = null;

    debug('skills-registry', `uninstalled skill "${skillName}" from ${installed.baseDir}`);

    return { removed: true, path: installed.baseDir };
  }

  /**
   * List installed skills with metadata.
   *
   * @param {object} [options]
   * @param {'user'|'project'|'all'} [options.source='all'] - Filter by install source.
   * @param {boolean} [options.includeHidden=false] - Include hidden skills.
   * @param {string} [options.sortBy='name'] - Sort key: 'name', 'usageCount', 'lastUsedAt', 'installedAt'.
   * @param {boolean} [options.sortDesc=false] - Sort descending.
   * @returns {Array<object>}
   */
  list(options = {}) {
    const {
      source = 'all',
      includeHidden = false,
      sortBy = 'name',
      sortDesc = false,
    } = options;

    const skills = [];

    if (source === 'all' || source === 'user') {
      const userDir = this._resolveTargetDir('user');
      if (fs.existsSync(userDir)) {
        const loaded = loadSkillsFromDir(userDir, 'userSettings');
        for (const s of loaded) {
          const full = this._loadSkillInfo(
            path.join(userDir, s.name),
            'userSettings'
          );
          if (full) skills.push(full);
        }
      }
    }

    if (source === 'all' || source === 'project') {
      const projectDir = this._resolveTargetDir('project');
      if (fs.existsSync(projectDir)) {
        const loaded = loadSkillsFromDir(projectDir, 'projectSettings');
        for (const s of loaded) {
          const full = this._loadSkillInfo(
            path.join(projectDir, s.name),
            'projectSettings'
          );
          if (full) skills.push(full);
        }
      }
    }

    // De-duplicate by name (user overrides project)
    const seen = new Set();
    const deduped = [];
    for (const s of skills) {
      if (!seen.has(s.name)) {
        seen.add(s.name);
        deduped.push(s);
      }
    }

    // Filter hidden
    let result = includeHidden ? deduped : deduped.filter((s) => s.userInvocable !== false);

    // Sort
    const sortKeys = {
      name: (a, b) => a.name.localeCompare(b.name),
      usageCount: (a, b) => (a.usageCount || 0) - (b.usageCount || 0),
      lastUsedAt: (a, b) => (a.lastUsedAt || 0) - (b.lastUsedAt || 0),
      installedAt: (a, b) => {
        const ma = this._meta(a.name);
        const mb = this._meta(b.name);
        return (ma ? ma.installedAt || 0 : 0) - (mb ? mb.installedAt || 0 : 0);
      },
    };

    const comparator = sortKeys[sortBy] || sortKeys.name;
    result.sort(comparator);
    if (sortDesc) result.reverse();

    return result;
  }

  /**
   * Search installed skills by name, description, or tags.
   *
   * @param {string} query - Search term (case-insensitive substring match).
   * @returns {Array<object>} Matching skills with metadata.
   */
  search(query) {
    if (!query || query.trim().length === 0) {
      return this.list();
    }

    const q = query.toLowerCase().trim();
    const all = this.list({ includeHidden: true });

    const results = all.filter((s) => {
      // Match name
      if (s.name.toLowerCase().includes(q)) return true;
      // Match display name
      if (s.displayName && s.displayName.toLowerCase().includes(q)) return true;
      // Match description
      if (s.description && s.description.toLowerCase().includes(q)) return true;
      // Match tags
      if (Array.isArray(s.tags) && s.tags.some((t) => t.toLowerCase().includes(q))) return true;

      return false;
    });

    // Increment search hit counts for results
    for (const r of results) {
      const meta = this._meta(r.name);
      meta.searchHitCount += 1;
    }

    return results;
  }

  /**
   * Update (hot-reload) a skill from its source.
   *
   * If the skill was installed from a file, re-read and re-parse SKILL.md.
   * If no source is known, this is a no-op.
   *
   * @param {string} skillName
   * @returns {{ updated: boolean, skill: object|null }}
   */
  update(skillName) {
    const installed = this._findInstalledSkill(skillName);

    if (!installed) {
      throw new Error(`Skill "${skillName}" is not installed.`);
    }

    const { baseDir, source } = installed;
    const skillFilePath = path.join(baseDir, 'SKILL.md');

    if (!fs.existsSync(skillFilePath)) {
      throw new Error(`SKILL.md not found for "${skillName}" at ${skillFilePath}`);
    }

    // Re-read and re-parse
    const content = fs.readFileSync(skillFilePath, 'utf-8');
    const { frontmatter, content: markdownContent } = parseFrontmatter(content);

    const usageStats = getSkillUsageStats();
    const usage = usageStats[skillName];

    const meta = this._meta(skillName);
    meta.updateCount += 1;

    const skill = {
      name: skillName,
      displayName: frontmatter.name || skillName,
      description:
        frontmatter.description || extractDescriptionFromMarkdown(markdownContent, 'Skill'),
      version: frontmatter.version || '0.0.0',
      author: frontmatter.author || null,
      tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
      arguments: parseArgumentNames(frontmatter.arguments),
      argumentHint: frontmatter['argument-hint'] || undefined,
      allowedTools: Array.isArray(frontmatter['allowed-tools'])
        ? frontmatter['allowed-tools']
        : [],
      whenToUse: frontmatter.when_to_use || undefined,
      userInvocable: frontmatter['user-invocable'] !== false,
      source,
      baseDir,
      installDir: baseDir,
      contentLength: markdownContent.length,
      usageCount: usage ? usage.usageCount : 0,
      lastUsedAt: usage ? usage.lastUsedAt : null,
      updatedAt: Date.now(),
    };

    debug('skills-registry', `updated skill "${skillName}" (hot-reload)`);

    return { updated: true, skill };
  }

  /**
   * Get detailed information about a skill.
   *
   * @param {string} skillName
   * @returns {object|null} Full skill info or null if not installed.
   */
  getInfo(skillName) {
    const installed = this._findInstalledSkill(skillName);

    if (!installed) return null;

    const { baseDir, source } = installed;
    const info = this._loadSkillInfo(baseDir, source);
    if (!info) return null;

    const meta = this._meta(skillName);
    const usageStats = getSkillUsageStats();
    const usage = usageStats[skillName];

    // Read the raw frontmatter for completeness
    const skillFilePath = path.join(baseDir, 'SKILL.md');
    const content = fs.readFileSync(skillFilePath, 'utf-8');
    const { frontmatter } = parseFrontmatter(content);

    // Check for optional directories
    const hasScripts = fs.existsSync(path.join(baseDir, 'scripts'));
    const hasAssets = fs.existsSync(path.join(baseDir, 'assets'));

    return {
      name: skillName,
      displayName: info.displayName,
      description: info.description,
      version: info.version,
      author: info.author,
      tags: info.tags,
      source,
      baseDir,
      fileSize: fs.statSync(skillFilePath).size,

      // Frontmatter fields
      frontmatter: {
        ...frontmatter,
        // Exclude the parsed content to avoid bloat
      },
      arguments: info.arguments,
      argumentHint: info.argumentHint,
      allowedTools: info.allowedTools,
      whenToUse: info.whenToUse,
      userInvocable: info.userInvocable,
      contentLength: info.contentLength,

      // Directories
      hasScripts,
      hasAssets,

      // Usage stats
      usage: {
        count: usage ? usage.usageCount : 0,
        lastUsedAt: usage ? usage.lastUsedAt : null,
        installCount: meta.installCount,
        updateCount: meta.updateCount,
        searchHitCount: meta.searchHitCount,
        installedAt: meta.installedAt,
      },
    };
  }

  /**
   * Get the total count of installed skills (excluding hidden unless specified).
   *
   * @param {object} [options]
   * @param {boolean} [options.includeHidden=false]
   * @returns {number}
   */
  count(options = {}) {
    return this.list(options).length;
  }

  /**
   * Check if a skill name is currently installed.
   *
   * @param {string} skillName
   * @returns {boolean}
   */
  isInstalled(skillName) {
    return this._findInstalledSkill(skillName) !== null;
  }
}

module.exports = { SkillRegistry };
