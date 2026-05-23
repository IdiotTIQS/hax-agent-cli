"use strict";

/**
 * GoalTemplates -- pre-defined milestone templates for common development
 * and project management workflows.
 *
 * Each template is a frozen object describing the default title, description,
 * priority, and a list of milestones that together form a proven recipe for
 * completing that type of work.
 */

const TEMPLATES = Object.freeze({
  /**
   * Template for adding a new feature.
   */
  ADD_FEATURE: Object.freeze({
    title: "Add New Feature",
    description: "Implement a new feature from specification through deployment.",
    defaultPriority: "high",
    milestones: [
      { title: "Write specification", status: "pending" },
      { title: "Review specification", status: "pending" },
      { title: "Implement core logic", status: "pending" },
      { title: "Write tests", status: "pending" },
      { title: "Document API / usage", status: "pending" },
      { title: "Code review", status: "pending" },
      { title: "Merge and deploy", status: "pending" },
    ],
  }),

  /**
   * Template for fixing a bug.
   */
  FIX_BUG: Object.freeze({
    title: "Fix Bug",
    description: "Reproduce, diagnose, fix, and verify a reported bug.",
    defaultPriority: "high",
    milestones: [
      { title: "Reproduce the issue", status: "pending" },
      { title: "Diagnose root cause", status: "pending" },
      { title: "Write failing test", status: "pending" },
      { title: "Implement the fix", status: "pending" },
      { title: "Verify fix passes tests", status: "pending" },
      { title: "Regression test surrounding area", status: "pending" },
    ],
  }),

  /**
   * Template for refactoring code.
   */
  REFACTOR_CODE: Object.freeze({
    title: "Refactor Code",
    description: "Improve code structure without changing external behavior.",
    defaultPriority: "medium",
    milestones: [
      { title: "Analyze current implementation", status: "pending" },
      { title: "Plan refactoring steps", status: "pending" },
      { title: "Extract components / functions", status: "pending" },
      { title: "Update tests", status: "pending" },
      { title: "Verify all tests pass", status: "pending" },
      { title: "Clean up dead code", status: "pending" },
      { title: "Update documentation", status: "pending" },
    ],
  }),

  /**
   * Template for writing tests.
   */
  WRITE_TESTS: Object.freeze({
    title: "Write Tests",
    description: "Add or improve test coverage for the codebase.",
    defaultPriority: "high",
    milestones: [
      { title: "Identify testing gaps", status: "pending" },
      { title: "Write unit tests", status: "pending" },
      { title: "Write integration tests", status: "pending" },
      { title: "Write edge-case tests", status: "pending" },
      { title: "Review code coverage report", status: "pending" },
    ],
  }),

  /**
   * Template for setting up a new project.
   */
  SETUP_PROJECT: Object.freeze({
    title: "Set Up Project",
    description: "Initialize a new project with configuration, dependencies, and documentation.",
    defaultPriority: "medium",
    milestones: [
      { title: "Initialize project structure", status: "pending" },
      { title: "Configure tooling (lint, format, build)", status: "pending" },
      { title: "Install dependencies", status: "pending" },
      { title: "Verify dev environment works", status: "pending" },
      { title: "Write README / onboarding docs", status: "pending" },
    ],
  }),

  /**
   * Template for optimizing performance.
   */
  OPTIMIZE_PERF: Object.freeze({
    title: "Optimize Performance",
    description: "Profile, identify bottlenecks, and improve application performance.",
    defaultPriority: "medium",
    milestones: [
      { title: "Profile application", status: "pending" },
      { title: "Identify key bottlenecks", status: "pending" },
      { title: "Implement optimizations", status: "pending" },
      { title: "Benchmark before vs after", status: "pending" },
      { title: "Document findings and improvements", status: "pending" },
    ],
  }),
});

/**
 * Available template names.
 *
 * @type {string[]}
 */
const TEMPLATE_NAMES = Object.keys(TEMPLATES);

/**
 * Create a goal object by filling in a named template with optional overrides.
 *
 * @param {string} templateName - one of the TEMPLATE_NAMES
 * @param {object} [overrides={}] - fields to override on the resulting goal
 *   { title?, description?, priority?, milestones?, deadline? }
 * @returns {object} a goal descriptor ready to be passed to GoalTracker.setGoal()
 */
function createFromTemplate(templateName, overrides = {}) {
  const template = TEMPLATES[templateName];
  if (!template) {
    throw new Error(
      `Unknown template "${templateName}". Available: ${TEMPLATE_NAMES.join(", ")}`,
    );
  }

  const merged = {
    title: overrides.title || template.title,
    description: overrides.description !== undefined
      ? overrides.description
      : template.description,
    priority: overrides.priority || template.defaultPriority,
    status: overrides.status || "active",
    milestones: overrides.milestones || template.milestones.map((m) => ({ ...m })),
    deadline: overrides.deadline || null,
  };

  return merged;
}

module.exports = {
  TEMPLATES,
  TEMPLATE_NAMES,
  createFromTemplate,
};
