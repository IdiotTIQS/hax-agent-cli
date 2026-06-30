/**
 * mcp-bootstrap.ts — shared MCP startup helper.
 *
 * Called once per CLI session (both legacy readline and ink TUI paths).
 * Instantiates McpClientManager, loads ~/.haxagent/mcp/mcp.json, starts
 * all enabled servers, discovers their tools, and registers each tool into
 * the shared ToolRegistry under the name "mcp__<server>__<tool>".
 *
 * The name prefix "mcp__<server>__<tool>" avoids collisions with built-in
 * tools (which use "." separators) and matches what ctx.mcpManager consumers
 * in mcp-tools.ts / extended.ts expect to look up via getStatus().
 *
 * Failures at any stage are caught and logged to stderr — bootstrapMcp never
 * throws, so a missing/broken MCP config never prevents the CLI from starting.
 */

import { McpClientManager } from "./mcp.js";
import type { ToolRegistry } from "../tools/registry.js";

/**
 * Bootstrap MCP: load config → start servers → discover tools → register.
 *
 * @param toolRegistry  The shared ToolRegistry to register MCP tools into.
 * @returns The McpClientManager instance (may have zero running servers on
 *          failure or empty config). Never returns null so callers can always
 *          pass it to CommandContext without an extra null check.
 */
export async function bootstrapMcp(toolRegistry: ToolRegistry): Promise<McpClientManager> {
  const mgr = new McpClientManager();

  try {
    mgr.loadConfig();

    // getStatus() returns {} when no servers are configured.
    const status = mgr.getStatus() as Record<string, unknown>;
    if (!status || Object.keys(status).length === 0) {
      // No MCP servers configured — return the empty manager so /mcp command works.
      return mgr;
    }

    process.stderr.write("[MCP] Starting MCP servers...\n");

    await mgr.startAll();

    // Brief pause to let MCP servers finish their initialization handshake
    // before we request the tool list (especially important for npx-based
    // servers that need a moment after the stdio initialize/initialized exchange).
    await new Promise<void>((resolve) => setTimeout(resolve, 500));

    const tools = await mgr.discoverTools();

    for (const t of tools) {
      // t.name is already prefixed as "mcp.<serverName>.<rawToolName>" by _listTools.
      // We strip that prefix to get the raw tool name, then re-prefix with "__" separator
      // for the registry key: "mcp__<server>__<rawTool>".
      const serverName = t._mcpServer;
      const internalPrefix = `mcp.${serverName}.`;
      const rawToolName = t.name.startsWith(internalPrefix)
        ? t.name.slice(internalPrefix.length)
        : t.name;
      const registryName = `mcp__${serverName}__${rawToolName}`;

      toolRegistry.register({
        name: registryName,
        description: t.description ?? `MCP tool ${rawToolName} from ${serverName}`,
        inputSchema: t.inputSchema ?? { type: "object", properties: {} },
        execute: t.execute as (args: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<{ ok: boolean; data?: unknown; error?: { code: string; message: string } }>,
        isReadOnly: (_args?: Record<string, unknown>) => false,
      });
    }

    const count = tools.length;
    process.stderr.write(`[MCP] Registered ${count} MCP tool(s) from ${Object.keys(status).length} server(s).\n`);
  } catch (err) {
    // Bootstrap failure must not crash the CLI.
    process.stderr.write(`[MCP] Bootstrap failed (continuing without MCP): ${(err as Error).message}\n`);
  }

  return mgr;
}
