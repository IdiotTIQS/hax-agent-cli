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

function atomicWriteBytes(filePath: string, data: Uint8Array | Buffer): void {
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
 * @param filePath
 * @param data
 * @param encoding
 */
function atomicWriteText(filePath: string, data: string, encoding: BufferEncoding = "utf-8"): void {
  atomicWriteBytes(filePath, Buffer.from(data, encoding));
}

function atomicWriteJSON(filePath: string, data: unknown): void {
  atomicWriteText(filePath, JSON.stringify(data, null, 2));
}

function safeReadJSON<T = unknown>(filePath: string, fallback: T | null = null): T | null {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch (_) { return fallback; }
}

export { atomicWriteBytes, atomicWriteText, atomicWriteJSON, safeReadJSON };
