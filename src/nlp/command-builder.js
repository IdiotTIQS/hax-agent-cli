"use strict";

/**
 * CommandBuilder — converts detected intent + entities into actionable
 * commands, tool calls, and agent task descriptions.
 *
 * Takes the output of IntentDetector.detect() and EntityExtractor.extract()
 * and synthesizes concrete actions: slash commands, tool execution plans,
 * and agent task prompts.
 */

// ── Intent → slash command mapping ──────────────────────────────────────
const INTENT_COMMAND_MAP = Object.freeze({
  CODE_REVIEW: { primary: "/review", aliases: ["/security-review", "/code-review"] },
  EXPLAIN_CODE: { primary: "/explain", aliases: ["/ask"] },
  WRITE_TESTS: { primary: "/test", aliases: ["/add-tests"] },
  REFACTOR: { primary: "/refactor", aliases: ["/clean"] },
  DEBUG: { primary: "/debug", aliases: ["/fix"] },
  OPTIMIZE: { primary: "/optimize", aliases: ["/perf"] },
  DOCUMENT: { primary: "/doc", aliases: ["/document"] },
  DEPLOY: { primary: "/deploy", aliases: ["/release", "/ship"] },
  ANALYZE: { primary: "/analyze", aliases: ["/profile", "/inspect"] },
  SEARCH_CODEBASE: { primary: "/search", aliases: ["/find", "/grep"] },
});

// ── Intent → agent type mapping ─────────────────────────────────────────
const INTENT_AGENT_MAP = Object.freeze({
  CODE_REVIEW: "security-reviewer",
  EXPLAIN_CODE: "explain",
  WRITE_TESTS: "test-runner",
  REFACTOR: "implementer",
  DEBUG: "implementer",
  OPTIMIZE: "implementer",
  DOCUMENT: "docs-writer",
  DEPLOY: "planner",
  ANALYZE: "explore",
  SEARCH_CODEBASE: "explore",
});

// ── Intent → tool mapping (primary tool to use) ─────────────────────────
const INTENT_TOOL_MAP = Object.freeze({
  CODE_REVIEW: "file.read",
  EXPLAIN_CODE: "file.read",
  WRITE_TESTS: "file.write",
  REFACTOR: "file.read",
  DEBUG: "file.read",
  OPTIMIZE: "file.read",
  DOCUMENT: "file.write",
  DEPLOY: "bash",
  ANALYZE: "bash",
  SEARCH_CODEBASE: "grep",
});

// ── Explanations by intent ──────────────────────────────────────────────
const EXPLANATIONS = Object.freeze({
  CODE_REVIEW: "Reviewing the code for quality, security, and correctness issues.",
  EXPLAIN_CODE: "Reading and explaining how the code works in detail.",
  WRITE_TESTS: "Writing test cases to cover the specified functionality.",
  REFACTOR: "Restructuring the code for better clarity and maintainability.",
  DEBUG: "Investigating and fixing the reported issue or bug.",
  OPTIMIZE: "Analyzing and improving code performance characteristics.",
  DOCUMENT: "Generating or updating documentation for the code.",
  DEPLOY: "Preparing and executing the deployment process.",
  ANALYZE: "Running analysis and collecting metrics about the code.",
  SEARCH_CODEBASE: "Searching the codebase for the specified patterns or references.",
});

// ── Constructor ─────────────────────────────────────────────────────────

class CommandBuilder {
  /**
   * @param {object} [options]
   * @param {object} [options.customMappings] — override/add intent-to-command mappings
   */
  constructor(options = {}) {
    this._commandMap = Object.assign({}, INTENT_COMMAND_MAP, options.customMappings || {});
  }

  /**
   * Build a complete action plan from intent and entities.
   *
   * @param {object} detection — output from IntentDetector.detect()
   * @param {string} detection.intent
   * @param {number} detection.confidence
   * @param {object} detection.entities
   * @param {string|null} detection.subIntent
   * @param {object} [extractedEntities] — output from EntityExtractor.extract()
   * @returns {{
   *   intent: string,
   *   confidence: number,
   *   command: string,
   *   toolCall: { tool: string, args: object },
   *   agentTask: { agentType: string, task: string },
   *   explanation: string,
   *   suggestedCommands: string[],
   * }}
   */
  build(detection, extractedEntities) {
    const intent = detection.intent || "SEARCH_CODEBASE";
    const confidence = detection.confidence || 0;
    const rawEntities = detection.entities || {};

    // Merge inline entities with extracted entities
    const entities = this._mergeEntities(rawEntities, extractedEntities || {});

    const command = this._buildCommand(intent, entities);
    const toolCall = this.buildToolCall(intent, entities);
    const agentTask = this.buildAgentTask(intent, entities);
    const explanation = this.explain(intent, entities);
    const suggestedCommands = this.suggestCommands(intent, entities);

    return {
      intent,
      confidence,
      command,
      toolCall,
      agentTask,
      explanation,
      suggestedCommands,
    };
  }

  /**
   * Suggest matching slash commands for the detected intent.
   *
   * @param {string} intent
   * @param {object} entities
   * @returns {string[]}
   */
  suggestCommands(intent, entities) {
    const mapping = this._commandMap[intent];
    if (!mapping) return [];

    const commands = [mapping.primary];
    if (mapping.aliases) commands.push(...mapping.aliases);

    // Append context-relevant flags based on entities
    const enhanced = commands.map((cmd) => {
      const parts = [cmd];

      // Attach file paths as arguments
      if (entities.files && entities.files.length > 0) {
        parts.push(entities.files[0]);
        if (entities.lineNumbers && entities.lineNumbers.length > 0) {
          parts[parts.length - 1] += `:${entities.lineNumbers[0]}`;
        }
      }

      return parts.join(" ");
    });

    return enhanced;
  }

  /**
   * Build a tool execution plan (what tool to call with what args).
   *
   * @param {string} intent
   * @param {object} entities
   * @returns {{ tool: string, args: object }}
   */
  buildToolCall(intent, entities) {
    const tool = INTENT_TOOL_MAP[intent] || "file.read";
    const args = {};

    // Build tool-specific arguments from entities
    switch (tool) {
      case "file.read": {
        if (entities.filePaths && entities.filePaths.length > 0) {
          args.file_path = entities.filePaths[0];
        }
        if (entities.lineNumbers && entities.lineNumbers.length > 0) {
          args.offset = entities.lineNumbers[0] - 1;
          args.limit = entities.lineNumbers.length > 1
            ? entities.lineNumbers[entities.lineNumbers.length - 1] - entities.lineNumbers[0] + 1
            : 50;
        }
        break;
      }
      case "file.write": {
        if (entities.filePaths && entities.filePaths.length > 0) {
          args.file_path = entities.filePaths[0];
        }
        break;
      }
      case "grep": {
        if (entities.functionNames && entities.functionNames.length > 0) {
          args.pattern = entities.functionNames[0];
        }
        if (entities.filePaths && entities.filePaths.length > 0) {
          args.path = entities.filePaths[0];
        }
        break;
      }
      case "bash": {
        if (intent === "DEPLOY") {
          args.command = entities.technologies && entities.technologies.includes("docker")
            ? "docker build -t app . && docker push app"
            : "npm run build && npm publish";
        } else if (intent === "ANALYZE") {
          args.command = "npm run lint && npm run test -- --coverage";
        }
        break;
      }
      default:
        break;
    }

    return { tool, args };
  }

  /**
   * Build an agent task description for team planning.
   *
   * @param {string} intent
   * @param {object} entities
   * @returns {{ agentType: string, task: string }}
   */
  buildAgentTask(intent, entities) {
    const agentType = INTENT_AGENT_MAP[intent] || "general-purpose";
    const task = this._buildTaskPrompt(intent, entities);
    return { agentType, task };
  }

  /**
   * Generate a human-readable explanation of what will be done.
   *
   * @param {string} intent
   * @param {object} entities
   * @returns {string}
   */
  explain(intent, entities) {
    let explanation = EXPLANATIONS[intent] || "Processing your request.";

    // Add entity-specific details
    if (entities.filePaths && entities.filePaths.length > 0) {
      const files = entities.filePaths.slice(0, 3).join(", ");
      const suffix = entities.filePaths.length > 3 ? ` and ${entities.filePaths.length - 3} more` : "";
      explanation += ` Target files: ${files}${suffix}.`;
    }

    if (entities.functionNames && entities.functionNames.length > 0) {
      const fns = entities.functionNames.slice(0, 3).join(", ");
      explanation += ` Focusing on: ${fns}.`;
    }

    if (entities.technologies && entities.technologies.length > 0) {
      const techs = entities.technologies.slice(0, 5).join(", ");
      explanation += ` Technologies involved: ${techs}.`;
    }

    if (entities.commitHashes && entities.commitHashes.length > 0) {
      explanation += ` Related commits: ${entities.commitHashes.slice(0, 3).join(", ")}.`;
    }

    return explanation;
  }

  // ── Private helpers ──────────────────────────────────────────────────

  /**
   * Build a slash command string with arguments.
   */
  _buildCommand(intent, entities) {
    const mapping = this._commandMap[intent];
    if (!mapping) return "/help";

    let cmd = mapping.primary;

    const parts = [];
    if (entities.files && entities.files.length > 0) {
      parts.push(entities.files[0]);
    } else if (entities.filePaths && entities.filePaths.length > 0) {
      parts.push(entities.filePaths[0]);
    }

    if (parts.length > 0) {
      cmd += " " + parts[0];
    }

    return cmd;
  }

  /**
   * Build a detailed task prompt for an agent.
   */
  _buildTaskPrompt(intent, entities) {
    const fileTargets = this._fileTargetsText(entities);
    const techContext = this._techContextText(entities);

    switch (intent) {
      case "CODE_REVIEW":
        return `Review the following code for security vulnerabilities, correctness bugs, ` +
          `and style issues.${fileTargets}${techContext} ` +
          `Check for: injection risks, unsafe defaults, secret exposure, ` +
          `missing error handling, and edge-case handling. Report findings with severity levels.`;

      case "EXPLAIN_CODE":
        return `Read and explain the code in detail: what it does, how it works, ` +
          `and its key design decisions.${fileTargets}${techContext} ` +
          `Walk through the control flow, data flow, and any notable patterns or anti-patterns.`;

      case "WRITE_TESTS":
        return `Write comprehensive tests for the specified functionality.${fileTargets}${techContext} ` +
          `Include unit tests for core logic, edge case tests for boundary conditions, ` +
          `and integration tests where interfaces cross module boundaries. Use the existing test framework.`;

      case "REFACTOR":
        return `Refactor the code to improve clarity, reduce duplication, and enhance ` +
          `maintainability.${fileTargets}${techContext} ` +
          `Extract reusable helpers, simplify complex conditionals, rename for clarity, ` +
          `and ensure the refactored code maintains existing behavior.`;

      case "DEBUG":
        return `Investigate and fix the reported issue.${fileTargets}${techContext} ` +
          `Reproduce the problem, identify the root cause, apply a minimal fix, ` +
          `and verify the fix resolves the issue without introducing regressions.`;

      case "OPTIMIZE":
        return `Analyze and improve the performance of the code.${fileTargets}${techContext} ` +
          `Identify bottlenecks, profile hot paths, and apply targeted optimizations. ` +
          `Consider: caching, lazy evaluation, algorithmic improvements, and reducing allocations.`;

      case "DOCUMENT":
        return `Generate or update documentation for the code.${fileTargets}${techContext} ` +
          `Include: API references, usage examples, type signatures, edge case notes, ` +
          `and installation/setup instructions where relevant. Match the project's doc style.`;

      case "DEPLOY":
        return `Prepare and execute the deployment.${techContext} ` +
          `Run the build pipeline, verify artifacts, deploy to the target environment, ` +
          `and run smoke tests to confirm the deployment succeeded.`;

      case "ANALYZE":
        return `Run analysis on the codebase.${fileTargets}${techContext} ` +
          `Collect metrics on: code complexity, test coverage, dependency freshness, ` +
          `and performance characteristics. Produce a summary report with actionable insights.`;

      case "SEARCH_CODEBASE":
        return `Search the codebase for relevant patterns and references.${fileTargets}${techContext} ` +
          `Look for: function definitions, import references, usage patterns, ` +
          `and related code. Report findings organized by file with context snippets.`;

      default:
        return `Process the user request: analyze the intent and execute the appropriate ` +
          `actions.${fileTargets}${techContext}`;
    }
  }

  /**
   * Format file targets for prompt text.
   */
  _fileTargetsText(entities) {
    const files = entities.filePaths || entities.files || [];
    if (files.length === 0) return " No specific files targeted.";
    const list = files.slice(0, 5).join(", ");
    const suffix = files.length > 5 ? ` (and ${files.length - 5} more)` : "";
    return ` Target files: ${list}${suffix}.`;
  }

  /**
   * Format technology context for prompt text.
   */
  _techContextText(entities) {
    const techs = entities.technologies || [];
    if (techs.length === 0) return "";
    return ` Technology stack: ${techs.slice(0, 5).join(", ")}.`;
  }

  /**
   * Merge inline entities (from IntentDetector) with extracted entities
   * (from EntityExtractor). Extracted entities take precedence for typed
   * fields; inline entities fill gaps.
   */
  _mergeEntities(rawEntities, extractedEntities) {
    const merged = {
      files: [],
      filePaths: [],
      functionNames: [],
      lineNumbers: [],
      technologies: [],
      errorMessages: [],
      urls: [],
      commitHashes: [],
      branchNames: [],
      versionNumbers: [],
    };

    // Inline entities
    if (rawEntities.files) merged.files = [...rawEntities.files];
    if (rawEntities.lineNumbers) merged.lineNumbers = [...rawEntities.lineNumbers];
    if (rawEntities.technologies) merged.technologies = [...rawEntities.technologies];
    if (rawEntities.urls) merged.urls = [...rawEntities.urls];
    if (rawEntities.commitHashes) merged.commitHashes = [...rawEntities.commitHashes];
    if (rawEntities.codeReferences) {
      // Inline code references go to functionNames
      merged.functionNames = [...rawEntities.codeReferences];
    }

    // Extracted entities (override inline where applicable)
    if (extractedEntities.filePaths && extractedEntities.filePaths.length > 0) {
      merged.filePaths = [...extractedEntities.filePaths];
    }
    if (extractedEntities.functionNames && extractedEntities.functionNames.length > 0) {
      merged.functionNames = [...new Set([...merged.functionNames, ...extractedEntities.functionNames])];
    }
    if (extractedEntities.lineNumbers && extractedEntities.lineNumbers.length > 0) {
      merged.lineNumbers = [...new Set([...merged.lineNumbers, ...extractedEntities.lineNumbers])];
    }
    if (extractedEntities.technologies && extractedEntities.technologies.length > 0) {
      merged.technologies = [...new Set([...merged.technologies, ...extractedEntities.technologies])];
    }
    if (extractedEntities.errorMessages && extractedEntities.errorMessages.length > 0) {
      merged.errorMessages = [...extractedEntities.errorMessages];
    }
    if (extractedEntities.urls && extractedEntities.urls.length > 0) {
      merged.urls = [...new Set([...merged.urls, ...extractedEntities.urls])];
    }
    if (extractedEntities.commitHashes && extractedEntities.commitHashes.length > 0) {
      merged.commitHashes = [...new Set([...merged.commitHashes, ...extractedEntities.commitHashes])];
    }
    if (extractedEntities.branchNames && extractedEntities.branchNames.length > 0) {
      merged.branchNames = [...extractedEntities.branchNames];
    }
    if (extractedEntities.versionNumbers && extractedEntities.versionNumbers.length > 0) {
      merged.versionNumbers = [...extractedEntities.versionNumbers];
    }

    return merged;
  }
}

// ── Quick convenience exports ────────────────────────────────────────────

function buildCommand(detection, entities) {
  return new CommandBuilder().build(detection, entities);
}

module.exports = {
  CommandBuilder,
  buildCommand,
  INTENT_COMMAND_MAP,
  INTENT_AGENT_MAP,
  INTENT_TOOL_MAP,
  EXPLANATIONS,
};
