"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const { MultiModalRenderer, formatBytes } = require("../../src/multimodal/renderer");

describe("MultiModalRenderer", () => {
  const renderer = new MultiModalRenderer({ columns: 80, ansiEnabled: true });

  describe("render() dispatch", () => {
    it("dispatches text type correctly", () => {
      const result = renderer.render("hello world", "text");
      assert.ok(result.includes("hello world"), "should contain the text content");
    });

    it("dispatches code type correctly", () => {
      const result = renderer.render("const x = 1;", "code", { language: "js" });
      assert.ok(result.includes("const"), "should contain the code");
      assert.ok(result.includes("╭"), "should have box-drawing top border");
      assert.ok(result.includes("╰"), "should have box-drawing bottom border");
    });

    it("dispatches table type correctly", () => {
      const data = {
        columns: ["Name", "Value"],
        rows: [["foo", 1], ["bar", 2]],
      };
      const result = renderer.render(data, "table");
      assert.ok(result.includes("Name"), "should contain column header");
      assert.ok(result.includes("foo"), "should contain row data");
      assert.ok(result.includes("bar"), "should contain second row");
    });

    it("returns fallback for unknown type", () => {
      const result = renderer.render("something", "unknown");
      // Falls back to text
      assert.ok(result.includes("something"), "should render as text for unknown type");
    });

    it("renders empty content gracefully", () => {
      const result = renderer.render(null, "text");
      assert.ok(result.includes("No content"), "should show empty placeholder");
    });
  });

  describe("renderTable()", () => {
    it("renders a simple table with box-drawing borders", () => {
      const data = {
        columns: ["Col A", "Col B"],
        rows: [[1, 2], [3, 4]],
        title: "Test Table",
      };
      const result = renderer.renderTable(data);

      assert.ok(result.includes("Test Table"), "should include title");
      assert.ok(result.includes("Col A"), "should include first column header");
      assert.ok(result.includes("Col B"), "should include second column header");
      assert.ok(result.includes("╭"), "should have top-left corner");
      assert.ok(result.includes("╮"), "should have top-right corner");
      assert.ok(result.includes("╰"), "should have bottom-left corner");
      assert.ok(result.includes("╯"), "should have bottom-right corner");
      assert.ok(result.includes("│"), "should have vertical borders");
      assert.ok(result.includes("2 rows"), "should show row count");
    });

    it("handles empty table gracefully", () => {
      const result = renderer.renderTable(null);
      assert.ok(result.includes("No table data"), "should show empty message");
    });

    it("truncates long cell values", () => {
      const data = {
        columns: ["Short"],
        rows: [["A".repeat(100)]],
      };
      const result = renderer.renderTable(data, { maxColWidth: 10 });
      assert.ok(result.includes("..."), "long cell should be truncated");
    });
  });

  describe("renderCodeBlock()", () => {
    it("renders JavaScript with syntax highlighting", () => {
      const code = "const greeting = 'hello';\nconsole.log(greeting);";
      const result = renderer.renderCodeBlock(code, "javascript");

      assert.ok(result.includes("const"), "should contain keyword");
      assert.ok(result.includes("console"), "should contain identifier");
      assert.ok(result.includes("╭"), "should have top border");
      assert.ok(result.includes("╰"), "should have bottom border");
      assert.ok(result.includes("1"), "should have line numbers");
    });

    it("renders with line numbers by default", () => {
      const code = "line1\nline2\nline3";
      const result = renderer.renderCodeBlock(code, "text");

      assert.ok(result.includes("1"), "should show line number 1");
      assert.ok(result.includes("2"), "should show line number 2");
      assert.ok(result.includes("3"), "should show line number 3");
    });

    it("supports disabling line numbers", () => {
      const code = "test";
      const result = renderer.renderCodeBlock(code, "text", { lineNumbers: false });
      // Line numbers padded with spaces would appear — check for the absence of "│" after line num
      assert.ok(!result.match(/^\s*\d+\s*│/m), "should not have line number bar");
    });

    it("supports highlightLines option", () => {
      const code = "line1\nline2\nline3";
      const result = renderer.renderCodeBlock(code, "text", { highlightLines: [2] });

      assert.ok(result.includes("line2"), "should include the highlighted line");
    });
  });

  describe("renderDiff()", () => {
    it("renders diff output with colors", () => {
      const diff = "--- a/file.txt\n+++ b/file.txt\n@@ -1,3 +1,3 @@\n-old line\n+new line\n context\n";
      const result = renderer.renderDiff(diff);

      assert.ok(result.includes("old line"), "should include removed line");
      assert.ok(result.includes("new line"), "should include added line");
      assert.ok(result.includes("╭"), "should have box-drawing border");
      assert.ok(result.includes("+1"), "should show add count");
      assert.ok(result.includes("-1"), "should show remove count");
    });

    it("handles empty diff", () => {
      const result = renderer.renderDiff("");
      assert.ok(result.includes("No diff"), "should show empty placeholder");
    });
  });

  describe("renderImage()", () => {
    it("renders image placeholder with metadata", () => {
      const imageData = {
        path: "/test/image.png",
        width: 800,
        height: 600,
        format: "png",
        size: 123456,
      };
      const result = renderer.renderImage(imageData);

      assert.ok(result.includes("╭"), "should have border");
      assert.ok(result.includes("╯"), "should have border");
      assert.ok(result.includes("800"), "should include width");
      assert.ok(result.includes("600"), "should include height");
      assert.ok(result.includes("PNG"), "should include format");
    });

    it("handles string path input", () => {
      const result = renderer.renderImage("/path/to/image.jpg", { label: "photo" });
      assert.ok(result.includes("╭"), "should have border");
    });
  });

  describe("renderChart()", () => {
    it("renders a bar chart", () => {
      const data = [
        { label: "A", value: 30 },
        { label: "B", value: 50 },
        { label: "C", value: 20 },
      ];
      const result = renderer.renderChart(data, "bar");

      assert.ok(result.includes("A"), "should include label A");
      assert.ok(result.includes("B"), "should include label B");
      assert.ok(result.includes("█"), "should use block characters");
      assert.ok(result.includes("│"), "should have axis");
    });

    it("renders a pie chart with legend", () => {
      const data = [
        { label: "Apples", value: 40 },
        { label: "Bananas", value: 60 },
      ];
      const result = renderer.renderChart(data, "pie");

      assert.ok(result.includes("Apples"), "should include Apples label");
      assert.ok(result.includes("Bananas"), "should include Bananas label");
      assert.ok(result.includes("%"), "should show percentages");
      assert.ok(result.includes("Total"), "should show total");
    });

    it("renders a line chart", () => {
      const data = [
        { label: "Jan", value: 10 },
        { label: "Feb", value: 20 },
        { label: "Mar", value: 15 },
      ];
      const result = renderer.renderChart(data, "line");

      assert.ok(result.includes("Jan"), "should include label");
    });

    it("handles array of numbers input", () => {
      const result = renderer.renderChart([5, 10, 15], "bar");
      assert.ok(result.includes("█"), "should render bars from numbers");
    });

    it("handles empty chart data", () => {
      const result = renderer.renderChart([], "bar");
      assert.ok(result.includes("No chart data"), "should show empty message");
    });
  });

  describe("file-tree rendering", () => {
    it("renders a file tree structure", () => {
      const tree = [
        { name: "src", type: "directory", children: [
          { name: "index.js", size: 1024 },
          { name: "utils.js", size: 512 },
        ]},
        { name: "package.json", size: 256 },
      ];
      const result = renderer.render(tree, "file-tree");

      assert.ok(result.includes("src/"), "should include directory with slash");
      assert.ok(result.includes("index.js"), "should include file");
      assert.ok(result.includes("├──"), "should use tree branch characters");
      assert.ok(result.includes("└──"), "should use last tree branch");
    });
  });

  describe("key-value rendering", () => {
    it("renders key-value pairs", () => {
      const data = { name: "HaxAgent", version: "1.0.0", author: "Team" };
      const result = renderer.render(data, "key-value");

      assert.ok(result.includes("name"), "should include key");
      assert.ok(result.includes("HaxAgent"), "should include value");
      assert.ok(result.includes("version"), "should include second key");
    });

    it("renders from Map input", () => {
      const data = new Map([["key1", "val1"], ["key2", "val2"]]);
      const result = renderer.render(data, "key-value");

      assert.ok(result.includes("key1"), "should include Map key");
      assert.ok(result.includes("val1"), "should include Map value");
    });
  });

  describe("mermaid rendering", () => {
    it("renders mermaid diagram source", () => {
      const mermaid = "graph TD\n  A[Start] --> B[End]";
      const result = renderer.render(mermaid, "mermaid");

      assert.ok(result.includes("Start"), "should include node label");
      assert.ok(result.includes("End"), "should include second node");
      assert.ok(result.includes("Flowchart"), "should detect type");
    });
  });

  describe("formatBytes utility", () => {
    it("formats bytes correctly", () => {
      assert.strictEqual(formatBytes(0), "0 B");
      assert.strictEqual(formatBytes(1024), "1.0 KB");
      assert.strictEqual(formatBytes(1048576), "1.0 MB");
      assert.strictEqual(formatBytes(1073741824), "1.0 GB");
      assert.strictEqual(formatBytes(1536), "1.5 KB");
    });

    it("handles non-finite values", () => {
      assert.strictEqual(formatBytes(null), "0 B");
      assert.strictEqual(formatBytes(NaN), "0 B");
    });
  });
});
