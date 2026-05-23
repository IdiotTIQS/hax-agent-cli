"use strict";

// Severity constants
const SEVERITY = {
  ERROR: "ERROR",
  WARNING: "WARNING",
  INFO: "INFO",
  SUGGESTION: "SUGGESTION",
};

// Score deductions per severity level
const SEVERITY_WEIGHT = {
  [SEVERITY.ERROR]: 20,
  [SEVERITY.WARNING]: 10,
  [SEVERITY.INFO]: 5,
  [SEVERITY.SUGGESTION]: 1,
};

// Preferred ID pattern: alphanumeric with hyphens (kebab-case) or camelCase
const KEBAB_CASE_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const CAMEL_CASE_RE = /^[a-z][a-zA-Z0-9]*$/;

// Single-char or purely numeric IDs smell
const SHORT_ID_RE = /^.$/;
const NUMERIC_ID_RE = /^\d+$/;

class WorkflowLinter {
  /**
   * Run all lint checks and return a scored report.
   * @param {object} workflow  { name, steps, description? }
   * @returns {{ issues: Array<object>, score: number }}
   *   Each issue: { severity, message, stepId?, rule, fix? }
   */
  lint(workflow) {
    const issues = [];

    if (!workflow || typeof workflow !== "object") {
      issues.push({
        severity: SEVERITY.ERROR,
        message: "Workflow definition must be a non-null object.",
        rule: "workflow-shape",
      });
      return { issues, score: this._computeScore(issues) };
    }

    const steps = Array.isArray(workflow.steps) ? workflow.steps : [];

    if (steps.length === 0) {
      issues.push({
        severity: SEVERITY.ERROR,
        message: "Workflow has no steps.",
        rule: "minimal-structure",
      });
      return { issues, score: this._computeScore(issues) };
    }

    // Run all checks
    issues.push(...this.checkNaming(steps));
    issues.push(...this.checkNaming(workflow));
    issues.push(...this.checkStructure(workflow));
    issues.push(...this.checkPerformance(workflow));

    const score = this._computeScore(issues);

    return { issues, score };
  }

  /**
   * Check naming conventions for step IDs and names.
   * @param {Array<object>|object} steps  — either steps array or workflow object
   * @returns {Array<object>} issues
   */
  checkNaming(input) {
    const issues = [];

    // If input has a .steps property, treat as workflow and check name + steps
    let workflowName = null;
    let steps = [];

    if (input && Array.isArray(input)) {
      steps = input;
    } else if (input && Array.isArray(input.steps)) {
      steps = input.steps;
      workflowName = typeof input.name === "string" ? input.name : null;
    }

    // Check workflow name
    if (workflowName !== null) {
      if (workflowName.length < 3) {
        issues.push({
          severity: SEVERITY.WARNING,
          message: `Workflow name "${workflowName}" is very short. Use a descriptive name (3+ characters).`,
          rule: "descriptive-names",
        });
      }
      if (/\s/.test(workflowName)) {
        issues.push({
          severity: SEVERITY.SUGGESTION,
          message: `Workflow name "${workflowName}" contains whitespace. Consider using kebab-case (e.g., "my-workflow").`,
          rule: "naming-convention",
        });
      }
      if (/[A-Z]/.test(workflowName)) {
        issues.push({
          severity: SEVERITY.SUGGESTION,
          message: `Workflow name "${workflowName}" contains uppercase characters. Prefer kebab-case for workflow names.`,
          rule: "naming-convention",
        });
      }
    }

    for (const step of steps) {
      if (!step || typeof step !== "object") continue;

      const stepId = typeof step.id === "string" ? step.id.trim() : null;
      const stepName = typeof step.name === "string" ? step.name.trim() : null;

      if (!stepId) continue;

      // ID naming conventions
      if (SHORT_ID_RE.test(stepId)) {
        issues.push({
          severity: SEVERITY.WARNING,
          message: `Step "${stepId}" has a single-character ID. Use a descriptive name.`,
          stepId,
          rule: "descriptive-ids",
        });
      }

      if (NUMERIC_ID_RE.test(stepId)) {
        issues.push({
          severity: SEVERITY.WARNING,
          message: `Step "${stepId}" has a purely numeric ID. Use a descriptive name.`,
          stepId,
          rule: "descriptive-ids",
        });
      }

      if (/\s/.test(stepId)) {
        issues.push({
          severity: SEVERITY.SUGGESTION,
          message: `Step "${stepId}" ID contains whitespace. Consider using kebab-case.`,
          stepId,
          rule: "naming-convention",
          fix: `Rename to: "${stepId.replace(/\s+/g, "-").toLowerCase()}"`,
        });
      }

      if (/[A-Z]/.test(stepId) && !CAMEL_CASE_RE.test(stepId)) {
        issues.push({
          severity: SEVERITY.SUGGESTION,
          message: `Step "${stepId}" ID mixes cases inconsistently. Prefer kebab-case or camelCase.`,
          stepId,
          rule: "naming-convention",
        });
      }

      if (/[^a-zA-Z0-9_-]/.test(stepId)) {
        issues.push({
          severity: SEVERITY.WARNING,
          message: `Step "${stepId}" ID contains special characters. Use only alphanumeric, hyphens, and underscores.`,
          stepId,
          rule: "naming-convention",
        });
      }

      // Step name conventions
      if (stepName) {
        if (stepName.endsWith(".")) {
          issues.push({
            severity: SEVERITY.SUGGESTION,
            message: `Step "${stepId}" name ends with a period.`,
            stepId,
            rule: "step-name-format",
          });
        }
        if (stepName.length < 3) {
          issues.push({
            severity: SEVERITY.INFO,
            message: `Step "${stepId}" name "${stepName}" is very short. A more descriptive name helps readability.`,
            stepId,
            rule: "descriptive-names",
          });
        }
        if (stepName === stepId) {
          issues.push({
            severity: SEVERITY.INFO,
            message: `Step "${stepId}" name is identical to its ID. Consider a more human-readable name.`,
            stepId,
            rule: "descriptive-names",
          });
        }
      }
    }

    return issues;
  }

  /**
   * Check structural best practices.
   * @param {object} workflow
   * @returns {Array<object>} issues
   */
  checkStructure(workflow) {
    const issues = [];
    const steps = Array.isArray(workflow.steps) ? workflow.steps : [];

    if (steps.length === 0) return issues;

    // Single step workflow
    if (steps.length === 1) {
      issues.push({
        severity: SEVERITY.INFO,
        message: "Workflow has only one step. Consider calling the step directly instead of using a workflow.",
        rule: "single-step-workflow",
      });
    }

    // Entry points
    const entryPoints = steps.filter((s) => {
      const deps = Array.isArray(s.dependsOn) ? s.dependsOn : [];
      return deps.length === 0;
    });

    if (entryPoints.length > 1) {
      issues.push({
        severity: SEVERITY.INFO,
        message: `Workflow has ${entryPoints.length} entry points (${entryPoints.map((s) => s.id).join(", ")}). This is valid but make sure they are intentionally independent.`,
        rule: "multiple-entry-points",
      });
    }

    // Parallel step usage without resource limits
    for (const step of steps) {
      if (step.type === "parallel" && step.config && Array.isArray(step.config.steps)) {
        if (step.config.steps.length > 10) {
          issues.push({
            severity: SEVERITY.WARNING,
            message: `Parallel step "${step.id}" has ${step.config.steps.length} sub-steps. Consider batching or adding concurrency limits.`,
            stepId: step.id,
            rule: "excessive-parallelism",
          });
        }
      }
    }

    // Validate all dependsOn entries reference IDs that are reasonably ordered
    const idIndex = new Map();
    steps.forEach((s, i) => { if (s.id) idIndex.set(s.id, i); });

    for (const step of steps) {
      const deps = Array.isArray(step.dependsOn) ? step.dependsOn : [];
      const myIdx = idIndex.get(step.id);

      for (const dep of deps) {
        const depIdx = idIndex.get(dep);
        // Dependency appears AFTER the step in the array — not necessarily wrong, but worth noting
        if (depIdx !== undefined && myIdx !== undefined && depIdx > myIdx) {
          issues.push({
            severity: SEVERITY.INFO,
            message: `Step "${step.id}" depends on "${dep}" which is defined later in the steps array. For readability, consider ordering dependencies before dependents.`,
            stepId: step.id,
            rule: "step-ordering",
          });
        }
      }
    }

    // Too many steps (maintainability)
    if (steps.length > 50) {
      issues.push({
        severity: SEVERITY.WARNING,
        message: `Workflow has ${steps.length} steps. Consider splitting into sub-workflows for maintainability.`,
        rule: "workflow-size",
      });
    }

    // Missing continueOnError without recovery steps
    for (const step of steps) {
      if (step.continueOnError) {
        // Check if any later step depends on this one — if so, they'll receive null
        const dependents = steps.filter((s) =>
          Array.isArray(s.dependsOn) && s.dependsOn.includes(step.id),
        );
        if (dependents.length > 0) {
          issues.push({
            severity: SEVERITY.WARNING,
            message: `Step "${step.id}" has continueOnError=true but step(s) "${dependents.map((s) => s.id).join(", ")}" depend on it. They may receive null/undefined results.`,
            stepId: step.id,
            rule: "continue-on-error-with-dependents",
          });
        }
      }
    }

    // condition steps used without a conditional path
    const condSteps = steps.filter((s) => s.type === "condition");
    if (condSteps.length > 0) {
      for (const cs of condSteps) {
        const dependents = steps.filter((s) =>
          Array.isArray(s.dependsOn) && s.dependsOn.includes(cs.id),
        );
        if (dependents.length === 0) {
          issues.push({
            severity: SEVERITY.INFO,
            message: `Condition step "${cs.id}" has no dependent steps. Its result is unused.`,
            stepId: cs.id,
            rule: "unused-condition",
          });
        }
      }
    }

    // Missing description
    if (!workflow.description || (typeof workflow.description === "string" && workflow.description.trim().length === 0)) {
      issues.push({
        severity: SEVERITY.SUGGESTION,
        message: "Workflow is missing a description. Add one to document its purpose.",
        rule: "missing-description",
      });
    }

    return issues;
  }

  /**
   * Check for performance anti-patterns.
   * @param {object} workflow
   * @returns {Array<object>} issues
   */
  checkPerformance(workflow) {
    const issues = [];
    const steps = Array.isArray(workflow.steps) ? workflow.steps : [];

    const MAX_RETRY = 5;
    const MAX_TIMEOUT_MS = 600_000; // 10 minutes

    for (const step of steps) {
      if (!step || typeof step !== "object") continue;

      // Excessive retries
      const retryCount = typeof step.retryCount === "number" ? step.retryCount : 0;
      if (retryCount > MAX_RETRY) {
        issues.push({
          severity: SEVERITY.WARNING,
          message: `Step "${step.id}" has retryCount=${retryCount} (>${MAX_RETRY}). Excessive retries can hide persistent failures.`,
          stepId: step.id,
          rule: "excessive-retries",
        });
      }

      // Large timeout
      const timeout = typeof step.timeout === "number" ? step.timeout : null;
      if (timeout !== null && timeout > MAX_TIMEOUT_MS) {
        const minutes = Math.round(timeout / 60000);
        issues.push({
          severity: SEVERITY.WARNING,
          message: `Step "${step.id}" has timeout=${timeout}ms (~${minutes} minutes). Consider breaking this step into smaller ones.`,
          stepId: step.id,
          rule: "large-timeout",
        });
      }

      // retryCount > 0 but no retryDelay set (uses default 1000ms)
      if (retryCount > 0 && step.retryDelay === undefined) {
        issues.push({
          severity: SEVERITY.INFO,
          message: `Step "${step.id}" has retryCount=${retryCount} but no explicit retryDelay. Default delay of 1000ms will be used.`,
          stepId: step.id,
          rule: "implicit-retry-delay",
        });
      }

      // High retryCount with low retryDelay — rapid retry storm
      const retryDelay = typeof step.retryDelay === "number" ? step.retryDelay : null;
      if (retryCount > 3 && retryDelay !== null && retryDelay < 1000) {
        issues.push({
          severity: SEVERITY.WARNING,
          message: `Step "${step.id}" has high retryCount (${retryCount}) with very low retryDelay (${retryDelay}ms). This can create a retry storm. Consider increasing retryDelay or using exponential backoff.`,
          stepId: step.id,
          rule: "retry-storm",
        });
      }

      // tool/agent steps with null handler
      if ((step.type === "tool" || step.type === "agent") && step.config) {
        if (step.config.handler === null || step.config.handler === undefined) {
          if (!step.config.tool) {
            issues.push({
              severity: SEVERITY.ERROR,
              message: `Step "${step.id}" of type "${step.type}" has no handler function or tool specified. It will fail at runtime.`,
              stepId: step.id,
              rule: "missing-handler",
            });
          } else {
            // Has tool but no handler — runtime might work if engine resolves the handler
            issues.push({
              severity: SEVERITY.INFO,
              message: `Step "${step.id}" has config.tool="${step.config.tool}" but no config.handler. Ensure the engine can resolve this tool at runtime.`,
              stepId: step.id,
              rule: "handlerless-tool",
            });
          }
        }
      }
    }

    // Steps that could be parallelized but are sequential
    // Find groups of independent consecutive steps
    this._suggestParallelization(steps, issues);

    return issues;
  }

  /**
   * Suggest parallelization for independent consecutive steps.
   */
  _suggestParallelization(steps, issues) {
    if (steps.length < 2) return;

    for (let i = 0; i < steps.length - 1; i++) {
      const a = steps[i];
      const b = steps[i + 1];
      if (!a || !b) continue;

      const aDeps = Array.isArray(a.dependsOn) ? a.dependsOn : [];
      const bDeps = Array.isArray(b.dependsOn) ? b.dependsOn : [];

      // If b depends on a, they must be sequential — skip
      if (bDeps.includes(a.id)) continue;

      // If both have the same dependencies and neither depends on the other, they could be parallel
      const aDepsSorted = [...aDeps].sort().join(",");
      const bDepsSorted = [...bDeps].sort().join(",");

      if (aDepsSorted === bDepsSorted && !aDeps.includes(b.id) && !bDeps.includes(a.id)) {
        issues.push({
          severity: SEVERITY.SUGGESTION,
          message: `Steps "${a.id}" and "${b.id}" have the same dependencies and could run in parallel for better performance.`,
          stepId: a.id,
          rule: "parallelization-opportunity",
        });
      }
    }
  }

  /**
   * Return a reference guide of best practices.
   * @returns {Array<{ category: string, practices: string[] }>}
   */
  getBestPractices() {
    return [
      {
        category: "Naming",
        practices: [
          "Use kebab-case for workflow names (e.g., ci-build-pipeline).",
          "Use kebab-case or camelCase for step IDs (e.g., run-lints, deployCanary).",
          "Give steps descriptive human-readable names describing their purpose.",
          "Avoid single-character or purely numeric step IDs.",
        ],
      },
      {
        category: "Structure",
        practices: [
          "Every workflow should have at least one entry point (step with no dependencies) and one exit point.",
          "Keep workflows under 30 steps for maintainability. Split large workflows into sub-workflows.",
          "Order steps so that dependencies appear before dependents in the array for readability.",
          "Include a description explaining the workflow's purpose.",
        ],
      },
      {
        category: "Dependencies",
        practices: [
          "Avoid circular dependencies — they make execution impossible.",
          "Ensure every dependsOn target references a real step ID.",
          "Self-dependencies (a step depending on itself) are always invalid.",
          "Minimize deep dependency chains. If depth exceeds 5, consider flattening.",
        ],
      },
      {
        category: "Performance",
        practices: [
          "Set retryCount to a reasonable value (0-5). Excessive retries hide persistent failures.",
          "Use retryDelay > 1000ms when retryCount > 3 to avoid retry storms.",
          "Set explicit timeouts per step. Steps without timeouts use a 5-minute default.",
          "Run independent steps in parallel when possible to reduce total execution time.",
          "Avoid timeouts exceeding 10 minutes. Break long-running steps into smaller ones.",
          "Be cautious with continueOnError when later steps depend on the failing step's output.",
        ],
      },
      {
        category: "Type-specific",
        practices: [
          "Tool steps: always provide config.handler or config.tool.",
          "Agent steps: always provide config.handler with a function.",
          "Condition steps: always provide config.evaluate returning boolean.",
          "Wait steps: always set config.duration in milliseconds.",
          "Parallel steps: ensure config.steps is a non-empty array with valid sub-steps.",
          "Prefer tool steps over agent steps for deterministic, repeatable operations.",
        ],
      },
      {
        category: "Error Handling",
        practices: [
          "Use continueOnError only for non-critical steps.",
          "Add a recovery or notification step after steps with continueOnError=true.",
          "Set retryCount > 0 for flaky operations (network calls, API requests).",
          "Set retryCount = 0 for idempotent or cacheable operations.",
        ],
      },
    ];
  }

  // ---- Private ----

  /**
   * Compute a 0-100 score from issues, with a floor of 0.
   */
  _computeScore(issues) {
    let deductions = 0;
    for (const issue of issues) {
      deductions += SEVERITY_WEIGHT[issue.severity] || 0;
    }
    return Math.max(0, 100 - deductions);
  }
}

module.exports = {
  WorkflowLinter,
  SEVERITY,
};
