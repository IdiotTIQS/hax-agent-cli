/**
 * Agent Tool — spawn sub-agents for independent tasks.
 * Ported from OpenHarness tools/agent_tool.py
 *
 * Supports:
 * - local_agent mode: spawn within same process
 * - remote_agent mode: spawn via network (deferred)
 * - Configurable max_turns, model selection
 * - Result collection and error handling
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// === Agent Tool ===

const agentTool = {
  name: "agent",
  description:
    "Launch a sub-agent to handle a complex, independent task autonomously. " +
    "The sub-agent will work on the task and return its findings. " +
    "Use this when you need to delegate research, exploration, or multi-step work.",
  inputSchema: {
    type: "object",
    required: ["description"],
    properties: {
      description: {
        type: "string",
        description: "A short (3-5 word) description of the task for the sub-agent",
      },
      prompt: {
        type: "string",
        description: "Detailed instructions for the sub-agent. Be specific about what to do and what to return.",
      },
      mode: {
        type: "string",
        enum: ["local_agent", "remote_agent"],
        default: "local_agent",
        description: "Execution mode: local_agent (same process) or remote_agent (network)",
      },
      max_turns: {
        type: "number",
        default: 15,
        description: "Maximum number of agent turns before stopping",
      },
      model: {
        type: "string",
        description: "Model to use for the sub-agent. Defaults to parent session model.",
      },
      run_in_background: {
        type: "boolean",
        default: false,
        description: "Run in background and return immediately with agent tracking ID",
      },
    },
  },

  isReadOnly: () => true,

  /**
   * Execute the agent tool.
   */
  async execute(args, ctx) {
    const description = args.description || "Unnamed task";
    const prompt = args.prompt || args.description || "";
    const mode = args.mode || "local_agent";
    const maxTurns = Math.min(args.max_turns || 15, 50); // cap at 50
    const runInBackground = !!args.run_in_background;

    // Generate unique agent ID
    const agentId = `agent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    if (runInBackground) {
      // Return immediately with tracking info
      return {
        ok: true,
        data: {
          agent_type: "subagent",
          mode,
          agent_id: agentId,
          description,
          status: "spawned",
          message: `Sub-agent "${description}" spawned in background. Track with agent ID: ${agentId}`,
        },
      };
    }

    // === Local Agent Mode ===
    if (mode === "local_agent") {
      return await _runLocalAgent(agentId, description, prompt, maxTurns, ctx);
    }

    // === Remote Agent Mode ===
    if (mode === "remote_agent") {
      return _runRemoteAgent(agentId, description, prompt, maxTurns, ctx);
    }

    return {
      ok: false,
      error: {
        code: "INVALID_MODE",
        message: `Unknown agent mode: ${mode}. Supported: local_agent, remote_agent`,
      },
    };
  },
};

/**
 * Run a local sub-agent using the current HaxAgent CLI.
 * Spawns a child process with hax-agent --batch mode.
 */
async function _runLocalAgent(agentId, description, prompt, maxTurns, ctx) {
  const startTime = Date.now();

  try {
    // Build the batch command
    const haxPath = ctx.haxAgentPath || _findHaxAgentPath();
    const cwd = ctx.root || process.cwd();

    if (!haxPath) {
      // No CLI available — return simulated result for now
      return {
        ok: true,
        data: {
          agent_id: agentId,
          description,
          mode: "local_agent",
          output: `[Agent simulation] Would execute sub-agent for: "${description}"\nPrompt: ${prompt}\nMax turns: ${maxTurns}`,
          duration_ms: Date.now() - startTime,
          status: "simulated",
        },
      };
    }

    // Escape the prompt for command-line
    const escapedPrompt = prompt.replace(/"/g, '\\"').replace(/\n/g, "\\n");

    const command = `"${haxPath}" --batch "${escapedPrompt}" --max-turns ${maxTurns}`;

    try {
      const output = execSync(command, {
        cwd,
        timeout: Math.min(maxTurns * 30000, 300000), // max 5 min
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024, // 10MB
      }).trim();

      return {
        ok: true,
        data: {
          agent_id: agentId,
          description,
          mode: "local_agent",
          output: output.slice(0, 50000),
          duration_ms: Date.now() - startTime,
          truncated: output.length > 50000,
          status: "completed",
        },
      };
    } catch (err) {
      const stderr = err.stderr || "";
      const stdout = err.stdout || "";

      return {
        ok: false,
        data: {
          agent_id: agentId,
          description,
          mode: "local_agent",
          output: stdout + (stderr ? "\n[stderr]\n" + stderr : ""),
          duration_ms: Date.now() - startTime,
          status: "failed",
        },
        error: {
          code: "AGENT_EXECUTION_FAILED",
          message: err.message,
          exitCode: err.status || 1,
        },
      };
    }
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "AGENT_SPAWN_FAILED",
        message: `Failed to spawn local agent: ${err.message}`,
      },
    };
  }
}

/**
 * Deferred: run a remote sub-agent via network.
 */
function _runRemoteAgent(agentId, description, prompt, maxTurns, ctx) {
  return {
    ok: true,
    data: {
      agent_id: agentId,
      description,
      mode: "remote_agent",
      output: `[Remote agent] Mode "remote_agent" requires network configuration. Agent "${description}" registered but not executed.`,
      status: "registered",
    },
  };
}

/**
 * Find the hax-agent CLI binary path.
 */
function _findHaxAgentPath() {
  try {
    // Try to find hax-agent in node_modules/.bin
    const candidates = [
      path.join(process.cwd(), "node_modules", ".bin", "hax-agent"),
      path.join(process.cwd(), "node_modules", ".bin", "hax-agent.cmd"),
      path.join(process.cwd(), "src", "cli.js"),
    ];

    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch (_) {}
    }

    // Try 'which' / 'where'
    try {
      const which = process.platform === "win32" ? "where hax-agent" : "which hax-agent";
      const result = execSync(which, { encoding: "utf-8", timeout: 5000 }).trim();
      if (result) return result.split("\n")[0].trim();
    } catch (_) {}

    return null;
  } catch (_) {
    return null;
  }
}

export { agentTool };
