const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseFrontmatter, extractDescriptionFromMarkdown, parseArgumentNames, substituteArguments } = require('./parser');

function getUserSkillsDir() {
  return path.join(os.homedir(), '.hax-agent', 'skills');
}

function getProjectSkillsDir(projectRoot) {
  return path.join(projectRoot, '.hax-agent', 'skills');
}

function loadSkillsFromDir(dirPath, source) {
  const skills = [];

  if (!fs.existsSync(dirPath)) {
    return skills;
  }

  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (error) {
    return skills;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }

    const skillDirPath = path.join(dirPath, entry.name);
    const skillFilePath = path.join(skillDirPath, 'SKILL.md');

    if (!fs.existsSync(skillFilePath)) {
      continue;
    }

    try {
      const content = fs.readFileSync(skillFilePath, 'utf-8');
      const { frontmatter, content: markdownContent } = parseFrontmatter(content);

      const skillName = entry.name;
      const description = frontmatter.description || extractDescriptionFromMarkdown(markdownContent, 'Skill');
      const argumentNames = parseArgumentNames(frontmatter.arguments);

      const skill = {
        type: 'skill',
        name: skillName,
        description: description,
        displayName: frontmatter.name || skillName,
        hasUserSpecifiedDescription: !!frontmatter.description,
        allowedTools: Array.isArray(frontmatter['allowed-tools']) ? frontmatter['allowed-tools'] : [],
        argumentHint: frontmatter['argument-hint'] || undefined,
        argNames: argumentNames.length > 0 ? argumentNames : undefined,
        whenToUse: frontmatter.when_to_use || undefined,
        userInvocable: frontmatter['user-invocable'] !== false,
        isHidden: frontmatter['user-invocable'] === false,
        context: frontmatter.context === 'fork' ? 'fork' : undefined,
        source: source,
        loadedFrom: 'skills',
        baseDir: skillDirPath,
        contentLength: markdownContent.length,
        progressMessage: 'running',
        getPromptForCommand(args) {
          let finalContent = markdownContent;

          if (args && argumentNames.length > 0) {
            finalContent = substituteArguments(finalContent, args, argumentNames);
          }

          const baseDirPrefix = `Base directory for this skill: ${skillDirPath}\n\n`;

          return [{ type: 'text', text: baseDirPrefix + finalContent }];
        },
      };

      skills.push(skill);
    } catch (error) {
      console.error(`[skills] failed to load skill from ${skillFilePath}: ${error.message}`);
    }
  }

  return skills;
}

function loadAllSkills(projectRoot) {
  const userSkillsDir = getUserSkillsDir();
  const projectSkillsDir = getProjectSkillsDir(projectRoot);

  const userSkills = loadSkillsFromDir(userSkillsDir, 'userSettings');
  const projectSkills = loadSkillsFromDir(projectSkillsDir, 'projectSettings');

  const allSkills = [...userSkills, ...projectSkills];

  const seen = new Set();
  const deduplicated = [];

  for (const skill of allSkills) {
    if (!seen.has(skill.name)) {
      seen.add(skill.name);
      deduplicated.push(skill);
    }
  }

  return deduplicated;
}

function getSkillsPath(source, dir) {
  switch (source) {
    case 'userSettings':
      return path.join(os.homedir(), '.hax-agent', dir);
    case 'projectSettings':
      return path.join('.hax-agent', dir);
    default:
      return '';
  }
}

module.exports = {
  loadAllSkills,
  loadSkillsFromDir,
  getUserSkillsDir,
  getProjectSkillsDir,
  getSkillsPath,
};
