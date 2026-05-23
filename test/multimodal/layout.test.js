"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const { LayoutEngine, G } = require("../../src/multimodal/layout");

describe("LayoutEngine", () => {
  const engine = new LayoutEngine({ columns: 80, rows: 24, ansiEnabled: true });

  describe("splitHorizontal()", () => {
    it("creates horizontal panels side by side", () => {
      const panels = [
        { content: "left\npanel", title: "Left" },
        { content: "right\npanel", title: "Right" },
      ];
      const result = engine.splitHorizontal(panels);

      assert.ok(result.includes("Left"), "should include left title");
      assert.ok(result.includes("Right"), "should include right title");
      assert.ok(result.includes("left"), "should include left content");
      assert.ok(result.includes("right"), "should include right content");
      // Should be on fewer lines than combined (side by side)
      const lines = result.split("\n");
      assert.ok(lines.length <= 4, "panels should be side by side, not stacked");
    });

    it("respects percentage width specifications", () => {
      const panels = [
        { content: "short", width: "30%", title: "A" },
        { content: "this is a wider content panel", width: "70%", title: "B" },
      ];
      const result = engine.splitHorizontal(panels);

      assert.ok(result.includes("A"), "should include panel A");
      assert.ok(result.includes("B"), "should include panel B");
    });

    it("respects numeric width specifications", () => {
      const panels = [
        { content: "col1", width: 15 },
        { content: "col2", width: 25 },
        { content: "col3", width: 30 },
      ];
      const result = engine.splitHorizontal(panels);
      assert.ok(result.includes("col1"), "should include first column");
      assert.ok(result.includes("col2"), "should include second column");
      assert.ok(result.includes("col3"), "should include third column");
    });

    it("handles empty panel array", () => {
      const result = engine.splitHorizontal([]);
      assert.strictEqual(result, "", "empty panels should yield empty string");
    });

    it("includes vertical separators between panels", () => {
      const panels = [
        { content: "one", title: "T1" },
        { content: "two", title: "T2" },
      ];
      const result = engine.splitHorizontal(panels, { gutter: 1 });
      // With gutter > 0, there should be vertical bar separators between panels
      assert.ok(result.includes("│"), "should include vertical separators");
    });
  });

  describe("splitVertical()", () => {
    it("creates vertically stacked panels with borders", () => {
      const panels = [
        { content: "Top\ncontent", title: "Top Panel", height: 5 },
        { content: "Bottom\ncontent", title: "Bottom Panel", height: 5 },
      ];
      const result = engine.splitVertical(panels);

      assert.ok(result.includes("Top Panel"), "should include top title");
      assert.ok(result.includes("Bottom Panel"), "should include bottom title");
      assert.ok(result.includes("Top\ncontent") || result.includes("Top"), "should include top content");
      assert.ok(result.includes("Bottom\ncontent") || result.includes("Bottom"), "should include bottom content");
      assert.ok(result.includes("╭"), "should have box-drawing borders");
      assert.ok(result.includes("╰"), "should have box-drawing borders");
    });

    it("handles percentage height specifications", () => {
      const panels = [
        { content: "small", height: "30%" },
        { content: "large", height: "70%" },
      ];
      const result = engine.splitVertical(panels);
      assert.ok(result.includes("small"), "should include first panel");
      assert.ok(result.includes("large"), "should include second panel");
    });
  });

  describe("createGrid()", () => {
    it("creates a grid with rows and columns", () => {
      const content = [
        ["A1", "B1", "C1"],
        ["A2", "B2", "C2"],
      ];
      const result = engine.createGrid(2, 3, content, { colWidth: 15, rowHeight: 2 });

      assert.ok(result.includes("A1"), "should include cell A1");
      assert.ok(result.includes("B1"), "should include cell B1");
      assert.ok(result.includes("C1"), "should include cell C1");
      assert.ok(result.includes("A2"), "should include cell A2");
      assert.ok(result.includes("C2"), "should include cell C2");
      assert.ok(result.includes("╭"), "should have grid borders");
      assert.ok(result.includes("┼") || result.includes("┬"), "should have grid intersections");
    });

    it("supports function content generator", () => {
      const result = engine.createGrid(2, 2, (row, col) => `R${row}C${col}`, { colWidth: 10, rowHeight: 1 });

      assert.ok(result.includes("R0C0"), "should include generated R0C0");
      assert.ok(result.includes("R0C1"), "should include generated R0C1");
      assert.ok(result.includes("R1C0"), "should include generated R1C0");
      assert.ok(result.includes("R1C1"), "should include generated R1C1");
    });

    it("handles zero dimensions gracefully", () => {
      const result = engine.createGrid(0, 0, []);
      assert.strictEqual(result, "", "zero grid should yield empty string");
    });
  });

  describe("createTabs()", () => {
    it("creates tabbed interface with active tab content", () => {
      const tabs = [
        { label: "General", content: "general settings content", active: true },
        { label: "Advanced", content: "advanced settings content" },
        { label: "Help", content: "help page content" },
      ];
      const result = engine.createTabs(tabs);

      assert.ok(result.includes("General"), "should include General tab");
      assert.ok(result.includes("Advanced"), "should include Advanced tab");
      assert.ok(result.includes("Help"), "should include Help tab");
      assert.ok(result.includes("general settings content"), "should show active tab content");
      assert.ok(!result.includes("advanced settings content"), "should not show inactive tab content");
    });

    it("supports explicit activeIndex", () => {
      const tabs = [
        { label: "Tab A", content: "content A" },
        { label: "Tab B", content: "content B" },
      ];
      const result = engine.createTabs(tabs, { activeIndex: 1 });

      assert.ok(result.includes("content B"), "should show second tab content");
      assert.ok(!result.includes("content A"), "should not show first tab content");
    });

    it("handles empty tabs", () => {
      const result = engine.createTabs([]);
      assert.strictEqual(result, "", "empty tabs should yield empty string");
    });
  });

  describe("createPanel()", () => {
    it("creates a bordered panel with title", () => {
      const result = engine.createPanel("Test Panel", "Hello panel world", "default");

      assert.ok(result.includes("Test Panel"), "should include title");
      assert.ok(result.includes("Hello panel world"), "should include content");
      assert.ok(result.includes("╭"), "should have top-left corner");
      assert.ok(result.includes("╮"), "should have top-right corner");
      assert.ok(result.includes("╰"), "should have bottom-left corner");
      assert.ok(result.includes("╯"), "should have bottom-right corner");
      assert.ok(result.includes("│"), "should have vertical borders");
    });

    it("applies style variants to borders", () => {
      const primaryResult = engine.createPanel("Info", "content", "primary");
      const errorResult = engine.createPanel("Error", "content", "error");
      const successResult = engine.createPanel("Success", "content", "success");

      assert.ok(primaryResult.includes("╭"), "primary panel should have borders");
      assert.ok(errorResult.includes("╭"), "error panel should have borders");
      assert.ok(successResult.includes("╭"), "success panel should have borders");
    });

    it("truncates content at maxHeight", () => {
      const manyLines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
      const result = engine.createPanel("Truncated", manyLines, "default", { maxHeight: 5 });

      assert.ok(result.includes("line 1"), "should include first line");
      assert.ok(!result.includes("line 6"), "should not include line beyond maxHeight");
      assert.ok(result.includes("more line"), "should show truncation notice");
    });

    it("supports collapsible panel indicator", () => {
      const result = engine.createPanel("Collapse", "content", "default", { collapsible: true });
      assert.ok(result.includes("▶"), "should include collapse indicator");
    });
  });

  describe("createStatusBar()", () => {
    it("creates a status bar with left, center, and right items", () => {
      const items = [
        { text: "LEFT", align: "left" },
        { text: "CENTER", align: "center" },
        { text: "RIGHT", align: "right" },
      ];
      const result = engine.createStatusBar(items);

      assert.ok(result.includes("LEFT"), "should include left text");
      assert.ok(result.includes("CENTER"), "should include center text");
      assert.ok(result.includes("RIGHT"), "should include right text");
    });

    it("creates top-positioned status bar", () => {
      const items = [{ text: "top bar info", align: "left" }];
      const result = engine.createStatusBar(items, { position: "top" });

      assert.ok(result.includes("top bar info"), "should include text");
      assert.ok(result.includes("─"), "should have top separator line");
    });

    it("handles simple string items as left-aligned", () => {
      const items = ["item1", "item2"];
      const result = engine.createStatusBar(items);

      assert.ok(result.includes("item1"), "should include first item");
      assert.ok(result.includes("item2"), "should include second item");
    });

    it("handles empty items gracefully", () => {
      const result = engine.createStatusBar([]);
      assert.strictEqual(result, "", "empty items should yield empty string");
    });
  });

  describe("divider()", () => {
    it("creates a horizontal rule", () => {
      const result = engine.divider();

      assert.ok(result.includes("─"), "should include horizontal rule character");
    });

    it("creates a labeled divider", () => {
      const result = engine.divider({ label: "Section 1" });

      assert.ok(result.includes("Section 1"), "should include label");
      assert.ok(result.includes("─"), "should include horizontal rule");
    });
  });

  describe("progressBar()", () => {
    it("renders a progress bar", () => {
      const result = engine.progressBar(50, 100);

      assert.ok(result.includes("50%"), "should show percentage");
      assert.ok(result.includes("▓"), "should use fill characters");
    });

    it("renders with label", () => {
      const result = engine.progressBar(75, 100, { label: "Loading" });

      assert.ok(result.includes("Loading"), "should include label");
      assert.ok(result.includes("75%"), "should show percentage");
    });

    it("clamps values outside range", () => {
      const result = engine.progressBar(200, 100);
      assert.ok(result.includes("100%"), "should clamp to 100%");

      const result2 = engine.progressBar(-50, 100);
      assert.ok(result2.includes("0%"), "should clamp to 0%");
    });
  });

  describe("G glyph constants", () => {
    it("exports box-drawing glyph set", () => {
      assert.ok(G.h, "should have horizontal");
      assert.ok(G.v, "should have vertical");
      assert.ok(G.tl, "should have top-left");
      assert.ok(G.tr, "should have top-right");
      assert.ok(G.bl, "should have bottom-left");
      assert.ok(G.br, "should have bottom-right");
      assert.ok(G.t, "should have tee-down");
      assert.ok(G.b, "should have tee-up");
      assert.ok(G.l, "should have tee-right");
      assert.ok(G.r, "should have tee-left");
      assert.ok(G.x, "should have cross");
    });

    it("provides shade characters for progress", () => {
      assert.ok(G.shade, "should have shade");
      assert.ok(G.shadeD, "should have dark shade");
      assert.ok(G.shadeDD, "should have darkest shade");
    });
  });

  describe("_splitToLines()", () => {
    it("wraps long lines at word boundaries", () => {
      const result = engine._splitToLines("hello world this is a long line", 20);
      assert.ok(result.length > 1, "long line should be wrapped");
    });

    it("preserves empty lines", () => {
      const result = engine._splitToLines("line1\n\nline2", 80);
      assert.strictEqual(result[1], "", "empty line should be preserved");
    });

    it("returns empty string for null input", () => {
      const result = engine._splitToLines(null, 80);
      assert.deepStrictEqual(result, [""], "null should yield array with empty string");
    });
  });
});
