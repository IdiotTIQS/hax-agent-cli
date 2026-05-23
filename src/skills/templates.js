"use strict";

/**
 * Skill templates for common tasks.
 *
 * Each template provides a ready-to-use SKILL.md scaffold that users can
 * instantiate, customise, and install via the SkillRegistry.
 *
 * Template structure:
 *   - name:            unique template identifier
 *   - title:           human-readable title
 *   - description:     1-line description (English)
 *   - descriptionZh:   1-line description (Simplified Chinese)
 *   - arguments:       array of argument name strings
 *   - systemPrompt:    the full SKILL.md body (without frontmatter delimiters)
 *   - recommendedTools array of tool permission patterns
 */

const TEMPLATES = {};

// ---------------------------------------------------------------------------
// Template: code-review
// ---------------------------------------------------------------------------
TEMPLATES['code-review'] = {
  name: 'code-review',
  title: 'Code Review',
  description: 'Review code changes for bugs, style issues, and security vulnerabilities',
  descriptionZh: '审查代码变更，检查错误、代码风格问题和安全漏洞',
  arguments: ['targetFiles', 'focusAreas'],
  recommendedTools: ['file.read', 'file.glob', 'file.search', 'shell.run'],
  systemPrompt: `# Code Review

Perform a thorough code review on the specified files or directories.

## Inputs
- \`$targetFiles\`: Files or directories to review (comma-separated paths).
- \`$focusAreas\`: Optional comma-separated focus areas: bugs, security, style, perf, maintainability.

## Goal
Identify defects, anti-patterns, and improvement opportunities. Provide actionable feedback ranked by severity.

## Steps

### 1. Discover files to review
Read \`$targetFiles\` and expand globs/directories. List every file that will be reviewed.
**Success criteria**: Complete, deduplicated file list presented to the user.

### 2. Read each file
Read the full content of every file in the list. Note the line numbers.
**Success criteria**: All files read successfully; no read errors.

### 3. Analyse for issues
For each file, check against the focus areas \`$focusAreas\`:
- **Bugs**: null-pointer risks, incorrect conditions, edge cases, race conditions.
- **Security**: injection vectors, missing sanitisation, exposed secrets, unsafe eval.
- **Style**: inconsistent naming, formatting violations, unclear variable names.
- **Perf**: unnecessary allocations, N+1 queries, blocking I/O, large payloads.
- **Maintainability**: magic numbers, dead code, excessive nesting, missing comments.

**Success criteria**: At least one finding per focus area or explicit "none found".

### 4. Report findings
Output a structured report:
- Severity (Critical / High / Medium / Low / Info)
- File + line number
- Description of the issue
- Suggested fix (code diff when possible)

**Success criteria**: Report is clear, actionable, and covers all focus areas.`,
};

// ---------------------------------------------------------------------------
// Template: refactor
// ---------------------------------------------------------------------------
TEMPLATES.refactor = {
  name: 'refactor',
  title: 'Refactor Code',
  description: 'Analyse code and propose refactoring to improve structure and readability',
  descriptionZh: '分析代码并提出重构建议，改进代码结构和可读性',
  arguments: ['targetFiles', 'goal'],
  recommendedTools: ['file.read', 'file.write', 'file.glob', 'file.search', 'shell.run'],
  systemPrompt: `# Refactor

Analyse the specified code and propose concrete refactoring changes.

## Inputs
- \`$targetFiles\`: Files or directories to refactor.
- \`$goal\`: Refactoring goal: reduce-complexity, extract-methods, improve-naming, split-module, or general.

## Goal
Improve code structure, readability, and maintainability without changing external behaviour.

## Steps

### 1. Understand the current code
Read \`$targetFiles\` thoroughly. Map dependencies, call graphs, and data flow.
**Success criteria**: You can explain the code's purpose and architecture to a colleague.

### 2. Identify refactoring targets
Based on \`$goal\`, find specific code sections that would benefit from refactoring:
- **reduce-complexity**: cyclomatic complexity > 10, deep nesting, long functions.
- **extract-methods**: code duplication, large blocks with single responsibility.
- **improve-naming**: ambiguous variable/function names.
- **split-module**: files > 500 lines, mixed concerns.

**Success criteria**: Ranked list of refactoring targets with justification.

### 3. Propose changes
For each target, describe:
- What to change (before/after).
- Why this improves the code.
- Risk assessment (safe / moderate / risky — safe with tests).

**Success criteria**: Each proposal is concrete enough to implement immediately.

### 4. Apply changes (optional)
If the user confirms, apply the refactoring and run any available tests to verify.
**Success criteria**: Tests pass; no behavioural regressions.`,
};

// ---------------------------------------------------------------------------
// Template: write-tests
// ---------------------------------------------------------------------------
TEMPLATES['write-tests'] = {
  name: 'write-tests',
  title: 'Write Tests',
  description: 'Generate test cases for code modules or functions',
  descriptionZh: '为代码模块或函数生成测试用例',
  arguments: ['targetFiles', 'testFramework'],
  recommendedTools: ['file.read', 'file.write', 'file.glob', 'file.search', 'shell.run'],
  systemPrompt: `# Write Tests

Generate comprehensive test cases for the specified code.

## Inputs
- \`$targetFiles\`: Files or modules to test.
- \`$testFramework\`: Target framework (jest, mocha, node-test, vitest — default: node-test).

## Goal
Produce a test file with high coverage covering happy paths, edge cases, error conditions, and boundary values.

## Steps

### 1. Analyse the source
Read \`$targetFiles\` and identify every exported function, class, and method.
**Success criteria**: Complete inventory of testable units.

### 2. Design test cases
For each unit, enumerate:
- **Happy path**: normal inputs, expected outputs.
- **Edge cases**: empty inputs, zero values, null/undefined.
- **Error cases**: invalid inputs, exceptions thrown.
- **Boundary values**: min/max ranges, off-by-one.

**Success criteria**: At least 3 test cases per unit; all behaviours covered.

### 3. Write the test file
Create or update the test file using \`$testFramework\` conventions:
- \`describe\` blocks for grouping.
- \`it\` / \`test\` blocks for individual cases.
- Arrange-Act-Assert structure.
- Setup/teardown for shared state.

**Success criteria**: File compiles/parses without syntax errors.

### 4. Run and verify
Execute the tests and report pass/fail. Fix any failing tests.
**Success criteria**: All tests pass; coverage meets project standards.`,
};

// ---------------------------------------------------------------------------
// Template: explain-code
// ---------------------------------------------------------------------------
TEMPLATES['explain-code'] = {
  name: 'explain-code',
  title: 'Explain Code',
  description: 'Explain how a piece of code works in clear, educational terms',
  descriptionZh: '用清晰易懂的方式解释代码的工作原理',
  arguments: ['targetFiles', 'audience'],
  recommendedTools: ['file.read', 'file.glob', 'file.search'],
  systemPrompt: `# Explain Code

Provide a clear, educational explanation of the specified code.

## Inputs
- \`$targetFiles\`: Files or code sections to explain.
- \`$audience\`: Target audience: beginner, intermediate, expert (default: intermediate).

## Goal
Help the user understand what the code does, how it works, and why it is structured as it is.

## Steps

### 1. Read and comprehend
Read \`$targetFiles\` thoroughly. Trace the execution flow.
**Success criteria**: You can summarise the code's purpose in one sentence.

### 2. Structure the explanation
Organise the explanation for \`$audience\`:
- **beginner**: Start with high-level purpose, avoid jargon, use analogies.
- **intermediate**: Explain patterns used, trade-offs, data flow.
- **expert**: Discuss architectural decisions, edge cases, performance characteristics.

**Success criteria**: The explanation is self-contained; no prior knowledge assumed beyond the audience level.

### 3. Walk through key sections
For each major section of the code:
- What it does.
- Why it exists.
- How it connects to other parts.

**Success criteria**: Each section explained in 1-3 paragraphs with code references.

### 4. Summarise
Provide a concise takeaway: architecture, key patterns, and notable design choices.
**Success criteria**: Reader can explain the code to someone else after reading.`,
};

// ---------------------------------------------------------------------------
// Template: debug-error
// ---------------------------------------------------------------------------
TEMPLATES['debug-error'] = {
  name: 'debug-error',
  title: 'Debug Error',
  description: 'Investigate and fix an error or bug report',
  descriptionZh: '调查并修复错误或缺陷报告',
  arguments: ['errorDescription', 'contextFiles'],
  recommendedTools: [
    'file.read',
    'file.glob',
    'file.search',
    'shell.run',
    'file.write',
  ],
  systemPrompt: `# Debug Error

Investigate an error or bug and propose a fix.

## Inputs
- \`$errorDescription\`: Error message, stack trace, or behaviour description.
- \`$contextFiles\`: Optional files or directories that may be relevant.

## Goal
Identify the root cause of the error and implement or propose a correct fix.

## Steps

### 1. Reproduce the error
Understand the error context from \`$errorDescription\`. If \`$contextFiles\` are provided, read them.
**Success criteria**: You can articulate what happens and what should happen instead.

### 2. Trace to root cause
Work backwards from the error:
- Read the code at the error location.
- Trace variable values, callers, and execution conditions.
- Identify the minimal condition that triggers the bug.

**Success criteria**: You have identified the exact line(s) and conditions causing the error.

### 3. Develop a fix
Propose a fix that:
- Corrects the root cause, not just the symptom.
- Does not introduce new issues.
- Is minimal and focused.

**Success criteria**: The fix resolves the error for all known trigger conditions.

### 4. Verify the fix
If possible, apply the fix and re-run the failing scenario. Confirm the error no longer occurs.
**Success criteria**: Error is gone; no regressions.`,
};

// ---------------------------------------------------------------------------
// Template: write-docs
// ---------------------------------------------------------------------------
TEMPLATES['write-docs'] = {
  name: 'write-docs',
  title: 'Write Documentation',
  description: 'Document a module, function, or API',
  descriptionZh: '为模块、函数或 API 编写文档',
  arguments: ['targetFiles', 'docFormat'],
  recommendedTools: ['file.read', 'file.write', 'file.glob', 'file.search'],
  systemPrompt: `# Write Documentation

Generate clear, comprehensive documentation for the specified code.

## Inputs
- \`$targetFiles\`: Files or modules to document.
- \`$docFormat\`: Output format: markdown, jsdoc, or readme (default: markdown).

## Goal
Produce developer-facing documentation that covers purpose, usage, API surface, and examples.

## Steps

### 1. Understand the code
Read \`$targetFiles\` and map all public APIs: exports, classes, functions, types.
**Success criteria**: Complete API inventory with parameter and return types.

### 2. Write the overview
A 2-4 paragraph introduction covering:
- What the module does.
- When to use it.
- Key concepts and terminology.

**Success criteria**: A new team member can decide if this module fits their need.

### 3. Document the API surface
For each public item:
- Name and signature.
- Description of behaviour.
- Parameter table (name, type, required, description).
- Return value (type, description).
- Throws (error types and conditions).
- Usage example(s).

**Success criteria**: Every public export is documented with at least one example.

### 4. Add integration notes
Include:
- Dependencies.
- Configuration requirements.
- Known limitations or edge cases.

**Success criteria**: Documentation is sufficient for a new developer to integrate the module.`,
};

// ---------------------------------------------------------------------------
// Template: optimize-perf
// ---------------------------------------------------------------------------
TEMPLATES['optimize-perf'] = {
  name: 'optimize-perf',
  title: 'Optimize Performance',
  description: 'Find and fix performance bottlenecks in code',
  descriptionZh: '查找并修复代码中的性能瓶颈',
  arguments: ['targetFiles', 'perfGoal'],
  recommendedTools: [
    'file.read',
    'file.glob',
    'file.search',
    'shell.run',
    'file.write',
  ],
  systemPrompt: `# Optimize Performance

Profile and optimise the specified code for better performance.

## Inputs
- \`$targetFiles\`: Files or modules to optimise.
- \`$perfGoal\`: Optimisation goal: speed, memory, or I/O (default: speed).

## Goal
Identify performance bottlenecks and implement targeted optimisations.

## Steps

### 1. Profile the code
Read \`$targetFiles\` and identify potential hotspots:
- Loops with high iteration counts.
- Recursive functions without memoisation.
- Repeated I/O or network calls.
- Large object allocations in hot paths.
- Synchronous blocking operations.

**Success criteria**: Ranked list of hotspots with estimated impact.

### 2. Measure baseline (if possible)
Run the code or relevant benchmarks. Record baseline metrics (time, memory, throughput).
**Success criteria**: Quantifiable baseline to compare against.

### 3. Apply optimisations
For each hotspot, apply relevant techniques:
- **Speed**: caching, memoisation, early exits, better data structures.
- **Memory**: object pooling, streaming, lazy loading, reducing copies.
- **I/O**: batching, parallelism, connection reuse, streaming.

**Success criteria**: Each optimisation is measurable and does not degrade correctness.

### 4. Validate and report
Re-run benchmarks and compare against baseline. Report improvement per hotspot.
**Success criteria**: Documented improvements; no correctness regressions.`,
};

// ---------------------------------------------------------------------------
// Template: generate-cli
// ---------------------------------------------------------------------------
TEMPLATES['generate-cli'] = {
  name: 'generate-cli',
  title: 'Generate CLI',
  description: 'Generate a CLI interface for a module or script',
  descriptionZh: '为模块或脚本生成命令行接口',
  arguments: ['targetFiles', 'cliFramework'],
  recommendedTools: ['file.read', 'file.write', 'file.glob', 'file.search', 'shell.run'],
  systemPrompt: `# Generate CLI

Create a command-line interface wrapper for the specified module or script.

## Inputs
- \`$targetFiles\`: Files or modules to expose via CLI.
- \`$cliFramework\`: CLI framework preference: commander, yargs, or none (default: none — uses Node.js built-in process.argv).

## Goal
Produce a CLI entrypoint that exposes the module's functionality as shell commands with argument parsing, help text, and error handling.

## Steps

### 1. Analyse the module's API
Read \`$targetFiles\` and identify every function or action suitable for CLI exposure.
**Success criteria**: Complete list of CLI commands with argument mappings.

### 2. Design the CLI interface
Define:
- Command names and aliases.
- Required and optional arguments.
- Flags and options.
- Help text for each command.

**Success criteria**: The interface is discoverable (--help) and consistent.

### 3. Implement the CLI
Create a new file (or update an existing entrypoint) that:
- Parses command-line arguments.
- Validates inputs.
- Calls the underlying module functions.
- Formats and prints output (JSON, table, or plain text).
- Handles errors gracefully with exit codes.

**Success criteria**: The CLI can be invoked and produces correct output.

### 4. Add usage documentation
Include:
- Installation instructions.
- Usage examples for each command.
- Exit codes reference.

**Success criteria**: A first-time user can install and run a command in under 2 minutes.`,
};

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/**
 * List all available template names.
 * @returns {string[]}
 */
function listTemplateNames() {
  return Object.keys(TEMPLATES);
}

/**
 * Get a template by name.
 * @param {string} name - Template identifier.
 * @returns {object|null} The template object, or null if not found.
 */
function getTemplate(name) {
  return TEMPLATES[name] || null;
}

/**
 * Generate a SKILL.md content string from a template, with optional overrides.
 *
 * @param {string} templateName - Template identifier.
 * @param {object} [overrides={}] - Fields to override in the generated output.
 *   Supported: title, description, arguments, recommendedTools.
 * @returns {string|null} Full SKILL.md content with frontmatter, or null if template not found.
 */
function generateSkillMarkdown(templateName, overrides = {}) {
  const template = getTemplate(templateName);
  if (!template) return null;

  const title = overrides.title || template.title;
  const description = overrides.description || template.description;
  const args = overrides.arguments || template.arguments;
  const tools = overrides.recommendedTools || template.recommendedTools;

  const argsYaml = args && args.length > 0
    ? args.map((a) => `  - ${a}`).join('\n')
    : '';

  const toolsYaml = tools && tools.length > 0
    ? tools.map((t) => `  - ${t}`).join('\n')
    : '';

  const frontmatter = [
    '---',
    `name: ${templateName}`,
    `description: ${description}`,
    toolsYaml ? 'allowed-tools:' : '',
    toolsYaml,
    argsYaml ? 'arguments:' : '',
    argsYaml,
    `when_to_use: Use when the user wants to ${description.toLowerCase()}`,
    '---',
  ]
    .filter((line) => line !== '')
    .join('\n');

  // Replace the H1 heading in systemPrompt with the overridden title
  const body = template.systemPrompt.replace(
    /^# .+/m,
    `# ${title}`
  );

  return `${frontmatter}\n\n${body}\n`;
}

/**
 * Search templates by keyword (matches name, title, or description).
 * @param {string} query - Search query.
 * @returns {Array<object>} Matching template names with descriptions.
 */
function searchTemplates(query) {
  if (!query || query.trim().length === 0) {
    return listTemplateNames().map((name) => ({
      name,
      title: TEMPLATES[name].title,
      description: TEMPLATES[name].description,
      descriptionZh: TEMPLATES[name].descriptionZh,
    }));
  }

  const q = query.toLowerCase();
  const results = [];

  for (const [name, template] of Object.entries(TEMPLATES)) {
    if (
      name.toLowerCase().includes(q) ||
      template.title.toLowerCase().includes(q) ||
      template.description.toLowerCase().includes(q) ||
      template.descriptionZh.includes(q)
    ) {
      results.push({
        name,
        title: template.title,
        description: template.description,
        descriptionZh: template.descriptionZh,
      });
    }
  }

  return results;
}

module.exports = {
  TEMPLATES,
  listTemplateNames,
  getTemplate,
  generateSkillMarkdown,
  searchTemplates,
};
