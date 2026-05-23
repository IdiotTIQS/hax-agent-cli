"use strict";

const fs = require('node:fs');
const path = require('node:path');
const { debug } = require('../debug');
const { parseFrontmatter } = require('./parser');

/**
 * Skill packaging utilities.
 *
 * Packages a skill directory into a portable format for sharing and
 * reinstalls a packaged skill into a target directory.
 *
 * Package format (directory-based):
 *   skill-name/
 *     SKILL.md          (required — core skill definition, frontmatter + markdown)
 *     manifest.json     (optional — package metadata: version, author, etc.)
 *     scripts/          (optional — helper scripts bundled with the skill)
 *     assets/           (optional — static assets referenced by the skill)
 *
 * .haxpkg files are plain directories ending in .haxpkg that follow
 * the above structure.  They can be tar.gz'd by the consumer if desired;
 * this module only reads/writes the raw directory form.
 */

const REQUIRED_FILES = ['SKILL.md'];
const OPTIONAL_DIRS = ['scripts', 'assets'];
const OPTIONAL_FILES = ['manifest.json'];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a skill package directory.
 *
 * Checks that:
 *   - The path exists and is a directory.
 *   - SKILL.md exists.
 *   - SKILL.md has parsable frontmatter with at least a name.
 *   - Optional directories/files are valid.
 *
 * @param {string} packagePath - Path to the package directory.
 * @returns {{ valid: boolean, errors: string[], warnings: string[], meta: object|null }}
 */
function validateSkillPackage(packagePath) {
  const errors = [];
  const warnings = [];
  let meta = null;

  const resolved = path.resolve(packagePath);

  if (!fs.existsSync(resolved)) {
    errors.push(`Package path does not exist: ${resolved}`);
    return { valid: false, errors, warnings, meta: null };
  }

  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    errors.push(`Package path is not a directory: ${resolved}`);
    return { valid: false, errors, warnings, meta: null };
  }

  // Check required files
  for (const file of REQUIRED_FILES) {
    const filePath = path.join(resolved, file);
    if (!fs.existsSync(filePath)) {
      errors.push(`Missing required file: ${file}`);
    } else {
      const fileStat = fs.statSync(filePath);
      if (!fileStat.isFile()) {
        errors.push(`Required entry is not a file: ${file}`);
      }
    }
  }

  // Parse SKILL.md for validity if it exists
  const skillMdPath = path.join(resolved, 'SKILL.md');
  if (fs.existsSync(skillMdPath)) {
    try {
      const content = fs.readFileSync(skillMdPath, 'utf-8');
      const { frontmatter } = parseFrontmatter(content);

      if (!frontmatter.name) {
        warnings.push('SKILL.md frontmatter is missing a "name" field');
      }

      meta = {
        name: frontmatter.name || path.basename(resolved),
        description: frontmatter.description || null,
        version: frontmatter.version || '0.0.0',
        author: frontmatter.author || null,
        tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
        arguments: frontmatter.arguments || null,
        hasFrontmatter: Object.keys(frontmatter).length > 0,
      };
    } catch (err) {
      errors.push(`Failed to parse SKILL.md: ${err.message}`);
    }
  }

  // Check for manifest.json
  const manifestPath = path.join(resolved, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const manifestRaw = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestRaw);
      if (meta) {
        meta.packageVersion = manifest.version || null;
        meta.packageName = manifest.name || null;
      }
    } catch (err) {
      warnings.push(`manifest.json exists but is not valid JSON: ${err.message}`);
    }
  }

  // Check optional directories
  for (const dir of OPTIONAL_DIRS) {
    const dirPath = path.join(resolved, dir);
    if (fs.existsSync(dirPath)) {
      const dirStat = fs.statSync(dirPath);
      if (!dirStat.isDirectory()) {
        warnings.push(`Expected directory "${dir}" is not a directory`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    meta,
  };
}

// ---------------------------------------------------------------------------
// Packaging
// ---------------------------------------------------------------------------

/**
 * Recursively copy a directory, skipping hidden files (dot-prefixed).
 * @param {string} src
 * @param {string} dest
 */
function _copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      _copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Create a skill package from a skill source directory.
 *
 * The source can be:
 *   - A directory containing SKILL.md (and optionally scripts/, assets/).
 *   - A path to a SKILL.md file itself.
 *
 * The output is always a directory.  By convention append ".haxpkg" to the
 * output path for discoverability (e.g. "my-skill.haxpkg").
 *
 * @param {string} skillPath  - Path to the skill source (directory or SKILL.md file).
 * @param {string} outputPath - Destination directory for the package.
 * @param {object} [options]
 * @param {object} [options.manifest] - Extra manifest data to merge into manifest.json.
 * @param {boolean} [options.overwrite=false] - Overwrite existing output directory.
 * @returns {{ packagePath: string, skillName: string, filesCopied: number }}
 */
function createSkillPackage(skillPath, outputPath, options = {}) {
  const { manifest: extraManifest = {}, overwrite = false } = options;

  const resolvedSource = path.resolve(skillPath);
  const resolvedOutput = path.resolve(outputPath);

  if (!fs.existsSync(resolvedSource)) {
    throw new Error(`Skill source does not exist: ${resolvedSource}`);
  }

  if (fs.existsSync(resolvedOutput)) {
    if (!overwrite) {
      throw new Error(
        `Output path already exists: ${resolvedOutput}. Use overwrite: true to replace.`
      );
    }
    fs.rmSync(resolvedOutput, { recursive: true, force: true });
  }

  fs.mkdirSync(resolvedOutput, { recursive: true });

  let sourceDir;
  let skillName;

  const sourceStat = fs.statSync(resolvedSource);

  if (sourceStat.isFile()) {
    // Single SKILL.md file
    const content = fs.readFileSync(resolvedSource, 'utf-8');
    const { frontmatter } = parseFrontmatter(content);
    skillName = frontmatter.name || path.basename(path.dirname(resolvedSource));

    fs.copyFileSync(resolvedSource, path.join(resolvedOutput, 'SKILL.md'));
    sourceDir = path.dirname(resolvedSource);
  } else {
    // Directory
    const skillMdPath = path.join(resolvedSource, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) {
      throw new Error(`No SKILL.md found in source directory: ${resolvedSource}`);
    }

    const content = fs.readFileSync(skillMdPath, 'utf-8');
    const { frontmatter } = parseFrontmatter(content);
    skillName = frontmatter.name || path.basename(resolvedSource);

    // Copy SKILL.md
    fs.copyFileSync(skillMdPath, path.join(resolvedOutput, 'SKILL.md'));
    sourceDir = resolvedSource;
  }

  let filesCopied = 1; // SKILL.md

  // Copy optional directories (scripts/, assets/)
  for (const dir of OPTIONAL_DIRS) {
    const srcDir = path.join(sourceDir, dir);
    if (fs.existsSync(srcDir)) {
      _copyDir(srcDir, path.join(resolvedOutput, dir));
      filesCopied += _countFiles(srcDir);
    }
  }

  // Generate manifest.json
  const skillContent = fs.readFileSync(path.join(resolvedOutput, 'SKILL.md'), 'utf-8');
  const { frontmatter } = parseFrontmatter(skillContent);

  const manifest = {
    name: skillName,
    version: frontmatter.version || '0.0.0',
    description: frontmatter.description || '',
    author: frontmatter.author || '',
    tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
    arguments: frontmatter.arguments || null,
    packagedAt: new Date().toISOString(),
    haxpkgVersion: '1.0',
    ...extraManifest,
  };

  fs.writeFileSync(
    path.join(resolvedOutput, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8'
  );
  filesCopied += 1;

  debug('skills-package', `packaged "${skillName}" -> ${resolvedOutput} (${filesCopied} files)`);

  return {
    packagePath: resolvedOutput,
    skillName,
    filesCopied,
    manifest,
  };
}

/**
 * Count files recursively in a directory.
 */
function _countFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  let count = 0;
  const stack = [dirPath];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        stack.push(path.join(current, entry.name));
      } else {
        count += 1;
      }
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Installation from package
// ---------------------------------------------------------------------------

/**
 * Install a skill from a package directory into a target directory.
 *
 * The package is validated first.  On success the contents are copied into
 * targetDir/<skill-name>/.
 *
 * @param {string} packagePath - Path to the package directory.
 * @param {string} targetDir   - Destination directory (e.g. ~/.hax-agent/skills).
 * @param {object} [options]
 * @param {boolean} [options.overwrite=false] - Overwrite existing installation.
 * @returns {{ installed: boolean, skillName: string, installDir: string, validation: object }}
 */
function installSkillPackage(packagePath, targetDir, options = {}) {
  const { overwrite = false } = options;

  const resolvedPackage = path.resolve(packagePath);
  const resolvedTarget = path.resolve(targetDir);

  // Validate first
  const validation = validateSkillPackage(resolvedPackage);
  if (!validation.valid) {
    throw new Error(
      `Invalid skill package: ${validation.errors.join('; ')}`
    );
  }

  const skillName = validation.meta.name;
  const installDir = path.join(resolvedTarget, skillName);

  if (fs.existsSync(installDir)) {
    if (!overwrite) {
      throw new Error(
        `Skill "${skillName}" is already installed at ${installDir}. Use overwrite: true.`
      );
    }
    fs.rmSync(installDir, { recursive: true, force: true });
  }

  fs.mkdirSync(installDir, { recursive: true });

  // Copy SKILL.md
  fs.copyFileSync(
    path.join(resolvedPackage, 'SKILL.md'),
    path.join(installDir, 'SKILL.md')
  );

  // Copy optional directories
  for (const dir of OPTIONAL_DIRS) {
    const srcDir = path.join(resolvedPackage, dir);
    if (fs.existsSync(srcDir)) {
      _copyDir(srcDir, path.join(installDir, dir));
    }
  }

  debug('skills-package', `installed "${skillName}" from package to ${installDir}`);

  return {
    installed: true,
    skillName,
    installDir,
    validation,
  };
}

// ---------------------------------------------------------------------------
// Listing packages
// ---------------------------------------------------------------------------

/**
 * List available skill packages in a directory.
 *
 * Scans the given directory for subdirectories that contain a valid SKILL.md
 * or subdirectories ending in .haxpkg.
 *
 * @param {string} directory - Directory to scan for packages.
 * @returns {Array<object>} Array of package descriptors: { name, path, version, valid, description, tags }.
 */
function listPackages(directory) {
  const resolved = path.resolve(directory);

  if (!fs.existsSync(resolved)) return [];

  const entries = fs.readdirSync(resolved, { withFileTypes: true });
  const packages = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const pkgPath = path.join(resolved, entry.name);
    const validation = validateSkillPackage(pkgPath);

    packages.push({
      name: validation.meta ? validation.meta.name : entry.name,
      path: pkgPath,
      directoryName: entry.name,
      version: validation.meta ? validation.meta.version : '0.0.0',
      description: validation.meta ? validation.meta.description : null,
      author: validation.meta ? validation.meta.author : null,
      tags: validation.meta ? validation.meta.tags : [],
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
    });
  }

  return packages;
}

module.exports = {
  createSkillPackage,
  installSkillPackage,
  validateSkillPackage,
  listPackages,
};
