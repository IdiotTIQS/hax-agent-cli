/**
 * Minimal settings management.
 * Loads from ~/.haxagent/settings.json and env vars.
 */

import fs from "fs";
import path from "path";
import os from "os";

const CONFIG_DIR = path.join(os.homedir(), ".haxagent");
const CONFIG_FILE = path.join(CONFIG_DIR, "settings.json");

const DEFAULTS = {
  agent: { provider: "anthropic", model: "claude-sonnet-4-6", maxTurns: 25 },
  permissions: { mode: "normal" },
  tools: { shell: { enabled: true } },
  sandbox: { enabled: true, backend: "auto", image: "node:18-alpine", network: "none", cpus: 2, memory: "512m" },
  ui: { locale: "en", autoClearScreen: true },
  context: { compactionEnabled: false, compactionThreshold: 0.85 },
};

interface AgentSettings {
  provider?: string;
  model?: string;
  maxTurns?: number;
  thinking?: boolean;
  thinkIntensity?: string | null;
  _activeProfile?: string;
  [key: string]: unknown;
}

interface PermissionSettings {
  mode?: string;
  allowedTools?: string[];
  deniedTools?: string[];
  [key: string]: unknown;
}

interface UiSettings {
  locale?: string;
  autoClearScreen?: boolean;
  theme?: string;
  [key: string]: unknown;
}

interface SettingsShape {
  agent?: AgentSettings;
  permissions?: PermissionSettings;
  ui?: UiSettings;
  [key: string]: unknown;
}

let _cached: SettingsShape | null = null;

function loadSettings(): SettingsShape {
  if (_cached) return _cached;
  _cached = _readSettings();
  return _cached;
}

function _readSettings() {
  let file = {};
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      file = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    }
  } catch (_) {}
  return deepMerge({} as SettingsShape, DEFAULTS as SettingsShape, file as SettingsShape);
}

/** Force reload from disk, busting the cache. */
function reloadSettings() {
  _cached = null;
  return loadSettings();
}

function saveSettings(settings: SettingsShape) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(settings, null, 2), "utf-8");
  _cached = null;
}

function deepMerge(target: SettingsShape, ...sources: Array<Record<string, unknown>>): SettingsShape {
  for (const src of sources) {
    for (const key of Object.keys(src)) {
      if (src[key] && typeof src[key] === "object" && !Array.isArray(src[key])) {
        target[key] = deepMerge((target[key] || {}) as SettingsShape, src[key] as Record<string, unknown>);
      } else {
        target[key] = src[key];
      }
    }
  }
  return target;
}

export { loadSettings, reloadSettings, saveSettings, CONFIG_DIR, CONFIG_FILE, DEFAULTS };
