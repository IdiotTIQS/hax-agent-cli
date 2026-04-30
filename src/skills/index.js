const { loadAllSkills, loadSkillsFromDir, getUserSkillsDir, getProjectSkillsDir, getSkillsPath } = require('./loader');
const { parseFrontmatter, extractDescriptionFromMarkdown, parseArgumentNames, substituteArguments } = require('./parser');
const { recordSkillUsage, getSkillUsageScore, getSkillUsageStats } = require('./usage');
const { createSkillifySkill } = require('./skillify');
const {
  buildSkillSystemPrompt,
  formatSkillsList,
  matchSkillByIntent,
  extractTriggerPhrases,
  getSkillsForSession,
  SKILL_BUDGET_CHARS,
  MAX_DESC_LENGTH,
} = require('./intent-matcher');

module.exports = {
  loadAllSkills,
  loadSkillsFromDir,
  getUserSkillsDir,
  getProjectSkillsDir,
  getSkillsPath,
  parseFrontmatter,
  extractDescriptionFromMarkdown,
  parseArgumentNames,
  substituteArguments,
  recordSkillUsage,
  getSkillUsageScore,
  getSkillUsageStats,
  createSkillifySkill,
  buildSkillSystemPrompt,
  formatSkillsList,
  matchSkillByIntent,
  extractTriggerPhrases,
  getSkillsForSession,
  SKILL_BUDGET_CHARS,
  MAX_DESC_LENGTH,
};
