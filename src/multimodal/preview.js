"use strict";

const fs = require("fs");
const path = require("path");
const { ANSI, THEME } = require("../renderer");
const { MultiModalRenderer } = require("./renderer");

// ── Known file signatures (magic bytes) ─────────────────────────────────

const MAGIC_SIGNATURES = new Map([
  [[0xFF, 0xD8, 0xFF], "image/jpeg"],
  [[0x89, 0x50, 0x4E, 0x47], "image/png"],
  [[0x47, 0x49, 0x46, 0x38], "image/gif"],
  [[0x52, 0x49, 0x46, 0x46], "image/webp"], // RIFF
  [[0x42, 0x4D], "image/bmp"],
  [[0x50, 0x4B, 0x03, 0x04], "application/zip"],
  [[0x1F, 0x8B], "application/gzip"],
  [[0x1F, 0x9D], "application/compress"],
  [[0x42, 0x5A, 0x68], "application/bzip2"],
  [[0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00], "application/xz"],
  [[0x25, 0x50, 0x44, 0x46], "application/pdf"],
  [[0xD0, 0xCF, 0x11, 0xE0], "application/msword"], // OLE
  [[0x7B], "application/json"], // JSON starts with {
  [[0x3C], "text/html"],       // < (could be HTML/XML)
]);

// ── Extension-based MIME mapping ────────────────────────────────────────

const EXT_TO_MIME = {
  // Images
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".gif": "image/gif", ".bmp": "image/bmp", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".tiff": "image/tiff",
  ".tif": "image/tiff",

  // Archives
  ".zip": "application/zip", ".tar": "application/tar",
  ".gz": "application/gzip", ".tgz": "application/gzip",
  ".bz2": "application/bzip2", ".xz": "application/xz",
  ".7z": "application/x-7z-compressed", ".rar": "application/x-rar-compressed",

  // Documents
  ".pdf": "application/pdf",
  ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",

  // Code / text
  ".txt": "text/plain", ".md": "text/markdown", ".rst": "text/x-rst",
  ".json": "application/json", ".yaml": "text/yaml", ".yml": "text/yaml",
  ".toml": "text/toml", ".ini": "text/ini", ".cfg": "text/ini",
  ".csv": "text/csv", ".tsv": "text/tab-separated-values",
  ".xml": "text/xml", ".html": "text/html", ".htm": "text/html",
  ".js": "text/javascript", ".mjs": "text/javascript", ".cjs": "text/javascript",
  ".jsx": "text/jsx", ".ts": "text/typescript", ".tsx": "text/typescript",
  ".py": "text/x-python", ".rb": "text/x-ruby", ".go": "text/x-go",
  ".rs": "text/x-rust", ".java": "text/x-java", ".c": "text/x-c",
  ".cpp": "text/x-c++", ".h": "text/x-c-header", ".hpp": "text/x-c++-header",
  ".css": "text/css", ".scss": "text/x-scss", ".less": "text/x-less",
  ".sh": "text/x-shellscript", ".bash": "text/x-shellscript",
  ".zsh": "text/x-shellscript", ".fish": "text/x-fish",
  ".sql": "text/x-sql", ".graphql": "text/x-graphql",
  ".dockerfile": "text/x-dockerfile",

  // Binary
  ".wasm": "application/wasm", ".bin": "application/octet-stream",
  ".exe": "application/x-msdownload", ".dll": "application/x-msdownload",
  ".so": "application/x-sharedlib", ".dylib": "application/x-mach-binary",
  ".o": "application/x-object", ".obj": "application/x-object",
  ".class": "application/x-java-class",
};

// ── Helpers ─────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

function repeatStr(ch, count) {
  if (count <= 0) return "";
  return ch.repeat(count);
}

function stripAnsi(text) {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function truncate(str, maxLen) {
  if (!str) return "";
  const s = String(str);
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + "...";
}

// ── FilePreview ─────────────────────────────────────────────────────────

class FilePreview {
  constructor(options = {}) {
    this.columns = options.columns || 80;
    this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024; // 10 MB
    this.ansiEnabled = options.ansiEnabled !== false;
    this.renderer = new MultiModalRenderer({
      columns: this.columns,
      ansiEnabled: this.ansiEnabled,
    });
  }

  // ── Main preview dispatch ──────────────────────────────────────────

  /**
   * Preview a file, auto-detecting its type.
   *
   * @param {string} filePath - Absolute or relative path to the file
   * @param {object} [options]
   * @param {number} [options.maxLines] - Max lines for text preview (default 30)
   * @param {number} [options.maxHexBytes] - Max bytes for hex dump (default 512)
   * @param {boolean} [options.forceType] - Override type detection
   * @returns {string}
   */
  preview(filePath, options = {}) {
    try {
      const resolved = path.resolve(filePath);

      // Check file exists
      let stat;
      try {
        stat = fs.statSync(resolved);
      } catch (err) {
        return this._formatError(`File not found: ${filePath}`);
      }

      if (!stat.isFile()) {
        return this._formatError(`Not a file: ${filePath}`);
      }

      if (stat.size > this.maxFileSize) {
        if (options.forceType === "binary" || options.forceType === "hex") {
          // Allow hex dump for large files but limit read
        } else {
          return this._formatWarning(
            `File too large for preview (${formatBytes(stat.size)} > ${formatBytes(this.maxFileSize)})`
          );
        }
      }

      const fileInfo = {
        path: resolved,
        name: path.basename(resolved),
        ext: path.extname(resolved).toLowerCase(),
        size: stat.size,
        mtime: stat.mtime,
      };

      // Determine type
      let previewType;
      if (options.forceType) {
        previewType = options.forceType;
      } else {
        previewType = this._detectType(resolved, stat);
      }

      // Dispatch
      switch (previewType) {
        case "image":
          return this.previewImage(resolved, { ...options, stat });
        case "binary":
        case "hex":
          return this.previewBinary(resolved, { ...options, stat });
        case "archive":
          return this.previewArchive(resolved, { ...options, stat });
        case "document":
        case "text":
        default:
          return this.previewDocument(resolved, { ...options, stat });
      }
    } catch (err) {
      return this._formatError(`Error previewing file: ${err.message}`);
    }
  }

  // ── Image preview ──────────────────────────────────────────────────

  /**
   * Preview an image file — metadata and ANSI approximation.
   *
   * @param {string} filePath - Path to image
   * @param {object} [options]
   * @returns {string}
   */
  previewImage(filePath, options = {}) {
    try {
      const resolved = path.resolve(filePath);
      const stat = options.stat || fs.statSync(resolved);

      // Read buffer for metadata
      const header = Buffer.alloc(64);
      const fd = fs.openSync(resolved, "r");
      fs.readSync(fd, header, 0, 64, 0);
      fs.closeSync(fd);

      const meta = this._parseImageMetadata(resolved, header);
      meta.size = stat.size;
      meta.mtime = stat.mtime;

      const out = [];

      // Header
      out.push(`${THEME.bold}${path.basename(resolved)}${ANSI.reset}`);

      // Metadata table
      const metaLines = [];
      if (meta.format) metaLines.push(`  ${THEME.accent}Format${ANSI.reset}     ${meta.format.toUpperCase()}`);
      if (meta.width && meta.height) metaLines.push(`  ${THEME.accent}Dimensions${ANSI.reset} ${meta.width} × ${meta.height} px`);
      metaLines.push(`  ${THEME.accent}Size${ANSI.reset}       ${formatBytes(stat.size)}`);
      if (meta.colorDepth) metaLines.push(`  ${THEME.accent}Depth${ANSI.reset}      ${meta.colorDepth} bits`);
      if (meta.colorType) metaLines.push(`  ${THEME.accent}Type${ANSI.reset}       ${meta.colorType}`);
      metaLines.push(`  ${THEME.accent}Modified${ANSI.reset}   ${stat.mtime.toISOString().replace("T", " ").slice(0, 19)}`);
      out.push(metaLines.join("\n"));

      // ANSI placeholder (reuse renderer)
      out.push("");
      out.push(this.renderer.renderImage(
        { path: resolved, ...meta },
        { width: Math.min(this.columns - 4, 60), height: 8, label: path.basename(resolved) }
      ));

      return out.join("\n");
    } catch (err) {
      return this._formatError(`Error previewing image: ${err.message}`);
    }
  }

  /**
   * Parse image metadata from the file header bytes.
   */
  _parseImageMetadata(filePath, buffer) {
    const meta = { format: "unknown" };
    const ext = path.extname(filePath).toLowerCase();

    // PNG detection
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      meta.format = "png";
      // Read IHDR: width at offset 16, height at offset 20 (big-endian)
      meta.width = buffer.readUInt32BE(16);
      meta.height = buffer.readUInt32BE(20);
      const bitDepth = buffer[24];
      const colorType = buffer[25];
      meta.colorDepth = bitDepth;
      meta.colorType = ["Grayscale", "", "RGB", "Indexed", "Grayscale+Alpha", "", "RGBA"][colorType] || `Type ${colorType}`;
    }

    // JPEG detection
    else if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      meta.format = "jpeg";
      meta.colorType = "YCbCr";
    }

    // GIF detection
    else if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
      meta.format = "gif";
      meta.width = buffer.readUInt16LE(6);
      meta.height = buffer.readUInt16LE(8);
    }

    // BMP detection
    else if (buffer[0] === 0x42 && buffer[1] === 0x4D) {
      meta.format = "bmp";
      meta.width = buffer.readUInt32LE(18);
      meta.height = buffer.readUInt32LE(22);
      meta.colorDepth = buffer.readUInt16LE(28);
    }

    // WebP detection (RIFF....WEBP)
    else if (
      buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
    ) {
      meta.format = "webp";
    }

    // Fallback from extension
    if (meta.format === "unknown" && ext) {
      const mime = EXT_TO_MIME[ext];
      if (mime && mime.startsWith("image/")) {
        meta.format = mime.replace("image/", "");
      }
    }

    return meta;
  }

  // ── Document preview ───────────────────────────────────────────────

  /**
   * Preview a text document with line numbers.
   *
   * @param {string} filePath - Path to text file
   * @param {object} [options]
   * @param {number} [options.maxLines] - Max lines to show (default 30)
   * @returns {string}
   */
  previewDocument(filePath, options = {}) {
    try {
      const resolved = path.resolve(filePath);
      const stat = options.stat || fs.statSync(resolved);

      // Check if it's a known binary format masquerading as text
      const ext = path.extname(resolved).toLowerCase();
      if (EXT_TO_MIME[ext] && EXT_TO_MIME[ext].startsWith("application/") && !["application/json"].includes(EXT_TO_MIME[ext])) {
        return this._formatWarning(
          `${path.basename(resolved)} appears to be a binary file (${EXT_TO_MIME[ext]})\nUse previewBinary() to view hex dump.`
        );
      }

      const maxLines = options.maxLines || 30;
      const content = fs.readFileSync(resolved, "utf8");
      const allLines = content.split("\n");
      const totalLines = allLines.length;
      const truncated = allLines.length > maxLines;
      const displayLines = truncated ? allLines.slice(0, maxLines) : allLines;

      const lineNumWidth = Math.max(2, String(totalLines).length);

      const out = [];

      // File header
      const lang = this._detectLanguage(resolved);
      out.push(
        `${THEME.bold}${path.basename(resolved)}${ANSI.reset}` +
        `  ${THEME.dim}${formatBytes(stat.size)} · ${totalLines} line${totalLines !== 1 ? "s" : ""}` +
        (lang ? ` · ${lang}` : "") +
        `${ANSI.reset}`
      );

      // Separator
      const innerWidth = Math.min(this.columns - 2, 100);
      out.push(`${THEME.border}╭${repeatStr("─", innerWidth)}╮${ANSI.reset}`);

      // Content lines
      for (let i = 0; i < displayLines.length; i++) {
        const lineNum = String(i + 1).padStart(lineNumWidth);
        const line = displayLines[i];
        // Truncate long lines
        const displayLine = line.length > innerWidth - lineNumWidth - 5
          ? line.slice(0, innerWidth - lineNumWidth - 8) + "..."
          : line;

        out.push(
          `${THEME.border}│${ANSI.reset} ${THEME.dim}${lineNum}${ANSI.reset} ${THEME.warning}│${ANSI.reset} ${displayLine}` +
          `${" ".repeat(Math.max(0, innerWidth - stripAnsi(displayLine).length - lineNumWidth - 5))}${THEME.border}│${ANSI.reset}`
        );
      }

      // Truncation notice
      if (truncated) {
        out.push(
          `${THEME.border}│${ANSI.reset} ${" ".repeat(lineNumWidth + 1)}${THEME.warning}│${ANSI.reset}` +
          ` ${THEME.dim}... ${totalLines - maxLines} more line${totalLines - maxLines !== 1 ? "s" : ""}${ANSI.reset}` +
          `${" ".repeat(Math.max(0, innerWidth - stripAnsi(`... ${totalLines - maxLines} more lines`).length - lineNumWidth - 7))}${THEME.border}│${ANSI.reset}`
        );
      }

      // Bottom border
      out.push(`${THEME.border}╰${repeatStr("─", innerWidth)}╯${ANSI.reset}`);

      return out.join("\n");
    } catch (err) {
      if (err.code === "ENOENT") return this._formatError(`File not found: ${filePath}`);
      try {
        // Fallback to binary preview if UTF-8 read fails
        return this.previewBinary(filePath, options);
      } catch (_e) {
        return this._formatError(`Error reading file: ${err.message}`);
      }
    }
  }

  // ── Binary preview (hex dump) ──────────────────────────────────────

  /**
   * Preview a binary file as a hex dump.
   *
   * @param {string} filePath - Path to binary file
   * @param {object} [options]
   * @param {number} [options.maxHexBytes] - Max bytes to display (default 512)
   * @param {number} [options.bytesPerLine] - Bytes per line (default 16)
   * @returns {string}
   */
  previewBinary(filePath, options = {}) {
    try {
      const resolved = path.resolve(filePath);
      const stat = options.stat || fs.statSync(resolved);
      const maxBytes = options.maxHexBytes || 512;
      const bytesPerLine = options.bytesPerLine || 16;

      const readSize = Math.min(stat.size, maxBytes);
      const fd = fs.openSync(resolved, "r");
      const buffer = Buffer.alloc(readSize);
      fs.readSync(fd, buffer, 0, readSize, 0);
      fs.closeSync(fd);

      const out = [];

      // Header
      out.push(
        `${THEME.bold}${path.basename(resolved)}${ANSI.reset}` +
        `  ${THEME.dim}${formatBytes(stat.size)} · Binary file${ANSI.reset}`
      );
      out.push("");

      // Column header
      out.push(`  ${THEME.dim}Offset    ${repeatStr(" ", 48)} ASCII${ANSI.reset}`);
      out.push(`  ${THEME.dim}${repeatStr("─", 8)}  ${repeatStr("─", 48)} ${repeatStr("─", 16)}${ANSI.reset}`);

      // Hex lines
      for (let offset = 0; offset < readSize; offset += bytesPerLine) {
        const chunk = buffer.slice(offset, Math.min(offset + bytesPerLine, readSize));
        const hexParts = [];
        const asciiParts = [];

        for (let i = 0; i < bytesPerLine; i++) {
          if (i < chunk.length) {
            const byte = chunk[i];
            hexParts.push(byte.toString(16).padStart(2, "0"));

            // Printable ASCII or high-byte
            if (byte >= 0x20 && byte <= 0x7E) {
              asciiParts.push(String.fromCharCode(byte));
            } else if (byte === 0x00) {
              asciiParts.push(`${THEME.dim}·${ANSI.reset}`);
            } else if (byte < 0x20) {
              asciiParts.push(`${THEME.accent}${String.fromCharCode(byte + 0x40)}${ANSI.reset}`);
            } else {
              asciiParts.push(`${THEME.dim}.${ANSI.reset}`);
            }
          } else {
            hexParts.push("  ");
            asciiParts.push(" ");
          }

          if (i === 7) hexParts.push(" "); // gutter
        }

        const offsetStr = offset.toString(16).padStart(8, "0");
        const hexStr = hexParts.join(" ");
        const asciiStr = asciiParts.join("");

        out.push(`  ${THEME.dim}${offsetStr}${ANSI.reset}  ${hexStr}  ${THEME.muted}|${ANSI.reset}${asciiStr}${THEME.muted}|${ANSI.reset}`);
      }

      // Truncation notice
      if (stat.size > maxBytes) {
        out.push(`\n  ${THEME.dim}... ${formatBytes(stat.size - maxBytes)} more not shown${ANSI.reset}`);
      }

      return out.join("\n");
    } catch (err) {
      return this._formatError(`Error reading binary file: ${err.message}`);
    }
  }

  // ── Archive preview ────────────────────────────────────────────────

  /**
   * Preview an archive file — list its contents.
   *
   * @param {string} filePath - Path to archive
   * @param {object} [options]
   * @returns {string}
   */
  previewArchive(filePath, options = {}) {
    try {
      const resolved = path.resolve(filePath);
      const stat = options.stat || fs.statSync(resolved);
      const ext = path.extname(resolved).toLowerCase();

      const archiveType = this._detectArchiveType(resolved);

      const out = [];

      // Header
      out.push(
        `${THEME.bold}${path.basename(resolved)}${ANSI.reset}` +
        `  ${THEME.dim}${formatBytes(stat.size)} · ${archiveType} archive${ANSI.reset}`
      );
      out.push("");

      // Attempt to list contents using available system tools
      const listing = this._listArchiveContents(resolved, ext);
      if (listing) {
        out.push(listing);
      } else {
        out.push(`${THEME.dim}  (Archive content listing requires tar/unzip/7z on PATH)${ANSI.reset}`);
        out.push("");
        out.push(`  ${THEME.info}Archive type${ANSI.reset}  ${archiveType}`);
        out.push(`  ${THEME.info}Size${ANSI.reset}          ${formatBytes(stat.size)}`);
        out.push(`  ${THEME.info}Modified${ANSI.reset}      ${stat.mtime.toISOString().replace("T", " ").slice(0, 19)}`);
      }

      return out.join("\n");
    } catch (err) {
      return this._formatError(`Error reading archive: ${err.message}`);
    }
  }

  /**
   * Attempt to list archive contents using system tools.
   */
  _listArchiveContents(filePath, ext) {
    try {
      const { execSync } = require("child_process");
      let cmd;

      if (ext === ".zip" || ext === ".jar" || ext === ".war" || ext === ".epub") {
        // Try unzip
        cmd = `unzip -l "${filePath}" 2>/dev/null`;
      } else if (ext === ".tar" || ext === ".tgz" || ext === ".gz" || ext === ".bz2" || ext === ".xz") {
        cmd = `tar -tvf "${filePath}" 2>/dev/null`;
      } else if (ext === ".7z") {
        cmd = `7z l "${filePath}" 2>/dev/null`;
      } else if (ext === ".rar") {
        cmd = `unrar l "${filePath}" 2>/dev/null`;
      } else {
        return null;
      }

      const output = execSync(cmd, {
        encoding: "utf8",
        maxBuffer: 512 * 1024,
        timeout: 5000,
        stdio: ["ignore", "pipe", "ignore"],
      });

      const lines = output.split("\n");
      const maxShow = 30;
      const displayLines = lines.slice(0, maxShow);

      if (displayLines.length === 0) return null;

      return displayLines.map(line => `  ${THEME.dim}${line}${ANSI.reset}`).join("\n") +
        (lines.length > maxShow ? `\n  ${THEME.dim}... ${lines.length - maxShow} more entries${ANSI.reset}` : "");
    } catch (err) {
      return null;
    }
  }

  /**
   * Detect archive type from extension.
   */
  _detectArchiveType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const map = {
      ".zip": "ZIP", ".tar": "TAR", ".gz": "GZip", ".tgz": "Tar+GZip",
      ".bz2": "BZip2", ".xz": "XZ", ".7z": "7-Zip", ".rar": "RAR",
      ".jar": "JAR", ".war": "WAR", ".epub": "EPUB",
    };
    return map[ext] || "Unknown";
  }

  // ── Type detection ─────────────────────────────────────────────────

  /**
   * Auto-detect the file type.
   */
  _detectType(filePath, stat) {
    const ext = path.extname(filePath).toLowerCase();

    // Check known image extensions first
    if ([".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".svg", ".ico", ".tiff", ".tif"].includes(ext)) {
      return "image";
    }

    // Check archive extensions
    if ([".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar", ".jar", ".war", ".epub"].includes(ext)) {
      return "archive";
    }

    // Check binary extensions
    if ([".wasm", ".bin", ".exe", ".dll", ".so", ".dylib", ".o", ".obj", ".class"].includes(ext)) {
      return "binary";
    }

    // Document/binary detection based on MIME
    const mime = EXT_TO_MIME[ext];
    if (mime) {
      if (mime.startsWith("image/")) return "image";
      if (mime.startsWith("application/")) {
        if (["application/pdf", "application/msword"].includes(mime) ||
          mime.includes("officedocument")) {
          return "binary"; // Complex document — show hex
        }
        if (["application/zip", "application/tar", "application/gzip", "application/bzip2", "application/xz"].includes(mime)) {
          return "archive";
        }
        if (["application/json"].includes(mime)) return "document";
        return "binary";
      }
    }

    // Try reading the file header to detect magic bytes
    try {
      const fd = fs.openSync(filePath, "r");
      const header = Buffer.alloc(16);
      fs.readSync(fd, header, 0, 16, 0);
      fs.closeSync(fd);

      // Check magic bytes
      for (const [sig, mime] of MAGIC_SIGNATURES) {
        let match = true;
        for (let i = 0; i < sig.length; i++) {
          if (header[i] !== sig[i]) { match = false; break; }
        }
        if (match) {
          if (mime.startsWith("image/")) return "image";
          if (mime.startsWith("application/zip") || mime.startsWith("application/gzip") ||
              mime.startsWith("application/bzip2") || mime.startsWith("application/xz")) {
            return "archive";
          }
          if (mime.startsWith("application/")) return "binary";
        }
      }

      // Check if mostly printable ASCII
      let printable = 0;
      for (let i = 0; i < Math.min(header.length, 16); i++) {
        const b = header[i];
        if ((b >= 0x20 && b <= 0x7E) || b === 0x0A || b === 0x0D || b === 0x09) printable++;
      }
      if (printable < 10) return "binary";
    } catch (err) {
      // If we can't read the file, fall through to document
    }

    return "document";
  }

  // ── Language detection ─────────────────────────────────────────────

  _detectLanguage(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const map = {
      ".js": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
      ".jsx": "JSX", ".ts": "TypeScript", ".tsx": "TypeScript",
      ".py": "Python", ".rb": "Ruby", ".go": "Go", ".rs": "Rust",
      ".java": "Java", ".c": "C", ".cpp": "C++", ".h": "C Header",
      ".css": "CSS", ".scss": "SCSS", ".less": "Less",
      ".sh": "Shell", ".bash": "Shell", ".zsh": "Shell",
      ".json": "JSON", ".yaml": "YAML", ".yml": "YAML", ".toml": "TOML",
      ".md": "Markdown", ".xml": "XML", ".html": "HTML",
      ".sql": "SQL", ".graphql": "GraphQL",
    };
    return map[ext] || null;
  }

  // ── Formatting helpers ──────────────────────────────────────────────

  _formatError(message) {
    return `${THEME.toolError}✗ ${message}${ANSI.reset}`;
  }

  _formatWarning(message) {
    return `${THEME.warning}⚠ ${message}${ANSI.reset}`;
  }
}

module.exports = { FilePreview, EXT_TO_MIME, formatBytes };
