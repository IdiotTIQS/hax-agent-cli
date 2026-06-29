import crypto from "crypto";
function generateId(len: number) { return crypto.randomBytes(len || 12).toString("hex").slice(0, len || 12); }
function timestamp() { return new Date().toISOString(); }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function hash(str: string) { return crypto.createHash("sha256").update(str).digest("hex").slice(0, 16); }
export { generateId, timestamp, sleep, hash };
