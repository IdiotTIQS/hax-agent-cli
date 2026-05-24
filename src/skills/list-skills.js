"use strict";

const { loadAllSkills, buildSessionSkillList } = require('./loader');
const { createSkillifySkill } = require('./skillify');

let _skillsCache = null;

function sanitizeMarkdownField(str) {
  return String(str).replace(/([*_#`\[\]|])/g, '\\$1');
}

/**
 * Creates the bundled "skills" skill that lists all available skills
 * when the user invokes `/skills` or `/skills list`.
 */
function createListSkillsSkill() {
  return {
    type: 'skill',
    name: 'skills',
    description: 'List all available skills (slash commands) you can invoke',
    displayName: 'skills',
    hasUserSpecifiedDescription: true,
    whenToUse: 'Use when the user asks "what can you do", "list skills", "list commands", "what commands are available", or types /skills',
    allowedTools: [],
    argumentHint: '[list]',
    argNames: [],
    userInvocable: true,
    isHidden: false,
    source: 'bundled',
    loadedFrom: 'bundled',
    baseDir: undefined,
    contentLength: 0,
    progressMessage: 'running',
    getPromptForCommand(_args) {
      const projectRoot = process.cwd();

      if (!_skillsCache) {
        const allSkills = loadAllSkills(projectRoot);
        const skillify = createSkillifySkill([]);
        const listSelf = createListSkillsSkill();
        _skillsCache = buildSessionSkillList(allSkills, skillify, listSelf);
      }

      const skills = _skillsCache;

      const lines = skills.map((s) => {
        const name = sanitizeMarkdownField(s.displayName || s.name);
        const desc = sanitizeMarkdownField(s.description || '');
        const hint = s.argumentHint ? ` ${sanitizeMarkdownField(s.argumentHint)}` : '';
        const source = s.source !== 'bundled' ? ` [${sanitizeMarkdownField(s.source)}]` : '';
        return `- **/${name}**${hint} — ${desc}${source}`;
      });

      const prompt = `# Available Skills

You have the following slash commands (skills) available. When the user asks a question matching one of these skills, invoke it with \`/skill-name\`.

${lines.join('\n')}

## How to Use

- When the user mentions a topic that matches a skill's purpose, invoke it using the skill name with a leading slash.
- Example: If the user asks "can you review my code", invoke \`/code-review\`.
- If the user explicitly asks for \`/skills\` or "list skills", show them this list.`;

      return [{ type: 'text', text: prompt }];
    },
  };
}

module.exports = {
  createListSkillsSkill,
};
