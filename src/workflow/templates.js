"use strict";

/**
 * Pre-built workflow templates.
 *
 * Each template is a function that returns { name, steps } compatible with
 * WorkflowEngine.define(). Templates accept optional overrides so callers can
 * supply handler functions, adjust timeouts, etc.
 */

/**
 * CI_CHECK — lint -> test -> build
 */
function CI_CHECK(overrides = {}) {
  const steps = [
    {
      id: "lint",
      name: "Lint code",
      type: "tool",
      config: {
        tool: "shell.run",
        command: "npm run lint",
        handler: null,
      },
      retryCount: 0,
      timeout: 120000,
      continueOnError: false,
      dependsOn: [],
    },
    {
      id: "test",
      name: "Run tests",
      type: "tool",
      config: {
        tool: "shell.run",
        command: "npm test",
        handler: null,
      },
      retryCount: 1,
      retryDelay: 2000,
      timeout: 300000,
      continueOnError: false,
      dependsOn: ["lint"],
    },
    {
      id: "build",
      name: "Build project",
      type: "tool",
      config: {
        tool: "shell.run",
        command: "npm run build",
        handler: null,
      },
      retryCount: 0,
      timeout: 300000,
      continueOnError: false,
      dependsOn: ["test"],
    },
  ];

  return applyOverrides({ name: "ci-check", steps }, overrides);
}

/**
 * CODE_REVIEW_PIPELINE — explore -> review -> suggest
 */
function CODE_REVIEW_PIPELINE(overrides = {}) {
  const steps = [
    {
      id: "explore",
      name: "Explore codebase",
      type: "agent",
      config: {
        handler: null,
        prompt: "Explore the codebase structure and identify files relevant to the review.",
      },
      retryCount: 0,
      timeout: 120000,
      continueOnError: false,
      dependsOn: [],
    },
    {
      id: "review",
      name: "Review code",
      type: "agent",
      config: {
        handler: null,
        prompt: "Review the code for correctness, style, and potential issues.",
      },
      retryCount: 0,
      timeout: 300000,
      continueOnError: false,
      dependsOn: ["explore"],
    },
    {
      id: "suggest",
      name: "Suggest improvements",
      type: "agent",
      config: {
        handler: null,
        prompt: "Based on the review, suggest concrete improvements with priority levels.",
      },
      retryCount: 0,
      timeout: 120000,
      continueOnError: false,
      dependsOn: ["review"],
    },
  ];

  return applyOverrides({ name: "code-review-pipeline", steps }, overrides);
}

/**
 * DEPLOY_PIPELINE — test -> build -> deploy -> verify
 */
function DEPLOY_PIPELINE(overrides = {}) {
  const steps = [
    {
      id: "test",
      name: "Run tests before deploy",
      type: "tool",
      config: {
        tool: "shell.run",
        command: "npm test",
        handler: null,
      },
      retryCount: 2,
      retryDelay: 5000,
      timeout: 300000,
      continueOnError: false,
      dependsOn: [],
    },
    {
      id: "build",
      name: "Build artifacts",
      type: "tool",
      config: {
        tool: "shell.run",
        command: "npm run build",
        handler: null,
      },
      retryCount: 1,
      retryDelay: 3000,
      timeout: 600000,
      continueOnError: false,
      dependsOn: ["test"],
    },
    {
      id: "deploy",
      name: "Deploy to target",
      type: "tool",
      config: {
        tool: "shell.run",
        command: "npm run deploy",
        handler: null,
      },
      retryCount: 2,
      retryDelay: 10000,
      timeout: 600000,
      continueOnError: false,
      dependsOn: ["build"],
    },
    {
      id: "verify",
      name: "Verify deployment",
      type: "agent",
      config: {
        handler: null,
        prompt: "Verify the deployment is healthy by checking endpoints, logs, and metrics.",
      },
      retryCount: 1,
      retryDelay: 5000,
      timeout: 120000,
      continueOnError: false,
      dependsOn: ["deploy"],
    },
  ];

  return applyOverrides({ name: "deploy-pipeline", steps }, overrides);
}

/**
 * DATA_PIPELINE — fetch -> transform -> validate -> store
 */
function DATA_PIPELINE(overrides = {}) {
  const steps = [
    {
      id: "fetch",
      name: "Fetch data",
      type: "tool",
      config: {
        tool: "data.fetch",
        handler: null,
      },
      retryCount: 2,
      retryDelay: 5000,
      timeout: 120000,
      continueOnError: false,
      dependsOn: [],
    },
    {
      id: "transform",
      name: "Transform data",
      type: "tool",
      config: {
        tool: "data.transform",
        handler: null,
      },
      retryCount: 1,
      retryDelay: 3000,
      timeout: 300000,
      continueOnError: false,
      dependsOn: ["fetch"],
    },
    {
      id: "validate",
      name: "Validate data",
      type: "condition",
      config: {
        evaluate: null,
      },
      retryCount: 0,
      timeout: 60000,
      continueOnError: false,
      dependsOn: ["transform"],
    },
    {
      id: "store",
      name: "Store data",
      type: "tool",
      config: {
        tool: "data.store",
        handler: null,
      },
      retryCount: 1,
      retryDelay: 3000,
      timeout: 120000,
      continueOnError: false,
      dependsOn: ["validate"],
    },
  ];

  return applyOverrides({ name: "data-pipeline", steps }, overrides);
}

/**
 * DOCS_PIPELINE — extract -> generate -> review -> publish
 */
function DOCS_PIPELINE(overrides = {}) {
  const steps = [
    {
      id: "extract",
      name: "Extract documentation sources",
      type: "agent",
      config: {
        handler: null,
        prompt: "Extract relevant documentation sources from the codebase, including JSDoc comments, READMEs, and inline docs.",
      },
      retryCount: 0,
      timeout: 180000,
      continueOnError: false,
      dependsOn: [],
    },
    {
      id: "generate",
      name: "Generate documentation",
      type: "agent",
      config: {
        handler: null,
        prompt: "Generate comprehensive documentation from the extracted sources.",
      },
      retryCount: 0,
      timeout: 300000,
      continueOnError: false,
      dependsOn: ["extract"],
    },
    {
      id: "review",
      name: "Review documentation",
      type: "agent",
      config: {
        handler: null,
        prompt: "Review the generated documentation for accuracy, completeness, and clarity.",
      },
      retryCount: 0,
      timeout: 120000,
      continueOnError: false,
      dependsOn: ["generate"],
    },
    {
      id: "publish",
      name: "Publish documentation",
      type: "tool",
      config: {
        tool: "shell.run",
        command: "echo 'Publishing documentation...'",
        handler: null,
      },
      retryCount: 1,
      retryDelay: 3000,
      timeout: 60000,
      continueOnError: false,
      dependsOn: ["review"],
    },
  ];

  return applyOverrides({ name: "docs-pipeline", steps }, overrides);
}

// ---- Helpers ----

function applyOverrides(template, overrides) {
  const result = {
    name: overrides.name || template.name,
    steps: template.steps.map((step, index) => {
      const stepOverrides = Array.isArray(overrides.steps) && overrides.steps[index]
        ? overrides.steps[index]
        : {};
      return deepMerge(step, stepOverrides);
    }),
  };

  if (overrides.description) {
    result.description = overrides.description;
  }

  return result;
}

function deepMerge(base, overrides) {
  if (!overrides || typeof overrides !== "object") return base;

  const result = { ...base };

  for (const key of Object.keys(overrides)) {
    const baseVal = base[key];
    const overrideVal = overrides[key];

    if (overrideVal === undefined) {
      continue;
    }

    if (baseVal && typeof baseVal === "object" && !Array.isArray(baseVal) && typeof overrideVal === "object" && !Array.isArray(overrideVal)) {
      result[key] = deepMerge(baseVal, overrideVal);
    } else {
      result[key] = overrideVal;
    }
  }

  return result;
}

// All templates keyed by name
const TEMPLATES = {
  CI_CHECK,
  CODE_REVIEW_PIPELINE,
  DEPLOY_PIPELINE,
  DATA_PIPELINE,
  DOCS_PIPELINE,
};

/**
 * Get a template by name.
 * @param {string} name
 * @param {object} [overrides]
 * @returns {{ name: string, steps: Array }}
 */
function getTemplate(name, overrides = {}) {
  const factory = TEMPLATES[name];
  if (!factory) {
    throw new Error(`Unknown template: ${name}. Available: ${Object.keys(TEMPLATES).join(", ")}.`);
  }
  return factory(overrides);
}

/**
 * List all available template names.
 */
function listTemplates() {
  return Object.keys(TEMPLATES);
}

module.exports = {
  CI_CHECK,
  CODE_REVIEW_PIPELINE,
  DEPLOY_PIPELINE,
  DATA_PIPELINE,
  DOCS_PIPELINE,
  TEMPLATES,
  getTemplate,
  listTemplates,
};
