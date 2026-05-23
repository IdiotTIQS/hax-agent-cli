/**
 * Tests for CloneDetector — code clone detection across files.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");

const {
  CloneDetector,
  stripComments,
  normalizeWhitespace,
  normalizeIdentifiers,
  tokenize,
  extractNGrams,
  jaccardSimilarity,
  structuralSignature,
  splitIntoBlocks,
} = require("../../src/similarity/detector");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a temporary file with given content. Returns the path.
 */
function tempFile(content, ext = ".js") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-sim-"));
  const filePath = path.join(dir, `test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`);
  fs.writeFileSync(filePath, content, "utf-8");
  return { filePath, dir };
}

// ---------------------------------------------------------------------------
// stripComments
// ---------------------------------------------------------------------------

describe("stripComments", () => {
  it("removes single-line comments", () => {
    const input = "const x = 1; // this is a comment\nconst y = 2;";
    const result = stripComments(input);
    assert.ok(!result.includes("this is a comment"));
    assert.ok(result.includes("const x = 1;"));
    assert.ok(result.includes("const y = 2;"));
  });

  it("removes block comments", () => {
    const input = "const x = 1; /* block\ncomment */ const y = 2;";
    const result = stripComments(input);
    assert.ok(!result.includes("block"));
    assert.ok(!result.includes("comment"));
    assert.ok(result.includes("const x = 1;"));
    assert.ok(result.includes("const y = 2;"));
  });

  it("preserves string literals containing comment-like sequences", () => {
    const input = 'const url = "https://example.com"; const path = "/* not a comment */";';
    const result = stripComments(input);
    assert.ok(result.includes("https://example.com"));
    assert.ok(result.includes("/* not a comment */"));
  });

  it("preserves regex literals containing slashes", () => {
    const input = "const re = /[a-z]+/g; // trailing comment";
    const result = stripComments(input);
    assert.ok(result.includes("/[a-z]+/g"));
    assert.ok(!result.includes("trailing comment"));
  });
});

// ---------------------------------------------------------------------------
// normalizeWhitespace
// ---------------------------------------------------------------------------

describe("normalizeWhitespace", () => {
  it("collapses multiple blank lines", () => {
    const input = "a\n\n\nb\n\nc";
    const result = normalizeWhitespace(input);
    const lines = result.split("\n");
    assert.strictEqual(lines.length, 3);
  });

  it("trims leading and trailing whitespace on each line", () => {
    const input = "  hello   \n  world  ";
    const result = normalizeWhitespace(input);
    assert.strictEqual(result, "hello\nworld");
  });
});

// ---------------------------------------------------------------------------
// normalizeIdentifiers
// ---------------------------------------------------------------------------

describe("normalizeIdentifiers", () => {
  it("replaces user identifiers with generic placeholders", () => {
    const input = "const myVar = 42;\nfunction myFunc() { return myVar; }";
    const result = normalizeIdentifiers(input);
    // myVar and myFunc should be normalized to id_0, id_1 (or similar)
    assert.ok(!result.includes("myVar"));
    assert.ok(!result.includes("myFunc"));
    assert.ok(result.includes("id_"));
    // Reserved words preserved
    assert.ok(result.includes("const"));
    assert.ok(result.includes("function"));
    assert.ok(result.includes("return"));
  });

  it("preserves language keywords", () => {
    const input = "if (x) { for (let i = 0; i < n; i++) { return i; } }";
    const result = normalizeIdentifiers(input);
    for (const kw of ["if", "for", "let", "return"]) {
      assert.ok(result.includes(kw), `Should preserve keyword: ${kw}`);
    }
  });

  it("maps the same identifier to the same placeholder", () => {
    const input = "const foo = 1;\nconst bar = foo + foo;";
    const result = normalizeIdentifiers(input);
    // foo appears 3 times, should get the same id each time
    // Count occurrences of the first generated id
    const matches = result.match(/const (id_\d+) = 1;/);
    assert.ok(matches, "Should have normalized the first declaration");
    const idForFoo = matches[1];
    const occurrences = (result.match(new RegExp("\\b" + idForFoo + "\\b", "g")) || []).length;
    assert.strictEqual(occurrences, 3, "foo should be normalized to the same id across all occurrences");
  });
});

// ---------------------------------------------------------------------------
// tokenize
// ---------------------------------------------------------------------------

describe("tokenize", () => {
  it("extracts identifiers, keywords, and operators as tokens", () => {
    const tokens = tokenize("const x = y + 1;");
    assert.ok(tokens.includes("const"));
    assert.ok(tokens.includes("x"));
    assert.ok(tokens.includes("="));
    assert.ok(tokens.includes("y"));
    assert.ok(tokens.includes("+"));
    assert.ok(tokens.includes("NUM"));
  });

  it("handles multi-character operators", () => {
    const tokens = tokenize("a === b && c <= d => e !== f");
    assert.ok(tokens.includes("==="), "should include ===");
    assert.ok(tokens.includes("&&"), "should include &&");
    assert.ok(tokens.includes("<="), "should include <=");
    assert.ok(tokens.includes("!=="), "should include !==");
    assert.ok(tokens.includes("=>"), "should include =>");
  });

  it("replaces string literals with STRING placeholder", () => {
    const tokens = tokenize("const msg = 'hello world';");
    assert.ok(tokens.includes("STRING"));
  });
});

// ---------------------------------------------------------------------------
// extractNGrams
// ---------------------------------------------------------------------------

describe("extractNGrams", () => {
  it("extracts n-grams of the specified size", () => {
    const tokens = ["a", "b", "c", "d", "e"];
    const trigrams = extractNGrams(tokens, 3);
    assert.strictEqual(trigrams.length, 3);
  });

  it("returns empty array when tokens are fewer than n", () => {
    const tokens = ["a", "b"];
    const trigrams = extractNGrams(tokens, 3);
    assert.strictEqual(trigrams.length, 0);
  });
});

// ---------------------------------------------------------------------------
// jaccardSimilarity
// ---------------------------------------------------------------------------

describe("jaccardSimilarity", () => {
  it("returns 1 for identical sets", () => {
    const a = new Set(["x", "y", "z"]);
    const b = new Set(["x", "y", "z"]);
    assert.strictEqual(jaccardSimilarity(a, b), 1);
  });

  it("returns 0 for disjoint sets", () => {
    const a = new Set(["a", "b"]);
    const b = new Set(["c", "d"]);
    assert.strictEqual(jaccardSimilarity(a, b), 0);
  });

  it("returns correct similarity for overlapping sets", () => {
    const a = new Set(["a", "b", "c"]);
    const b = new Set(["b", "c", "d"]);
    // intersection = 2 (b, c), union = 4 (a, b, c, d)
    assert.strictEqual(jaccardSimilarity(a, b), 0.5);
  });

  it("returns 1 for two empty sets", () => {
    assert.strictEqual(jaccardSimilarity(new Set(), new Set()), 1);
  });
});

// ---------------------------------------------------------------------------
// structuralSignature
// ---------------------------------------------------------------------------

describe("structuralSignature", () => {
  it("extracts control-flow keywords and braces", () => {
    const code = "function foo(a) { if (a > 0) { return a; } else { return -a; } }";
    const sig = structuralSignature(code);
    assert.ok(sig.includes("function"));
    assert.ok(sig.includes("if"));
    assert.ok(sig.includes("else"));
    assert.ok(sig.includes("return"));
    assert.ok(sig.includes("{"));
    assert.ok(sig.includes("}"));
  });

  it("excludes non-structural tokens like identifiers and operators", () => {
    const code = "const x = obj.method(y + z);";
    const sig = structuralSignature(code);
    assert.ok(!sig.includes("x"));
    assert.ok(!sig.includes("obj"));
    assert.ok(!sig.includes("method"));
    assert.ok(!sig.includes("y"));
    assert.ok(!sig.includes("z"));
    assert.ok(!sig.includes("+"));
    assert.ok(sig.includes("const"));
  });
});

// ---------------------------------------------------------------------------
// splitIntoBlocks
// ---------------------------------------------------------------------------

describe("splitIntoBlocks", () => {
  it("splits code into contiguous non-blank blocks", () => {
    const code = "a\nb\nc\nd\ne\nf\n\nx\ny\nz\nw\nv\nu";
    const { contiguous } = splitIntoBlocks(code, 4);
    assert.ok(contiguous.length >= 1, "Should have at least one block");
    for (const block of contiguous) {
      assert.ok(block.startLine > 0);
      assert.ok(block.endLine >= block.startLine);
      assert.ok(block.code.split("\n").length >= 4);
    }
  });

  it("skips blocks smaller than minLines", () => {
    const code = "a\nb\nc\n\nx\ny\nz\nw\nv\nu";
    const { contiguous } = splitIntoBlocks(code, 5);
    // First block is only 3 lines, should be skipped
    assert.strictEqual(contiguous.length, 1);
    assert.strictEqual(contiguous[0].code.split("\n").length, 6);
  });
});

// ---------------------------------------------------------------------------
// CloneDetector
// ---------------------------------------------------------------------------

describe("CloneDetector", () => {
  describe("constructor", () => {
    it("accepts options", () => {
      const detector = new CloneDetector({ minLines: 10, similarityThreshold: 0.9 });
      assert.strictEqual(detector._options.minLines, 10);
      assert.strictEqual(detector._options.similarityThreshold, 0.9);
    });

    it("uses defaults when no options are provided", () => {
      const detector = new CloneDetector();
      assert.strictEqual(detector._options.minLines, 6);
      assert.strictEqual(detector._options.similarityThreshold, 0.8);
      assert.strictEqual(detector._options.minTokens, 50);
    });
  });

  describe("findExactClones", () => {
    it("detects identical code blocks across two files", () => {
      const detector = new CloneDetector({ minLines: 3 });
      const duplicateBlock =
        "function add(a, b) {\n" +
        "  const result = a + b;\n" +
        "  return result;\n" +
        "}";

      const files = [
        { path: "/a/file1.js", content: "const x = 1;\n\n" + duplicateBlock + "\n\nconst y = 2;" },
        { path: "/b/file2.js", content: "const z = 3;\n\n" + duplicateBlock + "\n\nconst w = 4;" },
      ];

      const clones = detector.findExactClones(files);
      assert.ok(clones.length > 0, "Should detect at least one exact clone group");
      assert.strictEqual(clones[0].similarity, 1.0);
      assert.strictEqual(clones[0].blocks.length, 2);
    });

    it("detects exact clones within the same file", () => {
      const detector = new CloneDetector({ minLines: 2 });
      const block = "const x = 1;\nconst y = 2;";
      const files = [
        { path: "/c/file3.js", content: block + "\n\nconst z = 3;\n\n" + block },
      ];

      const clones = detector.findExactClones(files);
      assert.ok(clones.length > 0, "Should detect clones within the same file");
    });

    it("returns empty array when no clones exist", () => {
      const detector = new CloneDetector({ minLines: 3 });
      const files = [
        { path: "/d/a.js", content: "const a = 1;\nconst b = 2;\nconst c = 3;" },
        { path: "/e/b.js", content: "const x = 9;\nconst y = 8;\nconst z = 7;" },
      ];

      const clones = detector.findExactClones(files);
      assert.strictEqual(clones.length, 0);
    });

    it("respects minLines option", () => {
      const detector = new CloneDetector({ minLines: 50 });
      const block = "const a = 1;\nconst b = 2;";
      const files = [
        { path: "/f/a.js", content: block },
        { path: "/g/b.js", content: block },
      ];

      const clones = detector.findExactClones(files);
      assert.strictEqual(clones.length, 0, "Should not detect clones shorter than minLines");
    });
  });

  describe("findNearClones", () => {
    it("detects similar code blocks above the threshold", () => {
      const detector = new CloneDetector({
        minLines: 4,
        minTokens: 10,
        similarityThreshold: 0.5,
      });

      // Nearly identical blocks — same variable names, extra line in one
      const block1 =
        "function processData(items) {\n" +
        "  const results = [];\n" +
        "  for (let i = 0; i < items.length; i++) {\n" +
        "    const item = items[i];\n" +
        "    results.push(item * 2);\n" +
        "  }\n" +
        "  return results;\n" +
        "}";

      // Nearly the same — just a renamed function and one extra log line
      const block2 =
        "function processData(items) {\n" +
        "  const results = [];\n" +
        "  for (let i = 0; i < items.length; i++) {\n" +
        "    const item = items[i];\n" +
        "    console.log(item);\n" +
        "    results.push(item * 2);\n" +
        "  }\n" +
        "  return results;\n" +
        "}";

      const files = [
        { path: "/h/a.js", content: block1 },
        { path: "/i/b.js", content: block2 },
      ];

      const clones = detector.findNearClones(files);
      assert.ok(clones.length > 0, "Should detect near clones for similar code");
    });

    it("does not detect clones when similarity is below threshold", () => {
      const detector = new CloneDetector({
        minLines: 4,
        minTokens: 50,
        similarityThreshold: 0.99,
      });

      // These should be quite different
      const block1 =
        "function fetchUsers() {\n" +
        "  return db.query('SELECT * FROM users');\n" +
        "}\n" +
        "module.exports = { fetchUsers };\n";

      const block2 =
        "class EventEmitter {\n" +
        "  constructor() { this._events = {}; }\n" +
        "  on(event, handler) { }\n" +
        "  emit(event, data) { }\n" +
        "}\n" +
        "module.exports = { EventEmitter };\n";

      const files = [
        { path: "/j/a.js", content: block1 },
        { path: "/k/b.js", content: block2 },
      ];

      const clones = detector.findNearClones(files);
      assert.strictEqual(clones.length, 0, "Should not detect near clones below threshold");
    });
  });

  describe("findStructuralClones", () => {
    it("detects structurally identical code with different identifiers", () => {
      const detector = new CloneDetector({
        minLines: 4,
        similarityThreshold: 0.7,
      });

      const block1 =
        "function getUser(id) {\n" +
        "  if (!id) { throw new Error('Missing id'); }\n" +
        "  const user = db.find(id);\n" +
        "  if (!user) { return null; }\n" +
        "  return user;\n" +
        "}";

      const block2 =
        "function getProduct(sku) {\n" +
        "  if (!sku) { throw new Error('Missing sku'); }\n" +
        "  const product = catalog.lookup(sku);\n" +
        "  if (!product) { return null; }\n" +
        "  return product;\n" +
        "}";

      const files = [
        { path: "/l/users.js", content: block1 },
        { path: "/m/products.js", content: block2 },
      ];

      const clones = detector.findStructuralClones(files);
      assert.ok(clones.length > 0, "Should detect structural clones despite different names");
    });

    it("does not detect structural clones in completely different structures", () => {
      const detector = new CloneDetector({
        minLines: 4,
        similarityThreshold: 0.8,
      });

      const block1 =
        "for (let i = 0; i < n; i++) {\n" +
        "  for (let j = 0; j < m; j++) {\n" +
        "    matrix[i][j] = i * j;\n" +
        "  }\n" +
        "}";

      const block2 =
        "if (condition) {\n" +
        "  return result;\n" +
        "} else if (other) {\n" +
        "  return fallback;\n" +
        "} else {\n" +
        "  return defaultValue;\n" +
        "}";

      const files = [
        { path: "/n/matrix.js", content: block1 },
        { path: "/o/conditional.js", content: block2 },
      ];

      const clones = detector.findStructuralClones(files);
      // These have very different structures, should not match
      // (May still match if small enough — but unlikely with high threshold)
      const validClones = clones.filter((c) => c.similarity >= 0.8);
      assert.strictEqual(validClones.length, 0, "Different structures should not match");
    });
  });

  describe("detect", () => {
    it("runs all three detection strategies and returns combined results", () => {
      const detector = new CloneDetector({ minLines: 4, minTokens: 15 });

      const commonBlock =
        "function common() {\n" +
        "  const data = loadData();\n" +
        "  const filtered = data.filter(x => x.active);\n" +
        "  return filtered;\n" +
        "}";

      const files = [
        { path: "/p/a.js", content: commonBlock },
        { path: "/q/b.js", content: commonBlock },
      ];

      // Full detect
      const result = detector.detect(files);

      assert.ok(result.groups, "Should return groups");
      assert.ok(result.stats, "Should return stats");
      assert.ok(typeof result.summary === "string", "Should return a summary string");
      assert.ok(result.stats.totalCloneGroups > 0, "Should detect clones");
      assert.ok(result.stats.affectedFiles >= 2, "Should reference at least 2 files");
      assert.ok(result.stats.byType.exact > 0, "Should detect at least exact clones");
    });

    it("accepts option overrides", () => {
      const detector = new CloneDetector({ minLines: 50 });
      const block = "const a = 1;\nconst b = 2;";

      const files = [
        { path: "/r/a.js", content: block },
        { path: "/s/b.js", content: block },
      ];

      // Override with lower minLines
      const result = detector.detect(files, { minLines: 2 });
      assert.ok(result.stats.totalCloneGroups > 0, "Should detect clones with overridden options");
    });
  });

  describe("getCloneGroups", () => {
    it("returns clone groups after detect() has been called", () => {
      const detector = new CloneDetector({ minLines: 2 });
      const block = "const a = 1;\nconst b = 2;";
      const files = [
        { path: "/t/a.js", content: block },
        { path: "/u/b.js", content: block },
      ];

      detector.detect(files);
      const groups = detector.getCloneGroups();
      assert.ok(Array.isArray(groups), "Should return an array");
      assert.ok(groups.length > 0, "Should have at least one group");
      assert.ok(groups[0].blocks, "Each group should have blocks");
      assert.ok(groups[0].type, "Each group should have a type");
      assert.ok(typeof groups[0].similarity === "number", "Each group should have similarity");
    });

    it("returns empty array when detect has not been called", () => {
      const detector = new CloneDetector();
      const groups = detector.getCloneGroups();
      assert.ok(Array.isArray(groups));
      assert.strictEqual(groups.length, 0);
    });
  });

  describe("summary", () => {
    it("produces a descriptive summary for clones found", () => {
      const detector = new CloneDetector({ minLines: 3 });
      const block =
        "function test() {\n" +
        "  return true;\n" +
        "}\n";

      const files = [
        { path: "/v/a.js", content: block },
        { path: "/w/b.js", content: block },
      ];

      const result = detector.detect(files);
      assert.ok(result.summary.includes("clone"), "Summary should mention clones");
      assert.ok(result.summary.includes("file"), "Summary should mention files");
    });

    it("produces a 'no clones' summary when nothing is found", () => {
      const detector = new CloneDetector({ minLines: 50, similarityThreshold: 0.99 });
      const files = [
        { path: "/x/a.js", content: "const a = 1;" },
        { path: "/y/b.js", content: "const b = 2;" },
      ];

      const result = detector.detect(files);
      assert.ok(result.summary.includes("No code clones"), "Should indicate no clones found");
    });
  });
});
