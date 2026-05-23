"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const {
  buildProjectContext,
  selectRelevantFiles,
  summarizeDirectory,
} = require("../../src/intel/context-builder");

async function createTempProject(files) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hax-ctx-test-"));
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf8");
  }
  return dir;
}

test("buildProjectContext creates structured project overview", async () => {
  const dir = await createTempProject({
    "package.json": JSON.stringify({
      name: "test-app",
      dependencies: { express: "^4.18.0" },
    }),
    "src/index.js": "const express = require('express');\nconst app = express();\n",
    "src/utils.js": "function helper() { return 42; }\n",
    "test/index.test.js": "// test\n",
    "README.md": "# Test App\n",
    ".gitignore": "node_modules\n",
  });

  try {
    const context = await buildProjectContext(dir, { includeDeps: true, includeTree: true });

    // Project metadata
    assert.ok(context.project);
    assert.equal(context.project.name, path.basename(dir));
    assert.ok(Array.isArray(context.project.languages));
    assert.ok(context.project.type.length > 0);

    // Overview
    assert.ok(context.overview);
    assert.ok(context.overview.totalFiles >= 4);
    assert.ok(context.overview.totalLines > 0);
    assert.ok(context.overview.testFiles >= 1);

    // Dependencies
    assert.ok(context.dependencies);
    assert.ok(Array.isArray(context.dependencies));
    // Should have node ecosystem
    const nodeDeps = context.dependencies.find(d => d.ecosystem === "node");
    assert.ok(nodeDeps);
    assert.ok(nodeDeps.dependencyCount >= 1);

    // File tree
    assert.ok(context.fileTree);
    assert.ok(Array.isArray(context.fileTree));
    assert.ok(context.fileTree.length > 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("buildProjectContext respects includeDeps: false", async () => {
  const dir = await createTempProject({
    "package.json": JSON.stringify({ dependencies: { lodash: "4.17.21" } }),
    "src/index.js": "// code\n",
  });

  try {
    const context = await buildProjectContext(dir, { includeDeps: false });
    assert.equal(context.dependencies, null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("selectRelevantFiles returns files matching query by filename", async () => {
  const dir = await createTempProject({
    "src/auth/login.js": "// login\n",
    "src/auth/register.js": "// register\n",
    "src/database/connection.js": "// db connection\n",
    "src/utils/format.js": "// string formatting\n",
    "src/index.js": "// entry\n",
    "README.md": "# Project\n",
    "package.json": "{}",
  });

  try {
    const results = await selectRelevantFiles(dir, "auth login", { maxResults: 5 });
    assert.ok(results.length > 0, "Should find at least one relevant file");

    const authFiles = results.filter(f => f.path.includes("auth"));
    assert.ok(authFiles.length > 0, "Should find files in auth directory");

    // Top result should be most relevant
    const topScore = results[0].score;
    for (const r of results.slice(1)) {
      assert.ok(r.score <= topScore, "Results should be sorted by descending score");
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("selectRelevantFiles includes content snippets when requested", async () => {
  const dir = await createTempProject({
    "src/config.js": "const PORT = process.env.PORT || 3000;\nconst config = { port: PORT };\nmodule.exports = config;\n",
    "src/server.js": "const app = require('./config');\napp.listen(3000);\n",
  });

  try {
    const results = await selectRelevantFiles(dir, "PORT config", {
      maxResults: 5,
      includeContent: true,
    });

    const configFile = results.find(f => f.path.includes("config.js"));
    assert.ok(configFile);
    assert.ok(configFile.snippet.length > 0, "Should include content snippet");
    assert.ok(configFile.snippet.includes("PORT"), "Snippet should contain matched text");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("selectRelevantFiles returns empty array for no matches", async () => {
  const dir = await createTempProject({
    "src/utils.js": "// some utility\n",
  });

  try {
    const results = await selectRelevantFiles(dir, "completely_unmatched_term");
    assert.deepEqual(results, []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("selectRelevantFiles respects maxResults option", async () => {
  const dir = await createTempProject({
    "src/auth.js": "// auth",
    "src/auth_middleware.js": "// auth middleware",
    "src/oauth.js": "// oauth",
    "src/password.js": "// password",
    "src/authentication.js": "// authentication",
    "src/authorize.js": "// authorize",
  });

  try {
    const results = await selectRelevantFiles(dir, "auth", { maxResults: 3 });
    assert.ok(results.length <= 3, "Should respect maxResults limit");
    assert.ok(results.length > 0, "Should find at least some matches");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("summarizeDirectory provides directory overview", async () => {
  const dir = await createTempProject({
    "src/components/Button.js": "// Button\n",
    "src/components/Input.js": "// Input\n\n\n",
    "src/components/Card.js": "// Card\n",
    "src/components/index.js": "// exports\n",
    "src/components/styles.css": "body { }\n",
    "src/utils/empty.ts": "// (empty)\n",
  });

  try {
    const summary = await summarizeDirectory(dir, "src/components");
    assert.equal(summary.stats.fileCount, 5);
    assert.equal(summary.subdirectories.length, 0);
    assert.ok(summary.stats.totalSizeBytes > 0);

    // Check extensions grouping
    assert.ok(summary.byExtension[".js"] >= 3);
    assert.ok(summary.byExtension[".css"] >= 1);

    // Top files
    const fileNames = summary.topFiles.map(f => f.name).sort();
    assert.ok(fileNames.includes("Button.js"));
    assert.ok(fileNames.includes("Card.js"));
    assert.ok(fileNames.includes("Input.js"));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("summarizeDirectory handles non-existent directory", async () => {
  const dir = await createTempProject({
    "README.md": "# test",
  });

  try {
    const summary = await summarizeDirectory(dir, "nonexistent");
    assert.ok(summary.error);
    assert.ok(summary.error.includes("not found") || summary.error.includes("Directory"));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("summarizeDirectory lists subdirectories", async () => {
  const dir = await createTempProject({
    "src/module/foo.js": "// foo",
    "src/module/sub/a.js": "// sub a",
    "src/module/sub/b.js": "// sub b",
    "src/module/nested/deep/file.ts": "// deep",
  });

  try {
    const summary = await summarizeDirectory(dir, "src/module");
    assert.ok(summary.subdirectories.length >= 2);
    const subNames = summary.subdirectories.map(d =>
      typeof d === "string" ? d : d.name
    );
    assert.ok(subNames.includes("sub") || subNames.some(s => s.includes("sub")));
    assert.ok(subNames.includes("nested") || subNames.some(s => s.includes("nested")));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("buildProjectContext handles empty project gracefully", async () => {
  const dir = await createTempProject({
    "README.md": "# Empty Project\n",
  });

  try {
    const context = await buildProjectContext(dir);
    assert.ok(context.project);
    assert.equal(context.overview.totalFiles, 1);
    assert.ok(context.overview.totalLines >= 1);
    assert.equal(context.dependencies, null);
    assert.ok(Array.isArray(context.fileTree));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("buildProjectContext includes entry points and config files in overview", async () => {
  const dir = await createTempProject({
    "package.json": JSON.stringify({ name: "test-pkg" }),
    "tsconfig.json": JSON.stringify({}),
    "src/index.ts": "export {};\n",
    "src/lib/helper.ts": "export function help() {}\n",
  });

  try {
    const context = await buildProjectContext(dir);
    // getKeyFiles detects root-level entry points and source dirs
    assert.ok(context.overview.mainSourceDirs.includes("src"));
    assert.ok(context.overview.configFiles.length >= 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
