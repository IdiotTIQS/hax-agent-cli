const fs = require('fs');
const path = require('path');
const os = require('os');

const SKILL_USAGE_DEBOUNCE_MS = 60_000;

function getSkillUsageFilePath() {
  return path.join(os.homedir(), '.hax-agent', 'skill-usage.json');
}

function loadSkillUsageData() {
  const filePath = getSkillUsageFilePath();

  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
  }

  return {};
}

function saveSkillUsageData(data) {
  const filePath = getSkillUsageFilePath();
  const dir = path.dirname(filePath);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

const lastWriteBySkill = new Map();

function recordSkillUsage(skillName) {
  const now = Date.now();
  const lastWrite = lastWriteBySkill.get(skillName);

  if (lastWrite !== undefined && now - lastWrite < SKILL_USAGE_DEBOUNCE_MS) {
    return;
  }

  lastWriteBySkill.set(skillName, now);

  const usageData = loadSkillUsageData();
  const existing = usageData[skillName];

  usageData[skillName] = {
    usageCount: (existing?.usageCount ?? 0) + 1,
    lastUsedAt: now,
  };

  saveSkillUsageData(usageData);
}

function getSkillUsageScore(skillName) {
  const usageData = loadSkillUsageData();
  const usage = usageData[skillName];

  if (!usage) return 0;

  const daysSinceUse = (Date.now() - usage.lastUsedAt) / (1000 * 60 * 60 * 24);
  const recencyFactor = Math.pow(0.5, daysSinceUse / 7);

  return usage.usageCount * Math.max(recencyFactor, 0.1);
}

function getSkillUsageStats() {
  return loadSkillUsageData();
}

module.exports = {
  recordSkillUsage,
  getSkillUsageScore,
  getSkillUsageStats,
};
