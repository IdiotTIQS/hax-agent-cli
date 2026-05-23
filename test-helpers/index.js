/**
 * Test helpers for HaxAgent — one-stop import for all shared test utilities.
 *
 * Usage in test files:
 *   const {
 *     createMockProvider, createMockSession, createMockTool,
 *     sampleMessages, sampleToolResults, sampleConfig,
 *     assertIsError, assertValidSession, assertDeepContains,
 *     withTempDir, withTempFile, withTempSession,
 *   } = require("../test-helpers");
 */
"use strict";

const mocks = require("./mocks");
const fixtures = require("./fixtures");
const assertions = require("./assertions");
const temp = require("./temp");

module.exports = {
  // mocks
  createMockProvider: mocks.createMockProvider,
  createMockSession: mocks.createMockSession,
  createMockTool: mocks.createMockTool,
  createMockToolRegistry: mocks.createMockToolRegistry,
  createMockScreen: mocks.createMockScreen,
  createMockSettings: mocks.createMockSettings,
  createMockCostTracker: mocks.createMockCostTracker,

  // fixtures
  sampleMessages: fixtures.sampleMessages,
  sampleToolResults: fixtures.sampleToolResults,
  sampleSessionTranscript: fixtures.sampleSessionTranscript,
  sampleMemories: fixtures.sampleMemories,
  sampleAgentDefinitions: fixtures.sampleAgentDefinitions,
  sampleConfig: fixtures.sampleConfig,

  // assertions
  assertIsError: assertions.assertIsError,
  assertValidSession: assertions.assertValidSession,
  assertValidToolResult: assertions.assertValidToolResult,
  assertValidMemoryEntry: assertions.assertValidMemoryEntry,
  assertDeepContains: assertions.assertDeepContains,
  assertValidProviderResponse: assertions.assertValidProviderResponse,
  assertValidTranscriptEntry: assertions.assertValidTranscriptEntry,
  assertMockCallCount: assertions.assertMockCallCount,

  // temp
  withTempDir: temp.withTempDir,
  withTempFile: temp.withTempFile,
  withTempSession: temp.withTempSession,
  withTempEnv: temp.withTempEnv,
};
