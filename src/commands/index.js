"use strict";

const { loadAllSkills, createSkillifySkill, recordSkillUsage } = require("../skills");
const { THEME, ANSI } = require("../renderer");
const { SLASH_COMMANDS } = require("./definitions");
const shellUi = require("./shell-ui");
const { getTranslator } = shellUi;
const { getSlashCommandSuggestion, getSubcommandSuggestion } = require("./handlers");

const handlerExports = require("./handlers");

async function handleSlashCommand(line, context) {
  const [commandName, ...args] = line.slice(1).split(/\s+/);

  const command = SLASH_COMMANDS.find(
    (c) => c.name === commandName || c.aliases?.includes(commandName),
  );

  if (!command) {
    const skills = loadAllSkills(context.session.settings.projectRoot || process.cwd());
    const skillify = createSkillifySkill(context.session.messages);
    const allSkills = [skillify, ...skills];
    const matchedSkill = allSkills.find((s) => s.name === commandName && !s.isHidden);

    if (matchedSkill) {
      recordSkillUsage(matchedSkill.name);
      await shellUi.handleSkillInvocation(matchedSkill, args, context);
      return;
    }

    const t = getTranslator(context.session);
    const suggestion = getSlashCommandSuggestion(commandName);
    context.screen.write(`${THEME.error}${t('errors.unknownCommand', { command: commandName })}${ANSI.reset || ''}\n`);
    if (suggestion) {
      context.screen.write(`${THEME.dim}${t('errors.didYouMean', { command: `/${suggestion}` })}${ANSI.reset || ''}\n`);
    }
    context.screen.write(`${THEME.dim}${t('errors.typeHelp')}${ANSI.reset || ''}\n`);
    return;
  }

  switch (command.name) {
    case 'help': handlerExports.showShellHelp(context); break;
    case 'exit': handlerExports.exitShell(context); break;
    case 'clear': handlerExports.clearShell(context); break;
    case 'compact': handlerExports.compactShell(context); break;
    case 'tools': handlerExports.showTools(context); break;
    case 'skills': handlerExports.showSkills(args, context); break;
    case 'skillify': await handlerExports.handleSkillifyCommand(args, context); break;
    case 'agents': handlerExports.showAgents(context); break;
    case 'team': await handlerExports.handleTeamCommand(args, context); break;
    case 'models': await handlerExports.showModels(context); break;
    case 'model': await handlerExports.switchModel(args, context); break;
    case 'provider': await handlerExports.switchProvider(args, context); break;
    case 'api-url': await handlerExports.switchApiUrl(args, context); break;
    case 'api-key': await handlerExports.switchApiKey(args, context); break;
    case 'language': await handlerExports.switchLanguage(args, context); break;
    case 'cost': handlerExports.showCost(context); break;
    case 'sessions': await handlerExports.showSessions(context); break;
    case 'resume': await handlerExports.resumeSession(args, context); break;
    case 'config': handlerExports.showConfig(context); break;
    case 'doctor': handlerExports.runDoctor(args, context); break;
    case 'theme': handlerExports.toggleTheme(context); break;
    case 'vim': handlerExports.toggleVim(context); break;
    case 'memory': handlerExports.handleMemoryCommand(args, context); break;
    case 'permissions': await handlerExports.handlePermissionsCommand(args, context); break;
    case 'update': await handlerExports.handleUpdateCheck(args, context); break;
    default:
      context.screen.write(`${THEME.error}Command not implemented: /${command.name}${ANSI.reset || ''}\n`);
  }
}

// Re-export everything for existing consumers (cli.js, desktop/main/index.js)
module.exports = {
  ...handlerExports,
  ...shellUi,
  SLASH_COMMANDS,
  handleSlashCommand,
};
