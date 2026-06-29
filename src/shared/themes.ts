/**
 * Theme System — 5 built-in terminal color themes.
 * Ported from OpenHarness themes/ pattern.
 */

const THEMES = {
  default: {
    name: "Default",
    description: "Clean dark theme with blue accents",
    accent: "\x1b[34m",
    success: "\x1b[32m",
    warning: "\x1b[33m",
    error: "\x1b[31m",
    dim: "\x1b[90m",
    heading: "\x1b[1;36m",
    spinner: "\x1b[36m",
  },
  monokai: {
    name: "Monokai",
    description: "Warm retro coding theme",
    accent: "\x1b[35m",
    success: "\x1b[32m",
    warning: "\x1b[33m",
    error: "\x1b[31m",
    dim: "\x1b[37m",
    heading: "\x1b[1;33m",
    spinner: "\x1b[33m",
  },
  nord: {
    name: "Nord",
    description: "Cool arctic blue theme",
    accent: "\x1b[38;5;110m",
    success: "\x1b[38;5;114m",
    warning: "\x1b[38;5;215m",
    error: "\x1b[38;5;167m",
    dim: "\x1b[38;5;240m",
    heading: "\x1b[1;38;5;109m",
    spinner: "\x1b[38;5;109m",
  },
  solarized: {
    name: "Solarized",
    description: "Ethan Schoonover's classic palette",
    accent: "\x1b[38;5;33m",
    success: "\x1b[38;5;64m",
    warning: "\x1b[38;5;166m",
    error: "\x1b[38;5;124m",
    dim: "\x1b[38;5;242m",
    heading: "\x1b[1;38;5;37m",
    spinner: "\x1b[38;5;37m",
  },
  minimal: {
    name: "Minimal",
    description: "Black and white, distraction-free",
    accent: "\x1b[37m",
    success: "\x1b[37m",
    warning: "\x1b[37m",
    error: "\x1b[37m",
    dim: "\x1b[90m",
    heading: "\x1b[1;37m",
    spinner: "\x1b[37m",
  },
};

/** Apply a theme to the global THEME object */
function applyTheme(themeName, targetTheme) {
  const theme = THEMES[themeName] || THEMES.default;
  if (!targetTheme) return theme;
  Object.assign(targetTheme, theme);
  return targetTheme;
}

/** List all available themes */
function listThemes() {
  return Object.entries(THEMES).map(([name, t]) => ({ name, ...t }));
}

export { THEMES, applyTheme, listThemes };
