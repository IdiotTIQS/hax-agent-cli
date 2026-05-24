"use strict";

const { ToolExecutionError } = require('./error');

/**
 * Creates the built-in "Skill" tool so the LLM can invoke skills via function calling.
 * Without this tool, skills can only be triggered through CLI slash commands (/skill),
 * not when the LLM needs them autonomously.
 */
function createSkillTool({ root, settings } = {}) {
  const projectRoot = root || process.cwd();
  let _skillsCache = null;
  let _skillifyFn = null;

  function _loadSkills() {
    if (_skillsCache) return _skillsCache;

    try {
      const { loadAllSkills } = require('../skills/loader');
      const { createSkillifySkill } = require('../skills/skillify');
      const all = loadAllSkills(projectRoot);
      const skillify = createSkillifySkill([]);
      _skillifyFn = skillify;
      const { createListSkillsSkill } = require('../skills/list-skills');
      const listSelf = createListSkillsSkill();
      // Build a unified map keyed by skill name
      const { buildSessionSkillList } = require('../skills/loader');
      const list = buildSessionSkillList(all, skillify, listSelf);
      _skillsCache = new Map();
      for (const s of list) {
        _skillsCache.set(s.name, s);
      }
    } catch (_) {
      _skillsCache = new Map();
    }
    return _skillsCache;
  }

  return {
    name: 'Skill',
    description: 'Invoke a registered skill (slash command) by name. Skills are specialized capabilities that extend the agent with domain knowledge, workflows, or tool integrations. Use this when the user asks you to perform a task that matches an available skill.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: {
          type: 'string',
          description: 'The skill name (without leading slash). E.g. "code-review", "security-review", "review", "init".',
        },
        args: {
          type: 'string',
          description: 'Optional arguments to pass to the skill, as a single string (space-separated if multiple).',
        },
      },
    },
    async execute(args, context) {
      const skillName = String(args.name || '').trim().replace(/^\/+/, '');
      if (!skillName) {
        throw new ToolExecutionError('INVALID_INPUT', 'Skill name is required');
      }

      const skills = _loadSkills();
      const skill = skills.get(skillName);

      if (!skill) {
        const available = Array.from(skills.keys()).filter(k => !k.startsWith('skillify') && k !== 'skills').sort();
        const hint = available.length > 0
          ? ` Available skills: ${available.join(', ')}`
          : ' No skills are currently loaded.';
        throw new ToolExecutionError('SKILL_NOT_FOUND', `Skill "${skillName}" is not loaded.${hint}`);
      }

      const skillArgs = args.args
        ? String(args.args).trim().split(/\s+/)
        : [];

      try {
        if (typeof skill.getPromptForCommand === 'function') {
          const blocks = await skill.getPromptForCommand(skillArgs);
          const text = blocks.map(b => b.text || '').join('\n');

          // Record usage for stats
          try {
            const { recordSkillUsage } = require('../skills');
            recordSkillUsage(skillName);
          } catch (_) { /* best-effort */ }

          return {
            skill: skillName,
            invoked: true,
            message: `Skill "${skillName}" loaded. Follow the instructions below to complete the user's request.`,
            instructions: text,
          };
        }

        return {
          skill: skillName,
          invoked: true,
          message: `Skill "${skillName}" activated: ${skill.description || '(no description)'}`,
        };
      } catch (err) {
        throw new ToolExecutionError(
          'SKILL_EXECUTION_ERROR',
          `Failed to invoke skill "${skillName}": ${err.message}`,
        );
      }
    },
  };
}

module.exports = { createSkillTool };
