"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const {
  analyzeDependencies,
  getOutdatedDependencies,
  detectUnusedDependencies,
  buildDependencyGraph,
  findCircularDependencies,
  getDependencySizes,
} = require("../../src/intel/dependency-analyzer");

/**
 * Creates a temporary project directory with given file map.
 * @param {object} files - Map of relative paths to file contents
 * @returns {Promise<string>} Path to temp directory
 */
async function createTempProject(files) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hax-dep-test-"));
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf8");
  }
  return dir;
}

test("analyzeDependencies parses package.json with all dependency types", async () => {
  const dir = await createTempProject({
    "package.json": JSON.stringify({
      dependencies: { express: "^4.18.0", lodash: "4.17.21" },
      devDependencies: { jest: "^29.0.0" },
      peerDependencies: { react: ">=18.0.0" },
      optionalDependencies: { "fsevents": "^2.3.0" },
    }),
  });

  try {
    const result = await analyzeDependencies(dir);
    assert.ok(result.ecosystems.node);
    assert.equal(Object.keys(result.ecosystems.node).length, 5);
    assert.equal(result.ecosystems.node.express.version, "^4.18.0");
    assert.equal(result.ecosystems.node.express.type, "dependencies");
    assert.equal(result.ecosystems.node.jest.type, "devDependencies");
    assert.equal(result.ecosystems.node.react.type, "peerDependencies");
    assert.equal(result.files.includes("package.json"), true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("analyzeDependencies parses requirements.txt", async () => {
  const dir = await createTempProject({
    "requirements.txt": "flask==2.3.0\nrequests>=2.28.0\n# a comment\nnumpy\n",
  });

  try {
    const result = await analyzeDependencies(dir);
    assert.ok(result.ecosystems.python);
    assert.equal(result.ecosystems.python.flask.version, "==2.3.0");
    assert.equal(result.ecosystems.python.requests.version, ">=2.28.0");
    assert.equal(result.ecosystems.python.numpy.version, "*");
    assert.equal(result.files.includes("requirements.txt"), true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("analyzeDependencies parses Cargo.toml", async () => {
  const dir = await createTempProject({
    "Cargo.toml": `
[package]
name = "my-app"
version = "0.1.0"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
tokio = "1.28"
`,
  });

  try {
    const result = await analyzeDependencies(dir);
    assert.ok(result.ecosystems.rust);
    // Cargo.toml parsing checks for version in various formats
    assert.ok("serde" in result.ecosystems.rust || Object.keys(result.ecosystems.rust).length >= 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("analyzeDependencies parses go.mod", async () => {
  const dir = await createTempProject({
    "go.mod": `
module example.com/myapp

go 1.21

require (
    github.com/gin-gonic/gin v1.9.1
    github.com/stretchr/testify v1.8.4
)
`,
  });

  try {
    const result = await analyzeDependencies(dir);
    assert.ok(result.ecosystems.go);
    assert.equal(result.files.includes("go.mod"), true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("analyzeDependencies handles multiple manifest files", async () => {
  const dir = await createTempProject({
    "package.json": JSON.stringify({ dependencies: { lodash: "4.17.21" } }),
    "requirements.txt": "requests>=2.28.0\n",
  });

  try {
    const result = await analyzeDependencies(dir);
    assert.ok(result.ecosystems.node);
    assert.ok(result.ecosystems.python);
    assert.equal(result.files.length, 2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("getOutdatedDependencies returns lock file info without network", async () => {
  const dir = await createTempProject({
    "package.json": JSON.stringify({ dependencies: { lodash: "4.17.21" } }),
    "package-lock.json": "{}",
    "Cargo.toml": "[dependencies]\n",
    "Cargo.lock": "",
  });

  try {
    const result = await getOutdatedDependencies(dir);
    assert.ok(result.node);
    assert.ok(result.node.lockFiles.includes("package-lock.json"));
    assert.ok(result.rust);
    assert.equal(result.rust.lockFile, "Cargo.lock");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("buildDependencyGraph extracts imports from JavaScript files", async () => {
  const dir = await createTempProject({
    "src/index.js": `
const express = require('express');
import lodash from 'lodash';
const util = require('./utils');
import { helper } from '../helpers/format';
`,
    "src/utils.js": `
const debug = require('debug');
module.exports = function utils() {};
`,
    "src/components/button.js": `
import React from 'react';
import clsx from 'clsx';
import './button.css';
`,
  });

  try {
    const graph = await buildDependencyGraph(dir);
    assert.equal(Object.keys(graph).length, 3);

    const indexImports = graph["src/index.js"];
    assert.ok(indexImports.includes("express"));
    assert.ok(indexImports.includes("lodash"));
    assert.ok(indexImports.includes("./utils"));
    assert.ok(indexImports.includes("../helpers/format"));

    const utilsImports = graph["src/utils.js"];
    assert.ok(utilsImports.includes("debug"));

    const buttonImports = graph["src/components/button.js"];
    assert.ok(buttonImports.includes("react"));
    assert.ok(buttonImports.includes("clsx"));
    assert.ok(buttonImports.includes("./button.css"));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("buildDependencyGraph extracts imports from Python files", async () => {
  const dir = await createTempProject({
    "main.py": `
import os
import sys
from flask import Flask
from .utils import helper
from ..models import User
`,
    "utils.py": `
import json
from typing import Optional
`,
  });

  try {
    const graph = await buildDependencyGraph(dir);
    assert.equal(Object.keys(graph).length, 2);

    const mainImports = graph["main.py"];
    assert.ok(mainImports.includes("flask"));
    assert.ok(mainImports.includes("os"));
    assert.ok(mainImports.includes("sys"));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("findCircularDependencies detects simple circular imports", async () => {
  const dir = await createTempProject({
    "src/a.js": `
const b = require('./b');
module.exports = { name: 'a' };
`,
    "src/b.js": `
const a = require('./a');
module.exports = { name: 'b' };
`,
    "src/c.js": `
const b = require('./b');
module.exports = { name: 'c' };
`,
  });

  try {
    const cycles = await findCircularDependencies(dir);
    assert.ok(cycles.length > 0, "Should detect at least one cycle");

    // The cycle should include a.js and b.js
    const flattenCycles = cycles.map(c => c.map(n => n.replace(/\\/g, "/")));
    const hasABCycle = flattenCycles.some(cycle =>
      (cycle.includes("src/a.js") && cycle.includes("src/b.js"))
    );
    assert.ok(hasABCycle, "Should detect cycle between a.js and b.js");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("findCircularDependencies returns empty array when no cycles exist", async () => {
  const dir = await createTempProject({
    "src/a.js": `const b = require('./b');`,
    "src/b.js": `const c = require('./c');`,
    "src/c.js": `module.exports = {};`,
  });

  try {
    const cycles = await findCircularDependencies(dir);
    assert.equal(cycles.length, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("getDependencySizes estimates sizes of node_modules packages", async () => {
  const dir = await createTempProject({
    "node_modules/lodash/index.js": "// lodash",
    "node_modules/lodash/package.json": "{}",
    "node_modules/express/index.js": "// express",
    "node_modules/express/lib/app.js": "// app",
    "node_modules/@scope/pkg/index.js": "// scoped",
  });

  try {
    const sizes = await getDependencySizes(dir);
    assert.ok(typeof sizes.lodash === "number");
    assert.ok(sizes.lodash > 0);
    assert.ok(typeof sizes.express === "number");
    assert.ok(sizes.express > 0);
    assert.ok("@scope/pkg" in sizes);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("getDependencySizes returns empty object for missing node_modules", async () => {
  const dir = await createTempProject({
    "package.json": "{}",
  });

  try {
    const sizes = await getDependencySizes(dir);
    assert.equal(typeof sizes, "object");
    assert.equal(Object.keys(sizes).length, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("detectUnusedDependencies finds imports not declared in package.json", async () => {
  const dir = await createTempProject({
    "package.json": JSON.stringify({
      dependencies: { express: "^4.18.0" },
    }),
    "src/app.js": `
const express = require('express');
const lodash = require('lodash');
const fs = require('fs');
`,
  });

  try {
    const result = await detectUnusedDependencies(dir);
    assert.ok(Array.isArray(result.missingDeps));
    // lodash is imported but not in package.json
    const lodashMissing = result.missingDeps.filter(d => d.module === "lodash");
    assert.ok(lodashMissing.length > 0);
    // express is in package.json, should not be missing
    const expressMissing = result.missingDeps.filter(d => d.module === "express");
    assert.equal(expressMissing.length, 0);
    // fs is built-in, should not be flagged
    const fsMissing = result.missingDeps.filter(d => d.module === "fs");
    assert.equal(fsMissing.length, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
