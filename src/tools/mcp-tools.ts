/**
 * MCP Tools — bridge MCP servers to the Agent tool system.
 *
 * Three tools:
 *   - list_mcp_resources  — discover resources from MCP servers
 *   - read_mcp_resource   — fetch a specific resource
 *   - list_mcp_tools      — discover available MCP tools
 *
 * These work with the existing McpClientManager in services/mcp.js.
 * The MCP manager is injected via context (ctx.mcpManager).
 */

// Internal shape accessed from McpClientManager — justified any boundary
interface McpManagerLike {
  _servers: Map<string, McpServerEntryLike>;
  _sendMCPRequest(child: unknown, request: Record<string, unknown>): Promise<unknown>;
  discoverTools(name?: string | null): Promise<Array<{ name: string; description: string; _mcpServer?: string; [key: string]: unknown }>>;
}
interface McpServerEntryLike {
  status: string;
  process: unknown;
  tools: Array<{ name: string }>;
  error?: string | null;
  _httpClient?: { url: string; headers: Record<string, string> };
}
interface McpRpcResult {
  error?: { message?: string };
  resources?: unknown[];
  contents?: unknown;
  [key: string]: unknown;
}

// === List MCP Resources ===

const listMcpResourcesTool = {
  name: "list_mcp_resources",
  description:
    "List available resources from configured MCP servers. " +
    "Resources can include files, database tables, API endpoints, and more. " +
    "Optionally filter by server name.",
  inputSchema: {
    type: "object",
    required: [],
    properties: {
      server: {
        type: "string",
        description: "Optional server name to filter resources by. If omitted, lists all servers.",
      },
    },
  },

  isReadOnly: () => true,

  async execute(args: Record<string, unknown>, ctx: Record<string, unknown>) {
    const manager = ctx.mcpManager as McpManagerLike | undefined;
    if (!manager) {
      return {
        ok: false,
        error: {
          code: "MCP_NOT_CONFIGURED",
          message: "MCP manager not available. Configure MCP servers in ~/.haxagent/mcp/mcp.json",
        },
      };
    }

    const serverName = (args.server as string) || null;
    const resources: Array<{ server: string; status: string; resources: unknown[]; count?: number; error?: string | null }> = [];

    try {
      const servers: Array<[string, McpServerEntryLike | undefined]> = serverName
        ? [[serverName, manager._servers.get(serverName)]]
        : [...manager._servers.entries()];

      for (const [name, info] of servers) {
        if (!info || info.status !== "running") {
          resources.push({
            server: name,
            status: info?.status || "unknown",
            resources: [],
            error: info?.status !== "running" ? `Server not running (status: ${info?.status})` : null,
          });
          continue;
        }

        try {
          const serverResources = await _listResources(manager, name, info);
          resources.push({
            server: name,
            status: "running",
            resources: serverResources,
            count: serverResources.length,
          });
        } catch (err) {
          resources.push({
            server: name,
            status: "error",
            error: (err as Error).message,
            resources: [],
          });
        }
      }

      const totalCount = resources.reduce((sum, r) => sum + (r.count || 0), 0);

      return {
        ok: true,
        data: {
          servers: resources,
          total_servers: resources.length,
          total_resources: totalCount,
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: { code: "MCP_LIST_ERROR", message: (err as Error).message },
      };
    }
  },
};

// === Read MCP Resource ===

const readMcpResourceTool = {
  name: "read_mcp_resource",
  description:
    "Read a specific resource from an MCP server by URI. " +
    "Use list_mcp_resources first to discover available resources.",
  inputSchema: {
    type: "object",
    required: ["server", "uri"],
    properties: {
      server: {
        type: "string",
        description: "MCP server name that owns the resource",
      },
      uri: {
        type: "string",
        description: "Resource URI to read (as returned by list_mcp_resources)",
      },
    },
  },

  isReadOnly: () => true,

  async execute(args: Record<string, unknown>, ctx: Record<string, unknown>) {
    const manager = ctx.mcpManager as McpManagerLike | undefined;
    if (!manager) {
      return {
        ok: false,
        error: {
          code: "MCP_NOT_CONFIGURED",
          message: "MCP manager not available",
        },
      };
    }

    const serverName = args.server as string;
    const uri = args.uri as string;

    if (!serverName || !uri) {
      return {
        ok: false,
        error: {
          code: "INVALID_PARAMS",
          message: "Both 'server' and 'uri' are required",
        },
      };
    }

    const info = manager._servers.get(serverName);
    if (!info) {
      return {
        ok: false,
        error: { code: "SERVER_NOT_FOUND", message: `MCP server "${serverName}" not found` },
      };
    }

    if (info.status !== "running") {
      return {
        ok: false,
        error: { code: "SERVER_NOT_RUNNING", message: `Server "${serverName}" is ${info.status}` },
      };
    }

    try {
      const content = await _readResource(manager, serverName, info, uri);

      return {
        ok: true,
        data: {
          server: serverName,
          uri,
          content,
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: { code: "MCP_READ_ERROR", message: (err as Error).message },
      };
    }
  },
};

// === List MCP Tools ===

const listMcpToolsTool = {
  name: "list_mcp_tools",
  description:
    "List all available tools from configured MCP servers. " +
    "These tools can be called directly as mcp.<server>.<tool_name>.",
  inputSchema: {
    type: "object",
    required: [],
    properties: {
      server: {
        type: "string",
        description: "Optional server name to filter tools by",
      },
    },
  },

  isReadOnly: () => true,

  async execute(args: Record<string, unknown>, ctx: Record<string, unknown>) {
    const manager = ctx.mcpManager as McpManagerLike | undefined;
    if (!manager) {
      return {
        ok: false,
        error: {
          code: "MCP_NOT_CONFIGURED",
          message: "MCP manager not available",
        },
      };
    }

    try {
      const tools = await manager.discoverTools((args.server as string) || null);
      const byServer: Record<string, Array<{ name: string; description: string }>> = {};

      for (const tool of tools) {
        const server = tool._mcpServer || "unknown";
        if (!byServer[server]) byServer[server] = [];
        byServer[server].push({
          name: tool.name,
          description: tool.description,
        });
      }

      return {
        ok: true,
        data: {
          tools_by_server: byServer,
          total_tools: tools.length,
          servers: Object.keys(byServer).length,
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: { code: "MCP_TOOLS_ERROR", message: (err as Error).message },
      };
    }
  },
};

// === Internal Helpers ===

async function _listResources(manager: McpManagerLike, serverName: string, info: McpServerEntryLike) {
  const request = {
    jsonrpc: "2.0",
    id: Date.now(),
    method: "resources/list",
  };

  if (info.process) {
    const result = await manager._sendMCPRequest(info.process, request) as McpRpcResult;
    return ((result?.resources || []) as Array<{ uri: string; name?: string; description?: string; mimeType?: string }>).map((r) => ({
      uri: r.uri,
      name: r.name || r.uri,
      description: r.description || "",
      mimeType: r.mimeType || null,
    }));
  }

  if (info._httpClient) {
    const r = await fetch(info._httpClient.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...info._httpClient.headers },
      body: JSON.stringify(request),
    });
    const data = await r.json() as McpRpcResult;
    return ((data?.resources || []) as Array<{ uri: string; name?: string; description?: string; mimeType?: string }>).map((r) => ({
      uri: r.uri,
      name: r.name || r.uri,
      description: r.description || "",
      mimeType: r.mimeType || null,
    }));
  }

  return [];
}

async function _readResource(manager: McpManagerLike, serverName: string, info: McpServerEntryLike, uri: string) {
  const request = {
    jsonrpc: "2.0",
    id: Date.now(),
    method: "resources/read",
    params: { uri },
  };

  if (info.process) {
    const result = await manager._sendMCPRequest(info.process, request) as McpRpcResult;
    if (result?.error) throw new Error(result.error.message);
    return result?.contents || result;
  }

  if (info._httpClient) {
    const r = await fetch(info._httpClient.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...info._httpClient.headers },
      body: JSON.stringify(request),
    });
    const data = await r.json() as McpRpcResult;
    if (data?.error) throw new Error(data.error.message);
    return data?.contents || data;
  }

  throw new Error("Server has no active transport");
}

export {
  listMcpResourcesTool,
  readMcpResourceTool,
  listMcpToolsTool,
};
