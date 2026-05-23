"use strict";

/**
 * /personality command — view and control the agent's personality profile,
 * response style, and situational behavior modifiers.
 *
 * Sub-commands:
 *   /personality                           show current settings
 *   /personality set <profile-name>        apply a pre-built profile
 *   /personality style <style-name>        apply a response style
 *   /personality mode <modifier-name>      stack a behavior modifier
 *   /personality mode clear                remove all active modifiers
 *   /personality reset                     clear everything (profile, style, modifiers)
 */

const { THEME, ANSI } = require("../renderer");

// ---------------------------------------------------------------------------
// Lazy / optional imports — gracefully degrade when modules are absent
// ---------------------------------------------------------------------------

let _ALL_PROFILES = null;
let _ALL_STYLES = null;
let _ALL_MODIFIERS = null;
let _getModifierByName = null;
let _activeModifiers = null;

function _loadModules() {
  if (!_ALL_PROFILES) {
    try {
      const profiles = require("../personality/profiles");
      _ALL_PROFILES = profiles.ALL_PROFILES;
    } catch (_) { /* unavailable */ }
  }
  if (!_ALL_STYLES) {
    try {
      const styles = require("../personality/response-styles");
      _ALL_STYLES = styles.ALL_STYLES;
    } catch (_) { /* unavailable */ }
  }
  if (!_ALL_MODIFIERS) {
    try {
      const modifiers = require("../personality/behavior-modifiers");
      _ALL_MODIFIERS = modifiers.ALL_MODIFIERS;
      _getModifierByName = modifiers.getModifierByName;
      _activeModifiers = modifiers.activeModifiers;
    } catch (_) { /* unavailable */ }
  }
}

// ---------------------------------------------------------------------------
// Valid profile / style / modifier names (lowercase)
// ---------------------------------------------------------------------------

function _validProfileNames() {
  _loadModules();
  if (!_ALL_PROFILES) return [];
  return _ALL_PROFILES.map(function (p) { return p.name.toLowerCase(); });
}

function _validStyleNames() {
  _loadModules();
  if (!_ALL_STYLES) return [];
  return _ALL_STYLES.map(function (s) { return s.name.toLowerCase(); });
}

function _validModifierNames() {
  _loadModules();
  if (!_ALL_MODIFIERS) return [];
  return _ALL_MODIFIERS.map(function (m) { return m.name.toLowerCase(); });
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

function handlePersonalityCommand(args, context) {
  const screen = context.screen;
  const session = context.session;

  // Ensure personality store exists on the session.
  if (!session.personality) {
    session.personality = {};
  }

  // First argument is always the sub-command, but if it looks like a valid
  // profile/style name (and no sub-command was given), treat "set" as default.
  const [subCommand, ...rest] = args;

  if (!subCommand || subCommand === "show" || subCommand === "status") {
    _showPersonality(session, screen);
    return;
  }

  if (subCommand === "set") {
    _setProfile(rest, session, screen);
    return;
  }

  if (subCommand === "style") {
    _setStyle(rest, session, screen);
    return;
  }

  if (subCommand === "mode") {
    _handleMode(rest, session, screen);
    return;
  }

  if (subCommand === "reset") {
    _resetPersonality(session, screen);
    return;
  }

  // Graceful fallback for unknown sub-commands.
  const validNames = _validProfileNames();
  if (validNames.length > 0 && validNames.includes(subCommand.toLowerCase())) {
    // User typed "/personality precise" — treat as "set precise".
    _setProfile([subCommand, ...rest], session, screen);
    return;
  }

  screen.write(
    THEME.error +
    "Unknown personality sub-command: " + subCommand + "\n" +
    (ANSI.reset || "") +
    THEME.dim +
    "Usage: /personality [status|show|set <profile>|style <style>|mode <modifier>|reset]\n" +
    (ANSI.reset || "")
  );
}

// ---------------------------------------------------------------------------
// Show
// ---------------------------------------------------------------------------

function _showPersonality(session, screen) {
  _loadModules();

  screen.write("\n" + THEME.heading + "Personality Settings" + (ANSI.reset || "") + "\n");
  screen.write(THEME.border + "──────────────────────────────────" + (ANSI.reset || "") + "\n");

  // Active profile
  const profileName = session.personality.activeProfile;
  if (profileName) {
    const profile = _findProfile(profileName);
    screen.write(
      "  " + THEME.dim + "Profile:" + (ANSI.reset || "") + " " +
      THEME.accent + profileName + (ANSI.reset || "")
    );
    if (profile) {
      screen.write(" " + THEME.dim + profile.description + (ANSI.reset || ""));
    }
    screen.write("\n");
  } else {
    screen.write("  " + THEME.dim + "Profile:" + (ANSI.reset || "") + " " + THEME.dim + "(none)" + (ANSI.reset || "") + "\n");
  }

  // Active style
  const styleName = session.personality.activeStyle;
  if (styleName) {
    screen.write(
      "  " + THEME.dim + "Style:" + (ANSI.reset || "") + " " +
      THEME.accent + styleName + (ANSI.reset || "") + "\n"
    );
  } else {
    screen.write("  " + THEME.dim + "Style:" + (ANSI.reset || "") + " " + THEME.dim + "(none)" + (ANSI.reset || "") + "\n");
  }

  // Active modifiers
  const mods = session.personality.activeModifiers;
  if (Array.isArray(mods) && mods.length > 0) {
    screen.write(
      "  " + THEME.dim + "Mode(s):" + (ANSI.reset || "") + " " +
      THEME.warning + mods.join(", ") + (ANSI.reset || "") + "\n"
    );
  } else {
    screen.write("  " + THEME.dim + "Mode(s):" + (ANSI.reset || "") + " " + THEME.dim + "(none)" + (ANSI.reset || "") + "\n");
  }

  screen.write("\n");

  // List available profiles
  if (_ALL_PROFILES && _ALL_PROFILES.length > 0) {
    screen.write("  " + THEME.dim + "Available profiles:" + (ANSI.reset || "") + "\n");
    for (let i = 0; i < _ALL_PROFILES.length; i += 1) {
      var p = _ALL_PROFILES[i];
      var marker = profileName && p.name.toLowerCase() === profileName.toLowerCase()
        ? THEME.success + "*" + (ANSI.reset || "")
        : " ";
      screen.write(
        "   " + marker + " " + THEME.accent + p.name.padEnd(14) + (ANSI.reset || "") +
        " " + THEME.dim + p.description + (ANSI.reset || "") + "\n"
      );
    }
    screen.write("\n");
  }

  // List available styles
  if (_ALL_STYLES && _ALL_STYLES.length > 0) {
    screen.write("  " + THEME.dim + "Available styles:" + (ANSI.reset || "") + "\n");
    for (var i2 = 0; i2 < _ALL_STYLES.length; i2 += 1) {
      var s = _ALL_STYLES[i2];
      var sMarker = styleName && s.name.toLowerCase() === styleName.toLowerCase()
        ? THEME.success + "*" + (ANSI.reset || "")
        : " ";
      screen.write(
        "   " + sMarker + " " + THEME.accent + s.name.padEnd(16) + (ANSI.reset || "") +
        " " + THEME.dim + s.description + (ANSI.reset || "") + "\n"
      );
    }
    screen.write("\n");
  }

  // List available modifiers
  if (_ALL_MODIFIERS && _ALL_MODIFIERS.length > 0) {
    screen.write("  " + THEME.dim + "Available modes:" + (ANSI.reset || "") + "\n");
    for (var i3 = 0; i3 < _ALL_MODIFIERS.length; i3 += 1) {
      var m = _ALL_MODIFIERS[i3];
      var isActive = Array.isArray(mods) && mods.some(function (am) {
        return am.toLowerCase() === m.name.toLowerCase();
      });
      var mMarker = isActive
        ? THEME.success + "*" + (ANSI.reset || "")
        : " ";
      screen.write(
        "   " + mMarker + " " + THEME.accent + m.name.padEnd(18) + (ANSI.reset || "") +
        " " + THEME.dim + m.description + (ANSI.reset || "") + "\n"
      );
    }
    screen.write("\n");
  }

  screen.write(
    THEME.dim +
    "Usage: /personality set <name>  ·  /personality style <name>  ·  /personality mode <name>  ·  /personality reset\n" +
    (ANSI.reset || "") + "\n"
  );
}

// ---------------------------------------------------------------------------
// Set profile
// ---------------------------------------------------------------------------

function _setProfile(rest, session, screen) {
  _loadModules();

  var profileName = (rest[0] || "").trim();
  if (!profileName) {
    screen.write(
      THEME.error + "Missing profile name.\n" + (ANSI.reset || "") +
      THEME.dim + "Available profiles: " + _validProfileNames().join(", ") + "\n" +
      (ANSI.reset || "")
    );
    return;
  }

  var profile = _findProfile(profileName);
  if (!profile) {
    screen.write(
      THEME.error + "Unknown profile: " + profileName + "\n" + (ANSI.reset || "") +
      THEME.dim + "Available profiles: " + _validProfileNames().join(", ") + "\n" +
      (ANSI.reset || "")
    );
    return;
  }

  session.personality.activeProfile = profile.name;
  screen.write(
    THEME.success + "Personality set to: " + profile.name + "\n" + (ANSI.reset || "") +
    THEME.dim + profile.description + "\n" + (ANSI.reset || "")
  );
}

// ---------------------------------------------------------------------------
// Set style
// ---------------------------------------------------------------------------

function _setStyle(rest, session, screen) {
  _loadModules();

  var styleName = (rest[0] || "").trim();
  if (!styleName) {
    screen.write(
      THEME.error + "Missing style name.\n" + (ANSI.reset || "") +
      THEME.dim + "Available styles: " + _validStyleNames().join(", ") + "\n" +
      (ANSI.reset || "")
    );
    return;
  }

  var style = _findStyle(styleName);
  if (!style) {
    screen.write(
      THEME.error + "Unknown style: " + styleName + "\n" + (ANSI.reset || "") +
      THEME.dim + "Available styles: " + _validStyleNames().join(", ") + "\n" +
      (ANSI.reset || "")
    );
    return;
  }

  session.personality.activeStyle = style.name;
  screen.write(
    THEME.success + "Response style set to: " + style.name + "\n" + (ANSI.reset || "") +
    THEME.dim + style.description + "\n" + (ANSI.reset || "")
  );
}

// ---------------------------------------------------------------------------
// Handle mode (add / clear)
// ---------------------------------------------------------------------------

function _handleMode(rest, session, screen) {
  _loadModules();

  var modName = (rest[0] || "").trim();

  if (!modName) {
    screen.write(
      THEME.error + "Missing modifier name.\n" + (ANSI.reset || "") +
      THEME.dim + "Available modes: " + _validModifierNames().join(", ") + "\n" +
      (ANSI.reset || "") +
      THEME.dim + 'Use "/personality mode clear" to remove all active modifiers.\n' +
      (ANSI.reset || "")
    );
    return;
  }

  if (modName === "clear") {
    session.personality.activeModifiers = [];
    screen.write(
      THEME.success + "All behavior modifiers cleared.\n" + (ANSI.reset || "")
    );
    return;
  }

  var modifier = _findModifier(modName);
  if (!modifier) {
    screen.write(
      THEME.error + "Unknown modifier: " + modName + "\n" + (ANSI.reset || "") +
      THEME.dim + "Available modes: " + _validModifierNames().join(", ") + "\n" +
      (ANSI.reset || "")
    );
    return;
  }

  if (!Array.isArray(session.personality.activeModifiers)) {
    session.personality.activeModifiers = [];
  }

  // Toggle: if already active, remove it; otherwise add it.
  var existingIndex = -1;
  for (var i = 0; i < session.personality.activeModifiers.length; i += 1) {
    if (session.personality.activeModifiers[i].toLowerCase() === modifier.name.toLowerCase()) {
      existingIndex = i;
      break;
    }
  }

  if (existingIndex >= 0) {
    session.personality.activeModifiers.splice(existingIndex, 1);
    screen.write(
      THEME.success + "Mode removed: " + modifier.name + "\n" + (ANSI.reset || "")
    );
  } else {
    session.personality.activeModifiers.push(modifier.name);
    screen.write(
      THEME.success + "Mode activated: " + modifier.name + "\n" + (ANSI.reset || "") +
      THEME.dim + modifier.description + "\n" + (ANSI.reset || "")
    );
    if (session.personality.activeModifiers.length > 1) {
      screen.write(
        THEME.dim + "Active modes: " + session.personality.activeModifiers.join(", ") + "\n" +
        (ANSI.reset || "")
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

function _resetPersonality(session, screen) {
  session.personality = {};
  screen.write(
    THEME.success + "Personality, response style, and behavior modifiers cleared.\n" +
    (ANSI.reset || "") +
    THEME.dim + "Agent will use default behavior.\n" +
    (ANSI.reset || "")
  );
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

function _findProfile(name) {
  _loadModules();
  if (!_ALL_PROFILES) return null;
  var lower = (name || "").toLowerCase();
  for (var i = 0; i < _ALL_PROFILES.length; i += 1) {
    if (_ALL_PROFILES[i].name.toLowerCase() === lower) {
      return _ALL_PROFILES[i];
    }
  }
  return null;
}

function _findStyle(name) {
  _loadModules();
  if (!_ALL_STYLES) return null;
  var lower = (name || "").toLowerCase();
  for (var i = 0; i < _ALL_STYLES.length; i += 1) {
    if (_ALL_STYLES[i].name.toLowerCase() === lower) {
      return _ALL_STYLES[i];
    }
  }
  return null;
}

function _findModifier(name) {
  _loadModules();
  if (!_ALL_MODIFIERS) return null;
  var lower = (name || "").toLowerCase();
  for (var i = 0; i < _ALL_MODIFIERS.length; i += 1) {
    if (_ALL_MODIFIERS[i].name.toLowerCase() === lower) {
      return _ALL_MODIFIERS[i];
    }
  }
  return null;
}

module.exports = {
  handlePersonalityCommand,
};
