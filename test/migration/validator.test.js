/**
 * Tests for MigrationValidator.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { MigrationValidator } = require("../../src/migration/validator");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hax-mig-val-"));
}

function cleanupDir(dir) {
  try {
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (_) { /* ignore */ }
}

function writeTempFile(dir, name, content) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

// ---------------------------------------------------------------------------
// checkSyntax
// ---------------------------------------------------------------------------

test("checkSyntax: accepts valid JavaScript", () => {
  const validator = new MigrationValidator();
  const result = validator.checkSyntax("const x = 1; function get() { return x; }");
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("checkSyntax: rejects invalid syntax", () => {
  const validator = new MigrationValidator();
  const result = validator.checkSyntax("const x = ;");
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
});

test("checkSyntax: rejects empty or non-string content", () => {
  const validator = new MigrationValidator();
  const emptyResult = validator.checkSyntax("");
  assert.equal(emptyResult.valid, false);
  assert.ok(emptyResult.errors.some((e) => e.includes("empty")));

  const nullResult = validator.checkSyntax(null);
  assert.equal(nullResult.valid, false);
});

test("checkSyntax: warns about potential unbalanced backticks", () => {
  const validator = new MigrationValidator();
  // A single backtick on a line that's not a comment
  const result = validator.checkSyntax("const x = `hello;");
  // May or may not be valid depending on the rest, but should produce a warning
  assert.ok(result.warnings.length > 0 || result.valid === false);
});

test("checkSyntax: handles ES module syntax", () => {
  const validator = new MigrationValidator();
  const result = validator.checkSyntax(
    "import { readFile } from 'fs';\nexport default function main() { return 42; }"
  );
  assert.equal(result.valid, true);
});

test("checkSyntax: handles async/await syntax", () => {
  const validator = new MigrationValidator();
  const result = validator.checkSyntax(
    "async function fetchData() { const result = await Promise.resolve(42); return result; }"
  );
  assert.equal(result.valid, true);
});

// ---------------------------------------------------------------------------
// validate (comprehensive)
// ---------------------------------------------------------------------------

test("validate: passes for valid transformed code identical to original", () => {
  const validator = new MigrationValidator();
  const code = '"use strict";\nconst x = 42;\nmodule.exports = x;';
  const result = validator.validate(code, code);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("validate: returns errors for invalid transformed code", () => {
  const validator = new MigrationValidator();
  const original = "const x = 1;";
  const transformed = "const x = ;";
  const result = validator.validate(transformed, original);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
});

test("validate: detects missing module.exports when original had them", () => {
  const validator = new MigrationValidator();
  const original = '"use strict";\nmodule.exports = { foo: 1 };\n';
  const transformed = '"use strict";\n// module.exports removed\n';
  const result = validator.validate(transformed, original);
  assert.ok(result.warnings.some((w) => w.includes("module.exports")));
});

test("validate: detects removed try/catch blocks", () => {
  const validator = new MigrationValidator();
  const original = 'try { risky(); } catch (e) { console.log(e); }\n';
  const transformed = 'risky();\n';
  const result = validator.validate(transformed, original);
  assert.ok(result.warnings.some((w) => w.includes("try/catch")));
});

test("validate: detects drastically reduced line count", () => {
  const validator = new MigrationValidator();
  const original = Array(50).fill("// line").join("\n");
  const transformed = "// single line";
  const result = validator.validate(transformed, original);
  assert.ok(result.warnings.some((w) => w.includes("Line count")));
});

// ---------------------------------------------------------------------------
// checkImports
// ---------------------------------------------------------------------------

test("checkImports: returns valid for code without imports", () => {
  const validator = new MigrationValidator();
  const result = validator.checkImports("const x = 1;");
  assert.equal(result.valid, true);
});

test("checkImports: detects mixed ESM and CJS", () => {
  const validator = new MigrationValidator();
  const code = `import fs from 'fs';
const path = require('path');`;
  const result = validator.checkImports(code);
  assert.ok(result.suggestions.some((s) => s.includes("mixes ESM imports") || s.includes("standardizing")));
});

test("checkImports: detects duplicate imports", () => {
  const validator = new MigrationValidator();
  const code = `import fs from 'fs';
import path from 'path';
import fs from 'fs';`;
  const result = validator.checkImports(code);
  // Should warn about duplicate
  assert.ok(result.warnings.some((w) => w.includes("Duplicate import") || w.includes("Duplicate")));
});

test("checkImports: resolves valid local imports when filePath is given", () => {
  const dir = createTempDir();
  // Create a valid dependency
  writeTempFile(dir, "utils.js", "module.exports = {};");
  const mainPath = writeTempFile(dir, "main.js", "const utils = require('./utils');");

  const validator = new MigrationValidator();
  const result = validator.checkImports(
    "const utils = require('./utils');",
    mainPath
  );
  assert.equal(result.valid, true);
  // Should NOT warn about unresolvable import
  assert.ok(!result.warnings.some((w) => w.includes("could not be resolved") || w.includes("unresolved")));

  cleanupDir(dir);
});

test("checkImports: warns about unresolvable local imports", () => {
  const dir = createTempDir();
  const mainPath = writeTempFile(dir, "main.js", "module.exports = {};");

  const validator = new MigrationValidator();
  const code = "const missing = require('./nonexistent');";
  const result = validator.checkImports(code, mainPath);
  assert.ok(result.warnings.some((w) => w.includes("could not be resolved") || w.includes("not found")));

  cleanupDir(dir);
});

// ---------------------------------------------------------------------------
// checkDependencies
// ---------------------------------------------------------------------------

test("checkDependencies: passes for a single file with no dependencies", () => {
  const validator = new MigrationValidator();
  const files = [{
    file: "/proj/main.js",
    original: "const x = 1;",
    transformed: "const x = 1;",
  }];
  const result = validator.checkDependencies(files);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("checkDependencies: warns about missing dependency in file set", () => {
  const validator = new MigrationValidator();
  const files = [{
    file: "/proj/index.js",
    original: "const utils = require('./utils');",
    transformed: "const utils = require('./utils');",
  }];
  const result = validator.checkDependencies(files);
  // ./utils is not in the file set, so it should warn
  assert.ok(
    result.warnings.some((w) =>
      w.includes("./utils") && (w.includes("not found") || w.includes("could not"))
    )
  );
});

test("checkDependencies: does not warn when dependency is present in file set", () => {
  const validator = new MigrationValidator();
  const files = [
    {
      file: "/proj/index.js",
      original: "const utils = require('./utils');",
      transformed: "const utils = require('./utils');",
    },
    {
      file: "/proj/utils.js",
      original: "module.exports = {};",
      transformed: "module.exports = {};",
    },
  ];
  const result = validator.checkDependencies(files);
  assert.ok(!result.warnings.some((w) => w.includes("./utils")));
});

test("checkDependencies: detects circular dependencies", () => {
  const validator = new MigrationValidator();
  const files = [
    {
      file: "/proj/a.js",
      original: "const b = require('./b');",
      transformed: "const b = require('./b');",
    },
    {
      file: "/proj/b.js",
      original: "const a = require('./a');",
      transformed: "const a = require('./a');",
    },
  ];
  const result = validator.checkDependencies(files);
  assert.ok(result.warnings.some((w) => w.includes("Circular dependency")));
});
