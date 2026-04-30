const { loadAllSkills } = require('./loader');
const { createSkillifySkill } = require('./skillify');

const SKILL_BUDGET_CHARS = 8000;
const MAX_DESC_LENGTH = 250;

function formatSkillDescription(skill) {
  const desc = skill.whenToUse
    ? `${skill.displayName || skill.name}: ${skill.description} - ${skill.whenToUse}`
    : `${skill.displayName || skill.name}: ${skill.description}`;

  if (desc.length > MAX_DESC_LENGTH) {
    return desc.slice(0, MAX_DESC_LENGTH - 1) + '\u2026';
  }

  return desc;
}

function formatSkillsList(skills, budget = SKILL_BUDGET_CHARS) {
  if (skills.length === 0) return '';

  const entries = skills.map((skill) => ({
    skill,
    full: `- ${formatSkillDescription(skill)}`,
  }));

  const fullTotal = entries.reduce((sum, e) => sum + e.full.length, 0) + (entries.length - 1);

  if (fullTotal <= budget) {
    return entries.map((e) => e.full).join('\n');
  }

  const bundledIndices = new Set();
  const restSkills = [];

  for (let i = 0; i < skills.length; i++) {
    const skill = skills[i];
    if (skill.source === 'bundled') {
      bundledIndices.add(i);
    } else {
      restSkills.push({ skill, index: i });
    }
  }

  const bundledChars = entries.reduce(
    (sum, e, i) => (bundledIndices.has(i) ? sum + e.full.length + 1 : sum),
    0
  );
  const remainingBudget = budget - bundledChars;

  if (restSkills.length === 0) {
    return entries.map((e) => e.full).join('\n');
  }

  const restNameOverhead = restSkills.reduce(
    (sum, s) => sum + (s.skill.displayName || s.skill.name).length + 4,
    0
  ) + (restSkills.length - 1);

  const availableForDescs = remainingBudget - restNameOverhead;
  const maxDescLen = Math.floor(availableForDescs / restSkills.length);

  if (maxDescLen < 20) {
    return skills
      .map((skill, i) =>
        bundledIndices.has(i)
          ? entries[i].full
          : `- ${skill.displayName || skill.name}`
      )
      .join('\n');
  }

  return skills
    .map((skill, i) => {
      if (bundledIndices.has(i)) return entries[i].full;
      const desc = skill.whenToUse
        ? `${skill.displayName || skill.name}: ${skill.description} - ${skill.whenToUse}`
        : `${skill.displayName || skill.name}: ${skill.description}`;
      const truncated = desc.length > maxDescLen
        ? desc.slice(0, maxDescLen - 1) + '\u2026'
        : desc;
      return `- ${truncated}`;
    })
    .join('\n');
}

function buildSkillSystemPrompt(skills, budget = SKILL_BUDGET_CHARS) {
  if (skills.length === 0) return '';

  const skillsList = formatSkillsList(skills, budget);

  return `<system-reminder>
Available skills:
${skillsList}

When users ask you to perform tasks, check if any of the available skills match. Skills provide, specialized capabilities and domain knowledge.

When users reference a "slash command" or "/<something>" (e.g., "/commit", "/review-pr"), they are referring to a skill.

How to invoke:
- Use the skill name with a leading slash, optionally with arguments
- Examples:
  - \`/pdf\` - invoke the pdf skill
  - \`/code-review src/index.js\` - invoke with arguments
  - \`/review-pr 123\` - invoke with arguments

Important:
- When a skill matches the user's request, this is a BLOCKING REQUIREMENT: invoke the relevant skill BEFORE generating any other response about the task
- NEVER mention a skill without actually invoking it
- Do not invoke a skill that is already running
- Do not use this for built-in CLI commands (like /help, /clear, etc.)
</system-reminder>`;
}

function matchSkillByIntent(userMessage, skills) {
  if (skills.length === 0) return null;

  const messageLower = userMessage.toLowerCase();

  for (const skill of skills) {
    if (skill.whenToUse) {
      const whenToUseLower = skill.whenToUse.toLowerCase();
      const triggerPhrases = extractTriggerPhrases(whenToUseLower);

      for (const phrase of triggerPhrases) {
        if (messageLower.includes(phrase)) {
          return skill;
        }
      }
    }

    if (messageLower.includes(skill.name.toLowerCase()) ||
        messageLower.includes((skill.displayName || '').toLowerCase())) {
      return skill;
    }
  }

  return null;
}

function extractTriggerPhrases(whenToUseText) {
  const phrases = [];

  const useWhenMatch = whenToUseText.match(/use when[\s\S]*/i);
  if (!useWhenMatch) return [];

  const text = useWhenMatch[0];

  const quotedExamples = text.match(/"([^"]+)"/g);
  if (quotedExamples) {
    for (const quoted of quotedExamples) {
      const example = quoted.slice(1, -1).trim();
      if (example.length > 2) {
        phrases.push(example.toLowerCase());
      }
    }
  }

  const keyPhrases = text
    .replace(/use when/i, '')
    .replace(/example[s]?[:\s]+[^.;!?]+/gi, '')
    .replace(/"[^"]+"/g, '')
    .split(/[,.]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 3);

  phrases.push(...keyPhrases);

  return phrases.filter((p) => p.length > 2);
}

function getSkillsForSession(projectRoot, messages) {
  const skills = loadAllSkills(projectRoot || process.cwd());
  const skillify = createSkillifySkill(messages);
  return [skillify, ...skills].filter((s) => !s.isHidden);
}

module.exports = {
  buildSkillSystemPrompt,
  formatSkillsList,
  matchSkillByIntent,
  extractTriggerPhrases,
  getSkillsForSession,
  SKILL_BUDGET_CHARS,
  MAX_DESC_LENGTH,
};
