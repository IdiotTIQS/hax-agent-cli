"use strict";

/**
 * EntityExtractor — structured entity extraction from natural language text.
 *
 * Detects and extracts named entities relevant to software development
 * contexts: file paths, function/class names, line numbers, technology
 * stacks, error messages, URLs, commit hashes, branch names, and version
 * numbers.
 *
 * Pure regex + heuristic approach — no ML dependency.
 */

// ── Known technology stacks ──────────────────────────────────────────────
const KNOWN_TECHNOLOGIES = Object.freeze([
  // Frontend frameworks & libraries
  "react", "angular", "vue", "svelte", "solid", "preact", "qwik",
  "next.js", "next", "nuxt", "remix", "astro", "gatsby", "sapper",
  "jquery", "backbone", "ember", "alpine",
  // Backend frameworks
  "express", "koa", "fastify", "hapi", "nest", "loopback", "feathers",
  "django", "flask", "fastapi", "pyramid", "tornado",
  "rails", "sinatra", "laravel", "symfony", "spring", "dotnet", "actix",
  // Languages & runtimes
  "node", "node.js", "deno", "bun", "python", "ruby", "go", "golang",
  "rust", "elixir", "php", "kotlin", "swift", "scala", "java",
  "typescript", "javascript", "csharp", "c#", "f#",
  // APIs & protocols
  "graphql", "rest", "grpc", "websocket", "soap", "trpc",
  // Databases
  "postgres", "postgresql", "mysql", "mariadb", "mongodb", "redis",
  "sqlite", "cassandra", "dynamodb", "couchdb", "neo4j", "supabase",
  "firestore", "cockroachdb", "timescale",
  // Cloud & infrastructure
  "docker", "kubernetes", "k8s", "aws", "azure", "gcp",
  "firebase", "heroku", "vercel", "netlify", "fly", "render",
  "terraform", "pulumi", "ansible",
  // CSS & styling
  "tailwind", "bootstrap", "material-ui", "mui", "chakra", "ant-design",
  "antd", "styled-components", "emotion", "sass", "scss", "less",
  // Build tools
  "webpack", "vite", "esbuild", "rollup", "parcel", "turbopack", "swc",
  "babel", "tsc",
  // Testing
  "jest", "mocha", "jasmine", "cypress", "playwright", "vitest", "ava",
  "puppeteer", "selenium", "karma",
  // Linting & formatting
  "eslint", "prettier", "husky", "lint-staged", "commitlint",
  // State management
  "redux", "zustand", "mobx", "recoil", "jotai", "valtio", "pinia",
  "vuex", "ngrx", "akita",
  // ORMs & data
  "prisma", "drizzle", "sequelize", "typeorm", "mongoose", "knex",
  "entity-framework", "hibernate", "sqlalchemy", "activerecord",
  // Misc
  "storybook", "figma", "swagger", "openapi", "postman",
  "git", "github", "gitlab", "bitbucket",
  "nginx", "apache", "caddy", "traefik",
  "rabbitmq", "kafka", "redis-pubsub", "nats",
  "prometheus", "grafana", "datadog", "sentry",
  "linux", "macos", "windows",
]);

// ── Common file extensions ───────────────────────────────────────────────
const CODE_EXTENSIONS = new Set([
  "js", "jsx", "ts", "tsx", "mjs", "cjs",
  "py", "pyi", "pyx",
  "go",
  "rs",
  "java", "kt", "kts",
  "rb", "rake",
  "php", "phtml",
  "swift",
  "c", "cpp", "cc", "cxx", "h", "hpp", "hh",
  "cs",
  "scala",
  "elm",
  "ex", "exs", "eex", "leex",
  "hs", "lhs",
  "clj", "cljs", "edn",
  "lua",
  "r",
  "jl",
  "dart",
  "sql", "psql",
  "sh", "bash", "zsh", "fish",
  "html", "css", "scss", "sass", "less", "styl",
  "json", "yaml", "yml", "toml", "ini", "cfg", "conf",
  "md", "mdx", "rst", "txt",
  "xml", "svg",
  "vue", "svelte",
  "graphql", "gql",
  "proto",
  "dockerfile", "makefile", "cmake",
  "env", "gitignore", "editorconfig",
]);

// ── Function / class name patterns ──────────────────────────────────────
const CODE_IDENTIFIER_RE = /\b([A-Z][A-Za-z0-9_]{1,50}|[a-z][a-zA-Z0-9_]{2,50})\b/g;

// ── Constructor ─────────────────────────────────────────────────────────

class EntityExtractor {
  /**
   * @param {object} [options]
   * @param {string[]} [options.extraTechnologies] — additional tech keywords to detect
   */
  constructor(options = {}) {
    this._techSet = new Set(
      KNOWN_TECHNOLOGIES.concat(options.extraTechnologies || []).map((t) => t.toLowerCase()),
    );
  }

  /**
   * Extract all entity types from text.
   *
   * @param {string} text
   * @returns {{
   *   filePaths: string[],
   *   functionNames: string[],
   *   lineNumbers: number[],
   *   technologies: string[],
   *   errorMessages: string[],
   *   urls: string[],
   *   commitHashes: string[],
   *   branchNames: string[],
   *   versionNumbers: string[],
   * }}
   */
  extract(text) {
    const input = String(text || "").trim();

    if (!input) {
      return {
        filePaths: [],
        functionNames: [],
        lineNumbers: [],
        technologies: [],
        errorMessages: [],
        urls: [],
        commitHashes: [],
        branchNames: [],
        versionNumbers: [],
      };
    }

    return {
      filePaths: this.extractFilePaths(input),
      functionNames: this.extractCodeReferences(input).functions,
      lineNumbers: this._extractLineNumbers(input),
      technologies: this.extractTechnologies(input),
      errorMessages: this._extractErrorMessages(input),
      urls: this._extractUrls(input),
      commitHashes: this._extractCommitHashes(input),
      branchNames: this._extractBranchNames(input),
      versionNumbers: this._extractVersionNumbers(input),
    };
  }

  // ── File paths ───────────────────────────────────────────────────────

  /**
   * Extract file paths from text. Matches relative paths, absolute paths,
   * and bare filenames with known code extensions.
   *
   * @param {string} text
   * @returns {string[]}
   */
  extractFilePaths(text) {
    const input = String(text || "").trim();
    if (!input) return [];

    const results = [];

    // Pattern 1: Full paths (relative or absolute) with code extensions
    // e.g., src/utils/helpers.js, ./lib/parser.ts, /app/models/user.rb
    // Use [\w-]+ (no dot) to avoid consuming the extension separator
    const pathRe = /(?:\.{0,2}[\/\\])?(?:[\w-]+[\/\\])*[\w-]+\.([\w]+)\b/g;
    let match;
    while ((match = pathRe.exec(input)) !== null) {
      const ext = match[1].toLowerCase();
      if (CODE_EXTENSIONS.has(ext)) {
        results.push(match[0]);
      }
    }

    // Pattern 2: Backtick-wrapped file references (common in markdown/chat)
    // e.g., `src/foo.js`, `auth.ts`
    const backtickRe = /`([^`]+\.[\w]+)`/g;
    while ((match = backtickRe.exec(input)) !== null) {
      const candidate = match[1].trim();
      const extMatch = candidate.match(/\.([\w]+)$/);
      if (extMatch && CODE_EXTENSIONS.has(extMatch[1].toLowerCase())) {
        results.push(candidate);
      }
    }

    // Pattern 3: Quoted paths
    // e.g., "src/index.js", 'components/App.tsx'
    const quoteRe = /["']([^"']+\.[\w]+)["']/g;
    while ((match = quoteRe.exec(input)) !== null) {
      const candidate = match[1].trim();
      const extMatch = candidate.match(/\.([\w]+)$/);
      if (extMatch && CODE_EXTENSIONS.has(extMatch[1].toLowerCase())) {
        results.push(candidate);
      }
    }

    return [...new Set(results)].sort();
  }

  // ── Code references (functions, classes) ──────────────────────────────

  /**
   * Extract function names, class names, and method references from text.
   *
   * @param {string} text
   * @returns {{ functions: string[], classes: string[] }}
   */
  extractCodeReferences(text) {
    const input = String(text || "").trim();
    if (!input) return { functions: [], classes: [] };

    const functions = [];
    const classes = [];

    // Pattern 1: Explicit mentions like "function X", "method Y", "class Z"
    const explicitRe = /\b(function|method|fn|func|class|component|hook|module)\s+(?:`)?([A-Za-z_][A-Za-z0-9_]{1,50})(?:`)?\b/g;
    let match;
    while ((match = explicitRe.exec(input)) !== null) {
      const kind = match[1].toLowerCase();
      const name = match[2];
      if (kind === "class" || kind === "component") {
        classes.push(name);
      } else {
        functions.push(name);
      }
    }

    // Pattern 2: PascalCase identifiers (likely class/component names)
    // Must be standalone, not at start of sentence unless it's clearly a code name
    const pascalRe = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g;
    while ((match = pascalRe.exec(input)) !== null) {
      const name = match[1];
      // Avoid false positives from normal English (e.g., "JavaScript" but not "RouterProvider")
      if (name.length >= 6 && /[A-Z]/.test(name.slice(1))) {
        // Check it's not a known non-code word
        if (!this._isCommonEnglishPascal(name)) {
          classes.push(name);
        }
      }
    }

    // Pattern 3: camelCase identifiers in code contexts
    // e.g., "the getUserData function", "call handleSubmit"
    const camelRe = /\b([a-z][a-z0-9]*[A-Z][A-Za-z0-9]{2,})\b/g;
    while ((match = camelRe.exec(input)) !== null) {
      const name = match[1];
      // Avoid capturing regular English camelWords (rare but possible)
      if (name.length >= 5) {
        functions.push(name);
      }
    }

    // Pattern 4: snake_case identifiers
    const snakeRe = /\b([a-z][a-z0-9]*(?:_[a-z0-9]+){1,})\b/g;
    while ((match = snakeRe.exec(input)) !== null) {
      const name = match[1];
      if (name.length >= 4) {
        functions.push(name);
      }
    }

    // Pattern 5: Backtick-wrapped identifiers
    // e.g., `handleClick`, `UserProfile`
    const btRe = /`([A-Za-z_][A-Za-z0-9_]{2,50})`/g;
    while ((match = btRe.exec(input)) !== null) {
      const name = match[1];
      if (/[A-Z]/.test(name)) {
        // PascalCase or camelCase inside backticks
        if (name[0] === name[0].toUpperCase() && name[0] !== "_") {
          classes.push(name);
        } else {
          functions.push(name);
        }
      }
    }

    return {
      functions: [...new Set(functions)].sort(),
      classes: [...new Set(classes)].sort(),
    };
  }

  // ── Technologies ─────────────────────────────────────────────────────

  /**
   * Detect mentioned technology stacks in text.
   *
   * @param {string} text
   * @returns {string[]}
   */
  extractTechnologies(text) {
    const input = String(text || "").trim();
    if (!input) return [];

    const normalized = input.toLowerCase();
    const found = [];

    for (const tech of this._techSet) {
      // Use word-boundary matching for single-word techs
      if (tech.includes(" ") || tech.includes("-") || tech.includes(".") || tech.includes("#")) {
        if (normalized.includes(tech)) {
          found.push(tech);
        }
      } else {
        const re = new RegExp(`\\b${tech.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        if (re.test(input)) {
          found.push(tech);
        }
      }
    }

    return found.sort();
  }

  // ── Private extraction helpers ───────────────────────────────────────

  /**
   * Extract line numbers from phrases like "line 42", "lines 10-20", ":32".
   */
  _extractLineNumbers(text) {
    const results = [];

    // "line(s) N", "line N-M", "at line N"
    const lineRe = /\b(?:lines?|at)\s+(\d+)(?:\s*[-–—to]+\s*(\d+))?/gi;
    let match;
    while ((match = lineRe.exec(text)) !== null) {
      const start = Number(match[1]);
      results.push(start);
      if (match[2] !== undefined) {
        const end = Number(match[2]);
        for (let i = start + 1; i <= end; i += 1) results.push(i);
      }
    }

    // Colon notation: ":42", "L42"
    const colonRe = /\b[:L](\d+)\b/g;
    while ((match = colonRe.exec(text)) !== null) {
      results.push(Number(match[1]));
    }

    return [...new Set(results)].sort((a, b) => a - b);
  }

  /**
   * Extract error messages from quoted strings or known error patterns.
   */
  _extractErrorMessages(text) {
    const results = [];

    // Quoted strings that look like error messages
    const quoteRe = /["']([^"']{5,200})["']/g;
    let match;
    while ((match = quoteRe.exec(text)) !== null) {
      const content = match[1];
      // Heuristic: error messages often contain keywords
      if (/\b(error|failed|cannot|unable|invalid|missing|not found|denied|refused|timeout|unexpected|unknown)\b/i.test(content)) {
        results.push(content.trim());
      }
    }

    // Error-like patterns: "Error: ...", "TypeError: ...", etc.
    const errorRe = /\b(?:Error|Exception|TypeError|ReferenceError|SyntaxError|RangeError|E\d+)[:]\s*([^\n]{5,200})/g;
    while ((match = errorRe.exec(text)) !== null) {
      results.push(match[1].trim());
    }

    // Stack trace snippets
    const stackRe = /\bat\s+([^\n]{10,200})/g;
    while ((match = stackRe.exec(text)) !== null) {
      results.push(match[1].trim());
    }

    return [...new Set(results)];
  }

  /**
   * Extract URLs from text.
   */
  _extractUrls(text) {
    const re = /https?:\/\/[^\s)\]]+/g;
    const matches = text.match(re);
    return matches ? [...new Set(matches)] : [];
  }

  /**
   * Extract git commit hashes (7–40 hex chars).
   */
  _extractCommitHashes(text) {
    // Match standalone hex strings that look like commit hashes
    const re = /\b([0-9a-f]{7,40})\b/gi;
    const matches = text.match(re);
    if (!matches) return [];

    // Filter out common false positives (like "cafebabe" in tech docs
    // or short hex numbers that are likely not hashes)
    const filtered = matches.filter((h) => {
      const lower = h.toLowerCase();
      // Must contain at least one letter (not all digits)
      if (/^\d+$/.test(lower)) return false;
      // Common false positive patterns
      if (lower === "deadbeef" && text.toLowerCase().includes("deadbeef")) return true;
      return lower.length >= 7;
    });

    return [...new Set(filtered.map((h) => h.toLowerCase()))];
  }

  /**
   * Extract git branch names.
   */
  _extractBranchNames(text) {
    const results = [];

    // "branch X", "on branch X", "feature/xyz"
    const branchRe = /\b(?:branch|in)\s+["']?([a-zA-Z0-9][a-zA-Z0-9._/-]{1,100})["']?\b/gi;
    let match;
    while ((match = branchRe.exec(text)) !== null) {
      const candidate = match[1].trim();
      if (candidate.length >= 2 && !/^(?:the|this|that|master|main|develop)$/i.test(candidate)) {
        results.push(candidate);
      }
    }

    // Common branch prefixes followed by path-like names
    const prefixRe = /\b(?:feature|bugfix|hotfix|release|fix|chore|refactor|docs?|test|ci)\/[a-zA-Z0-9._-]{2,50}\b/gi;
    const prefixMatches = text.match(prefixRe);
    if (prefixMatches) {
      results.push(...prefixMatches);
    }

    return [...new Set(results)].sort();
  }

  /**
   * Extract version numbers (semver or partial).
   */
  _extractVersionNumbers(text) {
    const results = [];

    // Semver: v1.2.3, 1.2.3, v1.2.3-beta.1
    const semverRe = /\bv?(\d+\.\d+(?:\.\d+)?(?:-[a-zA-Z0-9.]+)?(?:\+[a-zA-Z0-9.]+)?)\b/g;
    let match;
    while ((match = semverRe.exec(text)) !== null) {
      results.push(match[0]);
    }

    // "version X.Y" pattern
    const versionRe = /\bversion\s+v?(\d+\.\d+(?:\.\d+)?)\b/gi;
    while ((match = versionRe.exec(text)) !== null) {
      results.push(match[0]);
    }

    return [...new Set(results)].sort();
  }

  /**
   * Check if a PascalCase word is a common English proper noun
   * that would be a false positive for a class name.
   */
  _isCommonEnglishPascal(word) {
    const common = new Set([
      "JavaScript", "TypeScript", "Python", "Monday", "Tuesday", "Wednesday",
      "Thursday", "Friday", "Saturday", "Sunday", "January", "February",
      "March", "April", "May", "June", "July", "August", "September",
      "October", "November", "December", "English", "Spanish", "French",
      "German", "Chinese", "Japanese", "Windows", "Linux", "macOS", "iOS",
      "Android", "Internet", "Bluetooth", "WiFi", "Amazon", "Google",
      "Microsoft", "Apple", "Facebook", "Twitter", "LinkedIn", "YouTube",
      "GitHub", "GitLab", "Bitbucket", "Docker", "Kubernetes", "GraphQL",
      "PostgreSQL", "MongoDB", "Firebase", "Heroku", "Vercel", "Netlify",
    ]);
    return common.has(word);
  }
}

// ── Quick convenience exports ────────────────────────────────────────────

function extractEntities(text) {
  return new EntityExtractor().extract(text);
}

function extractFilePaths(text) {
  return new EntityExtractor().extractFilePaths(text);
}

function extractCodeReferences(text) {
  return new EntityExtractor().extractCodeReferences(text);
}

function extractTechnologies(text) {
  return new EntityExtractor().extractTechnologies(text);
}

module.exports = {
  EntityExtractor,
  extractEntities,
  extractFilePaths,
  extractCodeReferences,
  extractTechnologies,
  KNOWN_TECHNOLOGIES,
  CODE_EXTENSIONS,
};
