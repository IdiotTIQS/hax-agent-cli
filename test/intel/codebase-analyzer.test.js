"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const {
  analyzeCodebase,
  getProjectType,
  getKeyFiles,
  getGitStats,
} = require("../../src/intel/codebase-analyzer");

async function createTempProject(files) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hax-cba-test-"));
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf8");
  }
  return dir;
}

test("analyzeCodebase counts files by extension and lines", async () => {
  const dir = await createTempProject({
    "src/index.js": `const a = 1;\nconst b = 2;\nmodule.exports = { a, b };\n`,
    "src/utils.js": `function add(x, y) { return x + y; }\n`,
    "test/index.test.js": `const t = require('node:test');\nt('test', () => {});\n`,
    "src/styles/main.css": `body { margin: 0; }\np { color: red; }\n`,
    "README.md": `# Project\n\nDescription\n`,
    "package.json": JSON.stringify({ name: "test-project" }),
  });

  try {
    const result = await analyzeCodebase(dir);

    // File counts
    assert.equal(result.summary.totalFiles, 6);

    // Extension counts
    assert.ok(result.filesByExtension[".js"] >= 3);
    assert.ok(result.filesByExtension[".css"] >= 1);
    assert.ok(result.filesByExtension[".md"] >= 1);
    assert.ok(result.filesByExtension[".json"] >= 1);

    // Lines
    assert.ok(result.summary.totalLines > 0);

    // Language detection
    assert.ok(result.languages["JavaScript"] >= 1);
    assert.ok(result.languages["CSS"] >= 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("analyzeCodebase detects test files", async () => {
  const dir = await createTempProject({
    "src/app.js": `// not a test\n`,
    "src/__tests__/app.test.js": `// test\n`,
    "test/unit.test.js": `// unit test\n`,
    "spec/server.spec.js": `// spec\n`,
  });

  try {
    const result = await analyzeCodebase(dir);
    assert.equal(result.testFileCount, 3);
    assert.equal(result.testFiles.length, 3);
    const testPaths = result.testFiles.map(f => f.path.replace(/\\/g, "/")).sort();
    assert.ok(testPaths.some(p => p.includes("app.test.js")));
    assert.ok(testPaths.some(p => p.includes("unit.test.js")));
    assert.ok(testPaths.some(p => p.includes("server.spec.js")));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("analyzeCodebase detects documentation files", async () => {
  const dir = await createTempProject({
    "README.md": "# Project",
    "CHANGELOG.md": "# Changelog",
    "CONTRIBUTING.md": "# Contributing",
    "LICENSE": "MIT",
    "docs/index.md": "# Docs",
    "src/code.js": "// code",
  });

  try {
    const result = await analyzeCodebase(dir);
    assert.ok(result.docFileCount >= 4);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("analyzeCodebase detects entry points", async () => {
  const dir = await createTempProject({
    "index.js": "// root index",
    "main.ts": "// main",
    "src/index.ts": "// src index",
    "src/helpers/random.ts": "// helper",
    "cli.js": "// cli",
  });

  try {
    const result = await analyzeCodebase(dir);
    const entryNames = result.entryPoints.map(e => e.path.replace(/\\/g, "/"));
    assert.ok(entryNames.includes("index.js"));
    assert.ok(entryNames.includes("main.ts"));
    assert.ok(entryNames.includes("src/index.ts"));
    assert.ok(entryNames.includes("cli.js"));
    assert.equal(entryNames.length, 4);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("analyzeCodebase handles empty directories gracefully", async () => {
  const dir = await createTempProject({
    "src/empty/README.txt": "placeholder",
  });

  try {
    const result = await analyzeCodebase(dir);
    assert.equal(result.summary.totalFiles, 1);
    assert.equal(result.summary.totalLines, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("getProjectType detects monorepo", async () => {
  const dir = await createTempProject({
    "package.json": JSON.stringify({ name: "monorepo" }),
    "packages/pkg-a/package.json": JSON.stringify({ name: "pkg-a" }),
    "packages/pkg-b/package.json": JSON.stringify({ name: "pkg-b" }),
    "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
  });

  try {
    const type = await getProjectType(dir);
    assert.equal(type, "monorepo");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("getProjectType detects web app with Vite", async () => {
  const dir = await createTempProject({
    "package.json": JSON.stringify({ scripts: { dev: "vite" } }),
    "vite.config.js": "export default {}",
    "index.html": "<!DOCTYPE html>",
    "src/main.js": "// entry",
  });

  try {
    const type = await getProjectType(dir);
    assert.ok(type.startsWith("web-app"));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("getProjectType detects Next.js app", async () => {
  const dir = await createTempProject({
    "package.json": JSON.stringify({ dependencies: { next: "latest" } }),
    "next.config.js": "module.exports = {}",
    "pages/index.js": "// page",
  });

  try {
    const type = await getProjectType(dir);
    assert.equal(type, "web-app: Next.js");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("getProjectType detects CLI project", async () => {
  const dir = await createTempProject({
    "package.json": JSON.stringify({
      name: "my-cli",
      bin: { "my-cli": "./cli.js" },
    }),
    "cli.js": "// cli entry",
  });

  try {
    const type = await getProjectType(dir);
    assert.equal(type, "cli");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("getProjectType detects Rust project", async () => {
  const dir = await createTempProject({
    "Cargo.toml": "[package]\nname = \"my-crate\"\n",
    "src/main.rs": "fn main() {}",
  });

  try {
    const type = await getProjectType(dir);
    assert.equal(type, "rust");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("getKeyFiles identifies manifest, config, and entry files", async () => {
  const dir = await createTempProject({
    "package.json": "{}",
    "tsconfig.json": "{}",
    ".gitignore": "node_modules",
    "Dockerfile": "FROM node:20",
    "src/index.ts": "// entry",
    "docs/readme.md": "# docs",
  });

  try {
    const keyFiles = await getKeyFiles(dir);
    assert.ok(keyFiles.manifestFiles.includes("package.json"));
    assert.ok(keyFiles.configFiles.includes("tsconfig.json"));
    assert.ok(keyFiles.mainSourceDirs.includes("src"));
    // getKeyFiles only detects entry points at root level
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("getGitStats returns available object without executing git", async () => {
  const dir = await createTempProject({
    "README.md": "# test",
  });

  try {
    const stats = await getGitStats(dir);
    // Should report not available since there's no .git
    assert.equal(stats.available, false);
    assert.ok(stats.reason);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
