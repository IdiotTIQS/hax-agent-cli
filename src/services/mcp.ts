/**
 * MCP Client — full Model Context Protocol client supporting
 * stdio and HTTP transports. Ported from OpenHarness mcp/client.py.
 *
 * Usage:
 *   const mgr = new McpClientManager();
 *   mgr.addServer("filesystem", { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] });
 *   await mgr.startAll();
 *   const tools = await mgr.discoverTools();
 *   toolRegistry.registerMCP(tools);
 */

import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { EventEmitter } from "events";
import path from "path";
import fs from "fs";
import os from "os";

// === Interfaces ===

interface McpServerConfigOptions {
  name?: string;
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  configDir?: string;
}

interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  isReadOnly: () => boolean;
}

interface McpServerEntry {
  config: McpServerConfig;
  process: ChildProcessWithoutNullStreams | null;
  tools: McpToolInfo[];
  status: string;
  error: string | null;
  restartCount: number;
  _httpClient?: { url: string; headers: Record<string, string> };
}

interface JsonRpcResponse {
  id?: unknown;
  error?: { message?: string };
  tools?: unknown[];
  resources?: unknown[];
  contents?: unknown;
  content?: unknown;
  [key: string]: unknown;
}

// === MCP Server Config ===

class McpServerConfig {
  name: string;
  type: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  url: string;
  headers: Record<string, string>;
  enabled: boolean;

  constructor(o: McpServerConfigOptions = {}) {
    this.name = o.name || "";
    this.type = o.type || "stdio"; // "stdio" | "http" | "ws"
    // stdio
    this.command = o.command || "";
    this.args = o.args || [];
    this.env = o.env || {};
    this.cwd = o.cwd || process.cwd();
    // http/ws
    this.url = o.url || "";
    this.headers = o.headers || {};
    this.enabled = o.enabled !== false;
  }
}

// === MCP Client Manager ===

class McpClientManager extends EventEmitter {
  _servers: Map<string, McpServerEntry>;
  _configDir: string;
  _defaultConfigPath: string;

  constructor(o: McpServerConfigOptions = {}) {
    super();
    this._servers = new Map(); // name -> { config, process, tools, status }
    this._configDir = o.configDir || path.join(os.homedir(), ".haxagent", "mcp");
    this._defaultConfigPath = path.join(this._configDir, "mcp.json");
  }

  /** Add a server configuration */
  addServer(name: string, config: McpServerConfigOptions | McpServerConfig) {
    const cfg = config instanceof McpServerConfig ? config : new McpServerConfig({ ...config, name });
    this._servers.set(name, {
      config: cfg,
      process: null,
      tools: [],
      status: "stopped", // stopped | starting | running | error
      error: null,
      restartCount: 0,
    });
    return this;
  }

  /** Remove a server and stop it if running */
  removeServer(name: string) {
    const info = this._servers.get(name);
    if (info) this._stopServer(name, info);
    this._servers.delete(name);
    return this;
  }

  /** Start all enabled servers */
  async startAll() {
    const promises: Promise<McpServerEntry>[] = [];
    for (const [name, info] of this._servers) {
      if (info.config.enabled) promises.push(this.startServer(name));
    }
    return Promise.allSettled(promises);
  }

  /** Start a single server */
  async startServer(name: string): Promise<McpServerEntry> {
    const info = this._servers.get(name);
    if (!info) throw new Error(`Unknown MCP server: ${name}`);
    if (info.status === "running") return info;

    info.status = "starting";
    const cfg = info.config;

    try {
      if (cfg.type === "stdio") {
        await this._startStdio(name, info, cfg);
      } else if (cfg.type === "http" || cfg.type === "ws") {
        await this._startHttp(name, info, cfg);
      } else {
        throw new Error(`Unsupported transport: ${cfg.type}`);
      }

      info.status = "running";
      info.restartCount = 0;
      this.emit("started", { name, tools: info.tools.length });
    } catch (err) {
      info.status = "error";
      info.error = (err as Error).message;
      this.emit("error", { name, error: (err as Error).message });
    }
    return info;
  }

  /** Stop a server */
  stopServer(name: string) {
    const info = this._servers.get(name);
    if (!info) return;
    this._stopServer(name, info);
    info.status = "stopped";
  }

  /** Stop all servers */
  stopAll() {
    for (const [name, info] of this._servers) this._stopServer(name, info);
  }

  /** Discover all tools from running servers */
  async discoverTools(name: string | null = null) {
    const tools: Array<McpToolInfo & { _mcpServer: string; execute: (args: Record<string, unknown>, ctx: unknown) => Promise<unknown> }> = [];
    const servers = name ? [[name, this._servers.get(name)] as [string, McpServerEntry | undefined]] : [...this._servers.entries()];

    for (const [n, info] of servers) {
      if (!info || info.status !== "running") continue;
      try {
        const serverTools = await this._listTools(n, info);
        info.tools = serverTools;
        for (const t of serverTools) {
          tools.push({
            ...t,
            _mcpServer: n,
            execute: this._createMcpExecutor(n, t.name),
          });
        }
      } catch (_) {}
    }
    return tools;
  }

  /** Get server status */
  getStatus(name: string | null = null) {
    if (name) {
      const info = this._servers.get(name);
      return info ? { name, status: info.status, tools: info.tools.length, error: info.error } : null;
    }
    const statuses: Record<string, { status: string; tools: number; error: string | null }> = {};
    for (const [n, info] of this._servers) {
      statuses[n] = { status: info.status, tools: info.tools.length, error: info.error };
    }
    return statuses;
  }

  /** Load MCP config from JSON */
  loadConfig(filePath: string | null = null) {
    const fp = filePath || this._defaultConfigPath;
    if (!fs.existsSync(fp)) return;
    try {
      const config = JSON.parse(fs.readFileSync(fp, "utf-8"));
      const servers = config.mcpServers || config.servers || config;
      for (const [name, cfg] of Object.entries(servers)) {
        this.addServer(name, cfg as McpServerConfigOptions);
      }
    } catch (_) {}
  }

  /** Save current config to JSON */
  saveConfig(filePath: string | null = null) {
    const fp = filePath || this._defaultConfigPath;
    if (!fs.existsSync(path.dirname(fp))) fs.mkdirSync(path.dirname(fp), { recursive: true });
    const servers: Record<string, McpServerConfig> = {};
    for (const [name, info] of this._servers) {
      servers[name] = info.config;
    }
    fs.writeFileSync(fp, JSON.stringify({ mcpServers: servers }, null, 2));
  }

  /** Register MCP tools into a ToolRegistry */
  async registerToRegistry(registry: { register: (t: unknown) => void }) {
    const tools = await this.discoverTools();
    for (const t of tools) {
      registry.register(t);
    }
    return tools.length;
  }

  // === Private ===

  async _startStdio(name: string, info: McpServerEntry, cfg: McpServerConfig) {
    if (!cfg.command) throw new Error("stdio server requires 'command'");

    const env = { ...process.env, ...cfg.env };
    const child = spawn(cfg.command, cfg.args, {
      cwd: cfg.cwd || process.cwd(),
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    info.process = child;

    // Initialize MCP protocol
    const initResult = await this._sendMCPRequest(child, {
      jsonrpc: "2.0", id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        clientInfo: { name: "hax-agent", version: "1.0.0" },
      },
    }) as JsonRpcResponse;

    if (!initResult || initResult.error) {
      child.kill();
      throw new Error(`MCP init failed: ${initResult?.error?.message || "no response"}`);
    }

    // Send initialized notification
    this._sendMCPNotify(child, { jsonrpc: "2.0", method: "notifications/initialized" });

    // Start reading stderr
    this._startStderrReader(name, child);

    // Handle process exit
    child.on("exit", (code) => {
      info.status = code === 0 ? "stopped" : "error";
      info.error = code ? `Exit code ${code}` : null;
      this.emit("stopped", { name, code });
    });
  }

  async _startHttp(name: string, info: McpServerEntry, cfg: McpServerConfig) {
    if (!cfg.url) throw new Error("HTTP server requires 'url'");
    // HTTP transport — verify reachability
    try {
      const r = await fetch(cfg.url, { method: "POST",
        headers: { "Content-Type": "application/json", ...cfg.headers },
        body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize",
          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "hax-agent", version: "1.0.0" } } }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      info._httpClient = { url: cfg.url, headers: cfg.headers };
    } catch (err) {
      throw new Error(`HTTP MCP server unreachable: ${(err as Error).message}`);
    }
  }

  _stopServer(name: string, info: McpServerEntry) {
    if (info.process) {
      try { info.process.kill("SIGTERM"); } catch (_) {}
      info.process = null;
    }
  }

  async _listTools(name: string, info: McpServerEntry): Promise<McpToolInfo[]> {
    if (info.process) {
      const result = await this._sendMCPRequest(info.process, {
        jsonrpc: "2.0", id: Date.now(),
        method: "tools/list",
      }) as JsonRpcResponse;
      return ((result?.tools || []) as Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>).map(t => ({
        name: `mcp.${name}.${t.name}`,
        description: t.description || `MCP tool: ${t.name}`,
        inputSchema: t.inputSchema || { type: "object", properties: {} },
        isReadOnly: () => false,
      }));
    }
    if (info._httpClient) {
      const r = await fetch(info._httpClient.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...info._httpClient.headers },
        body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/list" }),
      });
      const data = await r.json() as JsonRpcResponse;
      return ((data?.tools || []) as Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>).map(t => ({
        name: `mcp.${name}.${t.name}`,
        description: t.description || `MCP tool: ${t.name}`,
        inputSchema: t.inputSchema || { type: "object", properties: {} },
        isReadOnly: () => false,
      }));
    }
    return [];
  }

  _createMcpExecutor(serverName: string, toolName: string) {
    return async (args: Record<string, unknown>, ctx: unknown) => {
      const info = this._servers.get(serverName);
      if (!info) throw new Error(`MCP server ${serverName} not found`);
      try {
        const callParams = {
          jsonrpc: "2.0", id: Date.now(),
          method: "tools/call",
          params: { name: toolName.replace(`mcp.${serverName}.`, ""), arguments: args },
        };
        if (info.process) {
          const result = await this._sendMCPRequest(info.process, callParams) as JsonRpcResponse;
          if (result?.error) throw new Error(result.error.message);
          return { ok: true, data: result?.content || result };
        }
        if (info._httpClient) {
          const r = await fetch(info._httpClient.url, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...info._httpClient.headers },
            body: JSON.stringify(callParams),
          });
          const data = await r.json() as JsonRpcResponse;
          if (data?.error) throw new Error(data.error.message);
          return { ok: true, data: data?.content || data };
        }
        throw new Error("Server not running");
      } catch (err) {
        return { ok: false, error: { code: "MCP_ERROR", message: (err as Error).message } };
      }
    };
  }

  /** Send JSON-RPC request to stdio process and await response */
  _sendMCPRequest(child: ChildProcessWithoutNullStreams, request: Record<string, unknown>, timeoutMs = 10000): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error("MCP request timeout")); }, timeoutMs);

      let buffer = "";
      const onData = (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line) as JsonRpcResponse;
            if (msg.id === request.id || msg.id === (request.id + "result")) {
              cleanup();
              resolve(msg);
            }
          } catch (_) {}
        }
      };

      child.stdout.on("data", onData);

      const cleanup = () => {
        clearTimeout(timer);
        child.stdout.removeListener("data", onData);
      };

      child.stdin.write(JSON.stringify(request) + "\n");
    });
  }

  _sendMCPNotify(child: ChildProcessWithoutNullStreams, notification: Record<string, unknown>) {
    child.stdin.write(JSON.stringify(notification) + "\n");
  }

  _startStderrReader(name: string, child: ChildProcessWithoutNullStreams) {
    child.stderr.on("data", (data: Buffer) => {
      this.emit("log", { server: name, message: data.toString().trim() });
    });
  }
}

export { McpClientManager, McpServerConfig };
