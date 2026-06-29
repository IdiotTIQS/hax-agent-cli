/**
 * Plan Mode Tools — enter and exit planning mode.
 * Ported from OpenHarness tools/enter_plan_mode_tool.py + exit_plan_mode_tool.py
 *
 * Plan mode blocks all modifying operations, allowing the agent to
 * explore and research without making changes. Used for:
 * - Architecture planning before implementation
 * - Code review without accidental edits
 * - Safe exploration of unknown codebases
 */

// === Shared Plan Mode State ===

interface PermissionCheckerLike {
  mode: string;
  setMode: (m: string) => void;
}

/**
 * Manages plan mode transitions across sessions.
 * Tracks the previous permission mode for proper restoration.
 */
class PlanModeState {
  _planSessions: Map<string, { previousMode: string; enteredAt: number }>;

  constructor() {
    this._planSessions = new Map(); // sessionId → { previousMode, enteredAt }
  }

  /**
   * Enter plan mode for a session.
   * @param {string} sessionId
   * @param {Object} permissionChecker — PermissionChecker instance with setMode()
   * @returns {Object} { ok, previousMode }
   */
  enter(sessionId: string, permissionChecker: PermissionCheckerLike) {
    if (!permissionChecker || !permissionChecker.mode) {
      return { ok: false, error: "No permission checker available" };
    }

    const previousMode = permissionChecker.mode;

    if (previousMode === "plan") {
      return { ok: true, previousMode, message: "Already in plan mode" };
    }

    permissionChecker.setMode("plan");
    this._planSessions.set(sessionId, { previousMode, enteredAt: Date.now() });

    return {
      ok: true,
      previousMode,
      message: `Entered plan mode (was: ${previousMode}). All modifications are blocked. Use exit_plan_mode to restore.`,
    };
  }

  /**
   * Exit plan mode for a session.
   * @param {string} sessionId
   * @param {Object} permissionChecker
   * @returns {Object} { ok, restoredMode }
   */
  exit(sessionId: string, permissionChecker: PermissionCheckerLike) {
    if (!permissionChecker || !permissionChecker.mode) {
      return { ok: false, error: "No permission checker available" };
    }

    const currentMode = permissionChecker.mode;
    if (currentMode !== "plan") {
      return { ok: true, restoredMode: currentMode, message: `Not in plan mode (current: ${currentMode})` };
    }

    const saved = this._planSessions.get(sessionId);
    const restoredMode = saved?.previousMode || "normal";

    permissionChecker.setMode(restoredMode);
    this._planSessions.delete(sessionId);

    return {
      ok: true,
      restoredMode,
      message: `Exited plan mode. Restored to: ${restoredMode}`,
    };
  }

  /**
   * Check if a session is currently in plan mode.
   */
  isInPlanMode(sessionId: string, permissionChecker: PermissionCheckerLike) {
    return permissionChecker?.mode === "plan";
  }
}

// Singleton
const planModeState = new PlanModeState();

// === Enter Plan Mode Tool ===

const enterPlanModeTool = {
  name: "enter_plan_mode",
  description:
    "Enter plan mode — blocks all file modifications and shell commands that change state. " +
    "Use this when you need to explore, research, or design an implementation approach " +
    "without making changes. The user can review your plan and approve before you proceed.",
  inputSchema: {
    type: "object",
    required: [],
    properties: {
      reason: {
        type: "string",
        description: "Brief reason why plan mode is needed (shown to user)",
      },
    },
  },

  isReadOnly: () => true,

  async execute(args: Record<string, unknown>, ctx: Record<string, unknown>) {
    const sessionId = (ctx.sessionId as string) || "default";
    const permissionChecker = (ctx.permissionChecker || ctx.permissions) as PermissionCheckerLike | undefined;

    if (!permissionChecker) {
      return {
        ok: false,
        error: {
          code: "NO_PERMISSION_CHECKER",
          message: "Permission checker not available in this context",
        },
      };
    }

    const result = planModeState.enter(sessionId, permissionChecker);

    if (!result.ok) {
      return {
        ok: false,
        error: { code: "PLAN_MODE_FAILED", message: result.error },
      };
    }

    return {
      ok: true,
      data: {
        mode: "plan",
        previous_mode: result.previousMode,
        reason: (args.reason as string) || "Exploration and planning",
        message: result.message,
      },
    };
  },
};

// === Exit Plan Mode Tool ===

const exitPlanModeTool = {
  name: "exit_plan_mode",
  description:
    "Exit plan mode — restore the previous permission mode. " +
    "Use this after the user has approved your implementation plan.",
  inputSchema: {
    type: "object",
    required: [],
    properties: {
      plan_summary: {
        type: "string",
        description: "Brief summary of the plan that was approved (shown to user)",
      },
    },
  },

  isReadOnly: () => false,

  async execute(args: Record<string, unknown>, ctx: Record<string, unknown>) {
    const sessionId = (ctx.sessionId as string) || "default";
    const permissionChecker = (ctx.permissionChecker || ctx.permissions) as PermissionCheckerLike | undefined;

    if (!permissionChecker) {
      return {
        ok: false,
        error: {
          code: "NO_PERMISSION_CHECKER",
          message: "Permission checker not available in this context",
        },
      };
    }

    const result = planModeState.exit(sessionId, permissionChecker);

    if (!result.ok) {
      return {
        ok: false,
        error: { code: "EXIT_PLAN_MODE_FAILED", message: result.error },
      };
    }

    return {
      ok: true,
      data: {
        restored_mode: result.restoredMode,
        plan_summary: (args.plan_summary as string) || null,
        message: result.message,
      },
    };
  },
};

export {
  enterPlanModeTool,
  exitPlanModeTool,
  PlanModeState,
  planModeState,
};
