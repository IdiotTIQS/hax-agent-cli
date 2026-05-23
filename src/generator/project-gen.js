"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { TemplateRegistry } = require("./templates");
const { FileGenerator } = require("./file-gen");

/**
 * ProjectGenerator
 *
 * Generates complete project scaffolds for different runtime ecosystems.
 * Each generation method produces the full set of boilerplate files needed
 * to start developing immediately.
 *
 * Supported project types:
 *   - Node.js / TypeScript (with ESLint, Jest)
 *   - Python (with setuptools, pytest)
 *   - Web app (React, Vue, or Svelte)
 *   - CLI tool
 *   - HaxAgent plugin
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
 * Create a directory (recursive) and return its absolute path.
 *
 * @param {string} base
 * @param {string} name
 * @returns {string}
 */
function makeDir(base, name) {
  const dir = path.resolve(base, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── ProjectGenerator ─────────────────────────────────────────────────────────

class ProjectGenerator {
  /**
   * @param {object} [options]
   * @param {string} [options.outputDir] — default output root (default: cwd)
   */
  constructor(options = {}) {
    /** @type {string} */
    this._outputDir = options.outputDir || process.cwd();

    /** @type {TemplateRegistry} */
    this._templates = new TemplateRegistry();

    /** @type {FileGenerator} */
    this._fileGen = new FileGenerator({ cwd: this._outputDir });
  }

  // ---------------------------------------------------------------------------
  // generate(options) — dispatcher
  // ---------------------------------------------------------------------------

  /**
   * Generate a project of the given type.  Delegates to the appropriate
   * specialised method.
   *
   * @param {object} options
   * @param {string} options.type     — "node" | "python" | "web" | "cli" | "plugin"
   * @param {string} options.name     — project name
   * @param {string} [options.outputDir] — override default output directory
   * @param {object} [options.extra]  — type-specific overrides
   * @returns {{ projectDir: string, files: string[] }}
   */
  generate(options = {}) {
    const type = options.type || "node";
    const opts = { ...options };

    switch (type) {
      case "node":
        return this.generateNodeProject(opts);
      case "python":
        return this.generatePythonProject(opts);
      case "web":
        return this.generateWebApp(opts);
      case "cli":
        return this.generateCLI(opts);
      case "plugin":
        return this.generatePlugin(opts);
      default:
        throw new Error(`ProjectGenerator.generate: unknown project type "${type}"`);
    }
  }

  // ---------------------------------------------------------------------------
  // generateNodeProject
  // ---------------------------------------------------------------------------

  /**
   * Scaffold a Node.js project with TypeScript, ESLint, and Jest.
   *
   * @param {object} options
   * @param {string} options.name         — project name (kebab-case)
   * @param {string} [options.description] — package description
   * @param {string} [options.outputDir]  — where to create the project
   * @param {object} [options.extra]      — additional overrides
   * @returns {{ projectDir: string, files: string[] }}
   */
  generateNodeProject(options = {}) {
    const name = sanitizeName(options.name || "my-node-app");
    const outputDir = options.outputDir || this._outputDir;
    const projectDir = makeDir(outputDir, name);
    const desc = options.description || `${name} — a Node.js project`;

    const fileGen = new FileGenerator({ cwd: projectDir });
    const writtenFiles = [];

    // package.json — use pre-formatted dependency blocks for valid JSON
    const deps = [
      { name: "dotenv", version: "^16.4.0" },
    ];
    const devDeps = [
      { name: "typescript", version: "^5.4.0" },
      { name: "@types/node", version: "^20.11.0" },
      { name: "jest", version: "^29.7.0" },
      { name: "@types/jest", version: "^29.5.0" },
      { name: "ts-jest", version: "^29.1.0" },
      { name: "eslint", version: "^8.57.0" },
      { name: "@typescript-eslint/parser", version: "^7.0.0" },
    ];

    const depsBlock = deps.length > 0
      ? `,\n  "dependencies": {\n${deps.map((d, i) =>
          `    "${d.name}": "${d.version}"${i < deps.length - 1 ? "," : ""}`
        ).join("\n")}\n  }`
      : "";
    const devDepsBlock = devDeps.length > 0
      ? `,\n  "devDependencies": {\n${devDeps.map((d, i) =>
          `    "${d.name}": "${d.version}"${i < devDeps.length - 1 ? "," : ""}`
        ).join("\n")}\n  }`
      : "";

    const pkgVars = {
      name,
      version: "1.0.0",
      description: desc,
      main: "dist/index.js",
      startScript: "node dist/index.js",
      testScript: "jest",
      buildScript: "tsc",
      lintScript: "eslint src/",
      keywordsBlock: `"keywords": ["hax-agent", "node"],`,
      author: options.author || "",
      license: options.license || "MIT",
      dependenciesBlock: depsBlock,
      devDependenciesBlock: devDepsBlock,
    };

    const pkgContent = this._templates.generate("package.json", pkgVars);
    const pkgPath = path.join(projectDir, "package.json");
    fileGen.generateFromSpec({
      path: "package.json",
      template: pkgContent,
      variables: {},
      overwrite: true,
      createDirs: false,
    });
    writtenFiles.push(pkgPath);

    // tsconfig.json — use pre-formatted blocks
    const tsVars = {
      target: "ES2022",
      module: "commonjs",
      moduleResolution: "node",
      strict: "true",
      esModuleInterop: "true",
      skipLibCheck: "true",
      outDir: "dist",
      rootDir: "src",
      declaration: "true",
      sourceMap: "true",
      jsxBlock: "",
      pathsBlock: "",
      include: `"src/**/*"`,
      exclude: `"node_modules", "dist", "test"`,
    };

    const tsContent = this._templates.generate("tsconfig.json", tsVars);
    fileGen.generateFromSpec({
      path: "tsconfig.json",
      template: tsContent,
      variables: {},
      overwrite: true,
      createDirs: false,
    });
    writtenFiles.push(path.join(projectDir, "tsconfig.json"));

    // jest.config.js
    const jestConfig = [
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
    ].join("\n");
    fileGen.generateFromSpec({
      path: "jest.config.js",
      template: jestConfig,
      variables: {},
      overwrite: true,
      createDirs: false,
    });
    writtenFiles.push(path.join(projectDir, "jest.config.js"));

    // .eslintrc.json
    const eslintConfig = JSON.stringify({
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
    }, null, 2);
    fileGen.generateFromSpec({
      path: ".eslintrc.json",
      template: eslintConfig,
      variables: {},
      overwrite: true,
      createDirs: false,
    });
    writtenFiles.push(path.join(projectDir, ".eslintrc.json"));

    // .env
    const envVars = {
      name,
      nodeEnv: "development",
      port: "3000",
      host: "0.0.0.0",
      apiKeys: [{ key: "API_KEY", value: "your-api-key-here" }],
      dbHost: "localhost",
      dbPort: "5432",
      dbName: name,
      dbUser: "postgres",
      logLevel: "info",
      logFormat: "json",
      featureFlags: [
        { name: "FEATURE_DEBUG", enabled: "false" },
      ],
    };
    const envContent = this._templates.generate(".env", envVars);
    fileGen.generateFromSpec({
      path: ".env",
      template: envContent,
      variables: {},
      overwrite: true,
      createDirs: false,
    });
    writtenFiles.push(path.join(projectDir, ".env"));

    // .gitignore
    const gitignore = [
      "node_modules/",
      "dist/",
      "coverage/",
      ".env",
      "*.log",
      ".DS_Store",
      "",
    ].join("\n");
    fileGen.generateFromSpec({
      path: ".gitignore",
      template: gitignore,
      variables: {},
      overwrite: true,
      createDirs: false,
    });
    writtenFiles.push(path.join(projectDir, ".gitignore"));

    // Source files
    const srcDir = path.join(projectDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });

    const indexTs = [
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
    ].join("\n");
    fileGen.generateFromSpec({
      path: "src/index.ts",
      template: indexTs,
      variables: {},
      overwrite: true,
      createDirs: true,
    });
    writtenFiles.push(path.join(projectDir, "src", "index.ts"));

    // Test files
    const testDir = path.join(projectDir, "test");
    fs.mkdirSync(testDir, { recursive: true });

    const indexTest = [
      `import { main } from "../src/index";`,
      ``,
      `describe("${name}", () => {`,
      `  it("main does not throw", () => {`,
      `    expect(() => main()).not.toThrow();`,
      `  });`,
      `});`,
      ``,
    ].join("\n");
    fileGen.generateFromSpec({
      path: "test/index.test.ts",
      template: indexTest,
      variables: {},
      overwrite: true,
      createDirs: true,
    });
    writtenFiles.push(path.join(projectDir, "test", "index.test.ts"));

    return { projectDir, files: writtenFiles };
  }

  // ---------------------------------------------------------------------------
  // generatePythonProject
  // ---------------------------------------------------------------------------

  /**
   * Scaffold a Python project with setuptools and pytest.
   *
   * @param {object} options
   * @param {string} options.name         — project name
   * @param {string} [options.description]
   * @param {string} [options.outputDir]
   * @param {object} [options.extra]
   * @returns {{ projectDir: string, files: string[] }}
   */
  generatePythonProject(options = {}) {
    const name = sanitizeName(options.name || "my-python-app");
    const moduleName = name.replace(/-/g, "_");
    const outputDir = options.outputDir || this._outputDir;
    const projectDir = makeDir(outputDir, name);
    const desc = options.description || `${name} — a Python project`;

    const fileGen = new FileGenerator({ cwd: projectDir });
    const writtenFiles = [];

    // setup.py
    const setupPy = [
      `"""`,
      `${name} — ${desc}`,
      `"""`,
      `from setuptools import setup, find_packages`,
      ``,
      `setup(`,
      `    name="${name}",`,
      `    version="${options.version || "0.1.0"}",`,
      `    description="${desc}",`,
      `    author="${options.author || ""}",`,
      `    packages=find_packages(where="src"),`,
      `    package_dir={"": "src"},`,
      `    python_requires=">=${options.pythonVersion || "3.10"}",`,
      `    install_requires=[`,
      `        "click>=8.1",`,
      `    ],`,
      `    extras_require={`,
      `        "dev": [`,
      `            "pytest>=8.0",`,
      `            "pytest-cov>=4.0",`,
      `            "ruff>=0.3",`,
      `            "mypy>=1.8",`,
      `        ],`,
      `    },`,
      `    entry_points={`,
      `        "console_scripts": [`,
      `            "${name}=${moduleName}.cli:main",`,
      `        ],`,
      `    },`,
      `)`,
      ``,
    ].join("\n");
    fileGen.generateFromSpec({
      path: "setup.py", template: setupPy, variables: {},
      overwrite: true, createDirs: false,
    });
    writtenFiles.push(path.join(projectDir, "setup.py"));

    // pyproject.toml
    const pyprojectToml = `[build-system]
requires = ["setuptools>=68", "wheel"]
build-backend = "setuptools.build_meta"

[tool.pytest.ini_options]
testpaths = ["test"]
addopts = ["-v", "--tb=short", "--strict-markers"]

[tool.ruff]
line-length = 100
target-version = "py310"

[tool.mypy]
strict = true
ignore_missing_imports = true
`;
    fileGen.generateFromSpec({
      path: "pyproject.toml", template: pyprojectToml, variables: {},
      overwrite: true, createDirs: false,
    });
    writtenFiles.push(path.join(projectDir, "pyproject.toml"));

    // requirements.txt
    fileGen.generateFromSpec({
      path: "requirements.txt",
      template: "# Core dependencies\nclick>=8.1\n\n# Dev dependencies (install with pip install -r requirements-dev.txt)\n",
      variables: {}, overwrite: true, createDirs: false,
    });
    writtenFiles.push(path.join(projectDir, "requirements.txt"));

    // requirements-dev.txt
    fileGen.generateFromSpec({
      path: "requirements-dev.txt",
      template: "-r requirements.txt\npytest>=8.0\npytest-cov>=4.0\nruff>=0.3\nmypy>=1.8\n",
      variables: {}, overwrite: true, createDirs: false,
    });
    writtenFiles.push(path.join(projectDir, "requirements-dev.txt"));

    // .gitignore
    const gitignore = [
      "__pycache__/", "*.py[cod]", "*$py.class",
      "*.egg-info/", "dist/", "build/",
      ".pytest_cache/", ".mypy_cache/", ".ruff_cache/",
      ".coverage", "coverage.xml", "htmlcov/",
      ".venv/", "venv/", "*.log", ".env", ".DS_Store", "",
    ].join("\n");
    fileGen.generateFromSpec({
      path: ".gitignore", template: gitignore, variables: {},
      overwrite: true, createDirs: false,
    });
    writtenFiles.push(path.join(projectDir, ".gitignore"));

    // src/pkg/__init__.py
    const srcPkg = path.join(projectDir, "src", moduleName);
    fs.mkdirSync(srcPkg, { recursive: true });
    fs.writeFileSync(path.join(srcPkg, "__init__.py"), `"""${name} package."""\n`, "utf-8");
    writtenFiles.push(path.join(srcPkg, "__init__.py"));

    // src/pkg/cli.py
    const cliPy = [
      `"""CLI entry point for ${name}."""`,
      `import click`,
      ``,
      `@click.group()`,
      `def main():`,
      `    """${desc}"""`,
      `    pass`,
      ``,
      `@main.command()`,
      `@click.argument("name", default="World")`,
      `def greet(name):`,
      `    """Print a greeting."""`,
      `    click.echo(f"Hello, {name}!")`,
      ``,
      `if __name__ == "__main__":`,
      `    main()`,
      ``,
    ].join("\n");
    fileGen.generateFromSpec({
      path: path.join("src", moduleName, "cli.py"),
      template: cliPy, variables: {},
      overwrite: true, createDirs: true,
    });
    writtenFiles.push(path.join(srcPkg, "cli.py"));

    // test/test_cli.py
    const testDir = path.join(projectDir, "test");
    fs.mkdirSync(testDir, { recursive: true });
    const testInit = path.join(testDir, "__init__.py");
    fs.writeFileSync(testInit, "", "utf-8");
    writtenFiles.push(testInit);

    const testCli = [
      `"""Tests for ${name} CLI."""`,
      `from click.testing import CliRunner`,
      `from ${moduleName}.cli import main`,
      ``,
      `def test_greet():`,
      `    runner = CliRunner()`,
      `    result = runner.invoke(main, ["greet", "Hax"])`,
      `    assert result.exit_code == 0`,
      `    assert "Hello, Hax!" in result.output`,
      ``,
    ].join("\n");
    fileGen.generateFromSpec({
      path: "test/test_cli.py",
      template: testCli, variables: {},
      overwrite: true, createDirs: true,
    });
    writtenFiles.push(path.join(projectDir, "test", "test_cli.py"));

    return { projectDir, files: writtenFiles };
  }

  // ---------------------------------------------------------------------------
  // generateWebApp
  // ---------------------------------------------------------------------------

  /**
   * Scaffold a web application (React, Vue, or Svelte).
   *
   * @param {object} options
   * @param {string} options.name          — project name
   * @param {"react"|"vue"|"svelte"} [options.framework="react"]
   * @param {string} [options.description]
   * @param {string} [options.outputDir]
   * @param {object} [options.extra]
   * @returns {{ projectDir: string, files: string[] }}
   */
  generateWebApp(options = {}) {
    const name = sanitizeName(options.name || "my-web-app");
    const framework = options.framework || "react";
    const outputDir = options.outputDir || this._outputDir;
    const projectDir = makeDir(outputDir, name);
    const desc = options.description || `${name} — a ${framework} web application`;

    const fileGen = new FileGenerator({ cwd: projectDir });
    const writtenFiles = [];

    // package.json
    const pkgContent = JSON.stringify({
      name,
      version: "1.0.0",
      description: desc,
      private: true,
      scripts: {
        dev: "vite",
        build: "vite build",
        preview: "vite preview",
        test: "vitest run",
        lint: "eslint src/",
      },
      dependencies: {
        ...(framework === "react" ? { react: "^18.3.0", "react-dom": "^18.3.0" } : {}),
        ...(framework === "vue" ? { vue: "^3.4.0" } : {}),
        ...(framework === "svelte" ? { svelte: "^4.2.0" } : {}),
      },
    }, null, 2);
    fileGen.generateFromSpec({
      path: "package.json", template: pkgContent, variables: {},
      overwrite: true, createDirs: false,
    });
    writtenFiles.push(path.join(projectDir, "package.json"));

    // vite.config.js
    const viteImports = framework === "react"
      ? `import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";`
      : framework === "vue"
        ? `import { defineConfig } from "vite";\nimport vue from "@vitejs/plugin-vue";`
        : `import { defineConfig } from "vite";\nimport { svelte } from "@sveltejs/vite-plugin-svelte";`;

    const vitePlugins = framework === "react"
      ? `[react()]`
      : framework === "vue"
        ? `[vue()]`
        : `[svelte()]`;

    fileGen.generateFromSpec({
      path: "vite.config.js",
      template: `${viteImports}\n\nexport default defineConfig({\n  plugins: ${vitePlugins},\n});\n`,
      variables: {}, overwrite: true, createDirs: false,
    });
    writtenFiles.push(path.join(projectDir, "vite.config.js"));

    // index.html
    const indexHtml = [
      `<!DOCTYPE html>`,
      `<html lang="en">`,
      `<head>`,
      `  <meta charset="UTF-8" />`,
      `  <meta name="viewport" content="width=device-width, initial-scale=1.0" />`,
      `  <title>${name}</title>`,
      `</head>`,
      `<body>`,
      `  <div id="app"></div>`,
      `  <script type="module" src="/src/main.${framework === "svelte" ? "js" : framework === "vue" ? "js" : "jsx"}"></script>`,
      `</body>`,
      `</html>`,
      ``,
    ].join("\n");
    fileGen.generateFromSpec({
      path: "index.html", template: indexHtml, variables: {},
      overwrite: true, createDirs: false,
    });
    writtenFiles.push(path.join(projectDir, "index.html"));

    // .gitignore
    fileGen.generateFromSpec({
      path: ".gitignore",
      template: "node_modules/\ndist/\n.env\n*.log\n.DS_Store\n",
      variables: {}, overwrite: true, createDirs: false,
    });
    writtenFiles.push(path.join(projectDir, ".gitignore"));

    // src/main entry
    const srcDir = path.join(projectDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });

    if (framework === "react") {
      const mainJsx = [
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
      ].join("\n");
      fileGen.generateFromSpec({
        path: "src/main.jsx", template: mainJsx, variables: {},
        overwrite: true, createDirs: true,
      });
      writtenFiles.push(path.join(srcDir, "main.jsx"));

      const appJsx = [
        `import React from "react";`,
        ``,
        `export default function App() {`,
        `  return (`,
        `    <div>`,
        `      <h1>${name}</h1>`,
        `      <p>${desc}</p>`,
        `    </div>`,
        `  );`,
        `}`,
        ``,
      ].join("\n");
      fileGen.generateFromSpec({
        path: "src/App.jsx", template: appJsx, variables: {},
        overwrite: true, createDirs: true,
      });
      writtenFiles.push(path.join(srcDir, "App.jsx"));
    } else if (framework === "vue") {
      const mainJs = [
        `import { createApp } from "vue";`,
        `import App from "./App.vue";`,
        ``,
        `createApp(App).mount("#app");`,
        ``,
      ].join("\n");
      fileGen.generateFromSpec({
        path: "src/main.js", template: mainJs, variables: {},
        overwrite: true, createDirs: true,
      });
      writtenFiles.push(path.join(srcDir, "main.js"));

      const appVue = [
        `<script setup>`,
        `const name = "${name}";`,
        `</script>`,
        ``,
        `<template>`,
        `  <div>`,
        `    <h1>{{ name }}</h1>`,
        `    <p>${desc}</p>`,
        `  </div>`,
        `</template>`,
        ``,
      ].join("\n");
      fileGen.generateFromSpec({
        path: "src/App.vue", template: appVue, variables: {},
        overwrite: true, createDirs: true,
      });
      writtenFiles.push(path.join(srcDir, "App.vue"));
    } else {
      // Svelte
      const mainJs = [
        `import App from "./App.svelte";`,
        ``,
        `const app = new App({ target: document.getElementById("app") });`,
        ``,
        `export default app;`,
        ``,
      ].join("\n");
      fileGen.generateFromSpec({
        path: "src/main.js", template: mainJs, variables: {},
        overwrite: true, createDirs: true,
      });
      writtenFiles.push(path.join(srcDir, "main.js"));

      const appSvelte = [
        `<script>`,
        `  let name = "${name}";`,
        `</script>`,
        ``,
        `<main>`,
        `  <h1>{name}</h1>`,
        `  <p>${desc}</p>`,
        `</main>`,
        ``,
      ].join("\n");
      fileGen.generateFromSpec({
        path: "src/App.svelte", template: appSvelte, variables: {},
        overwrite: true, createDirs: true,
      });
      writtenFiles.push(path.join(srcDir, "App.svelte"));
    }

    return { projectDir, files: writtenFiles };
  }

  // ---------------------------------------------------------------------------
  // generateCLI
  // ---------------------------------------------------------------------------

  /**
   * Scaffold a CLI tool project (Node.js based, binary in package.json).
   *
   * @param {object} options
   * @param {string} options.name         — tool name (used as the binary)
   * @param {string} [options.description]
   * @param {string} [options.outputDir]
   * @param {object} [options.extra]
   * @returns {{ projectDir: string, files: string[] }}
   */
  generateCLI(options = {}) {
    const name = sanitizeName(options.name || "my-cli");
    const outputDir = options.outputDir || this._outputDir;
    const projectDir = makeDir(outputDir, name);
    const desc = options.description || `${name} — a CLI tool`;

    const fileGen = new FileGenerator({ cwd: projectDir });
    const writtenFiles = [];

    // package.json
    const pkg = JSON.stringify({
      name,
      version: "1.0.0",
      description: desc,
      main: "dist/cli.js",
      bin: { [name]: "dist/cli.js" },
      files: ["dist/"],
      scripts: {
        build: "tsc",
        start: "node dist/cli.js",
        test: "jest",
        lint: "eslint src/",
        prepublishOnly: "npm run build",
      },
      dependencies: { commander: "^12.0.0" },
      devDependencies: {
        typescript: "^5.4.0",
        "@types/node": "^20.11.0",
        jest: "^29.7.0",
        "ts-jest": "^29.1.0",
        eslint: "^8.57.0",
      },
    }, null, 2);
    fileGen.generateFromSpec({
      path: "package.json", template: pkg, variables: {},
      overwrite: true, createDirs: false,
    });
    writtenFiles.push(path.join(projectDir, "package.json"));

    // tsconfig.json
    fileGen.generateFromSpec({
      path: "tsconfig.json",
      template: JSON.stringify({
        compilerOptions: {
          target: "ES2022", module: "commonjs",
          outDir: "dist", rootDir: "src",
          strict: true, esModuleInterop: true,
          declaration: true, sourceMap: true,
        },
        include: ["src/**/*"],
      }, null, 2),
      variables: {}, overwrite: true, createDirs: false,
    });
    writtenFiles.push(path.join(projectDir, "tsconfig.json"));

    // src/cli.ts
    const cliTs = [
      `#!/usr/bin/env node`,
      `"use strict";`,
      ``,
      `import { Command } from "commander";`,
      ``,
      `const program = new Command();`,
      ``,
      `program`,
      `  .name("${name}")`,
      `  .description("${desc}")`,
      `  .version("1.0.0");`,
      ``,
      `program`,
      `  .command("greet <name>")`,
      `  .description("Print a greeting")`,
      `  .action((name: string) => {`,
      `    console.log(\`Hello, \${name}!\`);`,
      `  });`,
      ``,
      `program.parse(process.argv);`,
      ``,
    ].join("\n");
    fileGen.generateFromSpec({
      path: "src/cli.ts", template: cliTs, variables: {},
      overwrite: true, createDirs: true,
    });
    writtenFiles.push(path.join(projectDir, "src", "cli.ts"));

    // .gitignore
    fileGen.generateFromSpec({
      path: ".gitignore",
      template: "node_modules/\ndist/\n.env\n*.log\n.DS_Store\n",
      variables: {}, overwrite: true, createDirs: false,
    });
    writtenFiles.push(path.join(projectDir, ".gitignore"));

    return { projectDir, files: writtenFiles };
  }

  // ---------------------------------------------------------------------------
  // generatePlugin
  // ---------------------------------------------------------------------------

  /**
   * Scaffold a HaxAgent plugin project.
   *
   * @param {object} options
   * @param {string} options.name         — plugin name (kebab-case)
   * @param {string} [options.description]
   * @param {string} [options.outputDir]
   * @param {object} [options.extra]
   * @returns {{ projectDir: string, files: string[] }}
   */
  generatePlugin(options = {}) {
    const name = sanitizeName(options.name || "my-plugin");
    const outputDir = options.outputDir || this._outputDir;
    const projectDir = makeDir(outputDir, name);
    const desc = options.description || `${name} — a HaxAgent plugin`;

    const fileGen = new FileGenerator({ cwd: projectDir });
    const writtenFiles = [];

    // package.json
    const pkg = JSON.stringify({
      name: `hax-agent-plugin-${name}`,
      version: "1.0.0",
      description: desc,
      main: "index.js",
      keywords: ["hax-agent", "plugin"],
      license: "MIT",
      peerDependencies: { "hax-agent": ">=1.4.0" },
      scripts: {
        test: "node --test",
        lint: "eslint .",
      },
    }, null, 2);
    fileGen.generateFromSpec({
      path: "package.json", template: pkg, variables: {},
      overwrite: true, createDirs: false,
    });
    writtenFiles.push(path.join(projectDir, "package.json"));

    // index.js — plugin module
    const pluginCode = [
      `"use strict";`,
      ``,
      `/**`,
      ` * ${name} — a HaxAgent plugin.`,
      ` *`,
      ` * ${desc}`,
      ` */`,
      ``,
      `// ── Hook implementations ───────────────────────────────────────`,
      ``,
      `/** @param {object} ctx @returns {object} */`,
      `function beforeToolCall(ctx) { return ctx; }`,
      ``,
      `/** @param {object} ctx @returns {object} */`,
      `function afterToolCall(ctx) { return ctx; }`,
      ``,
      `/** @param {object} ctx @returns {object} */`,
      `function onError(ctx) { return ctx; }`,
      ``,
      `/** @param {object} ctx @returns {object} */`,
      `function beforeChat(ctx) { return ctx; }`,
      ``,
      `/** @param {object} ctx @returns {object} */`,
      `function afterChat(ctx) { return ctx; }`,
      ``,
      `/** @param {object} ctx @returns {object} */`,
      `function onSessionStart(ctx) { return ctx; }`,
      ``,
      `/** @param {object} ctx @returns {object} */`,
      `function onSessionEnd(ctx) { return ctx; }`,
      ``,
      `// ── Plugin descriptor ───────────────────────────────────────────`,
      ``,
      `const plugin = {`,
      `  name: "${name}",`,
      `  version: "1.0.0",`,
      `  description: "${desc}",`,
      `  hooks: {`,
      `    beforeToolCall,`,
      `    afterToolCall,`,
      `    onError,`,
      `    beforeChat,`,
      `    afterChat,`,
      `    onSessionStart,`,
      `    onSessionEnd,`,
      `  },`,
      `};`,
      ``,
      `module.exports = plugin;`,
      `module.exports.register = function register(registry) {`,
      `  registry.register(plugin);`,
      `};`,
      ``,
    ].join("\n") + "\n";
    fileGen.generateFromSpec({
      path: "index.js", template: pluginCode, variables: {},
      overwrite: true, createDirs: false,
    });
    writtenFiles.push(path.join(projectDir, "index.js"));

    // test/basic.test.js
    const testDir = path.join(projectDir, "test");
    fs.mkdirSync(testDir, { recursive: true });

    const testCode = [
      `"use strict";`,
      ``,
      `const assert = require("node:assert/strict");`,
      `const test = require("node:test");`,
      `const plugin = require("../index");`,
      ``,
      `test("${name}: has expected shape", () => {`,
      `  assert.equal(typeof plugin, "object");`,
      `  assert.equal(plugin.name, "${name}");`,
      `  assert.equal(plugin.version, "1.0.0");`,
      `  assert.equal(typeof plugin.hooks, "object");`,
      `  assert.equal(typeof plugin.register, "function");`,
      `});`,
      ``,
      `test("${name}: hooks are pass-through", () => {`,
      `  const ctx = { session: { id: "test" }, message: "hello" };`,
      `  assert.strictEqual(plugin.hooks.beforeChat(ctx), ctx);`,
      `  assert.strictEqual(plugin.hooks.afterToolCall(ctx), ctx);`,
      `  assert.strictEqual(plugin.hooks.onSessionStart(ctx), ctx);`,
      `});`,
      ``,
      `test("${name}: register accepts registry object", () => {`,
      `  const registered = [];`,
      `  const registry = { register(p) { registered.push(p); } };`,
      `  plugin.register(registry);`,
      `  assert.equal(registered.length, 1);`,
      `  assert.strictEqual(registered[0], plugin);`,
      `});`,
      ``,
    ].join("\n") + "\n";
    fileGen.generateFromSpec({
      path: "test/basic.test.js", template: testCode, variables: {},
      overwrite: true, createDirs: true,
    });
    writtenFiles.push(path.join(testDir, "basic.test.js"));

    // .gitignore
    fileGen.generateFromSpec({
      path: ".gitignore",
      template: "node_modules/\n*.log\n.DS_Store\n",
      variables: {}, overwrite: true, createDirs: false,
    });
    writtenFiles.push(path.join(projectDir, ".gitignore"));

    return { projectDir, files: writtenFiles };
  }
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  ProjectGenerator,
  sanitizeName,
};
