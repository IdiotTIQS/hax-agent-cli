"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { FilePreview, EXT_TO_MIME, formatBytes } = require("../../src/multimodal/preview");

describe("FilePreview", () => {
  let tempDir;
  let preview;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "haxagent-preview-test-"));
    preview = new FilePreview({ columns: 80 });
  });

  afterEach(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });

  // ── Helpers ────────────────────────────────────────────────────────

  function createFile(name, content) {
    const filePath = path.join(tempDir, name);
    if (typeof content === "string") {
      fs.writeFileSync(filePath, content, "utf8");
    } else {
      fs.writeFileSync(filePath, content);
    }
    return filePath;
  }

  // ── Tests ──────────────────────────────────────────────────────────

  describe("preview() dispatch", () => {
    it("previews a text file with line numbers", () => {
      const filePath = createFile("test.txt", "line one\nline two\nline three\n");
      const result = preview.preview(filePath);

      assert.ok(result.includes("test.txt"), "should include filename");
      assert.ok(result.includes("line one"), "should include first line");
      assert.ok(result.includes("line two"), "should include second line");
      assert.ok(result.includes("line"), "should show line count");
      assert.ok(result.includes("╭"), "should have border decoration");
    });

    it("previews a small JSON file", () => {
      const filePath = createFile("data.json", JSON.stringify({ key: "value", num: 42 }, null, 2));
      const result = preview.preview(filePath);

      assert.ok(result.includes("data.json"), "should include filename");
      assert.ok(result.includes("key"), "should include JSON content");
      assert.ok(result.includes("JSON"), "should detect language");
    });

    it("handles non-existent file gracefully", () => {
      const result = preview.preview("/nonexistent/path/file.txt");
      assert.ok(result.includes("not found") || result.includes("Error"), "should report file not found");
    });

    it("handles directory path gracefully", () => {
      const result = preview.preview(tempDir);
      assert.ok(result.includes("Not a file") || result.includes("Error"), "should report not a file");
    });
  });

  describe("previewImage()", () => {
    it("detects and previews PNG metadata", () => {
      // Minimal valid PNG: 8-byte signature + IHDR chunk (13 bytes)
      const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      const ihdr = Buffer.alloc(25);
      ihdr.writeUInt32BE(13, 0); // IHDR length
      ihdr.write("IHDR", 4);
      ihdr.writeUInt32BE(100, 8); // width
      ihdr.writeUInt32BE(200, 12); // height
      ihdr[16] = 8; // bit depth
      ihdr[17] = 2; // color type (RGB)
      const crc = Buffer.alloc(4);
      const pngData = Buffer.concat([signature, ihdr, crc]);

      const filePath = createFile("test.png", pngData);
      const result = preview.previewImage(filePath);

      assert.ok(result.includes("test.png"), "should include filename");
      assert.ok(result.includes("PNG"), "should detect PNG format");
      assert.ok(result.includes("100"), "should include width");
      assert.ok(result.includes("200"), "should include height");
      assert.ok(result.includes("RGB"), "should include color type");
    });

    it("detects JPEG signature", () => {
      const jpegHeader = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
      // Pad to 64 bytes minimum for the header read
      const padding = Buffer.alloc(52, 0);
      const jpegData = Buffer.concat([jpegHeader, padding]);

      const filePath = createFile("photo.jpg", jpegData);
      const result = preview.previewImage(filePath);

      assert.ok(result.includes("photo.jpg"), "should include filename");
      assert.ok(result.includes("JPEG"), "should detect JPEG format");
    });

    it("detects GIF metadata", () => {
      // GIF89a header + logical screen descriptor
      const header = Buffer.alloc(13);
      header.write("GIF89a", 0);
      header.writeUInt16LE(50, 6);  // width
      header.writeUInt16LE(80, 8);  // height
      // Pad to 64 bytes
      const gifData = Buffer.concat([header, Buffer.alloc(51, 0)]);

      const filePath = createFile("anim.gif", gifData);
      const result = preview.previewImage(filePath);

      assert.ok(result.includes("anim.gif"), "should include filename");
      assert.ok(result.includes("GIF"), "should detect GIF format");
      assert.ok(result.includes("50"), "should include width");
      assert.ok(result.includes("80"), "should include height");
    });

    it("handles invalid image file gracefully", () => {
      const filePath = createFile("bad.png", Buffer.from("not an image"));
      const result = preview.previewImage(filePath);
      // Should not crash; outputs metadata with unknown format
      assert.ok(typeof result === "string", "should return a string");
    });
  });

  describe("previewDocument()", () => {
    it("shows content with line numbers", () => {
      const lines = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`);
      const filePath = createFile("doc.txt", lines.join("\n"));
      const result = preview.previewDocument(filePath);

      assert.ok(result.includes("doc.txt"), "should include filename");
      assert.ok(result.includes("line 1"), "should include first line");
      assert.ok(result.includes("1"), "should show line number 1");
      assert.ok(result.includes("│"), "should have gutter separator");
    });

    it("detects JavaScript language", () => {
      const filePath = createFile("app.js", "const x = 1;\nconsole.log(x);\n");
      const result = preview.previewDocument(filePath);

      assert.ok(result.includes("JavaScript"), "should detect JavaScript");
    });

    it("detects Python language", () => {
      const filePath = createFile("script.py", "print('hello')\ndef foo():\n    pass\n");
      const result = preview.previewDocument(filePath);

      assert.ok(result.includes("Python"), "should detect Python");
    });

    it("truncates long files to maxLines", () => {
      const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
      const filePath = createFile("long.txt", lines.join("\n"));
      const result = preview.previewDocument(filePath, { maxLines: 10 });

      assert.ok(result.includes("line 10"), "should include line 10");
      assert.ok(!result.includes("line 11"), "should not include line 11");
      assert.ok(result.includes("more line"), "should show truncation notice");
    });
  });

  describe("previewBinary()", () => {
    it("renders hex dump for binary data", () => {
      const data = Buffer.alloc(48);
      for (let i = 0; i < 48; i++) data[i] = i;
      const filePath = createFile("data.bin", data);
      const result = preview.previewBinary(filePath);

      assert.ok(result.includes("data.bin"), "should include filename");
      assert.ok(result.includes("Binary file"), "should indicate binary");
      assert.ok(result.includes("Offset"), "should show offset column");
      assert.ok(result.includes("00"), "should contain hex values");
      assert.ok(result.includes("01"), "should contain second hex value");
    });

    it("renders ASCII representation for printable bytes", () => {
      const data = Buffer.from("Hello World! 123");
      const filePath = createFile("text.bin", data);
      const result = preview.previewBinary(filePath);

      assert.ok(result.includes("Hello"), "should show ASCII representation");
      assert.ok(result.includes("48"), "should show hex for 'H' (0x48)");
    });

    it("respects maxHexBytes limit", () => {
      const data = Buffer.alloc(1024, 0xAA);
      const filePath = createFile("large.bin", data);
      const result = preview.previewBinary(filePath, { maxHexBytes: 64 });

      // Should indicate more data exists
      assert.ok(result.includes("more not shown"), "should indicate truncation");
      // 1024 - 64 = 960 remaining
      assert.ok(result.includes("960"), "should mention remaining bytes");
    });
  });

  describe("previewArchive()", () => {
    it("detects ZIP archive type", () => {
      // Minimal valid ZIP: local file header PK\x03\x04 + end-of-central-dir
      const zipData = Buffer.alloc(128);
      zipData[0] = 0x50; zipData[1] = 0x4B; zipData[2] = 0x03; zipData[3] = 0x04;
      const filePath = createFile("archive.zip", zipData);
      const result = preview.previewArchive(filePath);

      assert.ok(result.includes("archive.zip"), "should include filename");
      assert.ok(result.includes("ZIP"), "should detect ZIP type");
    });

    it("detects GZip archive type", () => {
      const gzData = Buffer.alloc(32);
      gzData[0] = 0x1F; gzData[1] = 0x8B; gzData[2] = 0x08;
      const filePath = createFile("file.tar.gz", gzData);
      const result = preview.previewArchive(filePath);

      assert.ok(result.includes("file.tar.gz"), "should include filename");
      assert.ok(result.includes("GZip") || result.includes("archive"), "should detect gzip");
    });
  });

  describe("type detection", () => {
    it("detects common image extensions", () => {
      const filePath = createFile("icon.png", Buffer.from([0x89, 0x50, 0x4E, 0x47]));
      const result = preview.preview(filePath);
      // Image preview output includes image-specific formatting
      assert.ok(result.includes("icon.png"), "should include filename");
    });
  });

  describe("formatBytes utility", () => {
    it("formats file sizes", () => {
      assert.strictEqual(formatBytes(0), "0 B");
      assert.strictEqual(formatBytes(1), "1 B");
      assert.strictEqual(formatBytes(1024), "1.0 KB");
      assert.strictEqual(formatBytes(1536), "1.5 KB");
      assert.strictEqual(formatBytes(1048576), "1.0 MB");
    });
  });

  describe("EXT_TO_MIME mapping", () => {
    it("maps common extensions", () => {
      assert.strictEqual(EXT_TO_MIME[".js"], "text/javascript");
      assert.strictEqual(EXT_TO_MIME[".json"], "application/json");
      assert.strictEqual(EXT_TO_MIME[".png"], "image/png");
      assert.strictEqual(EXT_TO_MIME[".zip"], "application/zip");
      assert.strictEqual(EXT_TO_MIME[".txt"], "text/plain");
    });
  });
});
