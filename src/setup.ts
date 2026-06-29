/**
 * First-run setup wizard.
 * Runs when no settings file exists or no provider env vars are set.
 */

import readline from "readline";
import os from "os";
import path from "path";
import fs from "fs";

function _question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise(function (resolve) {
    rl.question(prompt, function (answer) { resolve(answer.trim()); });
  });
}

async function runSetup(): Promise<{ provider: string; model: string; apiKey: string; permMode: string }> {
  var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  var out = process.stdout;

  out.write("\n\x1b[1;36m╔════════════════════════════════════╗\x1b[0m\n");
  out.write("\x1b[1;36m║   Welcome to Hax Agent Setup!     ║\x1b[0m\n");
  out.write("\x1b[1;36m╚════════════════════════════════════╝\x1b[0m\n\n");
  out.write("Let's configure your AI provider.\n\n");

  // 1. Provider
  var providers = ["anthropic", "openai", "deepseek", "groq", "mistral", "google", "zhipu", "dashscope", "ollama", "openrouter"];
  out.write("\x1b[1m1. Choose AI provider:\x1b[0m\n");
  for (var i = 0; i < providers.length; i++) {
    out.write("  [" + (i + 1) + "] " + providers[i] + "\n");
  }
  var choice: string = await _question(rl, "\nEnter number or name (default: deepseek): ");
  var provider: string = providers[parseInt(choice) - 1] || choice || "deepseek";
  if (!providers.includes(provider)) provider = "deepseek";

  // 2. API Key
  out.write("\n\x1b[1m2. API Key\x1b[0m\n");
  var keyHint = provider === "anthropic" ? "sk-ant-..." : provider === "openai" ? "sk-proj-..." : "sk-...";
  var apiKey: string = await _question(rl, "Paste your " + provider + " API key (" + keyHint + "): ");
  if (apiKey) {
    var kdir = path.join(os.homedir(), ".haxagent");
    if (!fs.existsSync(kdir)) fs.mkdirSync(kdir, { recursive: true });
    var kp = path.join(kdir, "apikeys.json");
    var keys: Record<string, string> = {};
    try { keys = JSON.parse(fs.readFileSync(kp, "utf-8")); } catch (_) {}
    keys[provider] = apiKey;
    fs.writeFileSync(kp, JSON.stringify(keys, null, 2));
  }

  // 3. Model
  var models = provider === "deepseek" ? ["deepseek-v4-flash", "deepseek-v4-pro"] :
    provider === "anthropic" ? ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5-20251001"] :
    provider === "openai" ? ["gpt-5.4-mini", "gpt-5.5", "o3-2025-04-16"] :
    ["default"];
  out.write("\n\x1b[1m3. Choose model:\x1b[0m\n");
  for (var j = 0; j < models.length; j++) {
    out.write("  [" + (j + 1) + "] " + models[j] + "\n");
  }
  var mChoice: string = await _question(rl, "\nEnter number (default: 1): ");
  var model: string = models[parseInt(mChoice) - 1] || models[0];
  if (!model) model = provider === "anthropic" ? "claude-sonnet-4-6" : "deepseek-v4-flash";

  // 4. Permission mode
  out.write("\n\x1b[1m4. Permission mode:\x1b[0m\n");
  out.write("  [1] normal — ask before write/delete/shell\n");
  out.write("  [2] yolo   — auto-approve all tools\n");
  var pChoice: string = await _question(rl, "\nEnter number (default: 1): ");
  var permMode = pChoice === "2" ? "yolo" : "normal";

  // Save settings
  var sdir = path.join(os.homedir(), ".haxagent");
  if (!fs.existsSync(sdir)) fs.mkdirSync(sdir, { recursive: true });
  var sp = path.join(sdir, "settings.json");
  var settings = {
    agent: { provider: provider, model: model, maxTurns: 25 },
    permissions: { mode: permMode, allowedTools: [], deniedTools: [] },
    ui: { locale: "en", autoClearScreen: true },
    setup: { initialized: true, completedAt: new Date().toISOString() }
  };
  fs.writeFileSync(sp, JSON.stringify(settings, null, 2));

  // Save profile
  var pp = path.join(sdir, "profiles.json");
  var profiles: Record<string, unknown> = {};
  profiles[provider] = { provider: provider, model: model, apiUrl: "" };
  fs.writeFileSync(pp, JSON.stringify(profiles, null, 2));

  out.write("\n\x1b[32m✅ Setup complete!\x1b[0m\n");
  out.write("  Provider: " + provider + "\n");
  out.write("  Model:    " + model + "\n");
  out.write("  Permissions: " + permMode + "\n");
  out.write("\nStarting Hax Agent...\n\n");

  rl.close();
  return { provider, model, apiKey, permMode };
}

function shouldRunSetup(): boolean {
  var sdir = path.join(os.homedir(), ".haxagent");
  var sp = path.join(sdir, "settings.json");
  if (fs.existsSync(sp)) {
    try {
      var s: Record<string, unknown> = JSON.parse(fs.readFileSync(sp, "utf-8"));
      if (s.setup && (s.setup as Record<string, unknown>).initialized) return false;
    } catch (_) {}
  }
  // Check for env vars
  if (process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY ||
      process.env.DEEPSEEK_API_KEY || process.env.GOOGLE_API_KEY) return false;
  return true;
}

export { runSetup, shouldRunSetup };
