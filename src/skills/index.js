const { loadAllSkills, loadSkillsFromDir, getUserSkillsDir, getProjectSkillsDir, getSkillsPath, buildSessionSkillList } = require('./loader');
const { parseFrontmatter, extractDescriptionFromMarkdown, parseArgumentNames, substituteArguments } = require('./parser');
const { recordSkillUsage, getSkillUsageScore, getSkillUsageStats } = require('./usage');
const { createSkillifySkill } = require('./skillify');
const { createListSkillsSkill } = require('./list-skills');
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
  createListSkillsSkill,
  buildSkillSystemPrompt,
  formatSkillsList,
  matchSkillByIntent,
  extractTriggerPhrases,
  getSkillsForSession,
  buildSessionSkillList,
  SKILL_BUDGET_CHARS,
  MAX_DESC_LENGTH,
};
