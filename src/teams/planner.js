"use strict";

const { loadAgentDefinitions, normalizeName } = require('./agents');

const BUILT_IN_AGENT_TYPES = new Set(
  require('./agents').BUILT_IN_AGENTS.map((a) => a.agentType),
);

// Detect whether the provider is a real LLM (not mock / local).
// The planner uses LLM decomposition when available; otherwise falls
// back to keyword-driven pattern decomposition.
function isLLMAvailable(provider) {
  if (!provider) return false;
  if (provider.name === 'mock' || provider.name === 'local') return false;
  // A real provider must have an apiKey set (or resolve one from env).
  if (!provider.apiKey) return false;
  return true;
}

/**
 * Primary entry point: generate a team plan from a natural-language goal.
 *
 * @param {object} options
 * @param {string} options.goal        - Natural-language goal description.
 * @param {object} options.provider    - Provider instance (may be mock).
 * @param {object} [options.settings]  - Hax Agent settings object.
 * @param {string} [options.projectRoot] - Project root directory.
 * @returns {Promise<{ plan: object, source: 'llm'|'pattern', planText: string }>}
 */
async function generateTeamPlan(options = {}) {
  const goal = String(options.goal || '').trim();

  if (!goal) {
    throw new Error('Goal description is required for team plan generation.');
  }

  const availableDefinitions = loadAgentDefinitions({
    projectRoot: options.projectRoot || process.cwd(),
    settings: options.settings,
  });

  const availableAgentTypes = availableDefinitions.activeAgents
    .filter((agent) => agent.source !== 'custom' || BUILT_IN_AGENT_TYPES.has(agent.agentType))
    .map((agent) => agent.agentType);

  if (isLLMAvailable(options.provider)) {
    try {
      return await generateWithLLM(goal, options.provider, availableAgentTypes, availableDefinitions);
    } catch {
      // Fall through to pattern-based decomposition
    }
  }

  return generateWithPatterns(goal, availableAgentTypes, availableDefinitions);
}

/**
 * LLM-driven plan generation.
 */
async function generateWithLLM(goal, provider, agentTypes, definitions) {
  const agentDescriptions = definitions.activeAgents
    .filter((agent) => agentTypes.includes(agent.agentType))
    .map((agent) => `- ${agent.agentType}: ${agent.role || agent.whenToUse || 'General teammate'}`)
    .join('\n');

  const prompt = buildLLMPrompt(goal, agentTypes, agentDescriptions);
  const response = await callLLM(provider, prompt);
  const plan = parseLLMResponse(response, goal, agentTypes, definitions);
  const planText = formatGeneratedPlan(plan);

  return {
    plan: validatePlan(plan, definitions),
    source: 'llm',
    planText,
    rawResponse: response,
  };
}

/**
 * Pattern-based / keyword decomposition (no LLM needed).
 */
function generateWithPatterns(goal, agentTypes, definitions) {
  const plan = decomposeGoalFallback(goal, agentTypes, definitions);
  const planText = formatGeneratedPlan(plan);

  return {
    plan: validatePlan(plan, definitions),
    source: 'pattern',
    planText,
  };
}

/**
 * Build the structured prompt we send to the LLM.
 */
function buildLLMPrompt(goal, agentTypes, agentDescriptions) {
  return [
    'You are a team planner for Hax Agent, an AI coding assistant CLI tool.',
    'Your task: given a user goal, produce a JSON team plan that decomposes the work across specialized agents.',
    '',
    'Available agent types (you MUST only use these):',
    agentDescriptions,
    '',
    'Output ONLY a valid JSON object with this structure:',
    '{',
    '  "name": "kebab-case-team-name",',
    '  "mission": "one-sentence summary of what the team will accomplish",',
    '  "members": [',
    '    {',
    '      "agentType": "one-of-the-available-types",',
    '      "name": "descriptive-kebab-name",',
    '      "role": "one-sentence specialty description for this task"',
    '    }',
    '  ],',
    '  "tasks": [',
    '    {',
    '      "id": "T1",',
    '      "title": "short task title",',
    '      "owner": "member-name",',
    '      "prompt": "detailed instructions for the agent to follow",',
    '      "dependsOn": [],',
    '      "deliverable": "concrete output expected for this task",',
    '      "agentType": "type-matching-the-owners-type"',
    '    }',
    '  ]',
    '}',
    '',
    'Rules:',
    '- Use 2-5 agents, each with a clear, non-overlapping specialty.',
    '- Prefer explore / planner before implementer / reviewer.',
    '- Make independent tasks parallel (empty dependsOn). Chain sequential tasks with dependsOn.',
    '- Every task must have an owner that matches one of the defined members.',
    '- Use concrete, verifiable deliverables.',
    '- Prefer kebab-case names for members (e.g., "code-explorer", "security-auditor").',
    '',
    'User goal:',
    goal,
    '',
    'Respond with the JSON object only. No markdown fences, no explanation.',
  ].join('\n');
}

/**
 * Call the LLM (non-streaming) and collect the full response text.
 */
async function callLLM(provider, prompt) {
  const messages = [{ role: 'user', content: prompt }];
  let content = '';

  for await (const chunk of provider.stream({
    messages,
    toolRegistry: null,
    system: 'You are a precise JSON generator. Respond with only valid JSON, no explanation.',
    model: provider.model,
    maxToolTurns: 0,
    context: { budgetTokens: 8000, inputTokens: 0 },
  })) {
    if (chunk.type === 'text') {
      content += chunk.delta;
    }
  }

  return content.trim();
}

/**
 * Parse the LLM JSON response, with robust error handling for markdown fences,
 * trailing text, and common JSON formatting issues.
 */
function parseLLMResponse(response, goal, agentTypes, definitions) {
  let json = response;

  // Strip markdown code fences if present
  const fenceMatch = json.match(/```(?:json)?\s*([\s\S]*?)```/);

  if (fenceMatch) {
    json = fenceMatch[1];
  }

  // Try to find the outermost { } pair
  const objectMatch = json.match(/\{[\s\S]*\}/);

  if (objectMatch) {
    json = objectMatch[0];
  }

  try {
    const parsed = JSON.parse(json);

    return normalizeParsedPlan(parsed, goal, agentTypes);
  } catch {
    // Last resort: try to fix common JSON issues
    const fixed = json
      .replace(/,\s*}/g, '}')     // trailing comma before }
      .replace(/,\s*]/g, ']')      // trailing comma before ]
      .replace(/\n/g, ' ')         // newlines to spaces
      .replace(/\s+/g, ' ');       // collapse whitespace

    const parsed = JSON.parse(fixed);
    return normalizeParsedPlan(parsed, goal, agentTypes);
  }
}

/**
 * Normalize a parsed plan to match the expected schema.
 */
function normalizeParsedPlan(parsed, goal, agentTypes) {
  const goalWords = goal.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
  const baseName = goalWords.slice(0, 3).join('-') || 'team';

  return {
    name: normalizeName(String(parsed.name || parsed.teamName || baseName)),
    mission: String(parsed.mission || parsed.description || goal).trim(),
    members: (parsed.members || parsed.agents || []).map((member) => ({
      agentType: normalizeName(String(member.agentType || member.type || 'general-purpose')),
      name: normalizeName(String(member.name || member.agentType || 'agent')),
      role: String(member.role || member.specialty || member.description || '').trim(),
    })),
    tasks: (parsed.tasks || parsed.work || []).map((task, index) => ({
      id: String(task.id || `T${index + 1}`).trim(),
      title: String(task.title || task.name || `Task ${index + 1}`).trim(),
      owner: normalizeName(String(task.owner || task.assignedTo || '')),
      prompt: String(task.prompt || task.description || task.instructions || task.title || '').trim(),
      dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn.map(String) : [],
      deliverable: String(task.deliverable || task.output || '').trim(),
      agentType: normalizeName(String(task.agentType || task.type || 'general-purpose')),
      parallel: task.parallel !== false,
    })),
  };
}

/**
 * Validate a plan against available agent definitions and fix common issues.
 */
function validatePlan(plan, definitions) {
  const validAgentTypes = new Set(definitions.activeAgents.map((agent) => agent.agentType));
  const memberNames = new Set(plan.members.map((member) => member.name));

  // Fix invalid agent types
  const fixedMembers = plan.members.map((member) => {
    if (validAgentTypes.has(member.agentType)) return member;

    // Map to closest known type
    const mapped = mapToValidAgentType(member.agentType, validAgentTypes);
    return { ...member, agentType: mapped };
  });

  // Fix tasks with invalid owners or agent types
  const fixedTasks = plan.tasks.map((task) => {
    let owner = task.owner;
    let agentType = task.agentType;

    // If owner is not in the team, try to find a matching member
    if (!memberNames.has(owner)) {
      const match = findBestMemberMatch(owner, fixedMembers);
      owner = match ? match.name : (fixedMembers[0]?.name || 'general-purpose');
    }

    // If agent type is invalid, use the owner's agent type
    if (!validAgentTypes.has(agentType)) {
      const ownerMember = fixedMembers.find((member) => member.name === owner);
      agentType = ownerMember ? ownerMember.agentType : 'general-purpose';
    }

    return { ...task, owner, agentType };
  });

  return {
    name: plan.name || 'default',
    mission: plan.mission || '',
    members: fixedMembers,
    tasks: fixedTasks,
  };
}

/**
 * Map an unknown agent type name to the closest known type via keyword matching.
 */
function mapToValidAgentType(agentType, validAgentTypes) {
  const text = agentType.toLowerCase();

  const mappings = [
    { keys: ['test', 'verify', 'validate', 'qa'], type: 'test-runner' },
    { keys: ['review', 'audit', 'code'], type: 'reviewer' },
    { keys: ['security', 'auth', 'perm'], type: 'security-reviewer' },
    { keys: ['doc', 'readme', 'write'], type: 'docs-writer' },
    { keys: ['plan', 'architect', 'design'], type: 'planner' },
    { keys: ['explore', 'map', 'discover', 'search', 'inspect'], type: 'explore' },
    { keys: ['impl', 'build', 'develop', 'code', 'refactor'], type: 'implementer' },
    { keys: ['general', 'utility'], type: 'general-purpose' },
  ];

  for (const mapping of mappings) {
    if (mapping.keys.some((key) => text.includes(key)) && validAgentTypes.has(mapping.type)) {
      return mapping.type;
    }
  }

  // Fall back to general-purpose or first available
  if (validAgentTypes.has('general-purpose')) return 'general-purpose';
  return [...validAgentTypes][0] || 'general-purpose';
}

/**
 * Find the best member match for an owner name using prefix/similarity.
 */
function findBestMemberMatch(name, members) {
  if (members.length === 0) return null;
  const normalized = normalizeName(name);

  // Exact match
  const exact = members.find((member) => member.name === normalized);
  if (exact) return exact;

  // Prefix match
  const prefix = members.find((member) => member.name.startsWith(normalized));
  if (prefix) return prefix;

  // Agent type match
  const typeMatch = members.find((member) => member.agentType === normalized);
  if (typeMatch) return typeMatch;

  return members[0];
}

/**
 * Pattern-based goal decomposition (no LLM).
 *
 * Uses keyword recognition to decide which agent types to involve and what
 * task sequences make sense. Heuristic-driven, works with mock/offline setups.
 */
function decomposeGoalFallback(goal, agentTypes, definitions) {
  const keywords = goal.toLowerCase();
  const activeAgents = new Set(agentTypes);
  const goalWords = goal.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
  const baseName = goalWords.slice(0, 3).join('-') || 'team';

  // Decide which agent roles are relevant
  const needsExploration = /explore|find|search|inspect|map|understand|look at|check out|investigate|navigate|read|examine/.test(keywords);
  const needsPlanning = /plan|design|architecture|structure|decompose|break down|organize|strategy/.test(keywords);
  const needsImplementation = /implement|build|create|write|refactor|change|modify|add|remove|update|fix|code|develop/.test(keywords);
  const needsReview = /review|audit|check|verify|inspect the quality|regression/.test(keywords);
  const needsSecurity = /security|auth|token|permission|secret|vulnerability|injection|exploit|csrf|xss/.test(keywords);
  const needsTesting = /test|verify|validate|coverage|lint|typecheck/.test(keywords);
  const needsDocumentation = /doc|readme|document|explain|usage|guide|manual/.test(keywords);

  // Default: explorer + implementer
  const members = [];
  const tasks = [];
  let taskCounter = 1;

  // Always include at least one implementer for any code-related goal
  const hasCodeGoal = needsImplementation || needsExploration || needsReview || needsSecurity || needsTesting;
  const isCodeRelated = hasCodeGoal || /code|file|module|package|src|test|lib|bin|app/.test(keywords);

  // --- Phase 1: Exploration (if needed) ---
  if (needsExploration && activeAgents.has('explore')) {
    members.push(createMember('explore', 'code-explorer', 'Maps existing code paths, dependencies, and constraints'));
    tasks.push(createTask(taskCounter++, 'Explore codebase structure',
      'code-explorer', 'explore',
      `Survey the codebase relevant to: ${goal}. Map file structure, key modules, dependencies, and architectural patterns.`,
      [], 'A mapping of relevant code paths with dependencies and constraints identified'));
  }

  // --- Phase 2: Planning (if needed) ---
  if (needsPlanning && activeAgents.has('planner')) {
    members.push(createMember('planner', 'task-planner', 'Decomposes goals into sequenced, verifiable tasks'));
    const exploreDep = needsExploration ? ['T1'] : [];
    tasks.push(createTask(taskCounter++, 'Decompose goal into work plan',
      'task-planner', 'planner',
      `Analyze the goal "${goal}" and produce a detailed implementation sequence with risk assessment and validation strategy.`,
      exploreDep, 'A step-by-step implementation plan with dependencies and risk notes'));
  }

  // --- Phase 3: Implementation (always include if code-related) ---
  if ((needsImplementation || isCodeRelated) && activeAgents.has('implementer')) {
    members.push(createMember('implementer', 'code-implementer', 'Makes focused code changes following project conventions'));
    const planDep = needsPlanning ? [`T${taskCounter - 1}`] : [];
    const exploreDep = needsExploration && !needsPlanning ? ['T1'] : [];
    const deps = [...planDep, ...exploreDep];
    tasks.push(createTask(taskCounter++, 'Implement changes',
      'code-implementer', 'implementer',
      `Implement the changes described in the goal: ${goal}. Follow existing project conventions. Keep changes focused and minimal.`,
      deps, 'Working code changes with files touched and verification notes'));
  }

  // --- Phase 4: Security review (if applicable) ---
  if (needsSecurity && activeAgents.has('security-reviewer')) {
    members.push(createMember('security-reviewer', 'security-auditor', 'Reviews trust boundaries, secret handling, and unsafe defaults'));
    const implDep = tasks.length > 0 ? [`T${taskCounter - 1}`] : [];
    tasks.push(createTask(taskCounter++, 'Security audit',
      'security-auditor', 'security-reviewer',
      `Review the implementation for the goal "${goal}". Check for secret exposure, injection risks, unsafe defaults, and permission boundaries.`,
      implDep, 'A security review checklist with findings by severity'));
  }

  // --- Phase 5: Testing / validation ---
  if (needsTesting && activeAgents.has('test-runner')) {
    members.push(createMember('test-runner', 'test-validator', 'Runs verification commands and triages test failures'));
    const implDep = tasks.length > 0 ? [`T${taskCounter - 1}`] : [];
    tasks.push(createTask(taskCounter++, 'Run test suite',
      'test-validator', 'test-runner',
      `Verify the implementation for "${goal}" by running the relevant test suite. Report failures with exact commands.`,
      implDep, 'Test results with command output and failure analysis'));
  }

  // --- Phase 6: Documentation (if applicable) ---
  if (needsDocumentation && activeAgents.has('docs-writer')) {
    members.push(createMember('docs-writer', 'doc-writer', 'Updates user-facing documentation and usage notes'));
    const implDep = tasks.length > 0 ? [`T${taskCounter - 1}`] : [];
    tasks.push(createTask(taskCounter++, 'Update documentation',
      'doc-writer', 'docs-writer',
      `Update relevant documentation for the changes made for "${goal}". Keep examples accurate and aligned with project style.`,
      implDep, 'Updated documentation files with accurate usage examples'));
  }

  // --- Final review (if review was requested) ---
  if (needsReview && !needsSecurity && activeAgents.has('reviewer')) {
    members.push(createMember('reviewer', 'code-reviewer', 'Reviews code for correctness and maintainability'));
    const implDep = tasks.length > 0 ? [`T${taskCounter - 1}`] : [];
    tasks.push(createTask(taskCounter++, 'Code review',
      'code-reviewer', 'reviewer',
      `Review the implementation for "${goal}" for correctness, style compliance, and potential regressions.`,
      implDep, 'A review report with issues classified as blocker vs nice-to-have'));
  }

  // Fallback: if no members were created, create a minimal general-purpose team
  if (members.length === 0) {
    members.push(createMember('general-purpose', 'general-agent', 'Handles general coding tasks'));
    tasks.push(createTask(1, 'Complete the goal',
      'general-agent', 'general-purpose',
      `Work on this goal: ${goal}. Explore the codebase first, then implement changes, verify results.`,
      [], 'Completed work with files changed, verification notes, and next steps'));
  }

  // Rebuild plan from arrays
  return {
    name: baseName,
    mission: `Complete: ${goal}`,
    members,
    tasks,
  };
}

/**
 * Create a team member object consistent with TeamRuntime member format.
 */
function createMember(agentType, name, role) {
  return {
    agentType: normalizeName(agentType),
    name: normalizeName(name),
    role: String(role || '').trim(),
  };
}

/**
 * Create a task object consistent with TeamRuntime task format.
 */
function createTask(id, title, owner, agentType, prompt, dependsOn, deliverable) {
  return {
    id: `T${id}`,
    title: String(title || '').trim(),
    owner: normalizeName(owner),
    prompt: String(prompt || '').trim(),
    dependsOn: (dependsOn || []).map(String),
    deliverable: String(deliverable || '').trim(),
    agentType: normalizeName(agentType),
    parallel: (dependsOn || []).length === 0,
  };
}

/**
 * Format a generated plan for display (human-readable preview).
 */
function formatGeneratedPlan(plan) {
  const lines = [
    `Team: ${plan.name}`,
    `Mission: ${plan.mission}`,
    '',
    `Agents (${plan.members.length}):`,
    ...plan.members.map((member) => `  - ${member.name} (${member.agentType}): ${member.role}`),
    '',
    `Tasks (${plan.tasks.length}):`,
    ...plan.tasks.map((task) => {
      const deps = task.dependsOn.length > 0 ? ` depends on: ${task.dependsOn.join(', ')}` : '';
      const parallel = task.parallel ? '⚡' : '🔗';
      return [
        `  ${parallel} ${task.id}: ${task.title}`,
        `     owner: ${task.owner} (${task.agentType})${deps}`,
        task.deliverable ? `     deliverable: ${task.deliverable}` : '',
      ].filter(Boolean).join('\n');
    }),
  ];

  return lines.join('\n');
}

/**
 * Create a TeamRuntime instance populated with a generated plan.
 * This does NOT invoke the LLM or run tasks -- it just loads the plan into
 * a team state file.
 *
 * @param {object} TeamRuntime - The TeamRuntime constructor (lazy-imported to avoid circular refs)
 * @param {object} options - Same options as generateTeamPlan plus teamRuntime-specific ones
 */
async function createTeamFromGoal(TeamRuntime, options = {}) {
  const { plan, source, planText } = await generateTeamPlan(options);
  const runtime = new TeamRuntime({
    settings: options.settings,
    projectRoot: options.projectRoot,
    toolRegistryFactory: options.toolRegistryFactory,
  });

  const result = runtime.createTeam({
    name: plan.name,
    mission: plan.mission,
    members: plan.members,
  });

  // Add all planned tasks with dependencies
  for (const task of plan.tasks) {
    runtime.addTask({
      title: task.title,
      prompt: task.prompt,
      owner: task.owner,
      agentType: task.agentType,
      dependsOn: task.dependsOn,
      deliverable: task.deliverable,
      parallel: task.parallel,
    });
  }

  return {
    team: runtime.snapshot(),
    plan,
    source,
    planText,
    created: result.created !== false,
  };
}

module.exports = {
  generateTeamPlan,
  createTeamFromGoal,
  isLLMAvailable,
  generateWithLLM,
  generateWithPatterns,
  decomposeGoalFallback,
  validatePlan,
  formatGeneratedPlan,
  parseLLMResponse,
  normalizeParsedPlan,
  buildLLMPrompt,
  callLLM,
};
