/**
 * Atomic file-write helpers for persistent state.
 * Ported from OpenHarness utils/fs.py
 *
 * Every file under ~/.haxagent/ that is rewritten during normal use
 * must be written atomically to prevent data loss on crash.
 */

import fs from "fs";
import path from "path";
import os from "os";

function atomicWriteBytes(filePath, data) {
  const dst = path.resolve(filePath);
  const dir = path.dirname(dst);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const tmpName = path.join(dir, `.${path.basename(dst)}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmpName, data);
    fs.renameSync(tmpName, dst);
  } catch (err) {
    try { fs.unlinkSync(tmpName); } catch (_) {}
    throw err;
  }
}

/**
 * @param {string} filePath
 * @param {string} data
 * @param {BufferEncoding} [encoding]
 */
function atomicWriteText(filePath, data, encoding = "utf-8") {
  atomicWriteBytes(filePath, Buffer.from(data, encoding));
}

function atomicWriteJSON(filePath, data) {
  atomicWriteText(filePath, JSON.stringify(data, null, 2));
}

function safeReadJSON(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (_) { return fallback; }
}

export { atomicWriteBytes, atomicWriteText, atomicWriteJSON, safeReadJSON };
