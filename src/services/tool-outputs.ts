import fs from "fs";
import path from "path";
import os from "os";

const TOOL_INLINE_MAX = 8000;
const ARTIFACT_DIR = path.join(os.homedir(), ".haxagent", "tool_artifacts");
function offloadToolOutput(toolName: string, toolUseId: string, output: unknown) { const text = typeof output === "string" ? output : JSON.stringify(output); if (text.length <= TOOL_INLINE_MAX) return { inline: text, file: null }; if (!fs.existsSync(ARTIFACT_DIR)) fs.mkdirSync(ARTIFACT_DIR, { recursive: true }); const ts = new Date().toISOString().replace(/[:.]/g, "-"); const safe = toolName.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 80); const fp = path.join(ARTIFACT_DIR, ts + "-" + safe + "-" + Date.now().toString(36) + ".txt"); fs.writeFileSync(fp, text); return { inline: text.slice(0, 500) + "\n...[truncated " + text.length + " chars, saved to " + fp + "]", file: fp }; }
export { offloadToolOutput };
