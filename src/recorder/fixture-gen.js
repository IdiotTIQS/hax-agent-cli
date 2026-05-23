"use strict";

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SENSITIVE_KEY_PATTERNS = [
  /api[_-]?key/i,
  /token/i,
  /secret/i,
  /password/i,
  /auth/i,
  /credential/i,
  /private/i,
];

const SENSITIVE_VALUE_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g,
  /sk-ant-[a-zA-Z0-9_-]{20,}/g,
  /Bearer\s+[A-Za-z0-9._\-]+/g,
  /xox[bprs]-[A-Za-z0-9-]+/g,
  /gh[po]_[A-Za-z0-9]{36,}/g,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, // JWT
  /\b\d{13,19}\b/g, // long numeric IDs (potential credit cards / account IDs)
];

class FixtureGenerator {
  /**
   * Generate test fixtures from a recording.
   * @param {object} recording - A session recording object.
   * @param {object} [options]
   * @param {boolean} [options.anonymize=true] - Strip sensitive data.
   * @param {boolean} [options.minimize=false] - Reduce to minimal reproducible case.
   * @param {boolean} [options.generateMockResponses=true] - Extract mock responses.
   * @param {string} [options.scenarioName] - Name for the scenario.
   */
  generateFromRecording(recording, options = {}) {
    if (!recording || !Array.isArray(recording.events)) {
      throw new Error('Invalid recording: must have an events array.');
    }

    const shouldAnonymize = options.anonymize !== false;
    const shouldMinimize = options.minimize === true;
    const shouldGenerateMocks = options.generateMockResponses !== false;

    let working = recording;

    if (shouldAnonymize) {
      working = this.anonymize(working);
    }
    if (shouldMinimize) {
      working = this.minimize(working);
    }

    const scenarios = this.extractScenarios(working);

    const testCode = scenarios.map((scenario, idx) => {
      const testName = scenario.name || `test_scenario_${idx + 1}`;
      return this.toTestCode({ ...scenario, name: testName });
    }).join('\n\n');

    const result = {
      fixtureName: options.scenarioName || 'generated_fixture',
      scenarios,
      testCode,
      recording: working,
    };

    if (shouldGenerateMocks) {
      result.mockResponses = this.generateMockResponses(working);
    }

    return result;
  }

  /**
   * Strip sensitive data from a recording.
   * @param {object} recording
   * @returns {object} Anonymized recording.
   */
  anonymize(recording) {
    const copy = JSON.parse(JSON.stringify(recording));

    copy.metadata = this._anonymizeObject(copy.metadata, 'metadata');
    copy.events = copy.events.map((event) => this._anonymizeEvent(event));

    return copy;
  }

  /**
   * Reduce a recording to a minimal reproducible case.
   * Keeps the first user message, the first assistant response that triggers tools,
   * and any error events. Removes redundant rounds.
   * @param {object} recording
   * @returns {object} Minimized recording.
   */
  minimize(recording) {
    const events = [...recording.events];

    if (events.length === 0) {
      return { ...recording, events: [] };
    }

    const kept = [];
    let userCount = 0;
    let toolCallCount = 0;
    let hasError = false;
    const maxTurns = 3;

    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      // Always keep the first user message
      if (event.type === 'user_message' && userCount === 0) {
        kept.push(events[i]);
        userCount += 1;
        continue;
      }

      // Keep first assistant response
      if (event.type === 'assistant_response' && kept.length <= 3) {
        kept.push(event);
        continue;
      }

      // Keep tool calls and results (up to a limit)
      if ((event.type === 'tool_call' || event.type === 'tool_result') && toolCallCount < 6) {
        kept.push(event);
        if (event.type === 'tool_call') toolCallCount += 1;
        continue;
      }

      // Keep error events
      if (event.type === 'error') {
        kept.push(event);
        hasError = true;
        continue;
      }

      // Restrict to max user turns for minimization
      if (event.type === 'user_message' && userCount < maxTurns) {
        kept.push(event);
        userCount += 1;
      }
    }

    return { ...recording, events: kept };
  }

  /**
   * Extract distinct test scenarios from a recording.
   * Groups events into scenarios: each user_message starts a new scenario.
   * @param {object} recording
   * @returns {object[]} Array of scenario objects.
   */
  extractScenarios(recording) {
    const events = recording.events || [];
    const scenarios = [];
    let currentScenario = null;

    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      if (event.type === 'user_message') {
        if (currentScenario) {
          scenarios.push(currentScenario);
        }

        const userIndex = scenarios.length + 1;
        currentScenario = {
          name: `user_message_${userIndex}`,
          userMessage: this._truncateText(String(event.data?.content || event.data || ''), 80),
          events: [event],
        };
      } else if (currentScenario) {
        currentScenario.events.push(event);
      } else {
        // Events before any user message go into a "preamble" scenario
        currentScenario = {
          name: 'session_preamble',
          userMessage: '(no user message)',
          events: [event],
        };
      }
    }

    if (currentScenario) {
      scenarios.push(currentScenario);
    }

    return scenarios;
  }

  /**
   * Generate Node.js test code from a fixture scenario.
   * @param {object} fixture - A scenario with name, userMessage, events.
   * @returns {string} Generated test code.
   */
  toTestCode(fixture) {
    const sanitizedName = String(fixture.name || 'test_case')
      .replace(/[^a-zA-Z0-9_]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 100);

    const lines = [];
    lines.push(`test("${sanitizedName}", async (t) => {"`);
    lines.push(`  // Scenario from recording: ${fixture.userMessage || 'N/A'}`);
    lines.push('');

    let userMessageCount = 0;
    let toolCallCount = 0;

    for (const event of (fixture.events || [])) {
      switch (event.type) {
        case 'user_message': {
          userMessageCount += 1;
          const content = this._serializeValue(event.data?.content || event.data || '');
          lines.push(`  // User message`);
          lines.push(`  const userMsg${userMessageCount} = ${content};`);
          break;
        }
        case 'assistant_response': {
          const content = this._serializeValue(event.data?.content || event.data || '');
          lines.push(`  // Expected assistant response`);
          lines.push(`  const expectedResponse = ${content};`);
          break;
        }
        case 'tool_call': {
          toolCallCount += 1;
          const toolName = String(event.data?.name || event.data?.tool || 'unknown_tool');
          const toolArgs = this._serializeValue(event.data?.arguments || event.data?.args || {});
          lines.push(`  // Expected tool call: ${toolName}`);
          lines.push(`  t.mock.method(tools, "${toolName}", () => ({ result: "ok" }));`);
          break;
        }
        case 'tool_result': {
          const result = this._serializeValue(event.data || {});
          lines.push(`  // Tool result`);
          lines.push(`  const toolResult = ${result};`);
          break;
        }
        case 'error': {
          const errMsg = this._serializeValue(event.data?.message || event.data || '');
          lines.push(`  // Error event`);
          lines.push(`  const expectedError = ${errMsg};`);
          break;
        }
        case 'state_change': {
          const state = this._serializeValue(event.data || {});
          lines.push(`  // State change`);
          lines.push(`  const stateChange = ${state};`);
          break;
        }
      }
    }

    lines.push('');
    lines.push('  // Assertions based on recording');
    lines.push(`  assert.ok(true, "Fixture assertions go here");`);
    lines.push('});');

    return lines.join('\n');
  }

  /**
   * Extract mock provider responses from a recording.
   * @param {object} recording
   * @returns {object[]} Array of mock response objects.
   */
  generateMockResponses(recording) {
    const events = recording.events || [];
    const mocks = [];

    for (const event of events) {
      if (event.type !== 'assistant_response') continue;

      const mock = {
        timestamp: event.timestamp,
        type: 'assistant_response',
        model: recording.metadata?.model || 'unknown',
        stopReason: event.data?.stop_reason || event.data?.stopReason || null,
      };

      if (event.data?.content) {
        mock.content = event.data.content;
      }
      if (event.data?.usage) {
        mock.usage = event.data.usage;
      }
      if (event.data?.tool_use || event.data?.toolUse) {
        mock.toolCalls = event.data.tool_use || event.data.toolUse;
      }

      mocks.push(mock);
    }

    return mocks;
  }

  /**
   * Save generated fixture to a file.
   * @param {object} result - The result from generateFromRecording().
   * @param {string} outputDir - Directory to write fixture files into.
   */
  saveFixture(result, outputDir) {
    const resolvedDir = path.resolve(outputDir);
    fs.mkdirSync(resolvedDir, { recursive: true });

    const baseName = String(result.fixtureName || 'fixture')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^_|_$/g, '');

    // Write the recording JSON
    const jsonPath = path.join(resolvedDir, `${baseName}.json`);
    const jsonContent = {
      fixtureName: result.fixtureName,
      scenarios: result.scenarios,
      mockResponses: result.mockResponses,
      recording: result.recording,
    };
    fs.writeFileSync(jsonPath, JSON.stringify(jsonContent, null, 2), 'utf8');

    // Write the test code
    const testPath = path.join(resolvedDir, `${baseName}.generated.test.js`);
    const testHeader = [
      '// Generated fixture test from session recording',
      `// Fixture: ${result.fixtureName}`,
      `// Generated at: ${new Date().toISOString()}`,
      '',
      '"use strict";',
      '',
      'const assert = require("node:assert/strict");',
      'const test = require("node:test");',
      '',
    ].join('\n');
    fs.writeFileSync(testPath, testHeader + '\n' + result.testCode + '\n', 'utf8');

    return {
      jsonPath: path.resolve(jsonPath),
      testPath: path.resolve(testPath),
    };
  }

  // ---- private helpers ----

  _anonymizeEvent(event) {
    const copy = { ...event };

    if (copy.data && typeof copy.data === 'object') {
      copy.data = this._anonymizeObject(copy.data, `event.${event.type}`);
    } else if (typeof copy.data === 'string') {
      copy.data = this._anonymizeString(copy.data);
    }

    if (copy.context && typeof copy.context === 'object') {
      copy.context = this._anonymizeObject(copy.context, 'context');
    }

    return copy;
  }

  _anonymizeObject(obj, label) {
    if (!obj || typeof obj !== 'object') return obj;

    const result = Array.isArray(obj) ? [...obj] : { ...obj };
    const keys = typeof result === 'object' && !Array.isArray(result) ? Object.keys(result) : [];

    for (const key of keys) {
      if (SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
        result[key] = '[REDACTED]';
      } else if (typeof result[key] === 'string') {
        result[key] = this._anonymizeString(result[key]);
      } else if (result[key] && typeof result[key] === 'object') {
        result[key] = this._anonymizeObject(result[key], `${label}.${key}`);
      }
    }

    return result;
  }

  _anonymizeString(str) {
    let result = str;

    for (const pattern of SENSITIVE_VALUE_PATTERNS) {
      result = result.replace(pattern, '[REDACTED]');
    }

    // Replace email addresses
    result = result.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, 'user@example.com');

    // Replace common name-like patterns (very basic)
    result = result.replace(/(?:\\b[A-Z][a-z]+\\s+[A-Z][a-z]+\\b)/g, (match) => {
      if (match.length > 30) return match;
      return 'John Doe';
    });

    return result;
  }

  _truncateText(text, maxLen) {
    const s = String(text);
    return s.length <= maxLen ? s : s.slice(0, maxLen - 3) + '...';
  }

  _serializeValue(value) {
    if (value === undefined || value === null) {
      return 'null';
    }
    if (typeof value === 'string') {
      // Escape backticks and template expressions
      const escaped = value.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
      return '`' + escaped + '`';
    }
    return JSON.stringify(value, null, 2);
  }
}

module.exports = {
  FixtureGenerator,
  SENSITIVE_KEY_PATTERNS,
  SENSITIVE_VALUE_PATTERNS,
};
