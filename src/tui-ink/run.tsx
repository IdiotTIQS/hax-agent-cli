/**
 * run.tsx — ink entrypoint for the --ink flag (Stage F5).
 *
 * Builds the provider / session / pm / skills / engine stack EXACTLY like
 * runInteractive in cli.ts does (same construction order, same options).
 * Then renders <App> with the approval bridge wired via dispatchRef.
 *
 * Approval bridge (RISK 1):
 *   1. A React.MutableRefObject<AppDispatch | null> is created here.
 *   2. makeApprovalCallback(dispatchRef) builds the engine's approvalCallback.
 *   3. The approvalCallback and dispatchRef are created before render().
 *   4. render(<App dispatchRef={dispatchRef} />) — App assigns
 *      dispatchRef.current = dispatch on its first render.
 *   5. When engine calls approvalCallback(toolName, toolInput):
 *      - A Promise is created; resolve is wrapped to ALSO dispatch set_approval(null).
 *      - dispatch({type:"set_approval", approval:{toolName,toolInput,wrappedResolve}})
 *        mounts ApprovalPrompt.
 *   6. User presses y/n/a → ApprovalPrompt fires setImmediate(resolve) (F4 guard).
 *   7. wrappedResolve: engineResolve(answer) + dispatch(set_approval(null)) unmounts.
 *
 * Engine construction is a near-copy of runInteractive so the two paths stay
 * in sync.  This module is imported lazily from cli.ts only when --ink is set.
 */

import React, { createRef } from "react";
import { render } from "ink";

import { THEME, styled } from "../shared/utils.js";
import { loadSettings, saveSettings } from "../config/settings.js";
import { ProfileManager } from "../config/profiles.js";
import { createProvider } from "../api/provider.js";
import { createDefaultRegistry } from "../tools/registry.js";
import {
  Session,
  AgentEngine,
  PermissionChecker,
  HookExecutor,
  PermissionMode,
} from "../engine/agent.js";
import type { SessionProvider, PluginRegistry, Sandbox } from "../engine/agent.js";
import { loadSkillRegistry } from "../skills/registry.js";
import { loadPluginRegistry } from "../plugins/registry.js";
import { SandboxAdapter } from "../sandbox/adapter.js";
import { applyTheme } from "../shared/themes.js";
import * as commandsRegistryMod from "../commands/registry.js";

import { App, makeApprovalCallback } from "./App.js";
import type { AppDispatch } from "./App.js";

// ---------------------------------------------------------------------------
// Flags interface (subset of ParsedFlags from cli.ts)
// ---------------------------------------------------------------------------

export interface InkFlags {
  provider?: string;
  model?: string;
  profile?: string;
  permissionMode?: string;
  maxTurns?: string;
  apiKey?: string;
  sandbox?: boolean;
  _?: string[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// runInteractiveInk
// ---------------------------------------------------------------------------

/**
 * Start the ink interactive TUI.
 *
 * Mirrors runInteractive from cli.ts in construction order.
 * Does NOT alter the readline path.
 */
export async function runInteractiveInk(flags: InkFlags): Promise<void> {
  // ── Settings & profile ───────────────────────────────────────────────────
  const settings = (loadSettings() ?? {}) as Record<string, unknown>;

  const agentSettings = settings.agent as Record<string, unknown> | undefined;
  const permsSettings = settings.permissions as Record<string, unknown> | undefined;
  const uiSettings = settings.ui as Record<string, unknown> | undefined;
  const sandboxSettings = settings.sandbox as Record<string, unknown> | undefined;

  const profiles = new ProfileManager();

  let providerName: string | undefined =
    flags.provider ?? (agentSettings?.provider as string | undefined);
  let modelName: string | undefined =
    flags.model ?? (agentSettings?.model as string | undefined);
  const permMode: string =
    flags.permissionMode ??
    (permsSettings?.mode as string | undefined) ??
    PermissionMode.DEFAULT;

  if (flags.profile) {
    if (profiles.use(flags.profile)) {
      providerName = profiles.active.provider;
      modelName = profiles.active.model;
    } else {
      console.error(`Error: unknown profile "${flags.profile}"`);
      process.exit(1);
    }
  } else {
    const savedProfile =
      (agentSettings?._activeProfile as string | undefined) ?? providerName;
    if (savedProfile && profiles.use(savedProfile)) {
      /* profile active */
    }
    providerName = providerName ?? profiles.active.provider;
    modelName = modelName ?? profiles.active.model;
  }

  // ── Provider ─────────────────────────────────────────────────────────────
  const provider = createProvider({ provider: providerName, model: modelName });
  if (flags.apiKey) {
    provider.apiKey = flags.apiKey;
  }

  // ── Core infrastructure ──────────────────────────────────────────────────
  const pm = new PermissionChecker({ mode: permMode });
  const hooks = new HookExecutor();
  const toolRegistry = createDefaultRegistry(process.cwd());
  const skills = loadSkillRegistry();

  // ── Plugin system ────────────────────────────────────────────────────────
  const pluginRegistry = loadPluginRegistry(process.cwd());
  const pluginHooks = pluginRegistry.getAllHooks() as Array<{
    event?: string;
    matcher?: string;
    priority?: number;
  }>;
  for (const h of pluginHooks) {
    hooks.register(h.event ?? "pre.tool_use", async () => {}, {
      matcher: h.matcher,
      priority: h.priority ?? 0,
    });
  }

  // ── Sandbox ──────────────────────────────────────────────────────────────
  let sandbox: SandboxAdapter | null = null;
  const explicitSandbox = !!flags.sandbox;
  const sandboxEnabled = explicitSandbox || !!sandboxSettings?.enabled;
  if (sandboxEnabled) {
    sandbox = new SandboxAdapter({
      backend: (sandboxSettings?.backend as string) ?? "docker",
      image: (sandboxSettings?.image as string) ?? "node:18-alpine",
      network: (sandboxSettings?.network as string) ?? "none",
      cpus: (sandboxSettings?.cpus as number) ?? 2,
      memory: (sandboxSettings?.memory as string) ?? "512m",
      hostDir: process.cwd(),
    });
    try {
      await sandbox.start();
      if (sandbox.isRunning) {
        process.stderr.write(
          styled(THEME.success, "Sandbox: docker (running)") + "\n",
        );
      }
    } catch (err) {
      if (explicitSandbox) {
        process.stderr.write(
          styled(THEME.warning, "Sandbox unavailable: " + (err as Error).message) +
            "\n",
        );
      }
      sandbox = null;
    }
  }

  // ── Session ──────────────────────────────────────────────────────────────
  const session = new Session({
    provider: provider as SessionProvider,
    toolRegistry,
    permissionManager: pm,
    hookExecutor: hooks,
    pluginRegistry: pluginRegistry as PluginRegistry,
    sandbox: sandbox as Sandbox | null,
  });

  // ── Restore saved permissions / thinking / theme ─────────────────────────
  if (permsSettings?.allowedTools) {
    for (const t of permsSettings.allowedTools as string[]) pm.allowTool(t);
  }
  if (permsSettings?.deniedTools) {
    for (const t of permsSettings.deniedTools as string[]) pm.denyTool(t);
  }
  if (agentSettings?.thinking) {
    session._thinking = true;
    session._thinkIntensity = agentSettings.thinkIntensity ?? null;
  }
  if (uiSettings?.theme) {
    try {
      applyTheme(uiSettings.theme as string, THEME);
    } catch (_) {}
  }

  // ── saveActiveProfile — persist active profile to settings (mirrors runInteractive) ──
  function saveActiveProfile(profilesRef: ProfileManager): void {
    try {
      const s = loadSettings();
      if (!s.agent) s.agent = {};
      s.agent._activeProfile = profilesRef.activeName;
      s.agent.provider = profilesRef.active.provider;
      s.agent.model = profilesRef.active.model;
      saveSettings(s);
    } catch (_) {}
  }
  // Persist the resolved active profile at startup so the next session restores it.
  saveActiveProfile(profiles);

  // ── Approval bridge ───────────────────────────────────────────────────────
  // Create a ref that App will populate with its dispatch on first render.
  // TIMING GUARANTEE: dispatchRef.current is null until App's first render.
  // makeApprovalCallback wraps the ref — it must not be called before App
  // mounts.  In practice the engine only calls approvalCallback from inside
  // engine.sendMessage(), which is triggered by handleSubmit(), which only
  // fires after App has mounted and the user submits input.  This structural
  // guarantee means the null case in makeApprovalCallback is a safety net,
  // not a normal code path.  If it ever fires, the Promise will hang — see
  // makeApprovalCallback in App.tsx for the null guard comment.
  const dispatchRef: React.MutableRefObject<AppDispatch | null> = { current: null };
  const approvalCallback = makeApprovalCallback(dispatchRef);

  // ── Engine ────────────────────────────────────────────────────────────────
  const maxTurns = flags.maxTurns ? parseInt(flags.maxTurns, 10) : undefined;
  const engine = new AgentEngine({
    session,
    projectRoot: process.cwd(),
    skillRegistry: skills,
    approvalCallback: approvalCallback,
    maxToolTurns: maxTurns,
  });

  // ── Command & skill names for completions ─────────────────────────────────
  const commandNames = Object.keys(commandsRegistryMod.commands ?? {});
  const skillNames: string[] = [];
  try {
    for (const s of skills.list()) {
      skillNames.push(s.name);
    }
  } catch (_) {}

  // ── Render ────────────────────────────────────────────────────────────────
  const { waitUntilExit } = render(
    <App
      engine={engine}
      pm={pm}
      initialModel={provider.model ?? ""}
      initialMode={pm.mode}
      providerName={provider.name ?? ""}
      commandNames={commandNames}
      skillNames={skillNames}
      dispatchRef={dispatchRef}
    />,
  );

  await waitUntilExit();

  if (sandbox) {
    try {
      sandbox.stop();
    } catch (_) {}
  }
  process.exit(0);
}
