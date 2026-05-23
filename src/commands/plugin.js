"use strict";

const { THEME, ANSI, styled } = require("../renderer");
const { suggestCommand } = require("../command-suggestions");

const PLUGIN_SUBCOMMANDS = [
  { name: "list", aliases: ["ls"] },
  { name: "search", aliases: ["find"] },
  { name: "install", aliases: ["add", "i"] },
  { name: "update", aliases: ["upgrade", "up"] },
  { name: "uninstall", aliases: ["remove", "rm", "delete"] },
  { name: "info", aliases: ["show", "details"] },
  { name: "enable", aliases: ["on"] },
  { name: "disable", aliases: ["off"] },
];

/**
 * Handle /plugin commands.
 *
 * @param {Array<string>} args - Command arguments
 * @param {object} context - { screen, session, ... }
 */
async function handlePluginCommand(args, context) {
  const { screen, session } = context;
  const pm = session.pluginManager || null;
  const [subCommand, ...rest] = args;

  const sub = (subCommand || "list").toLowerCase();

  switch (sub) {
    case "list":
    case "ls":
      handleList(screen, pm);
      break;
    case "search":
    case "find":
      handleSearch(rest, screen, pm);
      break;
    case "install":
    case "add":
    case "i":
      await handleInstall(rest, screen, pm);
      break;
    case "update":
    case "upgrade":
    case "up":
      await handleUpdate(rest, screen, pm);
      break;
    case "uninstall":
    case "remove":
    case "rm":
    case "delete":
      handleUninstall(rest, screen, pm);
      break;
    case "info":
    case "show":
    case "details":
      handleInfo(rest, screen, pm);
      break;
    case "enable":
    case "on":
      handleEnable(rest, screen, pm);
      break;
    case "disable":
    case "off":
      handleDisable(rest, screen, pm);
      break;
    default: {
      const suggestion = suggestCommand(
        sub,
        PLUGIN_SUBCOMMANDS.flatMap((sc) => [
          { match: sc.name, suggest: sc.name },
          ...sc.aliases.map((a) => ({ match: a, suggest: sc.name })),
        ]),
      );
      screen.write(`${THEME.error}Unknown plugin command: ${sub}${ANSI.reset || ""}\n`);
      if (suggestion) {
        screen.write(`${THEME.dim}Did you mean /plugin ${suggestion}?${ANSI.reset || ""}\n`);
      }
      screen.write(`${THEME.dim}Usage: /plugin [list|search|install|update|uninstall|info|enable|disable]${ANSI.reset || ""}\n`);
    }
  }
}

// ── Subcommand handlers ──────────────────────────────────────────────────

function handleList(screen, pm) {
  if (!pm) {
    screen.write(`${THEME.warning}Plugin manager is not available in this session.${ANSI.reset || ""}\n`);
    return;
  }

  const plugins = pm.list();

  screen.write(`\n${THEME.heading}Plugins${ANSI.reset || ""}\n`);
  screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset || ""}\n`);

  if (plugins.length === 0) {
    screen.write(`  ${THEME.dim}No plugins installed.${ANSI.reset || ""}\n`);
  } else {
    for (const plugin of plugins) {
      const statusIcon = plugin.status === "active" ? THEME.success + "●" + ANSI.reset
        : plugin.status === "disabled" ? THEME.warning + "○" + ANSI.reset
        : THEME.dim + "◌" + ANSI.reset;

      const nameCol = plugin.name.padEnd(20);
      const versionStr = styled(THEME.dim, `v${plugin.version}`) + " ";
      const statusStr = plugin.status === "active"
        ? styled(THEME.success, "active")
        : styled(THEME.warning, plugin.status);

      const hookCount = plugin.hooks.length;
      const hookStr = hookCount > 0
        ? styled(THEME.dim, `  (${hookCount} hook${hookCount !== 1 ? "s" : ""})`)
        : "";

      screen.write(`  ${statusIcon} ${nameCol} ${versionStr}${statusStr}${hookStr}\n`);
    }
  }

  // Stats footer
  if (pm.getStats) {
    const stats = pm.getStats();
    screen.write(`\n${THEME.dim}  ${stats.totalRegistered} active, ${stats.totalDisabled} disabled, ${stats.totalHooks} hooks total${ANSI.reset || ""}\n`);
  }

  screen.write(`\n${THEME.dim}  /plugin search <query>  ·  /plugin install <name>${ANSI.reset || ""}\n\n`);
}

function handleSearch(args, screen, pm) {
  const query = args.join(" ").trim();

  if (!query) {
    screen.write(`${THEME.warning}Usage: /plugin search <query>${ANSI.reset || ""}\n`);
    return;
  }

  if (!pm) {
    screen.write(`${THEME.warning}Plugin manager is not available.${ANSI.reset || ""}\n`);
    return;
  }

  screen.write(`\n${THEME.heading}Search: ${query}${ANSI.reset || ""}\n`);
  screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset || ""}\n`);

  try {
    const results = pm.search(query);

    if (results.length === 0) {
      screen.write(`  ${THEME.dim}No plugins found matching "${query}".${ANSI.reset || ""}\n`);
    } else {
      for (const plugin of results.slice(0, 20)) {
        const nameCol = plugin.name.padEnd(20);
        const versionStr = styled(THEME.dim, `v${plugin.version}`) + " ";
        const sourceStr = styled(THEME.dim, `[${plugin.source || "unknown"}]`) + " ";

        screen.write(`  ${THEME.accent}${nameCol}${ANSI.reset || ""} ${versionStr}${sourceStr}${plugin.description || ""}\n`);

        // Show hooks if any
        if (plugin.hooks && plugin.hooks.length > 0) {
          screen.write(`    ${THEME.dim}Hooks: ${plugin.hooks.join(", ")}${ANSI.reset || ""}\n`);
        }

        // Show rating if available
        if (plugin.rating > 0) {
          const stars = "★".repeat(Math.round(plugin.rating)) + "☆".repeat(5 - Math.round(plugin.rating));
          screen.write(`    ${THEME.dim}Rating: ${stars} (${plugin.rating}) · ${plugin.installs || 0} installs${ANSI.reset || ""}\n`);
        }
      }
    }
  } catch (err) {
    screen.write(`  ${THEME.error}Search failed: ${err.message}${ANSI.reset || ""}\n`);
  }

  screen.write(`\n${THEME.dim}  /plugin install <name> to install${ANSI.reset || ""}\n\n`);
}

async function handleInstall(args, screen, pm) {
  const pluginName = args[0];

  if (!pluginName) {
    screen.write(`${THEME.warning}Usage: /plugin install <name>${ANSI.reset || ""}\n`);
    return;
  }

  if (!pm) {
    screen.write(`${THEME.warning}Plugin manager is not available.${ANSI.reset || ""}\n`);
    return;
  }

  screen.write(`${THEME.dim}Installing "${pluginName}"...${ANSI.reset || ""}\n`);

  try {
    const result = pm.install(pluginName);
    screen.write(`${THEME.success}Installed: ${result.name} v${result.version}${ANSI.reset || ""}\n`);
    screen.write(`${THEME.dim}  Source: ${result.source || "local"}  ·  Path: ${result.path}${ANSI.reset || ""}\n\n`);
  } catch (err) {
    screen.write(`${THEME.error}Install failed: ${err.message}${ANSI.reset || ""}\n`);
    screen.write(`${THEME.dim}Try /plugin search <query> to find available plugins.${ANSI.reset || ""}\n\n`);
  }
}

async function handleUpdate(args, screen, pm) {
  const pluginName = args[0];

  if (!pluginName) {
    screen.write(`${THEME.warning}Usage: /plugin update <name>${ANSI.reset || ""}\n`);
    return;
  }

  if (!pm) {
    screen.write(`${THEME.warning}Plugin manager is not available.${ANSI.reset || ""}\n`);
    return;
  }

  screen.write(`${THEME.dim}Updating "${pluginName}"...${ANSI.reset || ""}\n`);

  try {
    const result = await pm.update(pluginName);
    if (result.updated) {
      screen.write(`${THEME.success}Updated: ${pluginName} v${result.oldVersion} → v${result.newVersion}${ANSI.reset || ""}\n`);
    } else {
      screen.write(`${THEME.dim}Already up to date: ${pluginName} v${result.newVersion}${ANSI.reset || ""}\n`);
    }
    screen.write(`${THEME.dim}  Path: ${result.path || "N/A"}${ANSI.reset || ""}\n\n`);
  } catch (err) {
    screen.write(`${THEME.error}Update failed: ${err.message}${ANSI.reset || ""}\n\n`);
  }
}

function handleUninstall(args, screen, pm) {
  const pluginName = args[0];

  if (!pluginName) {
    screen.write(`${THEME.warning}Usage: /plugin uninstall <name>${ANSI.reset || ""}\n`);
    return;
  }

  if (!pm) {
    screen.write(`${THEME.warning}Plugin manager is not available.${ANSI.reset || ""}\n`);
    return;
  }

  screen.write(`${THEME.dim}Uninstalling "${pluginName}"...${ANSI.reset || ""}\n`);

  try {
    const result = pm.uninstall(pluginName);
    if (result.removed) {
      screen.write(`${THEME.success}Uninstalled: ${pluginName}${ANSI.reset || ""}\n`);
      if (result.filesDeleted && result.filesDeleted.length > 0) {
        screen.write(`${THEME.dim}  Files removed: ${result.filesDeleted.join(", ")}${ANSI.reset || ""}\n`);
      }
    } else {
      screen.write(`${THEME.warning}Plugin "${pluginName}" was not installed.${ANSI.reset || ""}\n`);
    }
  } catch (err) {
    screen.write(`${THEME.error}Uninstall failed: ${err.message}${ANSI.reset || ""}\n`);
  }

  screen.write("\n");
}

function handleInfo(args, screen, pm) {
  const pluginName = args[0];

  if (!pluginName) {
    screen.write(`${THEME.warning}Usage: /plugin info <name>${ANSI.reset || ""}\n`);
    return;
  }

  if (!pm) {
    screen.write(`${THEME.warning}Plugin manager is not available.${ANSI.reset || ""}\n`);
    return;
  }

  const info = pm.getPluginInfo(pluginName);

  if (!info) {
    screen.write(`${THEME.warning}Plugin "${pluginName}" not found.${ANSI.reset || ""}\n`);
    screen.write(`${THEME.dim}Try /plugin search ${pluginName}${ANSI.reset || ""}\n\n`);
    return;
  }

  screen.write(`\n${THEME.heading}Plugin: ${info.name}${ANSI.reset || ""}\n`);
  screen.write(`${THEME.border}──────────────────────────────────${ANSI.reset || ""}\n`);

  const statusColor = info.status === "active" ? THEME.success
    : info.status === "disabled" ? THEME.warning : THEME.dim;
  screen.write(`  Status:      ${statusColor}${info.status}${ANSI.reset || ""}\n`);
  screen.write(`  Version:     ${info.version}\n`);

  if (info.description) {
    screen.write(`  Description: ${info.description}\n`);
  }

  // Hooks
  if (info.hooks && info.hooks.length > 0) {
    screen.write(`  Hooks:\n`);
    for (const hook of info.hooks) {
      screen.write(`    ${THEME.dim}→ ${hook}${ANSI.reset || ""}\n`);
    }
  } else {
    screen.write(`  Hooks:       ${THEME.dim}none${ANSI.reset || ""}\n`);
  }

  // Flags
  const flags = [];
  if (info.isolated) flags.push("isolated");
  if (info.hotSwappable) flags.push("hot-swappable");
  if (flags.length > 0) {
    screen.write(`  Flags:       ${flags.join(", ")}\n`);
  }

  // File path
  if (info.path) {
    screen.write(`  Path:        ${THEME.dim}${info.path}${ANSI.reset || ""}\n`);
  }

  // Stats (if available)
  if (pm.getPluginStats && info.status === "active") {
    const stats = pm.getPluginStats(pluginName);
    if (stats) {
      screen.write(`\n  ${THEME.heading}Runtime Stats${ANSI.reset || ""}\n`);
      screen.write(`  Calls:       ${stats.calls}\n`);
      screen.write(`  Errors:      ${stats.errors}\n`);
      if (stats.avgHookLatencyMs > 0) {
        screen.write(`  Avg latency: ${stats.avgHookLatencyMs.toFixed(1)}ms\n`);
      }
      if (stats.maxMemoryDeltaBytes > 0) {
        const kb = (stats.maxMemoryDeltaBytes / 1024).toFixed(1);
        screen.write(`  Max memory:  ${kb} KB\n`);
      }
      if (stats.lastWarning) {
        screen.write(`  Last warn:   ${THEME.warning}${stats.lastWarning}${ANSI.reset || ""}\n`);
      }
    }
  }

  screen.write("\n");
}

function handleEnable(args, screen, pm) {
  const pluginName = args[0];

  if (!pluginName) {
    screen.write(`${THEME.warning}Usage: /plugin enable <name>${ANSI.reset || ""}\n`);
    return;
  }

  if (!pm) {
    screen.write(`${THEME.warning}Plugin manager is not available.${ANSI.reset || ""}\n`);
    return;
  }

  const success = pm.enablePlugin(pluginName);

  if (success) {
    screen.write(`${THEME.success}Enabled: ${pluginName}${ANSI.reset || ""}\n\n`);
  } else {
    screen.write(`${THEME.error}Failed to enable "${pluginName}". It may not have been previously disabled.${ANSI.reset || ""}\n\n`);
  }
}

function handleDisable(args, screen, pm) {
  const pluginName = args[0];

  if (!pluginName) {
    screen.write(`${THEME.warning}Usage: /plugin disable <name>${ANSI.reset || ""}\n`);
    return;
  }

  if (!pm) {
    screen.write(`${THEME.warning}Plugin manager is not available.${ANSI.reset || ""}\n`);
    return;
  }

  const success = pm.disablePlugin(pluginName);

  if (success) {
    screen.write(`${THEME.success}Disabled: ${pluginName}${ANSI.reset || ""}\n`);
    screen.write(`${THEME.dim}Use /plugin enable ${pluginName} to re-enable.${ANSI.reset || ""}\n\n`);
  } else {
    screen.write(`${THEME.warning}Plugin "${pluginName}" is not currently active.${ANSI.reset || ""}\n\n`);
  }
}

module.exports = { handlePluginCommand };
