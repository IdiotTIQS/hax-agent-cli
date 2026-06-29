/**
 * Plugin Schema — JSON Schema validation for plugin.json manifests.
 * Ported from OpenHarness plugins/schemas.py pattern.
 */

// === Plugin JSON Schema ===

const PLUGIN_SCHEMA = {
  type: "object",
  required: ["name", "version"],
  properties: {
    name: {
      type: "string",
      pattern: "^[a-z][a-z0-9._-]*$",
      description: "Unique plugin identifier (lowercase, dots/hyphens allowed)",
    },
    version: {
      type: "string",
      pattern: "^\\d+\\.\\d+\\.\\d+(-[a-zA-Z0-9.]+)?$",
      description: "Semantic version (e.g., 1.0.0)",
    },
    description: {
      type: "string",
      maxLength: 200,
      description: "Short description of what this plugin does",
    },
    author: {
      type: "string",
      description: "Plugin author name or email",
    },
    license: {
      type: "string",
      enum: ["MIT", "Apache-2.0", "GPL-3.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "UNLICENSED", "Proprietary"],
      description: "SPDX license identifier",
    },
    homepage: { type: "string", format: "uri" },
    repository: { type: "string" },
    keywords: {
      type: "array",
      items: { type: "string" },
      maxItems: 10,
    },
    category: {
      type: "string",
      enum: ["tools", "skills", "commands", "hooks", "providers", "ui", "integration", "other"],
      description: "Plugin category",
    },
    engines: {
      type: "object",
      properties: {
        "hax-agent": { type: "string", description: "HaxAgent version requirement (e.g., >=1.5.0)" },
        node: { type: "string", description: "Node.js version requirement" },
      },
    },
    dependencies: {
      type: "object",
      description: "NPM dependencies to install with this plugin",
      patternProperties: {
        "^[a-zA-Z@]": { type: "string" },
      },
    },
    main: {
      type: "string",
      description: "Entry point (relative to plugin root, e.g., index.js)",
    },
    haxAgent: {
      type: "object",
      description: "HaxAgent-specific configuration",
      properties: {
        skills: {
          type: "array",
          items: { type: "string" },
          description: "Skill directories to load",
        },
        commands: {
          type: "array",
          items: { type: "string" },
          description: "Command files to load",
        },
        hooks: {
          type: "array",
          items: {
            type: "object",
            required: ["event", "type"],
            properties: {
              event: { type: "string" },
              type: { type: "string", enum: ["command", "http", "prompt", "agent"] },
              command: { type: "string" },
              url: { type: "string" },
              matcher: { type: "string" },
              priority: { type: "number" },
            },
          },
        },
        tools: {
          type: "array",
          items: { type: "string" },
          description: "Tool files to load",
        },
        mcp: {
          type: "object",
          description: "MCP server configurations provided by this plugin",
          patternProperties: {
            "^[a-zA-Z]": {
              type: "object",
              properties: {
                type: { type: "string", enum: ["stdio", "http"] },
                command: { type: "string" },
                args: { type: "array", items: { type: "string" } },
                url: { type: "string" },
              },
            },
          },
        },
        trust: {
          type: "object",
          description: "Trust configuration",
          properties: {
            requiresUserApproval: { type: "boolean", default: true },
            allowedOperations: {
              type: "array",
              items: { type: "string", enum: ["read", "write", "network", "shell", "all"] },
            },
            sandboxRequired: { type: "boolean", default: false },
          },
        },
      },
    },
  },
};

// === Validation Result ===

interface ValidationError {
  path: string;
  message: string;
}

class ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];

  constructor() {
    this.valid = true;
    this.errors = [];
    this.warnings = [];
  }

  addError(path: string, message: string): void {
    this.valid = false;
    this.errors.push({ path, message });
  }

  addWarning(path: string, message: string): void {
    this.warnings.push({ path, message });
  }

  toString(): string {
    const lines: string[] = [];
    if (this.errors.length) {
      lines.push(`Errors (${this.errors.length}):`);
      for (const e of this.errors) lines.push(`  [${e.path}] ${e.message}`);
    }
    if (this.warnings.length) {
      lines.push(`Warnings (${this.warnings.length}):`);
      for (const w of this.warnings) lines.push(`  [${w.path}] ${w.message}`);
    }
    if (this.valid && this.warnings.length === 0) lines.push("Valid.");
    return lines.join("\n");
  }
}

// === Plugin manifest shape (for validation) ===

interface HaxAgentHook {
  event?: string;
  type?: string;
  command?: string;
  url?: string;
}

interface HaxAgentMcpServer {
  type?: string;
  command?: string;
  url?: string;
}

interface HaxAgentTrust {
  requiresUserApproval?: boolean;
  sandboxRequired?: boolean;
  allowedOperations?: string[];
}

interface HaxAgentConfig {
  hooks?: HaxAgentHook[];
  mcp?: Record<string, HaxAgentMcpServer>;
  trust?: HaxAgentTrust;
}

interface PluginManifestShape {
  name?: string;
  version?: string;
  description?: string;
  category?: string;
  license?: string;
  keywords?: unknown;
  main?: unknown;
  dependencies?: Record<string, string>;
  haxAgent?: HaxAgentConfig;
  repository?: string;
}

// === Validator ===

/**
 * Validate a plugin.json object against the schema.
 * @param manifest — parsed plugin.json
 * @returns ValidationResult
 */
function validatePluginManifest(manifest: unknown): ValidationResult {
  const result = new ValidationResult();

  if (!manifest || typeof manifest !== "object") {
    result.addError("$", "Manifest is not a valid object");
    return result;
  }

  const m = manifest as PluginManifestShape;

  // Required fields
  if (!m.name || typeof m.name !== "string") {
    result.addError("name", "Required: plugin name (string)");
  } else if (!/^[a-z][a-z0-9._-]*$/.test(m.name)) {
    result.addError("name", `Invalid name "${m.name}": must be lowercase alphanumeric with dots/hyphens`);
  }

  if (!m.version || typeof m.version !== "string") {
    result.addError("version", "Required: semantic version (e.g., 1.0.0)");
  } else if (!/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(m.version)) {
    result.addError("version", `Invalid version "${m.version}": must be semver`);
  }

  // Description
  if (m.description && typeof m.description !== "string") {
    result.addError("description", "Must be a string");
  } else if (m.description && m.description.length > 200) {
    result.addWarning("description", "Description exceeds 200 characters");
  }

  // Category
  if (m.category) {
    const validCategories = ["tools", "skills", "commands", "hooks", "providers", "ui", "integration", "other"];
    if (!validCategories.includes(m.category)) {
      result.addWarning("category", `Unknown category "${m.category}". Use one of: ${validCategories.join(", ")}`);
    }
  }

  // License
  if (m.license) {
    const validLicenses = ["MIT", "Apache-2.0", "GPL-3.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "UNLICENSED", "Proprietary"];
    if (!validLicenses.includes(m.license)) {
      result.addWarning("license", `Unrecognized license "${m.license}"`);
    }
  }

  // Keywords
  if (m.keywords) {
    if (!Array.isArray(m.keywords)) {
      result.addError("keywords", "Must be an array");
    } else if ((m.keywords as unknown[]).length > 10) {
      result.addWarning("keywords", "More than 10 keywords");
    }
  }

  // Main entry
  if (m.main && typeof m.main !== "string") {
    result.addError("main", "Must be a string path");
  }

  // haxAgent config
  if (m.haxAgent) {
    const hax = m.haxAgent;

    // Trust config
    if (hax.trust) {
      if (hax.trust.requiresUserApproval === false) {
        result.addWarning("haxAgent.trust.requiresUserApproval",
          "Plugin requests auto-approval. Review carefully before trusting.");
      }
      if (hax.trust.sandboxRequired) {
        result.addWarning("haxAgent.trust.sandboxRequired",
          "Plugin requests sandbox isolation. Sandbox not yet implemented.");
      }
      if (hax.trust.allowedOperations) {
        if (hax.trust.allowedOperations.includes("shell")) {
          result.addWarning("haxAgent.trust.allowedOperations",
            "Plugin requests shell access. Review carefully.");
        }
        if (hax.trust.allowedOperations.includes("network")) {
          result.addWarning("haxAgent.trust.allowedOperations",
            "Plugin requests network access.");
        }
      }
    }

    // Hooks validation
    if (hax.hooks) {
      if (!Array.isArray(hax.hooks)) {
        result.addError("haxAgent.hooks", "Must be an array");
      } else {
        for (let i = 0; i < hax.hooks.length; i++) {
          const hook = hax.hooks[i];
          if (!hook.event || !hook.type) {
            result.addError(`haxAgent.hooks[${i}]`, "Hook requires event and type");
          }
          if (hook.type === "command" && !hook.command) {
            result.addError(`haxAgent.hooks[${i}]`, "Command hook requires 'command' field");
          }
          if (hook.type === "http" && !hook.url) {
            result.addError(`haxAgent.hooks[${i}]`, "HTTP hook requires 'url' field");
          }
        }
      }
    }

    // MCP config
    if (hax.mcp) {
      for (const [name, cfg] of Object.entries(hax.mcp)) {
        if (cfg.type === "stdio" && !cfg.command) {
          result.addError(`haxAgent.mcp.${name}`, "stdio MCP server requires 'command'");
        }
        if (cfg.type === "http" && !cfg.url) {
          result.addError(`haxAgent.mcp.${name}`, "HTTP MCP server requires 'url'");
        }
      }
    }
  }

  return result;
}

// === Quick Security Check ===

interface SecurityAuditResult {
  risk: "low" | "medium" | "high";
  reasons: string[];
}

/**
 * Quick security audit of a plugin manifest.
 * Returns a risk level: "low" | "medium" | "high"
 */
function securityAudit(manifest: unknown): SecurityAuditResult {
  if (!manifest) return { risk: "high", reasons: ["No manifest"] };

  const reasons: string[] = [];
  let risk: "low" | "medium" | "high" = "low";

  const m = manifest as PluginManifestShape;
  const hax = m.haxAgent;
  if (hax) {
    if (hax.trust?.requiresUserApproval === false && !hax.trust?.allowedOperations) {
      reasons.push("Auto-approval with no operation restrictions");
      risk = "high";
    }
    if (hax.trust?.allowedOperations?.includes("shell")) {
      reasons.push("Requests shell access");
      if (risk === "low") risk = "medium";
    }
    if (hax.trust?.allowedOperations?.includes("network")) {
      reasons.push("Requests network access");
    }
    if (hax.hooks?.some((h) => h.type === "command")) {
      reasons.push("Registers command hooks");
    }
  }

  return { risk, reasons };
}

export {
  PLUGIN_SCHEMA,
  ValidationResult,
  validatePluginManifest,
  securityAudit,
};
