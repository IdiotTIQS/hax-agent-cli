/**
 * Tests for CodeFingerprint — code fingerprint generation and comparison.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");

const {
  CodeFingerprint,
  stripComments,
  normalizeWhitespace,
  normalizeIdentifiers,
  keywordHistogram,
  tokenStats,
  cosineSimilarity,
  buildFeatureVector,
} = require("../../src/similarity/fingerprint");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hax-fp-"));
}

function writeFile(dir, name, content) {
  const fullPath = path.join(dir, name);
  fs.writeFileSync(fullPath, content, "utf-8");
  return fullPath;
}

// ---------------------------------------------------------------------------
// stripComments
// ---------------------------------------------------------------------------

describe("stripComments", () => {
  it("removes single-line and block comments", () => {
    const input =
      "// top comment\n" +
      "const x = 1; /* inline */ const y = 2; // trailing\n";
    const result = stripComments(input);
    assert.ok(!result.includes("top comment"));
    assert.ok(!result.includes("inline"));
    assert.ok(!result.includes("trailing"));
  });

  it("preserves strings that look like comments", () => {
    const input = 'const url = "https://site.com/path"; const note = "/* keep me */";';
    const result = stripComments(input);
    assert.ok(result.includes("https://site.com/path"));
    assert.ok(result.includes("/* keep me */"));
  });
});

// ---------------------------------------------------------------------------
// normalizeWhitespace
// ---------------------------------------------------------------------------

describe("normalizeWhitespace", () => {
  it("strips blank lines and trims whitespace", () => {
    const input = "  hello   \n\n\n  world  \n\n";
    const result = normalizeWhitespace(input);
    assert.strictEqual(result, "hello\nworld");
  });
});

// ---------------------------------------------------------------------------
// normalizeIdentifiers
// ---------------------------------------------------------------------------

describe("normalizeIdentifiers", () => {
  it("replaces user identifiers but preserves keywords", () => {
    const input = "function greet(name) { return 'Hello, ' + name; }";
    const result = normalizeIdentifiers(input);
    assert.ok(!result.includes("greet"));
    assert.ok(!result.includes("name"));
    assert.ok(result.includes("function"));
    assert.ok(result.includes("return"));
    assert.ok(result.includes("id_"));
  });
});

// ---------------------------------------------------------------------------
// keywordHistogram
// ---------------------------------------------------------------------------

describe("keywordHistogram", () => {
  it("counts keyword occurrences in code", () => {
    const code = "if (a) { if (b) { return c; } } else { return d; }";
    const hist = keywordHistogram(code);
    assert.strictEqual(hist["if"], 2);
    assert.strictEqual(hist["else"], 1);
    assert.strictEqual(hist["return"], 2);
    assert.strictEqual(hist["for"], undefined, "for should not appear");
  });
});

// ---------------------------------------------------------------------------
// tokenStats
// ---------------------------------------------------------------------------

describe("tokenStats", () => {
  it("computes token count and diversity", () => {
    const code = "const x = 10;\nconst y = x + 5;\nreturn y;";
    const stats = tokenStats(code);
    assert.ok(stats.total > 0, "Should have tokens");
    assert.ok(stats.unique > 0, "Should have unique tokens");
    assert.ok(stats.unique <= stats.total, "Unique <= total");
    assert.ok(typeof stats.operatorCount === "number");
    assert.ok(typeof stats.keywordCount === "number");
  });
});

// ---------------------------------------------------------------------------
// cosineSimilarity
// ---------------------------------------------------------------------------

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const vec = [0.5, 0.3, 0.2];
    const result = cosineSimilarity(vec, vec);
    assert.ok(Math.abs(result - 1.0) < 0.0001, "Identical vectors should have cosine 1.0");
  });

  it("returns 0 for orthogonal vectors", () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    assert.strictEqual(cosineSimilarity(a, b), 0);
  });

  it("returns 1 for two zero vectors", () => {
    assert.strictEqual(cosineSimilarity([0, 0], [0, 0]), 1);
  });
});

// ---------------------------------------------------------------------------
// buildFeatureVector
// ---------------------------------------------------------------------------

describe("buildFeatureVector", () => {
  it("builds a numeric vector from a fingerprint", () => {
    const fp = {
      features: {
        lines: 100,
        totalTokens: 500,
        uniqueTokens: 150,
        operatorCount: 80,
        punctuationCount: 60,
        keywordCount: 40,
        keywordHistogram: { if: 5, for: 3, return: 10, function: 2, const: 8 },
      },
    };
    const vec = buildFeatureVector(fp);
    assert.ok(Array.isArray(vec));
    assert.ok(vec.length > 0, "Vector should have entries");
    for (const val of vec) {
      assert.ok(typeof val === "number", "All entries should be numbers");
    }
  });
});

// ---------------------------------------------------------------------------
// CodeFingerprint
// ---------------------------------------------------------------------------

describe("CodeFingerprint", () => {
  describe("fingerprint", () => {
    it("generates a fingerprint with hash, structuralHash, and features", () => {
      const coder = new CodeFingerprint();
      const code = "function add(a, b) {\n  return a + b;\n}";
      const fp = coder.fingerprint(code);

      assert.ok(typeof fp.hash === "string", "Should have a hash");
      assert.strictEqual(fp.hash.length, 64, "Should be a SHA-256 hex string");
      assert.ok(typeof fp.structuralHash === "string", "Should have a structuralHash");
      assert.ok(typeof fp.rawHash === "string", "Should have a rawHash");
      assert.ok(fp.features, "Should have features");
      assert.ok(fp.features.lines > 0, "Should have a line count");
      assert.ok(fp.features.totalTokens > 0, "Should have a token count");
      assert.ok(fp.features.keywordHistogram, "Should have keyword histogram");
      assert.ok(fp.features.sizeBytes > 0, "Should have byte size");
    });

    it("stores filePath in the fingerprint when provided", () => {
      const coder = new CodeFingerprint();
      const fp = coder.fingerprint("const x = 1;", "/test/file.js");
      assert.strictEqual(fp.path, "/test/file.js");
    });

    it("throws on non-string input", () => {
      const coder = new CodeFingerprint();
      assert.throws(
        () => coder.fingerprint(null),
        /TypeError|must be a string/
      );
      assert.throws(
        () => coder.fingerprint(123),
        /TypeError|must be a string/
      );
    });

    it("normalizes whitespace in fingerprints", () => {
      const coder = new CodeFingerprint();
      const fp1 = coder.fingerprint("const x = 1;\nconst y = 2;");
      const fp2 = coder.fingerprint("  const x = 1;\n\n  const y = 2;  ");

      // Hashes should differ because of full normalization including identifiers
      // But structural hash should be the same
      assert.strictEqual(fp1.structuralHash, fp2.structuralHash,
        "Structural hash should match despite whitespace differences");
    });

    it("strips comments when generating fingerprints", () => {
      const coder = new CodeFingerprint();
      const codeWithComment = "// license header\nconst x = 1;\n/* block */ const y = 2;";
      const codeClean = "const x = 1;\nconst y = 2;";

      const fp1 = coder.fingerprint(codeWithComment);
      const fp2 = coder.fingerprint(codeClean);

      // Structural hashes should match (comments stripped, identifiers normalized)
      assert.strictEqual(fp1.structuralHash, fp2.structuralHash,
        "Structural hashes should match when only comments differ");
    });

    it("respects preserveComments option", () => {
      const coder = new CodeFingerprint({ preserveComments: true });
      const codeWithComment = "// header\nconst x = 1;";
      const codeClean = "const x = 1;";

      const fp1 = coder.fingerprint(codeWithComment);
      const fp2 = coder.fingerprint(codeClean);

      // With preserveComments, the hashes should differ
      assert.notStrictEqual(fp1.hash, fp2.hash,
        "Hashes should differ when comments are preserved and differ");
    });

    it("respects preserveIdentifiers option", () => {
      const coderPreserve = new CodeFingerprint({ preserveIdentifiers: true });
      const coderDefault = new CodeFingerprint();

      const code = "function myFunc() { return myFunc; }";
      const fpPreserve = coderPreserve.fingerprint(code);
      const fpDefault = coderDefault.fingerprint(code);

      // With preserveIdentifiers=true, the full normalization should NOT strip myFunc
      assert.notStrictEqual(fpPreserve.hash, fpDefault.hash,
        "Hashes should differ when one preserves identifiers and the other does not");
    });
  });

  describe("fingerprintFile", () => {
    it("reads a file and generates its fingerprint", () => {
      const dir = tempDir();
      const filePath = writeFile(dir, "test.js", "const x = 42;\nmodule.exports = x;\n");

      const coder = new CodeFingerprint();
      const fp = coder.fingerprintFile(filePath);

      assert.ok(typeof fp.hash === "string");
      assert.strictEqual(fp.path, filePath);
      assert.ok(fp.features.lines > 0);

      // Cleanup
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("throws when file does not exist", () => {
      const coder = new CodeFingerprint();
      assert.throws(
        () => coder.fingerprintFile("/nonexistent/path/file.js"),
        /File not found|ENOENT/
      );
    });

    it("throws when path is a directory", () => {
      const dir = tempDir();
      const coder = new CodeFingerprint();
      assert.throws(
        () => coder.fingerprintFile(dir),
        /not a file/
      );
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe("fingerprintDirectory", () => {
    it("scans a directory and fingerprints supported files", () => {
      const dir = tempDir();
      writeFile(dir, "a.js", "const a = 1;");
      writeFile(dir, "b.js", "function b() { return 2; }");
      writeFile(dir, "c.json", '{"key": "value"}');
      writeFile(dir, "d.txt", "not source code");
      writeFile(dir, "e.ts", "const e: number = 3;");

      const coder = new CodeFingerprint({ extensions: [".js", ".ts"] });
      const result = coder.fingerprintDirectory(dir);

      assert.strictEqual(result.fileCount, 3, "Should fingerprint .js and .ts files only");
      assert.strictEqual(result.skippedCount, 2, "Should skip .json and .txt");
      assert.ok(Array.isArray(result.fingerprints));
      assert.strictEqual(result.fingerprints.length, 3);

      for (const fp of result.fingerprints) {
        assert.ok(typeof fp.hash === "string");
        assert.ok(fp.path, "Each fingerprint should have a path");
      }

      // Cleanup
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("throws for non-existent directory", () => {
      const coder = new CodeFingerprint();
      assert.throws(
        () => coder.fingerprintDirectory("/nonexistent/directory"),
        /Directory not found|ENOENT/
      );
    });

    it("skips node_modules and dot-directories", () => {
      const dir = tempDir();
      writeFile(dir, "main.js", "const main = true;");
      const nmDir = path.join(dir, "node_modules");
      fs.mkdirSync(nmDir);
      writeFile(nmDir, "dep.js", "const dep = true;");

      const coder = new CodeFingerprint({ extensions: [".js"] });
      const result = coder.fingerprintDirectory(dir);

      assert.strictEqual(result.fileCount, 1, "Should skip node_modules");
      assert.strictEqual(result.fingerprints[0].path, path.join(dir, "main.js"));

      // Cleanup
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe("compare", () => {
    it("returns 1.0 for identical code fingerprints", () => {
      const coder = new CodeFingerprint();
      const code = "function add(a, b) {\n  return a + b;\n}";
      const fp1 = coder.fingerprint(code);
      const fp2 = coder.fingerprint(code);

      assert.strictEqual(coder.compare(fp1, fp2), 1.0);
    });

    it("returns high similarity for structurally similar code", () => {
      const coder = new CodeFingerprint();
      const code1 =
        "function getUser(id) {\n" +
        "  if (!id) return null;\n" +
        "  const user = db.find(id);\n" +
        "  return user;\n" +
        "}";

      const code2 =
        "function getProduct(sku) {\n" +
        "  if (!sku) return null;\n" +
        "  const product = catalog.lookup(sku);\n" +
        "  return product;\n" +
        "}";

      const fp1 = coder.fingerprint(code1);
      const fp2 = coder.fingerprint(code2);

      const sim = coder.compare(fp1, fp2);
      assert.ok(sim >= 0.8, `Structural similarity should be >= 0.8, got ${sim}`);
    });

    it("returns lower similarity for structurally different code", () => {
      const coder = new CodeFingerprint();

      // A pure-math function dominated by loop/arithmetic keywords
      const code1 =
        "function matrixMultiply(a, b, n) {\n" +
        "  const result = [];\n" +
        "  for (let i = 0; i < n; i++) {\n" +
        "    result[i] = [];\n" +
        "    for (let j = 0; j < n; j++) {\n" +
        "      let sum = 0;\n" +
        "      for (let k = 0; k < n; k++) {\n" +
        "        sum += a[i][k] * b[k][j];\n" +
        "      }\n" +
        "      result[i][j] = sum;\n" +
        "    }\n" +
        "  }\n" +
        "  return result;\n" +
        "}\n";

      // A state-machine: dominated by switch/case/break/default
      const code2 =
        "class StateMachine {\n" +
        "  constructor() { this.state = 'idle'; }\n" +
        "  transition(event) {\n" +
        "    switch (this.state) {\n" +
        "      case 'idle':\n" +
        "        if (event === 'start') { this.state = 'running'; }\n" +
        "        break;\n" +
        "      case 'running':\n" +
        "        if (event === 'pause') { this.state = 'paused'; }\n" +
        "        else if (event === 'stop') { this.state = 'idle'; }\n" +
        "        break;\n" +
        "      case 'paused':\n" +
        "        if (event === 'resume') { this.state = 'running'; }\n" +
        "        else if (event === 'stop') { this.state = 'idle'; }\n" +
        "        break;\n" +
        "      default:\n" +
        "        break;\n" +
        "    }\n" +
        "  }\n" +
        "}\n";

      const fp1 = coder.fingerprint(code1);
      const fp2 = coder.fingerprint(code2);

      const sim = coder.compare(fp1, fp2);
      // Two different structures: one dominated by for loops, the other by switch/case.
      // Feature-vector cosine should be noticeably lower than 1.0.
      assert.ok(sim < 0.92, `Structurally different code should have lower similarity, got ${sim}`);
    });

    it("returns 0 for null/undefined inputs", () => {
      const coder = new CodeFingerprint();
      const fp = coder.fingerprint("const x = 1;");
      assert.strictEqual(coder.compare(fp, null), 0);
      assert.strictEqual(coder.compare(null, fp), 0);
      assert.strictEqual(coder.compare(null, null), 0);
    });
  });

  describe("findSimilar", () => {
    it("finds candidates similar to a target fingerprint", () => {
      const coder = new CodeFingerprint();

      // A user-fetching function with error handling and data processing
      const target = coder.fingerprint(
        "async function fetchUser(userId) {\n" +
        "  if (!userId) throw new Error('Missing userId');\n" +
        "  const response = await http.get(`/api/users/${userId}`);\n" +
        "  if (!response.ok) throw new Error(`HTTP ${response.status}`);\n" +
        "  const data = await response.json();\n" +
        "  if (!data || !data.id) return null;\n" +
        "  return { id: data.id, name: data.name, email: data.email };\n" +
        "}",
        "/src/users.js"
      );

      const candidates = [
        // Very similar: same pattern, slight name variations
        coder.fingerprint(
          "async function fetchUserV2(userId) {\n" +
          "  if (!userId) throw new Error('Missing userId');\n" +
          "  const response = await http.get(`/api/v2/users/${userId}`);\n" +
          "  if (!response.ok) throw new Error(`HTTP ${response.status}`);\n" +
          "  const data = await response.json();\n" +
          "  if (!data || !data.id) return null;\n" +
          "  return { id: data.id, name: data.name, email: data.email };\n" +
          "}",
          "/src/users-v2.js"
        ),
        // Completely different: logger class
        coder.fingerprint(
          "class Logger {\n" +
          "  constructor(level) { this.level = level; }\n" +
          "  debug(msg) { if (this.level <= 0) console.debug(msg); }\n" +
          "  info(msg) { if (this.level <= 1) console.info(msg); }\n" +
          "  warn(msg) { if (this.level <= 2) console.warn(msg); }\n" +
          "  error(msg) { if (this.level <= 3) console.error(msg); }\n" +
          "}",
          "/src/logger.js"
        ),
        // Moderately different: math utility
        coder.fingerprint(
          "function factorial(n) {\n" +
          "  if (n < 0) throw new Error('Negative input');\n" +
          "  if (n === 0 || n === 1) return 1;\n" +
          "  let result = 1;\n" +
          "  for (let i = 2; i <= n; i++) { result *= i; }\n" +
          "  return result;\n" +
          "}",
          "/src/factorial.js"
        ),
        // Structurally similar to target (async fetch with error handling)
        coder.fingerprint(
          "async function loadProducts(category) {\n" +
          "  if (!category) throw new Error('Missing category');\n" +
          "  const resp = await api.get(`/products?cat=${category}`);\n" +
          "  if (!resp.ok) throw new Error(`API error: ${resp.status}`);\n" +
          "  const items = await resp.json();\n" +
          "  if (!items || items.length === 0) return [];\n" +
          "  return items.map(i => ({ id: i.id, title: i.title }));\n" +
          "}",
          "/src/products.js"
        ),
      ];

      const results = coder.findSimilar(target, candidates, { threshold: 0.5, maxResults: 3 });

      assert.ok(Array.isArray(results));
      assert.ok(results.length > 0, "Should find at least one similar candidate");
      assert.ok(results.length <= 3, "Should respect maxResults");

      for (const r of results) {
        assert.ok(r.fingerprint, "Each result should have a fingerprint");
        assert.ok(typeof r.similarity === "number", "Each result should have a similarity score");
        assert.ok(r.similarity >= 0.5, "Similarity should be at least the threshold");
      }

      // Results should be sorted by similarity descending
      for (let i = 1; i < results.length; i++) {
        assert.ok(results[i - 1].similarity >= results[i].similarity,
          "Results should be sorted by similarity descending");
      }

      // The users-v2.js candidate should be a top match (nearly identical structure)
      const topMatchPaths = results.map((r) => r.fingerprint.path);
      assert.ok(
        topMatchPaths.some((p) => p && (p.includes("users-v2") || p.includes("products"))),
        "Top results should include structurally similar candidates"
      );
    });

    it("excludes the target from results", () => {
      const coder = new CodeFingerprint();
      const fp = coder.fingerprint("const x = 1;");
      const candidates = [fp, coder.fingerprint("const y = 2;")];

      const results = coder.findSimilar(fp, candidates, { threshold: 0 });
      const selfMatch = results.find((r) => r.fingerprint.hash === fp.hash);
      assert.strictEqual(selfMatch, undefined, "Should not return the target fingerprint itself");
    });

    it("returns empty array with no candidates above threshold", () => {
      const coder = new CodeFingerprint();
      const target = coder.fingerprint("function a() { return 1; }");
      const candidates = [coder.fingerprint("class X { }")];

      const results = coder.findSimilar(target, candidates, { threshold: 0.99 });
      assert.strictEqual(results.length, 0);
    });

    it("handles empty or non-array candidate lists", () => {
      const coder = new CodeFingerprint();
      const fp = coder.fingerprint("const x = 1;");

      assert.deepStrictEqual(coder.findSimilar(fp, []), []);
      assert.deepStrictEqual(coder.findSimilar(fp, null), []);
      assert.deepStrictEqual(coder.findSimilar(fp, undefined), []);
    });
  });
});
