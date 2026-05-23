"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { FileGenerator } = require("./file-gen");

/**
 * ProjectComposer
 *
 * Composes complete projects from reusable, composable parts.
 * Each part contributes files, dependencies, devDependencies, and scripts.
 * The composer merges all registered parts to produce a cohesive scaffold.
 *
 * Supported part types:
 *   - framework    (language/framework runtime files)
 *   - testing      (test runner config and sample tests)
 *   - linting      (linter/formatter configuration)
 *   - ci           (CI pipeline config — GitHub Actions / GitLab CI)
 *   - docker       (Dockerfile, .dockerignore, compose file)
 *   - docs         (README, CONTRIBUTING, LICENSE)
 *   - gitignore    (.gitignore patterns)
 *   - env          (.env template with defaults)
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Sanitize a project name to a safe identifier.
 *
 * @param {string} raw
 * @returns {string}
 */
function sanitizeName(raw) {
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    || "untitled";
}

/**
 * Deep-merge two objects (base + override).  Override values win.
 * Arrays are concatenated (deduplicated by name when objects).
 *
 * @param {object} base
 * @param {object} override
 * @returns {object}
 */
function deepMerge(base, override) {
  const result = {};
  const allKeys = new Set([...Object.keys(base), ...Object.keys(override)]);

  for (const key of allKeys) {
    const bVal = base[key];
    const oVal = override[key];

    if (oVal !== undefined) {
      if (Array.isArray(bVal) && Array.isArray(oVal)) {
        // Merge arrays.  For arrays of named objects, deduplicate by "name"
        // with override items winning.  For everything else, concatenate.
        const allNamed = [...bVal, ...oVal].every(
          (item) => item && typeof item === "object" && typeof item.name === "string"
        );
        if (allNamed) {
          const seen = new Set();
          const merged = [];
          // Process base first, then overrides (overrides replace dupes)
          for (const item of bVal) {
            seen.add(item.name);
            merged.push(item);
          }
          for (const item of oVal) {
            const idx = merged.findIndex((m) => m.name === item.name);
            if (idx >= 0) {
              merged[idx] = item; // override wins
            } else {
              merged.push(item);
            }
          }
          result[key] = merged;
        } else {
          result[key] = [...bVal, ...oVal];
        }
      } else if (bVal !== null && typeof bVal === "object" && !Array.isArray(bVal) &&
                 oVal !== null && typeof oVal === "object" && !Array.isArray(oVal)) {
        result[key] = deepMerge(bVal, oVal);
      } else {
        result[key] = oVal;
      }
    } else {
      result[key] = bVal;
    }
  }

  return result;
}

/**
 * Create default built-in parts that can be added to any composer.
 *
 * @param {object} options
 * @param {string} options.name       — project name
 * @param {string} [options.framework="node"] — "node" | "python" | "web"
 * @returns {object<string, PartDef>}
 */
function buildDefaultParts(options = {}) {
  const name = sanitizeName(options.name || "my-project");
  const framework = options.framework || "node";

  /** @type {Object<string, import('./composer').PartDef>} */
  const parts = {};

  // ── framework ────────────────────────────────────────────────────────────

  if (framework === "node") {
    parts.framework = {
      name: "framework",
      files: [
        {
          path: "package.json",
          content: JSON.stringify({
            name,
            version: "1.0.0",
            description: `${name} — a Node.js project`,
            main: "dist/index.js",
            scripts: {
              start: "node dist/index.js",
              build: "tsc",
            },
            keywords: ["hax-agent", "composable"],
            license: "MIT",
          }, null, 2) + "\n",
        },
        {
          path: "tsconfig.json",
          content: JSON.stringify({
            compilerOptions: {
              target: "ES2022",
              module: "commonjs",
              moduleResolution: "node",
              strict: true,
              esModuleInterop: true,
              skipLibCheck: true,
              outDir: "dist",
              rootDir: "src",
              declaration: true,
              sourceMap: true,
            },
            include: ["src/**/*"],
            exclude: ["node_modules", "dist", "test"],
          }, null, 2) + "\n",
        },
        {
          path: "src/index.ts",
          content: [
            `/**`,
            ` * ${name} — application entry point.`,
            ` */`,
            ``,
            `export function main(): void {`,
            `  console.log("${name} is running");`,
            `}`,
            ``,
            `if (require.main === module) {`,
            `  main();`,
            `}`,
            ``,
          ].join("\n"),
        },
      ],
      dependencies: [
        { name: "dotenv", version: "^16.4.0" },
      ],
      devDependencies: [
        { name: "typescript", version: "^5.4.0" },
        { name: "@types/node", version: "^20.11.0" },
      ],
      scripts: {
        build: "tsc",
        start: "node dist/index.js",
      },
    };
  } else if (framework === "python") {
    const moduleName = name.replace(/-/g, "_");
    parts.framework = {
      name: "framework",
      files: [
        {
          path: "pyproject.toml",
          content: [
            `[build-system]`,
            `requires = ["setuptools>=68", "wheel"]`,
            `build-backend = "setuptools.build_meta"`,
            ``,
            `[project]`,
            `name = "${name}"`,
            `version = "0.1.0"`,
            `description = "${name} — a Python project"`,
            `requires-python = ">=3.10"`,
            `dependencies = []`,
            ``,
            `[project.optional-dependencies]`,
            `dev = []`,
            ``,
          ].join("\n") + "\n",
        },
        {
          path: `src/${moduleName}/__init__.py`,
          content: `"""${name} package."""\n`,
        },
        {
          path: `src/${moduleName}/cli.py`,
          content: [
            `"""CLI entry point for ${name}."""`,
            `import click`,
            ``,
            `@click.group()`,
            `def main():`,
            `    """${name} CLI."""`,
            `    pass`,
            ``,
            `if __name__ == "__main__":`,
            `    main()`,
            ``,
          ].join("\n"),
        },
      ],
      dependencies: [
        { name: "click", version: ">=8.1" },
      ],
      devDependencies: [],
      scripts: {},
    };
  } else {
    // web — default to React
    parts.framework = {
      name: "framework",
      files: [
        {
          path: "package.json",
          content: JSON.stringify({
            name,
            version: "1.0.0",
            description: `${name} — a web application`,
            private: true,
            type: "module",
            scripts: {
              dev: "vite",
              build: "vite build",
              preview: "vite preview",
            },
            dependencies: {
              react: "^18.3.0",
              "react-dom": "^18.3.0",
            },
          }, null, 2) + "\n",
        },
        {
          path: "index.html",
          content: [
            `<!DOCTYPE html>`,
            `<html lang="en">`,
            `<head>`,
            `  <meta charset="UTF-8" />`,
            `  <meta name="viewport" content="width=device-width, initial-scale=1.0" />`,
            `  <title>${name}</title>`,
            `</head>`,
            `<body>`,
            `  <div id="app"></div>`,
            `  <script type="module" src="/src/main.jsx"></script>`,
            `</body>`,
            `</html>`,
            ``,
          ].join("\n"),
        },
        {
          path: "src/main.jsx",
          content: [
            `import React from "react";`,
            `import ReactDOM from "react-dom/client";`,
            `import App from "./App";`,
            ``,
            `ReactDOM.createRoot(document.getElementById("app")).render(`,
            `  <React.StrictMode>`,
            `    <App />`,
            `  </React.StrictMode>`,
            `);`,
            ``,
          ].join("\n"),
        },
        {
          path: "src/App.jsx",
          content: [
            `import React from "react";`,
            ``,
            `export default function App() {`,
            `  return (`,
            `    <div>`,
            `      <h1>${name}</h1>`,
            `    </div>`,
            `  );`,
            `}`,
            ``,
          ].join("\n"),
        },
        {
          path: "vite.config.js",
          content: [
            `import { defineConfig } from "vite";`,
            `import react from "@vitejs/plugin-react";`,
            ``,
            `export default defineConfig({`,
            `  plugins: [react()],`,
            `});`,
            ``,
          ].join("\n"),
        },
      ],
      dependencies: [
        { name: "react", version: "^18.3.0" },
        { name: "react-dom", version: "^18.3.0" },
      ],
      devDependencies: [
        { name: "vite", version: "^5.2.0" },
        { name: "@vitejs/plugin-react", version: "^4.2.0" },
      ],
      scripts: {
        dev: "vite",
        build: "vite build",
        preview: "vite preview",
      },
    };
  }

  // ── testing ──────────────────────────────────────────────────────────────

  parts.testing = {
    name: "testing",
    files: [
      {
        path: "test/index.test.ts",
        content: [
          `import { main } from "../src/index";`,
          ``,
          `describe("${name}", () => {`,
          `  it("main does not throw", () => {`,
          `    expect(() => main()).not.toThrow();`,
          `  });`,
          `});`,
          ``,
        ].join("\n"),
      },
      {
        path: "jest.config.js",
        content: [
          `"use strict";`,
          ``,
          `module.exports = {`,
          `  preset: "ts-jest",`,
          `  testEnvironment: "node",`,
          `  roots: ["<rootDir>/test"],`,
          `  testMatch: ["**/*.test.ts"],`,
          `  collectCoverageFrom: ["src/**/*.ts"],`,
          `  coverageDirectory: "coverage",`,
          `};`,
          ``,
        ].join("\n"),
      },
    ],
    dependencies: [],
    devDependencies: [
      { name: "jest", version: "^29.7.0" },
      { name: "@types/jest", version: "^29.5.0" },
      { name: "ts-jest", version: "^29.1.0" },
      { name: "@jest/globals", version: "^29.7.0" },
    ],
    scripts: {
      test: "jest",
      "test:coverage": "jest --coverage",
      "test:watch": "jest --watch",
    },
  };

  // ── linting ──────────────────────────────────────────────────────────────

  parts.linting = {
    name: "linting",
    files: [
      {
        path: ".eslintrc.json",
        content: JSON.stringify({
          parser: "@typescript-eslint/parser",
          plugins: ["@typescript-eslint"],
          extends: [
            "eslint:recommended",
            "plugin:@typescript-eslint/recommended",
          ],
          env: { node: true, jest: true, es2022: true },
          rules: {
            "no-console": "warn",
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
          },
        }, null, 2) + "\n",
      },
      {
        path: ".prettierrc",
        content: JSON.stringify({
          semi: true,
          singleQuote: false,
          tabWidth: 2,
          trailingComma: "all",
          printWidth: 100,
        }, null, 2) + "\n",
      },
    ],
    dependencies: [],
    devDependencies: [
      { name: "eslint", version: "^8.57.0" },
      { name: "@typescript-eslint/parser", version: "^7.0.0" },
      { name: "@typescript-eslint/eslint-plugin", version: "^7.0.0" },
      { name: "prettier", version: "^3.2.0" },
    ],
    scripts: {
      lint: "eslint src/",
      format: "prettier --write src/ test/",
      "lint:fix": "eslint src/ --fix",
    },
  };

  // ── ci ───────────────────────────────────────────────────────────────────

  parts.ci = {
    name: "ci",
    files: [
      {
        path: ".github/workflows/ci.yml",
        content: [
          `name: CI`,
          ``,
          `on:`,
          `  push:`,
          `    branches: [master, main]`,
          `  pull_request:`,
          `    branches: [master, main]`,
          ``,
          `jobs:`,
          `  test:`,
          `    runs-on: ubuntu-latest`,
          `    strategy:`,
          `      matrix:`,
          `        node-version: [18, 20, 22]`,
          `    steps:`,
          `      - uses: actions/checkout@v4`,
          `      - name: Use Node.js \${{ matrix.node-version }}`,
          `        uses: actions/setup-node@v4`,
          `        with:`,
          `          node-version: \${{ matrix.node-version }}`,
          `          cache: "npm"`,
          `      - run: npm ci`,
          `      - run: npm run build`,
          `      - run: npm test`,
          `      - run: npm run lint`,
          ``,
        ].join("\n") + "\n",
      },
    ],
    dependencies: [],
    devDependencies: [],
    scripts: {
      ci: "npm ci && npm run build && npm test && npm run lint",
    },
  };

  // ── docker ───────────────────────────────────────────────────────────────

  parts.docker = {
    name: "docker",
    files: [
      {
        path: "Dockerfile",
        content: [
          `# ---- Build stage ----`,
          `FROM node:22-alpine AS builder`,
          `WORKDIR /app`,
          `COPY package*.json ./`,
          `RUN npm ci`,
          `COPY . .`,
          `RUN npm run build`,
          ``,
          `# ---- Run stage ----`,
          `FROM node:22-alpine`,
          `WORKDIR /app`,
          `ENV NODE_ENV=production`,
          `COPY --from=builder /app/dist ./dist`,
          `COPY --from=builder /app/package*.json ./`,
          `RUN npm ci --omit=dev`,
          ``,
          `EXPOSE 3000`,
          `CMD ["node", "dist/index.js"]`,
          ``,
        ].join("\n"),
      },
      {
        path: ".dockerignore",
        content: [
          `node_modules`,
          `dist`,
          `coverage`,
          `.git`,
          `.env`,
          `*.log`,
          `.DS_Store`,
          ``,
        ].join("\n"),
      },
      {
        path: "docker-compose.yml",
        content: [
          `version: "3.8"`,
          ``,
          `services:`,
          `  app:`,
          `    build: .`,
          `    container_name: ${name}`,
          `    ports:`,
          `      - "3000:3000"`,
          `    environment:`,
          `      - NODE_ENV=production`,
          `    restart: unless-stopped`,
          ``,
        ].join("\n") + "\n",
      },
    ],
    dependencies: [],
    devDependencies: [],
    scripts: {
      "docker:build": "docker build -t " + name + " .",
      "docker:run": "docker run -p 3000:3000 " + name,
      "docker:compose": "docker compose up",
    },
  };

  // ── docs ─────────────────────────────────────────────────────────────────

  parts.docs = {
    name: "docs",
    files: [
      {
        path: "README.md",
        content: [
          `# ${name}`,
          ``,
          `> ${name} — a composable HaxAgent project.`,
          ``,
          `## Getting Started`,
          ``,
          `\`\`\`bash`,
          `npm install`,
          `npm run build`,
          `npm start`,
          `\`\`\``,
          ``,
          `## Scripts`,
          ``,
          `| Script       | Description              |`,
          `| ------------ | ------------------------ |`,
          `| \`npm test\`   | Run the test suite       |`,
          `| \`npm run lint\` | Run the linter         |`,
          `| \`npm run build\` | Compile TypeScript    |`,
          ``,
          `## License`,
          ``,
          `MIT`,
          ``,
        ].join("\n"),
      },
      {
        path: "CONTRIBUTING.md",
        content: [
          `# Contributing to ${name}`,
          ``,
          `We welcome contributions! Please follow these guidelines.`,
          ``,
          `## Development`,
          ``,
          `1. Fork the repository`,
          `2. Create a feature branch`,
          `3. Make your changes`,
          `4. Run tests: \`npm test\``,
          `5. Submit a pull request`,
          ``,
          `## Code Style`,
          ``,
          `- Use TypeScript strict mode`,
          `- Follow existing patterns`,
          `- Add tests for new functionality`,
          ``,
        ].join("\n"),
      },
      {
        path: "LICENSE",
        content: [
          `MIT License`,
          ``,
          `Copyright (c) ${new Date().getFullYear()}`,
          ``,
          `Permission is hereby granted, free of charge, to any person obtaining a copy`,
          `of this software and associated documentation files (the "Software"), to deal`,
          `in the Software without restriction, including without limitation the rights`,
          `to use, copy, modify, merge, publish, distribute, sublicense, and/or sell`,
          `copies of the Software, and to permit persons to whom the Software is`,
          `furnished to do so, subject to the following conditions:`,
          ``,
          `The above copyright notice and this permission notice shall be included in all`,
          `copies or substantial portions of the Software.`,
          ``,
          `THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR`,
          `IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,`,
          `FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE`,
          `AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER`,
          `LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,`,
          `OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE`,
          `SOFTWARE.`,
          ``,
        ].join("\n"),
      },
    ],
    dependencies: [],
    devDependencies: [],
    scripts: {},
  };

  // ── gitignore ────────────────────────────────────────────────────────────

  parts.gitignore = {
    name: "gitignore",
    files: [
      {
        path: ".gitignore",
        content: `node_modules/\ndist/\ncoverage/\n.env\n*.log\n.DS_Store\n`,
      },
    ],
    dependencies: [],
    devDependencies: [],
    scripts: {},
  };

  // ── env ──────────────────────────────────────────────────────────────────

  parts.env = {
    name: "env",
    files: [
      {
        path: ".env",
        content: [
          `# ${name} environment configuration`,
          `# Generated by HaxAgent ProjectComposer`,
          ``,
          `NODE_ENV=development`,
          `PORT=3000`,
          `HOST=0.0.0.0`,
          ``,
          `# API Keys`,
          `API_KEY=your-api-key-here`,
          ``,
          `# Database`,
          `DB_HOST=localhost`,
          `DB_PORT=5432`,
          `DB_NAME=${name}`,
          `DB_USER=postgres`,
          ``,
          `# Logging`,
          `LOG_LEVEL=info`,
          `LOG_FORMAT=json`,
          ``,
        ].join("\n"),
      },
      {
        path: ".env.example",
        content: [
          `NODE_ENV=development`,
          `PORT=3000`,
          `HOST=0.0.0.0`,
          `API_KEY=`,
          `DB_HOST=localhost`,
          `DB_PORT=5432`,
          `DB_NAME=`,
          `DB_USER=postgres`,
          `LOG_LEVEL=info`,
          `LOG_FORMAT=json`,
          ``,
        ].join("\n"),
      },
    ],
    dependencies: [],
    devDependencies: [],
    scripts: {},
  };

  return parts;
}

// ── ProjectComposer ─────────────────────────────────────────────────────────

/**
 * @typedef {object} PartFile
 * @property {string} path     — relative file path within the project
 * @property {string} content  — file content (already rendered)
 */

/**
 * @typedef {object} Dependency
 * @property {string} name
 * @property {string} version
 */

/**
 * @typedef {object} PartDef
 * @property {string} name
 * @property {PartFile[]} files
 * @property {Dependency[]} dependencies
 * @property {Dependency[]} devDependencies
 * @property {Object<string, string>} scripts
 */

class ProjectComposer {
  /**
   * @param {object} [options]
   * @param {string} [options.outputDir]  — default output root (default: cwd)
   * @param {string} [options.framework]  — "node" | "python" | "web" (default: "node")
   */
  constructor(options = {}) {
    /** @type {string} */
    this._outputDir = options.outputDir || process.cwd();

    /** @type {string} */
    this._framework = options.framework || "node";

    /** @type {Map<string, PartDef>} name -> part definition */
    this._parts = new Map();
  }

  // ---------------------------------------------------------------------------
  // addPart(part)
  // ---------------------------------------------------------------------------

  /**
   * Add a project component part to the composer.
   *
   * A part is an object with name, files, dependencies, devDependencies, and
   * scripts.  Adding a part with the same name overwrites any existing one.
   *
   * @param {PartDef} part
   * @returns {this}
   */
  addPart(part) {
    if (!part || typeof part !== "object") {
      throw new TypeError("ProjectComposer.addPart: part must be an object");
    }
    if (!part.name || typeof part.name !== "string") {
      throw new TypeError("ProjectComposer.addPart: part.name must be a non-empty string");
    }
    if (!Array.isArray(part.files)) {
      throw new TypeError("ProjectComposer.addPart: part.files must be an array");
    }

    // Validate each file entry
    for (let i = 0; i < part.files.length; i++) {
      const f = part.files[i];
      if (!f || !f.path || typeof f.path !== "string") {
        throw new TypeError(`ProjectComposer.addPart: part "${part.name}" file[${i}] missing valid "path"`);
      }
      if (typeof f.content !== "string") {
        throw new TypeError(`ProjectComposer.addPart: part "${part.name}" file[${i}] ("${f.path}") missing valid "content"`);
      }
    }

    this._parts.set(part.name, {
      name: part.name,
      files: [...part.files],
      dependencies: Array.isArray(part.dependencies) ? [...part.dependencies] : [],
      devDependencies: Array.isArray(part.devDependencies) ? [...part.devDependencies] : [],
      scripts: part.scripts && typeof part.scripts === "object" ? { ...part.scripts } : {},
    });

    return this;
  }

  /**
   * Add one or more built-in parts by name.  Uses sensible defaults for each.
   *
   * @param {string|string[]} partNames  — e.g. "framework", ["testing", "linting"]
   * @param {object} [options]           — passed to default part builders
   * @returns {this}
   */
  addBuiltinParts(partNames, options = {}) {
    const names = Array.isArray(partNames) ? partNames : [partNames];
    const name = sanitizeName(options.name || "my-project");
    const defaults = buildDefaultParts({ ...options, name, framework: this._framework });

    for (const n of names) {
      if (!defaults[n]) {
        throw new Error(`ProjectComposer.addBuiltinParts: unknown built-in part "${n}"`);
      }
      this.addPart(defaults[n]);
    }

    return this;
  }

  // ---------------------------------------------------------------------------
  // getParts()
  // ---------------------------------------------------------------------------

  /**
   * List all registered parts with summary info.
   *
   * @returns {Array<{ name: string, fileCount: number, depCount: number, devDepCount: number, scriptNames: string[] }>}
   */
  getParts() {
    const result = [];
    for (const [, part] of this._parts) {
      result.push({
        name: part.name,
        fileCount: part.files.length,
        depCount: part.dependencies.length,
        devDepCount: part.devDependencies.length,
        scriptNames: Object.keys(part.scripts),
      });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  // ---------------------------------------------------------------------------
  // compose(options)
  // ---------------------------------------------------------------------------

  /**
   * Generate a complete project by composing all registered parts.
   *
   * This resolves file conflicts (later parts win for the same path),
   * merges dependencies, devDependencies, and scripts, writes all files
   * to disk, and returns a result object.
   *
   * @param {object} options
   * @param {string} options.name         — project name
   * @param {string} [options.outputDir]  — override output directory
   * @param {string} [options.description] — project description
   * @returns {{ projectDir: string, files: string[], scripts: object, dependencies: object[] }}
   */
  compose(options = {}) {
    const name = sanitizeName(options.name || "my-project");
    const outputDir = options.outputDir || this._outputDir;
    const projectDir = path.resolve(outputDir, name);

    // Ensure the project directory exists
    fs.mkdirSync(projectDir, { recursive: true });

    // Collect all parts: built-in defaults + user-registered
    const allParts = [];
    for (const [, part] of this._parts) {
      allParts.push(part);
    }

    // Merge files: later parts win for the same path
    /** @type {Map<string, PartFile>} */
    const fileMap = new Map();
    /** @type {Dependency[]} */
    const allDeps = [];
    /** @type {Dependency[]} */
    const allDevDeps = [];
    /** @type {Object<string, string>} */
    const allScripts = {};

    for (const part of allParts) {
      for (const f of part.files) {
        fileMap.set(f.path, f);
      }
      for (const d of part.dependencies) {
        // Deduplicate: later part with same name overwrites version
        const idx = allDeps.findIndex((e) => e.name === d.name);
        if (idx >= 0) {
          allDeps.splice(idx, 1);
        }
        allDeps.push(d);
      }
      for (const d of part.devDependencies) {
        const idx = allDevDeps.findIndex((e) => e.name === d.name);
        if (idx >= 0) {
          allDevDeps.splice(idx, 1);
        }
        allDevDeps.push(d);
      }
      Object.assign(allScripts, part.scripts);
    }

    // Update package.json with merged deps and scripts if it exists
    const pkgFile = fileMap.get("package.json");
    if (pkgFile) {
      try {
        const pkg = JSON.parse(pkgFile.content);
        if (allDeps.length > 0) {
          pkg.dependencies = pkg.dependencies || {};
          for (const d of allDeps) {
            pkg.dependencies[d.name] = d.version;
          }
        }
        if (allDevDeps.length > 0) {
          pkg.devDependencies = pkg.devDependencies || {};
          for (const d of allDevDeps) {
            pkg.devDependencies[d.name] = d.version;
          }
        }
        Object.assign(pkg.scripts, allScripts);
        if (options.description) {
          pkg.description = options.description;
        }
        pkgFile.content = JSON.stringify(pkg, null, 2) + "\n";
      } catch (_) {
        // If package.json isn't valid JSON, leave it as-is
      }
    }

    // Write all files to disk
    const fileGen = new FileGenerator({ cwd: projectDir });
    const writtenFiles = [];

    for (const [filePath, fileDef] of fileMap) {
      fileGen.generateFromSpec({
        path: filePath,
        template: fileDef.content,
        variables: {},
        overwrite: true,
        createDirs: true,
      });
      writtenFiles.push(path.join(projectDir, filePath));
    }

    // Sort for determinism
    const sortedDeps = [...allDeps].sort((a, b) => a.name.localeCompare(b.name));
    const sortedDevDeps = [...allDevDeps].sort((a, b) => a.name.localeCompare(b.name));

    return {
      projectDir,
      files: writtenFiles.sort(),
      scripts: allScripts,
      dependencies: sortedDeps,
      devDependencies: sortedDevDeps,
    };
  }

  // ---------------------------------------------------------------------------
  // preview(options)
  // ---------------------------------------------------------------------------

  /**
   * Dry-run preview of what compose() would generate, without writing to disk.
   *
   * @param {object} options
   * @param {string} options.name         — project name
   * @param {string} [options.outputDir]  — override output directory
   * @param {string} [options.description] — project description
   * @returns {{
   *   projectDir: string,
   *   files: Array<{ path: string, size: number }>,
   *   scripts: object,
   *   dependencies: object[],
   *   devDependencies: object[],
   *   totalFiles: number,
   *   totalSize: number
   * }}
   */
  preview(options = {}) {
    const name = sanitizeName(options.name || "my-project");
    const outputDir = options.outputDir || this._outputDir;
    const projectDir = path.resolve(outputDir, name);

    // Collect and merge files (same logic as compose, but no disk writes)
    const fileMap = new Map();
    /** @type {Dependency[]} */
    const allDeps = [];
    /** @type {Dependency[]} */
    const allDevDeps = [];
    const allScripts = {};

    for (const [, part] of this._parts) {
      for (const f of part.files) {
        fileMap.set(f.path, f);
      }
      for (const d of part.dependencies) {
        const idx = allDeps.findIndex((e) => e.name === d.name);
        if (idx >= 0) allDeps.splice(idx, 1);
        allDeps.push(d);
      }
      for (const d of part.devDependencies) {
        const idx = allDevDeps.findIndex((e) => e.name === d.name);
        if (idx >= 0) allDevDeps.splice(idx, 1);
        allDevDeps.push(d);
      }
      Object.assign(allScripts, part.scripts);
    }

    // Update package.json deps/scripts in preview
    const pkgFile = fileMap.get("package.json");
    if (pkgFile) {
      try {
        const pkg = JSON.parse(pkgFile.content);
        if (allDeps.length > 0) {
          pkg.dependencies = pkg.dependencies || {};
          for (const d of allDeps) pkg.dependencies[d.name] = d.version;
        }
        if (allDevDeps.length > 0) {
          pkg.devDependencies = pkg.devDependencies || {};
          for (const d of allDevDeps) pkg.devDependencies[d.name] = d.version;
        }
        Object.assign(pkg.scripts, allScripts);
        if (options.description) pkg.description = options.description;
        pkgFile.content = JSON.stringify(pkg, null, 2) + "\n";
      } catch (_) { /* ignore */ }
    }

    // Build file preview list
    let totalSize = 0;
    const files = [];
    for (const [fp, fd] of fileMap) {
      const size = Buffer.byteLength(fd.content, "utf-8");
      totalSize += size;
      files.push({ path: fp, size });
    }

    const sortedDeps = [...allDeps].sort((a, b) => a.name.localeCompare(b.name));
    const sortedDevDeps = [...allDevDeps].sort((a, b) => a.name.localeCompare(b.name));

    return {
      projectDir,
      files: files.sort((a, b) => a.path.localeCompare(b.path)),
      scripts: allScripts,
      dependencies: sortedDeps,
      devDependencies: sortedDevDeps,
      totalFiles: files.length,
      totalSize,
    };
  }

  // ---------------------------------------------------------------------------
  // removePart(name)
  // ---------------------------------------------------------------------------

  /**
   * Remove a part from the composer by name.
   *
   * @param {string} name
   * @returns {boolean} true if removed, false if not found
   */
  removePart(name) {
    return this._parts.delete(name);
  }

  /**
   * Return the number of registered parts.
   *
   * @returns {number}
   */
  get partCount() {
    return this._parts.size;
  }
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  ProjectComposer,
  buildDefaultParts,
  deepMerge,
  sanitizeName,
};
