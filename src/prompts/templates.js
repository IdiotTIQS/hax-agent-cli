"use strict";

/**
 * Prompt template library for common AI-assisted development tasks.
 *
 * Each template is a function (context) => string that takes optional
 * context and returns a formatted system prompt ready for LLM consumption.
 *
 * Context is an optional object that may include:
 *   { language, framework, focus, files, severity, constraints, code, ... }
 *
 * Templates are designed to be composable with builder.js layers.
 */

/**
 * CODE_REVIEW — Thorough code review with severity classification.
 *
 * Produces a structured review covering correctness, style, security,
 * performance, and maintainability. Issues are classified by severity.
 */
function CODE_REVIEW(context = {}) {
  const files = Array.isArray(context.files) ? context.files.join(', ') : (context.files || 'the provided code');
  const focus = context.focus ? `\nFocus areas specified by the reviewer: ${context.focus}` : '';
  const language = context.language ? `\nPrimary language(s): ${context.language}` : '';

  return [
    '# Task: Comprehensive Code Review',
    '',
    'You are conducting a thorough code review. Your goal is to identify issues that could cause bugs, security vulnerabilities, performance degradation, or maintenance challenges.',
    '',
    `## Files Under Review: ${files}${language}${focus}`,
    '',
    '## Review Dimensions',
    '',
    '### 1. Correctness',
    '- Does the code behave as intended?',
    '- Are edge cases handled (null, undefined, empty arrays, boundary values)?',
    '- Are async operations properly awaited and errors caught?',
    '- Is the control flow correct for all branches?',
    '',
    '### 2. Security',
    '- Are there any injection risks (SQL, command, template, prototype pollution)?',
    '- Are secrets, API keys, or credentials exposed in code or logs?',
    '- Is user input validated and sanitized before use?',
    '- Are permissions and authorization checks correctly placed?',
    '- Are dependencies sourced from trusted origins and pinned to safe versions?',
    '',
    '### 3. Performance',
    '- Are there unnecessary allocations, deep copies, or large object creations in hot paths?',
    '- Are loops, recursions, and database queries bounded?',
    '- Is caching used where appropriate?',
    '- Are async operations parallelized where possible?',
    '',
    '### 4. Maintainability',
    '- Is the code readable and well-structured?',
    '- Are functions focused and single-purpose?',
    '- Are names descriptive and consistent with project conventions?',
    '- Is there dead code, commented-out blocks, or TODO markers without context?',
    '- Are magic numbers extracted to named constants?',
    '',
    '### 5. Style & Convention',
    '- Does the code follow the existing project style?',
    '- Are indentation, naming, and formatting consistent?',
    '- Is error handling consistent across the codebase?',
    '',
    '## Severity Classification',
    'Classify each finding as one of:',
    '- **BLOCKER**: Must fix before merge (crashes, data loss, security holes)',
    '- **HIGH**: Should fix before merge (likely bugs, significant perf issues)',
    '- **MEDIUM**: Should fix soon (code smells, maintainability concerns)',
    '- **LOW**: Nice to fix (style nits, minor improvements)',
    '',
    '## Output Format',
    'Provide your review as structured feedback:',
    '1. **Summary** — 2-3 sentence overview of code quality',
    '2. **Findings** — Each finding with: severity, file:line, description, recommendation',
    '3. **Risk Assessment** — What is the risk of merging as-is?',
    '4. **Positive Observations** — What was done well?',
  ].join('\n');
}

/**
 * REFACTOR_PLAN — Analyze code and propose a concrete refactoring plan.
 *
 * Produces a step-by-step refactoring sequence with risk mitigation
 * and a rollback strategy.
 */
function REFACTOR_PLAN(context = {}) {
  const target = context.target || 'the specified code';
  const goals = context.goals || 'improve readability, reduce complexity, and enhance testability';
  const constraints = context.constraints
    ? `\nAdditional constraints: ${context.constraints}`
    : '\nConstraints: Preserve all existing behavior and public APIs. No breaking changes.';

  return [
    '# Task: Refactoring Plan',
    '',
    `You are analyzing "${target}" to produce a concrete refactoring plan.`,
    '',
    `## Refactoring Goals: ${goals}${constraints}`,
    '',
    '## Analysis Steps',
    '1. **Current State Assessment** — Identify pain points:',
    '   - Functions or modules that are too large or do too much',
    '   - Tight coupling between unrelated concerns',
    '   - Duplicated logic across files',
    '   - Hard-coded values that should be configurable',
    '   - Complex conditionals that could be simplified',
    '   - Missing abstractions or excessive indirection',
    '',
    '2. **Dependency Mapping** — Trace dependencies:',
    '   - What imports this module? What does it import?',
    '   - Which tests cover it and at what level (unit, integration, e2e)?',
    '   - Are there circular dependencies or hidden coupling?',
    '',
    '3. **Refactoring Sequence** — Propose ordered, incremental steps:',
    '   - Each step should be small, safe, and independently testable',
    '   - Start with extracting pure functions, reducing side effects',
    '   - Proceed to restructuring modules and improving interfaces',
    '   - End with renaming, style normalization, and documentation',
    '',
    '4. **Risk Mitigation** — For each step:',
    '   - What could go wrong? How to detect it?',
    '   - Which tests must pass before proceeding?',
    '   - What is the rollback strategy if something breaks?',
    '',
    '## Output Format',
    'Provide a structured refactoring plan:',
    '1. **Current State Summary** — Key problems identified',
    '2. **Step-by-Step Plan** — Ordered list of refactoring steps, each with:',
    '   - Description of the change',
    '   - Files affected',
    '   - Risk level (low/medium/high)',
    '   - Validation method (which tests to run)',
    '3. **Rollback Strategy** — How to undo if issues arise',
    '4. **Estimated Effort** — Rough complexity per step',
  ].join('\n');
}

/**
 * BUG_INVESTIGATION — Systematic guide for investigating and diagnosing bugs.
 *
 * Walks through hypothesis formation, evidence gathering, root cause
 * isolation, and fix recommendation.
 */
function BUG_INVESTIGATION(context = {}) {
  const symptoms = context.symptoms || 'described in the issue';
  const environment = context.environment
    ? `\nEnvironment: ${context.environment}`
    : '';
  const reproduction = context.reproduction
    ? `\nReproduction steps: ${context.reproduction}`
    : '';

  return [
    '# Task: Bug Investigation',
    '',
    'You are investigating a software bug using a systematic, evidence-driven approach.',
    '',
    `## Reported Symptoms: ${symptoms}${environment}${reproduction}`,
    '',
    '## Investigation Protocol',
    '',
    '### Phase 1: Information Gathering',
    '- Read the relevant source files to understand the code path',
    '- Check recent git history for related changes (`git log -- <files>`)',
    '- Review any error logs, stack traces, or console output',
    '- Identify the exact conditions that trigger the bug',
    '',
    '### Phase 2: Hypothesis Formation',
    '- Form 2-3 specific hypotheses about the root cause',
    '- Rank hypotheses by likelihood based on the evidence',
    '- For each hypothesis, describe what would confirm or rule it out',
    '',
    '### Phase 3: Evidence Collection',
    '- Add targeted logging or assertions to test hypotheses',
    '- Trace the data flow through the suspected code path',
    '- Check boundary conditions: null, zero, empty, max values',
    '- Verify assumptions about external dependencies (API calls, file I/O, DB queries)',
    '',
    '### Phase 4: Root Cause Isolation',
    '- Narrow down to the exact line or condition causing the issue',
    '- Explain the mechanism: what input triggers what behavior and why',
    '- Confirm the fix would not introduce regressions',
    '',
    '### Phase 5: Fix Recommendation',
    '- Propose the minimal code change to fix the root cause',
    '- Describe tests that should be added to prevent recurrence',
    '- Note any related issues that might have the same root cause',
    '',
    '## Output Format',
    '1. **Evidence Summary** — Key facts gathered',
    '2. **Hypotheses** — Ranked with confirm/disconfirm criteria',
    '3. **Root Cause** — Exact line or condition with explanation',
    '4. **Recommended Fix** — Minimal code change with justification',
    '5. **Prevention** — Tests and safeguards to add',
  ].join('\n');
}

/**
 * TEST_GENERATION — Generate comprehensive test cases for code.
 *
 * Covers unit, integration, edge case, error path, and property-based
 * test generation strategies.
 */
function TEST_GENERATION(context = {}) {
  const target = context.target || 'the provided code';
  const framework = context.framework ? `\nTest framework to use: ${context.framework}` : '';
  const coverage = context.coverage
    ? `\nTarget coverage goals: ${context.coverage}`
    : '\nTarget coverage goals: all public APIs, all error paths, key edge cases';

  return [
    '# Task: Generate Comprehensive Tests',
    '',
    `You are generating tests for "${target}".`,
    `${framework}${coverage}`,
    '',
    '## Test Design Principles',
    '- Tests should be deterministic, isolated, and fast',
    '- Each test should verify one behavior or condition',
    '- Use descriptive test names that explain the scenario and expected outcome',
    '- Avoid testing implementation details; test behavior through public interfaces',
    '- Mock external dependencies (network, filesystem, database) to keep tests fast and reliable',
    '',
    '## Test Categories to Cover',
    '',
    '### 1. Happy Path Tests',
    '- Normal inputs produce expected outputs',
    '- Common usage patterns work end-to-end',
    '',
    '### 2. Edge Case Tests',
    '- Empty inputs (null, undefined, empty string, empty array, zero)',
    '- Boundary values (min, max, just above max, just below min)',
    '- Very large inputs (large arrays, long strings, deep objects)',
    '- Unicode, special characters, and international text',
    '- Negative numbers, NaN, Infinity',
    '- Concurrent or repeated calls',
    '',
    '### 3. Error Path Tests',
    '- Invalid inputs are rejected with clear errors',
    '- External failures are handled gracefully (network errors, file not found, permission denied)',
    '- Timeout scenarios',
    '- Race conditions and async error propagation',
    '',
    '### 4. Integration Tests',
    '- Interactions between multiple modules work correctly',
    '- Data flows correctly through the full pipeline',
    '- Configuration and environment changes are handled',
    '',
    '### 5. Regression Tests',
    '- Previously fixed bugs do not reappear',
    '- Refactoring does not change observable behavior',
    '',
    '## Output Format',
    'Provide a structured test plan:',
    '1. **Test Structure** — How tests are organized (describe/it blocks, fixtures, helpers)',
    '2. **Test Cases** — For each category, list specific test cases with:',
    '   - Test name / description',
    '   - Input setup',
    '   - Expected behavior or output',
    '   - Category (happy path, edge case, error, integration, regression)',
    '3. **Mocks & Fixtures** — What needs to be mocked or pre-configured',
    '4. **Edge Cases Checklist** — Exhaustive list of edge conditions to verify',
  ].join('\n');
}

/**
 * DOCUMENTATION — Generate clear, user-focused documentation from code.
 *
 * Produces API docs, usage guides, examples, and troubleshooting
 * information.
 */
function DOCUMENTATION(context = {}) {
  const target = context.target || 'the provided code';
  const audience = context.audience || 'developers';
  const format = context.format || 'markdown';
  const scope = context.scope
    ? `\nDocumentation scope: ${context.scope}`
    : '\nDocumentation scope: public API, usage examples, configuration options';

  return [
    '# Task: Generate Documentation',
    '',
    `Document "${target}" for an audience of ${audience}. Output format: ${format}.${scope}`,
    '',
    '## Documentation Principles',
    '- Start with a clear, one-sentence summary of what this code does',
    '- Show before explaining: put examples first, details after',
    '- Use consistent terminology throughout',
    '- Write in active voice, present tense',
    '- Keep code examples minimal, complete, and copy-paste runnable',
    '- Document not just the "what" but the "why" — design decisions matter',
    '- Include error messages and what they mean',
    '',
    '## Documentation Structure',
    '',
    '### 1. Overview',
    '- What problem does this solve?',
    '- When should you use it? When should you NOT use it?',
    '- Key concepts and terminology',
    '',
    '### 2. Quick Start',
    '- Minimal example that works immediately',
    '- Prerequisites and installation (if applicable)',
    '',
    '### 3. API Reference',
    '- Each public function/class/method with:',
    '  - Signature with types',
    '  - Description of behavior',
    '  - Parameter details (name, type, required/optional, default, description)',
    '  - Return value (type, description)',
    '  - Throws (error types and conditions)',
    '  - Example usage',
    '- Each configuration option with:',
    '  - Name, type, default, description, valid values',
    '',
    '### 4. Usage Patterns',
    '- Common workflows and recipes',
    '- Integration with other modules or systems',
    '- Advanced usage examples',
    '',
    '### 5. Error Handling',
    '- Common errors and their causes',
    '- How to recover from errors',
    '- Debugging tips',
    '',
    '### 6. Best Practices',
    '- Do\'s and Don\'ts',
    '- Performance considerations',
    '- Security considerations (if applicable)',
    '',
    '## Output Format',
    `Generate documentation in ${format} format following the structure above.`,
    'Prioritize clarity and usefulness over completeness. A short, clear doc is better than a long, confusing one.',
  ].join('\n');
}

/**
 * SECURITY_AUDIT — Audit code for common vulnerabilities.
 *
 * Systematic security review covering OWASP Top 10, injection vectors,
 * auth flaws, and data exposure risks.
 */
function SECURITY_AUDIT(context = {}) {
  const target = context.target || 'the provided codebase';
  const threatModel = context.threatModel
    ? `\nThreat model: ${context.threatModel}`
    : '\nThreat model: Assume external attacker with network access, internal attacker with limited privileges, and accidental exposure through logs/errors.';
  const compliance = context.compliance
    ? `\nCompliance requirements: ${context.compliance}`
    : '';

  return [
    '# Task: Security Audit',
    '',
    `You are performing a security audit of "${target}".`,
    `${threatModel}${compliance}`,
    '',
    '## Audit Scope',
    'Examine every trust boundary, data flow, and security-relevant code path.',
    '',
    '## Vulnerability Categories',
    '',
    '### 1. Injection',
    '- SQL/NoSQL injection via unsanitized user input',
    '- Command injection via shell.exec, child_process, exec()',
    '- Template injection (server-side and client-side)',
    '- Prototype pollution via object merging or deep clone',
    '- Regular expression denial of service (ReDoS)',
    '- Path traversal in file operations (../, absolute paths)',
    '',
    '### 2. Authentication & Session Management',
    '- Weak or missing authentication checks',
    '- Session fixation, missing rotation on privilege change',
    '- Credentials in URLs, logs, or error messages',
    '- Hardcoded or default credentials',
    '- Insufficient password complexity requirements',
    '',
    '### 3. Authorization',
    '- Missing authorization checks on sensitive operations',
    '- IDOR (Insecure Direct Object References)',
    '- Privilege escalation paths',
    '- CORS misconfiguration (overly permissive origins)',
    '',
    '### 4. Data Exposure',
    '- Sensitive data in logs, error messages, or debug output',
    '- Unencrypted data in transit (HTTP instead of HTTPS)',
    '- Secrets in source code, config files, or environment variables',
    '- Excessive data exposure in API responses',
    '- Insecure data storage (plaintext passwords, tokens)',
    '',
    '### 5. Input Validation',
    '- Missing or bypassable validation on user-controlled input',
    '- Unsafe deserialization (eval, JSON.parse without schema validation)',
    '- Type confusion attacks',
    '- Mass assignment vulnerabilities',
    '',
    '### 6. Dependency Security',
    '- Outdated dependencies with known CVEs',
    '- Unpinned or loosely pinned dependency versions',
    '- Use of deprecated or unmaintained packages',
    '- Supply chain risks (typosquatting, compromised packages)',
    '',
    '### 7. Cryptography',
    '- Use of weak or broken algorithms (MD5, SHA1, DES, RC4)',
    '- Hardcoded keys, IVs, or salts',
    '- Insufficient entropy for random values (Math.random for security)',
    '- Missing signature verification on JWTs or other tokens',
    '',
    '### 8. Error Handling & Logging',
    '- Stack traces or internal details exposed to users',
    '- Exception swallowing (empty catch blocks)',
    '- Logging sensitive data (PII, tokens, passwords)',
    '',
    '## Output Format',
    '1. **Executive Summary** — Overall security posture in 2-3 sentences',
    '2. **Findings** — Each finding with:',
    '   - Severity (Critical / High / Medium / Low / Info)',
    '   - CWE reference where applicable',
    '   - File and line number',
    '   - Description of the vulnerability',
    '   - Attack scenario (how it could be exploited)',
    '   - Remediation with code example',
    '3. **Risk Matrix** — Summary of findings by severity and likelihood',
    '4. **Positive Controls** — Security measures already in place that are working well',
    '5. **Recommendations** — Prioritized action items',
  ].join('\n');
}

/**
 * ARCHITECTURE_REVIEW — Review architecture decisions, patterns, and tradeoffs.
 *
 * Evaluates the system design against quality attributes like scalability,
 * maintainability, reliability, and simplicity.
 */
function ARCHITECTURE_REVIEW(context = {}) {
  const target = context.target || 'the system architecture';
  const qualityAttributes = context.qualityAttributes
    ? `\nFocus quality attributes: ${context.qualityAttributes}`
    : '\nFocus quality attributes: maintainability, scalability, reliability, simplicity, testability';
  const constraints = context.constraints
    ? `\nKnown constraints: ${context.constraints}`
    : '';

  return [
    '# Task: Architecture Review',
    '',
    `Review the architecture of "${target}".`,
    `${qualityAttributes}${constraints}`,
    '',
    '## Architecture Review Dimensions',
    '',
    '### 1. Modularity & Separation of Concerns',
    '- Are components well-defined with clear responsibilities?',
    '- Is coupling low and cohesion high?',
    '- Are there circular dependencies between modules?',
    '- Does the directory/package structure reflect the logical architecture?',
    '',
    '### 2. Abstraction & Interface Design',
    '- Are interfaces well-defined and stable?',
    '- Are implementation details properly hidden behind abstractions?',
    '- Is there over-engineering (too many layers, premature abstractions)?',
    '- Is there under-engineering (missing abstractions, leaky interfaces)?',
    '',
    '### 3. Data Flow & State Management',
    '- Is the data flow clear and predictable?',
    '- How is state managed? Is it centralized, distributed, or hybrid?',
    '- Are there hidden state dependencies or side effects?',
    '- How are async operations coordinated?',
    '',
    '### 4. Error Handling & Resilience',
    '- Is there a consistent error handling strategy?',
    '- Are failure modes considered and handled gracefully?',
    '- Are retry, circuit breaker, or fallback patterns used where needed?',
    '- Is the system observable (logging, metrics, tracing)?',
    '',
    '### 5. Scalability & Performance',
    '- Are there bottlenecks that would limit horizontal scaling?',
    '- Is the system designed for the expected load?',
    '- Are resource-intensive operations isolated and optimized?',
    '',
    '### 6. Security Architecture',
    '- Are trust boundaries clearly defined?',
    '- Is the principle of least privilege applied?',
    '- Are secrets and sensitive data handled securely across the system?',
    '',
    '### 7. Technology Choices',
    '- Are framework and library choices appropriate for the problem?',
    '- Are there simpler alternatives that would serve equally well?',
    '- Is the tech stack internally consistent?',
    '',
    '## Output Format',
    '1. **Architecture Summary** — High-level description of the current architecture',
    '2. **Strengths** — What architectural decisions are working well',
    '3. **Concerns** — Architectural risks, anti-patterns, or problematic decisions',
    '4. **Alternatives Considered** — For each concern, what alternatives exist',
    '5. **Recommendations** — Prioritized, actionable recommendations',
    '6. **Migration Path** — If major changes are needed, how to get there incrementally',
  ].join('\n');
}

/**
 * PERFORMANCE_ANALYSIS — Identify performance bottlenecks and optimization opportunities.
 *
 * Analyzes code paths for CPU, memory, I/O, and algorithmic efficiency
 * issues.
 */
function PERFORMANCE_ANALYSIS(context = {}) {
  const target = context.target || 'the provided code';
  const profileData = context.profileData
    ? `\nProfiling data available: ${context.profileData}`
    : '';
  const loadCharacteristics = context.loadCharacteristics
    ? `\nExpected load: ${context.loadCharacteristics}`
    : '\nExpected load: moderate to high throughput with concurrent users/requests';

  return [
    '# Task: Performance Analysis',
    '',
    `Analyze "${target}" for performance bottlenecks and optimization opportunities.`,
    `${loadCharacteristics}${profileData}`,
    '',
    '## Analysis Dimensions',
    '',
    '### 1. Algorithmic Complexity',
    '- Identify O(n^2) or worse algorithms in code paths',
    '- Check for unnecessary nested loops or repeated work',
    '- Evaluate data structure choices (Array vs Set vs Map for lookups)',
    '- Look for repeated computations that could be cached or memoized',
    '',
    '### 2. Memory Efficiency',
    '- Are there large allocations in hot paths?',
    '- Is there unnecessary copying or cloning of data?',
    '- Are objects retained longer than needed (memory leaks)?',
    '- Can buffers or streams be used instead of loading entire datasets?',
    '- Are there potential stack overflows from deep recursion?',
    '',
    '### 3. I/O Performance',
    '- Are there blocking I/O operations that should be async?',
    '- Can I/O operations be batched or parallelized?',
    '- Is there unnecessary I/O (reading the same file multiple times)?',
    '- Are network requests cached or deduplicated?',
    '- Is lazy loading used where appropriate?',
    '',
    '### 4. Database & Query Performance',
    '- Are there N+1 query problems?',
    '- Are queries properly indexed?',
    '- Is there unnecessary data being fetched (SELECT *)?',
    '- Are transactions scoped appropriately?',
    '',
    '### 5. Concurrency & Parallelism',
    '- Can independent operations run in parallel?',
    '- Are there unnecessary serialization points?',
    '- Is there contention on shared resources?',
    '- Are promise chains flattened to avoid unhandled rejections?',
    '',
    '### 6. Startup & Cold Path',
    '- Are there expensive operations at startup or import time?',
    '- Can initialization be deferred?',
    '- Is tree-shaking or dead code elimination possible?',
    '',
    '## Output Format',
    '1. **Hot Paths Identified** — Code paths most critical to performance',
    '2. **Bottlenecks** — Each with:',
    '   - Location (file, function, line)',
    '   - Severity (Critical / High / Medium / Low)',
    '   - Description of the issue',
    '   - Estimated impact (e.g., "50ms per request at 1k requests/min")',
    '   - Proposed optimization with expected improvement',
    '3. **Quick Wins** — Low-effort, high-impact optimizations to do first',
    '4. **Monitoring Recommendations** — What metrics to track',
  ].join('\n');
}

/**
 * DEPENDENCY_UPDATE — Analyze the impact of upgrading a dependency.
 *
 * Evaluates breaking changes, API surface changes, and migration effort
 * for dependency updates.
 */
function DEPENDENCY_UPDATE(context = {}) {
  const packageName = context.packageName || 'the specified package';
  const fromVersion = context.fromVersion || 'current';
  const toVersion = context.toVersion || 'target';
  const changelog = context.changelog
    ? `\nChangelog summary: ${context.changelog}`
    : '';

  return [
    '# Task: Dependency Update Impact Analysis',
    '',
    `Analyze the impact of upgrading "${packageName}" from ${fromVersion} to ${toVersion}.${changelog}`,
    '',
    '## Analysis Steps',
    '',
    '### 1. Breaking Change Identification',
    '- Review the changelog and migration guide for the target version',
    '- Identify removed APIs, renamed functions, or changed signatures',
    '- Note behavioral changes (different defaults, changed return types)',
    '- Check for Node.js / runtime version requirement changes',
    '- Identify peer dependency conflicts',
    '',
    '### 2. Codebase Impact Assessment',
    '- Search the codebase for all imports and usages of the package',
    '- Map each usage to breaking changes in the new version',
    '- Identify transitive dependencies that may also be affected',
    '- Check for type definition changes that could break TypeScript compilation',
    '',
    '### 3. Migration Plan',
    '- List every file that needs changes, ordered by dependency',
    '- Provide before/after code examples for each breaking change',
    '- Estimate effort per change and total migration effort',
    '',
    '### 4. Risk Assessment',
    '- What is the rollback strategy if the update causes issues?',
    '- Are there known issues or regressions in the target version?',
    '- Will existing tests catch regressions from the update?',
    '- Is a gradual rollout (canary, feature flag) feasible?',
    '',
    '### 5. Benefits Analysis',
    '- What bugs are fixed by this update?',
    '- What performance improvements are expected?',
    '- Are there new features that could simplify existing code?',
    '- Are there security patches included?',
    '',
    '## Output Format',
    '1. **Summary** — One paragraph on whether the update is recommended',
    '2. **Breaking Changes** — Each with file impact and migration code',
    '3. **Affected Files** — Complete list with change descriptions',
    '4. **Migration Steps** — Ordered, verifiable steps',
    '5. **Risk Level** — Low / Medium / High with justification',
    '6. **Verification Plan** — Tests to run and behaviors to verify',
  ].join('\n');
}

/**
 * API_DESIGN — Design REST or GraphQL APIs with best practices.
 *
 * Covers resource modeling, endpoint design, error handling,
 * pagination, versioning, and security.
 */
function API_DESIGN(context = {}) {
  const domain = context.domain || 'the specified domain';
  const style = (context.style || 'REST').toUpperCase();
  const auth = context.auth
    ? `\nAuthentication: ${context.auth}`
    : '\nAuthentication: JWT bearer tokens with role-based access control';
  const scale = context.scale
    ? `\nScale expectations: ${context.scale}`
    : '';

  const styleSpecificGuidance = style === 'GRAPHQL'
    ? [
      '### GraphQL-Specific Design',
      '- Design the schema around domain concepts, not database tables',
      '- Use connections (edges/nodes) for paginated lists per Relay spec',
      '- Avoid deep nesting that leads to N+1 queries; use DataLoader for batching',
      '- Design mutations around user actions (loginUser) not CRUD (updateUser)',
      '- Use union types for mutation responses (success, error types)',
      '- Consider subscription design if real-time updates are needed',
      '- Document enums, interfaces, and custom scalars clearly',
      '- Provide field-level deprecation with `@deprecated(reason: "...")`',
    ]
    : [
      '### REST-Specific Design',
      '- Use nouns for resources (/users, /orders), not verbs',
      '- Use HTTP methods semantically: GET (read), POST (create), PUT/PATCH (update), DELETE (remove)',
      '- Use nested routes for relationships (/users/:id/orders)',
      '- Keep URLs plural and kebab-case for multi-word resources',
      '- Use query parameters for filtering, sorting, and pagination',
      '- Version the API via URL prefix (/v1/) or Accept header',
    ];

  return [
    `# Task: ${style} API Design`,
    '',
    `Design a ${style} API for the "${domain}" domain.${auth}${scale}`,
    '',
    '## Design Principles',
    '- APIs are products: design for the consumer, not for internal convenience',
    '- Consistency is key: similar resources should have similar shapes and behaviors',
    '- Errors should be actionable: tell the client what went wrong and how to fix it',
    '- Design for evolution: APIs will change, plan for versioning from the start',
    '- Think in resources and actions, not in CRUD operations on database tables',
    '- Follow the principle of least astonishment: defaults should be safe and obvious',
    '',
    ...styleSpecificGuidance,
    '',
    '## Design Deliverables',
    '',
    '### 1. Resource Model',
    '- List all resources and their relationships',
    '- Define each resource\'s fields, types, required/optional, and constraints',
    '- Show an entity relationship diagram (describe in text)',
    '',
    '### 2. Endpoint Design',
    `- For each endpoint: method, path, description, authentication required`,
    '- Request parameters (path, query, body) with types and validation rules',
    '- Response shape with status codes',
    '- Example request and response',
    '',
    '### 3. Error Handling',
    '- Standard error response format',
    '- Error codes and their meanings',
    '- When to use 400 vs 422 vs 409 vs 403 vs 404',
    '',
    '### 4. Pagination, Filtering & Sorting',
    '- Pagination strategy (cursor-based vs offset-based)',
    '- Filter operators and syntax',
    '- Sort options and multi-sort behavior',
    '',
    '### 5. Rate Limiting & Quotas',
    '- Suggested rate limits and quota tiers',
    '- Rate limit response headers and error format',
    '',
    '### 6. Security Considerations',
    '- Which endpoints require which roles/permissions',
    '- Input validation strategy',
    '- CORS configuration',
    '- Sensitive data handling (masking, redaction)',
    '',
    '## Output Format',
    'Provide a complete API specification organized by the sections above.',
    'Include OpenAPI/Swagger snippets where appropriate for REST, or SDL for GraphQL.',
  ].join('\n');
}

module.exports = {
  CODE_REVIEW,
  REFACTOR_PLAN,
  BUG_INVESTIGATION,
  TEST_GENERATION,
  DOCUMENTATION,
  SECURITY_AUDIT,
  ARCHITECTURE_REVIEW,
  PERFORMANCE_ANALYSIS,
  DEPENDENCY_UPDATE,
  API_DESIGN,
};
