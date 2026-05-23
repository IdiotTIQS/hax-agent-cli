/**
 * Tests for workflow templates: CI_CHECK, CODE_REVIEW_PIPELINE, DEPLOY_PIPELINE,
 * DATA_PIPELINE, DOCS_PIPELINE, getTemplate, listTemplates.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CI_CHECK,
  CODE_REVIEW_PIPELINE,
  DEPLOY_PIPELINE,
  DATA_PIPELINE,
  DOCS_PIPELINE,
  getTemplate,
  listTemplates,
} = require("../../src/workflow/templates");

// ---- CI_CHECK ----

test("CI_CHECK: returns a valid workflow with lint, test, build steps", () => {
  const workflow = CI_CHECK();

  assert.equal(workflow.name, "ci-check");
  assert.equal(workflow.steps.length, 3);

  assert.equal(workflow.steps[0].id, "lint");
  assert.equal(workflow.steps[0].type, "tool");
  assert.deepEqual(workflow.steps[0].dependsOn, []);

  assert.equal(workflow.steps[1].id, "test");
  assert.equal(workflow.steps[1].type, "tool");
  assert.deepEqual(workflow.steps[1].dependsOn, ["lint"]);

  assert.equal(workflow.steps[2].id, "build");
  assert.equal(workflow.steps[2].type, "tool");
  assert.deepEqual(workflow.steps[2].dependsOn, ["test"]);
});

test("CI_CHECK: applies overrides to name and step config", () => {
  const workflow = CI_CHECK({
    name: "custom-ci",
    steps: [
      { config: { handler: function customHandler() { return "ok"; } } },
      {},
      { timeout: 60000 },
    ],
  });

  assert.equal(workflow.name, "custom-ci");
  assert.equal(workflow.steps.length, 3);
  assert.equal(typeof workflow.steps[0].config.handler, "function");
  assert.equal(workflow.steps[0].config.handler.name, "customHandler");
  assert.equal(workflow.steps[2].timeout, 60000);
});

// ---- CODE_REVIEW_PIPELINE ----

test("CODE_REVIEW_PIPELINE: returns explore -> review -> suggest chain", () => {
  const workflow = CODE_REVIEW_PIPELINE();

  assert.equal(workflow.name, "code-review-pipeline");
  assert.equal(workflow.steps.length, 3);

  assert.equal(workflow.steps[0].id, "explore");
  assert.equal(workflow.steps[0].type, "agent");
  assert.deepEqual(workflow.steps[0].dependsOn, []);

  assert.equal(workflow.steps[1].id, "review");
  assert.equal(workflow.steps[1].type, "agent");
  assert.deepEqual(workflow.steps[1].dependsOn, ["explore"]);

  assert.equal(workflow.steps[2].id, "suggest");
  assert.equal(workflow.steps[2].type, "agent");
  assert.deepEqual(workflow.steps[2].dependsOn, ["review"]);
});

test("CODE_REVIEW_PIPELINE: all agent steps have prompt config", () => {
  const workflow = CODE_REVIEW_PIPELINE();

  for (const step of workflow.steps) {
    assert.ok(typeof step.config.prompt === "string" && step.config.prompt.length > 0,
      `Step ${step.id} should have a non-empty prompt`);
  }
});

// ---- DEPLOY_PIPELINE ----

test("DEPLOY_PIPELINE: returns test -> build -> deploy -> verify chain", () => {
  const workflow = DEPLOY_PIPELINE();

  assert.equal(workflow.name, "deploy-pipeline");
  assert.equal(workflow.steps.length, 4);

  assert.equal(workflow.steps[0].id, "test");
  assert.equal(workflow.steps[1].id, "build");
  assert.equal(workflow.steps[2].id, "deploy");
  assert.equal(workflow.steps[3].id, "verify");

  assert.deepEqual(workflow.steps[1].dependsOn, ["test"]);
  assert.deepEqual(workflow.steps[2].dependsOn, ["build"]);
  assert.deepEqual(workflow.steps[3].dependsOn, ["deploy"]);
});

test("DEPLOY_PIPELINE: deploy step has retryCount 2 with 10s delay", () => {
  const workflow = DEPLOY_PIPELINE();

  const deployStep = workflow.steps.find((s) => s.id === "deploy");
  assert.equal(deployStep.retryCount, 2);
  assert.equal(deployStep.retryDelay, 10000);
});

// ---- DATA_PIPELINE ----

test("DATA_PIPELINE: returns fetch -> transform -> validate -> store chain", () => {
  const workflow = DATA_PIPELINE();

  assert.equal(workflow.name, "data-pipeline");
  assert.equal(workflow.steps.length, 4);

  assert.equal(workflow.steps[0].id, "fetch");
  assert.equal(workflow.steps[0].type, "tool");

  assert.equal(workflow.steps[1].id, "transform");
  assert.equal(workflow.steps[1].type, "tool");

  assert.equal(workflow.steps[2].id, "validate");
  assert.equal(workflow.steps[2].type, "condition");

  assert.equal(workflow.steps[3].id, "store");
  assert.equal(workflow.steps[3].type, "tool");
});

test("DATA_PIPELINE: fetch step has retryCount 2 with 5s delay", () => {
  const workflow = DATA_PIPELINE();

  const fetchStep = workflow.steps.find((s) => s.id === "fetch");
  assert.equal(fetchStep.retryCount, 2);
  assert.equal(fetchStep.retryDelay, 5000);
});

// ---- DOCS_PIPELINE ----

test("DOCS_PIPELINE: returns extract -> generate -> review -> publish chain", () => {
  const workflow = DOCS_PIPELINE();

  assert.equal(workflow.name, "docs-pipeline");
  assert.equal(workflow.steps.length, 4);

  assert.equal(workflow.steps[0].id, "extract");
  assert.equal(workflow.steps[0].type, "agent");

  assert.equal(workflow.steps[1].id, "generate");
  assert.equal(workflow.steps[1].type, "agent");

  assert.equal(workflow.steps[2].id, "review");
  assert.equal(workflow.steps[2].type, "agent");

  assert.equal(workflow.steps[3].id, "publish");
  assert.equal(workflow.steps[3].type, "tool");
});

// ---- getTemplate ----

test("getTemplate: returns a template by name", () => {
  const workflow = getTemplate("CI_CHECK");
  assert.equal(workflow.name, "ci-check");
  assert.equal(workflow.steps.length, 3);
});

test("getTemplate: throws for unknown template name", () => {
  assert.throws(() => getTemplate("NONEXISTENT"), { message: /Unknown template/ });
});

test("getTemplate: passes overrides through", () => {
  const workflow = getTemplate("DEPLOY_PIPELINE", { name: "my-deploy" });
  assert.equal(workflow.name, "my-deploy");
  assert.equal(workflow.steps.length, 4);
});

// ---- listTemplates ----

test("listTemplates: returns all 5 template names", () => {
  const names = listTemplates();

  assert.equal(names.length, 5);
  assert.ok(names.includes("CI_CHECK"));
  assert.ok(names.includes("CODE_REVIEW_PIPELINE"));
  assert.ok(names.includes("DEPLOY_PIPELINE"));
  assert.ok(names.includes("DATA_PIPELINE"));
  assert.ok(names.includes("DOCS_PIPELINE"));
});

// ---- deep merge in overrides ----

test("template overrides: deep-merges nested config objects", () => {
  const workflow = CI_CHECK({
    steps: [
      { config: { customField: "value" } },
      {},
      {},
    ],
  });

  // Original config values preserved + customField added
  const lintStep = workflow.steps[0];
  assert.equal(lintStep.config.customField, "value");
  assert.equal(lintStep.config.tool, "shell.run"); // original preserved
  assert.equal(lintStep.config.command, "npm run lint"); // original preserved
});

test("template overrides: description is carried through", () => {
  const workflow = CI_CHECK({ description: "My custom CI pipeline" });
  assert.equal(workflow.description, "My custom CI pipeline");
});
