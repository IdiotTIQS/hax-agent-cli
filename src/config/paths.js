/**
 * Path resolution for HaxAgent configuration and data directories.
 * Ported from OpenHarness config/paths.py
 */

import fs from "fs";
import path from "path";
import os from "os";

const DEFAULT_BASE_DIR = ".haxagent";

function getConfigDir() {
  const env = process.env.HAXAGENT_CONFIG_DIR;
  const dir = env ? path.resolve(env) : path.join(os.homedir(), DEFAULT_BASE_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getConfigFilePath() { return path.join(getConfigDir(), "settings.json"); }

function getDataDir() {
  const env = process.env.HAXAGENT_DATA_DIR;
  const dir = env ? path.resolve(env) : path.join(getConfigDir(), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getLogsDir() {
  const env = process.env.HAXAGENT_LOGS_DIR;
  const dir = env ? path.resolve(env) : path.join(getConfigDir(), "logs");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getSessionsDir() {
  const dir = path.join(getDataDir(), "sessions");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getTasksDir() {
  const dir = path.join(getDataDir(), "tasks");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getMemoryDir() {
  const dir = path.join(getConfigDir(), "memory");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getCronRegistryPath() { return path.join(getDataDir(), "cron_jobs.json"); }
function getPluginsDir() { return path.join(getConfigDir(), "plugins"); }
function getSkillsDir() { return path.join(getConfigDir(), "skills"); }

function getProjectConfigDir(cwd) {
  const dir = path.resolve(cwd || process.cwd(), ".hax-agent");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export {
  getConfigDir, getConfigFilePath, getDataDir, getLogsDir,
  getSessionsDir, getTasksDir, getMemoryDir,
  getCronRegistryPath, getPluginsDir, getSkillsDir,
  getProjectConfigDir,
};
