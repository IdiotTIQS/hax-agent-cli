"use strict";

const { parseWorkflow, workflowToDsl } = require("./dsl");

const CATEGORIES = new Set([
  "CI/CD",
  "CodeReview",
  "Deployment",
  "Testing",
  "DataProcessing",
  "Security",
  "Documentation",
  "Custom",
]);

class WorkflowLibrary {
  constructor() {
    this._templates = new Map();
    this._counter = 0;
    this._registerBuiltins();
  }

  // ---- Registration ----

  /**
   * Register a workflow template with metadata.
   * @param {object} workflow
   *   { name, description?, category?, tags?, steps, params?, version? }
   * @returns {this}
   */
  register(workflow) {
    if (!workflow || typeof workflow !== "object") {
      throw new Error("Workflow template must be an object.");
    }
    if (typeof workflow.name !== "string" || workflow.name.trim().length === 0) {
      throw new Error("Workflow template must have a non-empty string name.");
    }
    if (!Array.isArray(workflow.steps)) {
      throw new Error("Workflow template must have a steps array.");
    }

    const name = workflow.name.trim();
    const category = workflow.category && CATEGORIES.has(workflow.category)
      ? workflow.category
      : "Custom";

    const template = {
      id: `tmpl-${Date.now().toString(36)}-${++this._counter}`,
      name,
      description: typeof workflow.description === "string" ? workflow.description : "",
      category,
      tags: Array.isArray(workflow.tags) ? workflow.tags.map(String) : [],
      steps: cloneSteps(workflow.steps),
      params: Array.isArray(workflow.params)
        ? workflow.params.map((p) => normalizeParam(p))
        : [],
      version: typeof workflow.version === "string" ? workflow.version : "1.0.0",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      usageCount: 0,
    };

    this._templates.set(name, template);
    return this;
  }

  /**
   * Remove a registered template by name.
   * @param {string} name
   * @returns {boolean}
   */
  unregister(name) {
    return this._templates.delete(name);
  }

  /**
   * Get a template by name.
   * @param {string} name
   * @returns {object|undefined}
   */
  get(name) {
    const tmpl = this._templates.get(name);
    if (tmpl) {
      return deepClone(tmpl);
    }
    return undefined;
  }

  /**
   * List templates, optionally filtered by category.
   * @param {string} [category]
   * @returns {Array<object>}
   */
  list(category) {
    let entries = [...this._templates.values()];

    if (category && CATEGORIES.has(category)) {
      entries = entries.filter((t) => t.category === category);
    }

    return entries.map((t) => summarize(t));
  }

  /**
   * List all distinct categories in use.
   * @returns {string[]}
   */
  categories() {
    const cats = new Set();
    for (const [, tmpl] of this._templates) {
      cats.add(tmpl.category);
    }
    return [...cats].sort();
  }

  /**
   * Return template count statistics per category.
   * @returns {object}
   */
  stats() {
    const byCategory = {};
    let total = 0;

    for (const [, tmpl] of this._templates) {
      byCategory[tmpl.category] = (byCategory[tmpl.category] || 0) + 1;
      total += 1;
    }

    return {
      total,
      byCategory,
      totalUsage: [...this._templates.values()].reduce((s, t) => s + t.usageCount, 0),
    };
  }

  // ---- Search ----

  /**
   * Search templates by name, description, tags, or category.
   * @param {string} query - Search query string.
   * @returns {Array<object>} Matching template summaries sorted by relevance.
   */
  search(query) {
    if (typeof query !== "string" || query.trim().length === 0) {
      return [];
    }

    const terms = query.trim().toLowerCase().split(/\s+/);
    const scored = [];

    for (const [, tmpl] of this._templates) {
      let score = 0;
      const nameLow = tmpl.name.toLowerCase();
      const descLow = tmpl.description.toLowerCase();
      const catLow = tmpl.category.toLowerCase();
      const tagsLow = tmpl.tags.map((t) => t.toLowerCase());

      for (const term of terms) {
        if (nameLow === term) score += 20;
        else if (nameLow.includes(term)) score += 10;
        if (catLow === term) score += 8;
        else if (catLow.includes(term)) score += 5;
        if (descLow.includes(term)) score += 3;
        if (tagsLow.some((t) => t === term)) score += 7;
        else if (tagsLow.some((t) => t.includes(term))) score += 4;
      }

      if (score > 0) {
        scored.push({ template: tmpl, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => summarize(s.template));
  }

  // ---- Instantiation ----

  /**
   * Create a runnable workflow instance from a template, applying parameter overrides.
   * @param {string} name - Template name.
   * @param {object} [params={}] - Parameter overrides keyed by param name.
   * @returns {object} { name, steps, description? } compatible with WorkflowEngine.define().
   */
  instantiate(name, params = {}) {
    const tmpl = this._templates.get(name);
    if (!tmpl) {
      throw new Error(`Unknown template: ${name}.`);
    }

    // Validate required params
    if (tmpl.params.length > 0) {
      const missing = [];
      for (const p of tmpl.params) {
        if (p.required && (params[p.name] === undefined || params[p.name] === null)) {
          missing.push(p.name);
        }
      }
      if (missing.length > 0) {
        throw new Error(
          `Template "${name}" requires parameters: ${missing.join(", ")}.`,
        );
      }
    }

    // Apply parameter substitution and defaults
    const steps = tmpl.steps.map((step) => {
      const substituted = deepClone(step);
      substituted.config = substituteParams(step.config || {}, params, tmpl.params);
      if (step.tool) substituted.tool = substituteString(step.tool, params);
      return substituted;
    });

    // Increment usage counter
    tmpl.usageCount += 1;
    tmpl.updatedAt = new Date().toISOString();

    const instance = {
      name: tmpl.name,
      steps,
      description: tmpl.description,
      templateId: tmpl.id,
      templateVersion: tmpl.version,
      instantiatedAt: new Date().toISOString(),
    };

    return instance;
  }

  // ---- Export / Import ----

  /**
   * Export a template in the specified format.
   * @param {string} name - Template name.
   * @param {string} format - "dsl", "json", or "yaml".
   * @returns {string}
   */
  exportTemplate(name, format = "json") {
    const tmpl = this._templates.get(name);
    if (!tmpl) {
      throw new Error(`Unknown template: ${name}.`);
    }

    const stripped = {
      name: tmpl.name,
      description: tmpl.description,
      category: tmpl.category,
      tags: tmpl.tags,
      version: tmpl.version,
      params: tmpl.params.map((p) => ({ name: p.name, type: p.type, default: p.default, required: p.required })),
      steps: tmpl.steps.map(stripStep),
    };

    switch (format.toLowerCase()) {
      case "dsl":
      case "yaml":
        return templateToYaml(stripped);
      case "json":
        return JSON.stringify(stripped, null, 2);
      default:
        throw new Error(`Unsupported format: "${format}". Use "dsl", "json", or "yaml".`);
    }
  }

  /**
   * Import a workflow definition (DSL string or JSON object).
   * @param {object|string} definition
   * @returns {this}
   */
  importDefinition(definition) {
    let parsed;

    if (typeof definition === "string") {
      parsed = parseWorkflow(definition);
    } else if (definition && typeof definition === "object") {
      parsed = definition;
    } else {
      throw new Error("Import definition must be a DSL string or JSON object.");
    }

    if (!parsed.name || typeof parsed.name !== "string") {
      throw new Error("Imported workflow must have a name.");
    }
    if (!Array.isArray(parsed.steps)) {
      throw new Error("Imported workflow must have steps.");
    }

    this.register({
      name: parsed.name,
      description: parsed.description || "",
      category: parsed.category || "Custom",
      tags: parsed.tags || [],
      steps: parsed.steps,
      params: parsed.params || [],
      version: parsed.version || "1.0.0",
    });

    return this;
  }

  // ---- Built-in templates ----

  _registerBuiltins() {
    // CI/CD
    this.register(CI_BUILD_PIPELINE());
    this.register(CI_CD_FULL_PIPELINE());

    // CodeReview
    this.register(CODE_REVIEW_PIPELINE());
    this.register(PR_REVIEW_PIPELINE());

    // Deployment
    this.register(DEPLOY_CANARY_PIPELINE());
    this.register(BLUE_GREEN_DEPLOY());

    // Testing
    this.register(TEST_SUITE_PIPELINE());
    this.register(REGRESSION_TEST_PIPELINE());

    // DataProcessing
    this.register(ETL_PIPELINE());

    // Security
    this.register(SECURITY_SCAN_PIPELINE());

    // Documentation
    this.register(DOCS_GENERATE_PIPELINE());

    // Custom
    this.register(HEALTH_CHECK_PIPELINE());
    this.register(DEPENDENCY_UPDATE_CHECK());
  }
}

// ---- Built-in Template Definitions ----

function CI_BUILD_PIPELINE() {
  return {
    name: "ci-build-pipeline",
    description: "Continuous Integration build pipeline: lint, test, build, and optionally package artifacts.",
    category: "CI/CD",
    tags: ["ci", "build", "lint", "test"],
    version: "1.0.0",
    params: [
      { name: "buildCommand", type: "string", default: "npm run build", required: false, description: "Build command to run" },
      { name: "testCommand", type: "string", default: "npm test", required: false, description: "Test command to run" },
      { name: "lintCommand", type: "string", default: "npm run lint", required: false, description: "Lint command to run" },
    ],
    steps: [
      { id: "lint", name: "Lint code", type: "tool", config: { tool: "shell.run", command: "{{lintCommand}}" }, retryCount: 0, timeout: 120000, dependsOn: [] },
      { id: "test", name: "Run tests", type: "tool", config: { tool: "shell.run", command: "{{testCommand}}" }, retryCount: 1, retryDelay: 2000, timeout: 300000, dependsOn: ["lint"] },
      { id: "build", name: "Build project", type: "tool", config: { tool: "shell.run", command: "{{buildCommand}}" }, retryCount: 1, retryDelay: 3000, timeout: 300000, dependsOn: ["test"] },
    ],
  };
}

function CI_CD_FULL_PIPELINE() {
  return {
    name: "ci-cd-full",
    description: "Full CI/CD pipeline covering lint, test, build, deploy, and post-deploy smoke tests.",
    category: "CI/CD",
    tags: ["ci", "cd", "deploy", "full-pipeline"],
    version: "1.0.0",
    params: [
      { name: "buildCommand", type: "string", default: "npm run build", required: false },
      { name: "deployCommand", type: "string", default: "npm run deploy", required: false },
    ],
    steps: [
      { id: "lint", name: "Lint code", type: "tool", config: { tool: "shell.run", command: "npm run lint" }, retryCount: 0, timeout: 120000, dependsOn: [] },
      { id: "test", name: "Run tests", type: "tool", config: { tool: "shell.run", command: "npm test" }, retryCount: 2, retryDelay: 3000, timeout: 300000, dependsOn: ["lint"] },
      { id: "build", name: "Build artifacts", type: "tool", config: { tool: "shell.run", command: "{{buildCommand}}" }, retryCount: 1, retryDelay: 5000, timeout: 600000, dependsOn: ["test"] },
      { id: "deploy", name: "Deploy to target", type: "tool", config: { tool: "shell.run", command: "{{deployCommand}}" }, retryCount: 2, retryDelay: 10000, timeout: 600000, dependsOn: ["build"] },
      { id: "smoke", name: "Run smoke tests", type: "agent", config: { handler: null, prompt: "Run smoke tests against the deployed application to verify health." }, retryCount: 1, retryDelay: 5000, timeout: 180000, dependsOn: ["deploy"] },
    ],
  };
}

function CODE_REVIEW_PIPELINE() {
  return {
    name: "code-review-pipeline",
    description: "Automated code review: explore codebase, analyze for issues, and suggest improvements.",
    category: "CodeReview",
    tags: ["review", "code-quality", "automated"],
    version: "1.0.0",
    params: [
      { name: "reviewFocus", type: "string", default: "correctness, style, security", required: false, description: "Areas to focus the review on" },
    ],
    steps: [
      { id: "explore", name: "Explore codebase", type: "agent", config: { handler: null, prompt: "Explore the codebase structure and identify files relevant to the review." }, retryCount: 0, timeout: 120000, dependsOn: [] },
      { id: "review", name: "Review code", type: "agent", config: { handler: null, prompt: "Review the code focusing on: {{reviewFocus}}. Check for correctness, potential bugs, and style issues." }, retryCount: 0, timeout: 300000, dependsOn: ["explore"] },
      { id: "suggest", name: "Suggest improvements", type: "agent", config: { handler: null, prompt: "Based on the review findings, suggest concrete improvements with priority levels and estimated effort." }, retryCount: 0, timeout: 120000, dependsOn: ["review"] },
    ],
  };
}

function PR_REVIEW_PIPELINE() {
  return {
    name: "pr-review-pipeline",
    description: "Pull Request review: checkout branch, lint, test, review, and approve if passing.",
    category: "CodeReview",
    tags: ["pr", "pull-request", "review", "automation"],
    version: "1.0.0",
    params: [
      { name: "prNumber", type: "string", default: "", required: true, description: "Pull request number to review" },
      { name: "baseBranch", type: "string", default: "main", required: false },
    ],
    steps: [
      { id: "checkout", name: "Checkout PR branch", type: "tool", config: { tool: "shell.run", command: "gh pr checkout {{prNumber}}" }, retryCount: 1, retryDelay: 3000, timeout: 60000, dependsOn: [] },
      { id: "lint", name: "Lint changed files", type: "tool", config: { tool: "shell.run", command: "npm run lint" }, retryCount: 0, timeout: 120000, dependsOn: ["checkout"] },
      { id: "review", name: "Review changes", type: "agent", config: { handler: null, prompt: "Review PR #{{prNumber}} against {{baseBranch}}. Analyze the diff for correctness and suggest changes." }, retryCount: 0, timeout: 300000, dependsOn: ["lint"] },
      { id: "approve", name: "Approve if passing", type: "condition", config: { evaluate: null }, retryCount: 0, timeout: 30000, dependsOn: ["review"] },
    ],
  };
}

function DEPLOY_CANARY_PIPELINE() {
  return {
    name: "deploy-canary",
    description: "Canary deployment: build, deploy to canary, verify health, then roll out incrementally.",
    category: "Deployment",
    tags: ["canary", "deploy", "incremental", "safe"],
    version: "1.0.0",
    params: [
      { name: "canaryPercent", type: "number", default: 10, required: false, description: "Percentage of traffic for canary" },
      { name: "environment", type: "string", default: "staging", required: false },
    ],
    steps: [
      { id: "build", name: "Build release artifacts", type: "tool", config: { tool: "shell.run", command: "npm run build" }, retryCount: 1, retryDelay: 5000, timeout: 600000, dependsOn: [] },
      { id: "deploy-canary", name: "Deploy to canary", type: "tool", config: { tool: "shell.run", command: "npm run deploy:canary -- --percent={{canaryPercent}} --env={{environment}}" }, retryCount: 2, retryDelay: 10000, timeout: 300000, dependsOn: ["build"] },
      { id: "verify-canary", name: "Verify canary health", type: "agent", config: { handler: null, prompt: "Verify the canary deployment health: check error rates, latency, and resource usage on {{environment}}." }, retryCount: 1, retryDelay: 10000, timeout: 180000, dependsOn: ["deploy-canary"] },
      { id: "rollout", name: "Full rollout", type: "tool", config: { tool: "shell.run", command: "npm run deploy:rollout -- --env={{environment}}" }, retryCount: 1, retryDelay: 5000, timeout: 300000, dependsOn: ["verify-canary"] },
      { id: "cleanup", name: "Clean up old instances", type: "tool", config: { tool: "shell.run", command: "npm run deploy:cleanup -- --env={{environment}}" }, retryCount: 0, timeout: 120000, dependsOn: ["rollout"] },
    ],
  };
}

function BLUE_GREEN_DEPLOY() {
  return {
    name: "blue-green-deploy",
    description: "Blue-green deployment: deploy to inactive environment, verify, then switch traffic.",
    category: "Deployment",
    tags: ["blue-green", "zero-downtime", "deploy", "safe"],
    version: "1.0.0",
    params: [
      { name: "targetEnv", type: "string", default: "green", required: false, description: "Target environment color" },
    ],
    steps: [
      { id: "build", name: "Build artifacts", type: "tool", config: { tool: "shell.run", command: "npm run build" }, retryCount: 1, retryDelay: 3000, timeout: 600000, dependsOn: [] },
      { id: "deploy-inactive", name: "Deploy to inactive", type: "tool", config: { tool: "shell.run", command: "npm run deploy -- --env={{targetEnv}}" }, retryCount: 2, retryDelay: 10000, timeout: 300000, dependsOn: ["build"] },
      { id: "verify", name: "Verify inactive env", type: "agent", config: { handler: null, prompt: "Verify the {{targetEnv}} environment is healthy: check all endpoints, monitor error rates, and confirm database connectivity." }, retryCount: 1, retryDelay: 5000, timeout: 180000, dependsOn: ["deploy-inactive"] },
      { id: "switch", name: "Switch traffic", type: "tool", config: { tool: "shell.run", command: "npm run deploy:switch -- --to={{targetEnv}}" }, retryCount: 1, retryDelay: 3000, timeout: 120000, dependsOn: ["verify"] },
      { id: "monitor", name: "Post-switch monitoring", type: "agent", config: { handler: null, prompt: "Monitor the application for 5 minutes after traffic switch: track error rates, latency, and user-reported issues." }, retryCount: 0, timeout: 300000, dependsOn: ["switch"] },
    ],
  };
}

function TEST_SUITE_PIPELINE() {
  return {
    name: "test-suite-pipeline",
    description: "Multi-level test suite: unit tests, integration tests, end-to-end tests.",
    category: "Testing",
    tags: ["test", "unit", "integration", "e2e"],
    version: "1.0.0",
    params: [
      { name: "unitCommand", type: "string", default: "npm run test:unit", required: false },
      { name: "integrationCommand", type: "string", default: "npm run test:integration", required: false },
      { name: "e2eCommand", type: "string", default: "npm run test:e2e", required: false },
    ],
    steps: [
      { id: "unit", name: "Run unit tests", type: "tool", config: { tool: "shell.run", command: "{{unitCommand}}" }, retryCount: 1, retryDelay: 2000, timeout: 180000, dependsOn: [] },
      { id: "integration", name: "Run integration tests", type: "tool", config: { tool: "shell.run", command: "{{integrationCommand}}" }, retryCount: 1, retryDelay: 5000, timeout: 300000, dependsOn: ["unit"] },
      { id: "e2e", name: "Run end-to-end tests", type: "tool", config: { tool: "shell.run", command: "{{e2eCommand}}" }, retryCount: 2, retryDelay: 10000, timeout: 600000, dependsOn: ["integration"] },
    ],
  };
}

function REGRESSION_TEST_PIPELINE() {
  return {
    name: "regression-test-pipeline",
    description: "Regression testing: compare test results against a baseline to detect regressions.",
    category: "Testing",
    tags: ["regression", "baseline", "comparison", "quality"],
    version: "1.0.0",
    params: [
      { name: "baselineBranch", type: "string", default: "main", required: false },
      { name: "testCommand", type: "string", default: "npm test", required: false },
    ],
    steps: [
      { id: "run-tests", name: "Run test suite", type: "tool", config: { tool: "shell.run", command: "{{testCommand}}" }, retryCount: 2, retryDelay: 5000, timeout: 300000, dependsOn: [] },
      { id: "fetch-baseline", name: "Fetch baseline results", type: "tool", config: { tool: "shell.run", command: "git fetch origin {{baselineBranch}} && git show origin/{{baselineBranch}}:test-results.json > baseline.json" }, retryCount: 0, timeout: 60000, dependsOn: ["run-tests"] },
      { id: "compare", name: "Compare results", type: "agent", config: { handler: null, prompt: "Compare current test results against the {{baselineBranch}} baseline. Identify any regressions, performance degradations, or new failures." }, retryCount: 0, timeout: 120000, dependsOn: ["fetch-baseline"] },
    ],
  };
}

function ETL_PIPELINE() {
  return {
    name: "etl-pipeline",
    description: "Extract, Transform, Load pipeline for data processing workflows.",
    category: "DataProcessing",
    tags: ["etl", "data", "extract", "transform", "load"],
    version: "1.0.0",
    params: [
      { name: "source", type: "string", default: "database", required: false, description: "Data source type" },
      { name: "target", type: "string", default: "warehouse", required: false, description: "Data target type" },
    ],
    steps: [
      { id: "extract", name: "Extract data", type: "tool", config: { tool: "data.extract", source: "{{source}}" }, retryCount: 2, retryDelay: 5000, timeout: 300000, dependsOn: [] },
      { id: "transform", name: "Transform data", type: "tool", config: { tool: "data.transform" }, retryCount: 1, retryDelay: 3000, timeout: 600000, dependsOn: ["extract"] },
      { id: "validate", name: "Validate transformed data", type: "condition", config: { evaluate: null }, retryCount: 0, timeout: 60000, dependsOn: ["transform"] },
      { id: "load", name: "Load to target", type: "tool", config: { tool: "data.load", target: "{{target}}" }, retryCount: 2, retryDelay: 10000, timeout: 300000, dependsOn: ["validate"] },
      { id: "audit", name: "Audit record counts", type: "agent", config: { handler: null, prompt: "Audit the ETL pipeline: verify record counts match between source and target, check for data integrity issues." }, retryCount: 0, timeout: 120000, dependsOn: ["load"] },
    ],
  };
}

function SECURITY_SCAN_PIPELINE() {
  return {
    name: "security-scan-pipeline",
    description: "Comprehensive security scan: dependency vulnerabilities, static code analysis, secrets detection.",
    category: "Security",
    tags: ["security", "scan", "vulnerabilities", "secrets", "compliance"],
    version: "1.0.0",
    params: [
      { name: "severityLevel", type: "string", default: "high", required: false, description: "Minimum severity to report (low, medium, high, critical)" },
    ],
    steps: [
      { id: "dep-scan", name: "Scan dependencies", type: "tool", config: { tool: "shell.run", command: "npm audit --audit-level={{severityLevel}}" }, retryCount: 0, timeout: 120000, dependsOn: [] },
      { id: "code-scan", name: "Static code analysis", type: "tool", config: { tool: "shell.run", command: "npm run security:scan" }, retryCount: 0, timeout: 300000, dependsOn: [] },
      { id: "secret-scan", name: "Scan for secrets", type: "tool", config: { tool: "shell.run", command: "npm run security:secrets" }, retryCount: 0, timeout: 180000, dependsOn: [] },
      { id: "report", name: "Generate security report", type: "agent", config: { handler: null, prompt: "Aggregate findings from dependency scan, code analysis, and secret scan into a security report. Highlight issues with severity >= {{severityLevel}}. Include remediation suggestions." }, retryCount: 0, timeout: 120000, dependsOn: ["dep-scan", "code-scan", "secret-scan"] },
    ],
  };
}

function DOCS_GENERATE_PIPELINE() {
  return {
    name: "docs-generate-pipeline",
    description: "Documentation generation: extract sources, generate docs, review for accuracy, and publish.",
    category: "Documentation",
    tags: ["docs", "documentation", "generate", "publish"],
    version: "1.0.0",
    params: [
      { name: "outputFormat", type: "string", default: "markdown", required: false, description: "Documentation output format" },
      { name: "outputDir", type: "string", default: "./docs", required: false },
    ],
    steps: [
      { id: "extract", name: "Extract doc sources", type: "agent", config: { handler: null, prompt: "Extract documentation sources from code comments, JSDoc, README files, and inline documentation." }, retryCount: 0, timeout: 180000, dependsOn: [] },
      { id: "generate", name: "Generate documentation", type: "agent", config: { handler: null, prompt: "Generate comprehensive documentation in {{outputFormat}} format from extracted sources. Output to {{outputDir}}." }, retryCount: 0, timeout: 300000, dependsOn: ["extract"] },
      { id: "review", name: "Review documentation", type: "agent", config: { handler: null, prompt: "Review the generated documentation for accuracy, completeness, and clarity. Flag any missing or incorrect information." }, retryCount: 0, timeout: 120000, dependsOn: ["generate"] },
      { id: "publish", name: "Publish documentation", type: "tool", config: { tool: "shell.run", command: "npm run docs:publish" }, retryCount: 1, retryDelay: 5000, timeout: 120000, dependsOn: ["review"] },
    ],
  };
}

function HEALTH_CHECK_PIPELINE() {
  return {
    name: "health-check-pipeline",
    description: "System health check: verify critical endpoints, check dependencies, and report status.",
    category: "Custom",
    tags: ["health", "monitoring", "uptime", "check"],
    version: "1.0.0",
    params: [
      { name: "baseUrl", type: "string", default: "http://localhost:3000", required: false, description: "Base URL to check" },
    ],
    steps: [
      { id: "ping", name: "Ping service", type: "tool", config: { tool: "http.get", url: "{{baseUrl}}/health" }, retryCount: 2, retryDelay: 5000, timeout: 30000, dependsOn: [] },
      { id: "deps", name: "Check dependencies", type: "agent", config: { handler: null, prompt: "Check all upstream dependencies for the service at {{baseUrl}}: database, cache, message queue, external APIs." }, retryCount: 1, retryDelay: 3000, timeout: 60000, dependsOn: ["ping"] },
      { id: "uptime", name: "Verify uptime", type: "tool", config: { tool: "http.get", url: "{{baseUrl}}/status/uptime" }, retryCount: 1, retryDelay: 2000, timeout: 30000, dependsOn: ["ping"] },
      { id: "report", name: "Generate health report", type: "agent", config: { handler: null, prompt: "Generate a health status report summarizing ping results, dependency status, and uptime metrics. Flag any degraded services." }, retryCount: 0, timeout: 60000, dependsOn: ["deps", "uptime"] },
    ],
  };
}

function DEPENDENCY_UPDATE_CHECK() {
  return {
    name: "dependency-update-check",
    description: "Check for outdated dependencies, analyze changelogs, and generate an update report.",
    category: "Custom",
    tags: ["dependencies", "updates", "maintenance", "npm"],
    version: "1.0.0",
    params: [
      { name: "packageManager", type: "string", default: "npm", required: false },
      { name: "updateStrategy", type: "string", default: "minor", required: false, description: "major, minor, or patch" },
    ],
    steps: [
      { id: "check-outdated", name: "Check outdated packages", type: "tool", config: { tool: "shell.run", command: "{{packageManager}} outdated --json" }, retryCount: 0, timeout: 120000, dependsOn: [] },
      { id: "audit", name: "Run security audit", type: "tool", config: { tool: "shell.run", command: "{{packageManager}} audit --json" }, retryCount: 0, timeout: 120000, dependsOn: [] },
      { id: "analyze", name: "Analyze changelogs", type: "agent", config: { handler: null, prompt: "Analyze changelogs for outdated packages. Identify breaking changes that would affect the {{updateStrategy}} update strategy. Assess risk level for each update." }, retryCount: 0, timeout: 300000, dependsOn: ["check-outdated", "audit"] },
      { id: "report", name: "Generate update report", type: "agent", config: { handler: null, prompt: "Generate a prioritized update report with recommended packages to update, risk assessments, and migration notes." }, retryCount: 0, timeout: 120000, dependsOn: ["analyze"] },
    ],
  };
}

// ---- Helpers ----

function summarize(tmpl) {
  return {
    id: tmpl.id,
    name: tmpl.name,
    description: tmpl.description,
    category: tmpl.category,
    tags: tmpl.tags,
    version: tmpl.version,
    stepCount: tmpl.steps.length,
    paramCount: tmpl.params.length,
    usageCount: tmpl.usageCount,
    createdAt: tmpl.createdAt,
    updatedAt: tmpl.updatedAt,
  };
}

function normalizeParam(p) {
  if (!p || typeof p !== "object") {
    return { name: "param", type: "string", default: undefined, required: false, description: "" };
  }
  return {
    name: typeof p.name === "string" ? p.name : "param",
    type: typeof p.type === "string" ? p.type : "string",
    default: p.default,
    required: Boolean(p.required),
    description: typeof p.description === "string" ? p.description : "",
  };
}

function cloneSteps(steps) {
  return JSON.parse(JSON.stringify(steps));
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function substituteParams(config, params, templateParams) {
  const result = { ...config };
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === "string") {
      result[key] = substituteString(value, params);
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = substituteParams(value, params, templateParams);
    }
  }
  return result;
}

function substituteString(str, params) {
  return str.replace(/\{\{(\w+)\}\}/g, (match, name) => {
    if (params[name] !== undefined && params[name] !== null) {
      return String(params[name]);
    }
    return match;
  });
}

function stripStep(step) {
  const { config, ...rest } = step;
  return { ...rest, config: deepClone(config) };
}

function templateToYaml(tmpl) {
  // Convert a template to a simplified YAML-like DSL string using workflowToDsl
  const workflowDef = {
    name: tmpl.name,
    description: tmpl.description,
    steps: tmpl.steps.map((s) => {
      const step = {};
      if (s.id) step.id = s.id;
      if (s.name) step.name = s.name;
      if (s.type) step.type = s.type;
      if (s.config && s.config.tool) step.tool = s.config.tool;
      if (s.config && s.config.command) step.command = s.config.command;
      if (s.dependsOn && s.dependsOn.length > 0) step.dependsOn = s.dependsOn;
      if (s.retryCount !== undefined) step.retryCount = s.retryCount;
      if (s.retryDelay !== undefined) step.retryDelay = s.retryDelay;
      if (s.timeout !== undefined) step.timeout = s.timeout;
      if (s.config && s.config.duration) step.duration = s.config.duration;
      // Bring remaining config keys
      if (s.config) {
        for (const [k, v] of Object.entries(s.config)) {
          if (!["tool", "command", "duration", "handler"].includes(k)) {
            step[k] = v;
          }
        }
      }
      return step;
    }),
  };

  let yaml = `# Template: ${tmpl.name}\n`;
  yaml += `# Category: ${tmpl.category}\n`;
  yaml += `# Version: ${tmpl.version}\n`;
  if (tmpl.description) yaml += `# ${tmpl.description}\n`;
  yaml += `# Tags: ${tmpl.tags.join(", ")}\n`;

  if (tmpl.params.length > 0) {
    yaml += `# Parameters:\n`;
    for (const p of tmpl.params) {
      yaml += `#   - ${p.name}: ${p.type}${p.required ? " (required)" : ` (default: ${JSON.stringify(p.default)})`}\n`;
    }
  }

  yaml += "\n" + workflowToDsl(workflowDef);
  return yaml;
}

module.exports = {
  WorkflowLibrary,
  CATEGORIES,
};
