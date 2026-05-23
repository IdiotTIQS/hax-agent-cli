"use strict";

/**
 * Prompt builder — utility functions for constructing, composing, and
 * layering system prompts for AI agents.
 *
 * Design philosophy:
 *   - Every builder function is pure: input prompts, output a new prompt string.
 *   - Layers are applied in order; later layers may reference or override
 *     earlier ones.
 *   - Builders never mutate inputs.
 */

const DEFAULT_SEPARATOR = '\n\n';

/**
 * Build a system prompt by joining multiple fragments with a separator.
 *
 * Each argument can be:
 *   - A string (used as-is)
 *   - A function (called with `context` to produce a string)
 *   - null / undefined / false (silently skipped)
 *   - An array (recursively flattened)
 *
 * @param {string} base - The base system prompt.
 * @param {...(string|Function|Array|null|undefined|false)} layers - Additional
 *   prompt fragments to layer on top.
 * @returns {string} The combined system prompt.
 */
function buildSystemPrompt(base, ...layers) {
  const parts = [];

  // Collect and flatten all parts
  function collect(items) {
    for (const item of items) {
      if (item === null || item === undefined || item === false) {
        continue;
      }
      if (Array.isArray(item)) {
        collect(item);
      } else if (typeof item === 'function') {
        const result = item();
        if (result !== null && result !== undefined && result !== false) {
          parts.push(String(result));
        }
      } else {
        parts.push(String(item));
      }
    }
  }

  collect([base, ...layers]);

  return parts.join(DEFAULT_SEPARATOR);
}

/**
 * Inject role-specific instructions into a prompt.
 *
 * Appends a formatted role block that defines the agent's identity,
 * responsibilities, and behavioral guidelines.
 *
 * @param {string} prompt - The base system prompt.
 * @param {object} role - A role configuration object (from roles.js).
 * @param {string} role.name - Human-readable role name.
 * @param {string} role.systemPrompt - The role's system prompt.
 * @param {string} [role.description] - One-sentence role description.
 * @returns {string} The prompt with role instructions appended.
 */
function withRole(prompt, role) {
  if (!role || !role.systemPrompt) {
    return prompt;
  }

  const prefix = [
    '---',
    `# Role: ${role.name || 'Specialist'}`,
    role.description ? `## Description\n${role.description}` : '',
    '---',
  ].filter(Boolean).join('\n');

  return [prompt, prefix, role.systemPrompt].filter(Boolean).join(DEFAULT_SEPARATOR);
}

/**
 * Inject project context into a prompt.
 *
 * Adds information about the project environment: file tree overview,
 * git status, current branch, recent commits, and relevant file contents.
 *
 * @param {string} prompt - The base system prompt.
 * @param {object} context - Project context information.
 * @param {string} [context.projectRoot] - Absolute path to the project root.
 * @param {string} [context.fileTree] - Formatted file tree (e.g., from `tree` command).
 * @param {string} [context.gitBranch] - Current git branch name.
 * @param {string} [context.gitStatus] - Formatted git status output.
 * @param {string} [context.recentCommits] - Formatted recent commit log.
 * @param {object} [context.packageJson] - Parsed package.json content.
 * @param {Array<string>} [context.relevantFiles] - Paths to files relevant to the task.
 * @returns {string} The prompt with project context appended.
 */
function withContext(prompt, context = {}) {
  if (!context || Object.keys(context).length === 0) {
    return prompt;
  }

  const sections = ['---', '# Project Context', '---', ''];

  if (context.projectRoot) {
    sections.push(`Project root: ${context.projectRoot}`);
  }

  if (context.gitBranch) {
    sections.push(`Current branch: ${context.gitBranch}`);
  }

  if (context.gitStatus && context.gitStatus.trim()) {
    sections.push('## Git Status', context.gitStatus.trim());
  }

  if (context.recentCommits && context.recentCommits.trim()) {
    sections.push('## Recent Commits', context.recentCommits.trim());
  }

  if (context.fileTree && context.fileTree.trim()) {
    sections.push('## Project Structure', context.fileTree.trim());
  }

  if (context.packageJson) {
    const pkg = context.packageJson;
    const deps = [
      pkg.name ? `  Name: ${pkg.name}` : null,
      pkg.version ? `  Version: ${pkg.version}` : null,
    ].filter(Boolean);

    if (deps.length > 0) {
      sections.push('## Package Information', deps.join('\n'));
    }

    const depEntries = [
      ...Object.entries(pkg.dependencies || {}).map(([name, ver]) => `  ${name}: ${ver}`),
      ...Object.entries(pkg.devDependencies || {}).map(([name, ver]) => `  ${name} (dev): ${ver}`),
    ];

    if (depEntries.length > 0) {
      sections.push('## Dependencies', depEntries.join('\n'));
    }
  }

  if (Array.isArray(context.relevantFiles) && context.relevantFiles.length > 0) {
    sections.push('## Relevant Files', context.relevantFiles.map((f) => `  - ${f}`).join('\n'));
  }

  if (sections.length <= 4) {
    // Only the header was added, no actual context content
    return prompt;
  }

  return [prompt, sections.join('\n')].filter(Boolean).join(DEFAULT_SEPARATOR);
}

/**
 * Add constraints to a prompt.
 *
 * Appends a formatted constraints block that limits agent behavior,
 * including tool usage limits, turn limits, scope boundaries, and
 * other operational restrictions.
 *
 * @param {string} prompt - The base system prompt.
 * @param {object} constraints - Constraint configuration.
 * @param {number} [constraints.maxTurns] - Maximum conversation turns allowed.
 * @param {number} [constraints.maxToolCalls] - Maximum tool calls allowed.
 * @param {boolean} [constraints.readOnly] - If true, agent cannot modify files.
 * @param {Array<string>} [constraints.allowedTools] - Explicit list of allowed tools.
 * @param {Array<string>} [constraints.disallowedTools] - Tools the agent must not use.
 * @param {Array<string>} [constraints.limitedPaths] - File paths the agent is restricted to.
 * @param {string} [constraints.timeLimit] - Time limit description (e.g., "5 minutes").
 * @param {string} [constraints.custom] - Arbitrary additional constraint text.
 * @returns {string} The prompt with constraints appended.
 */
function withConstraints(prompt, constraints = {}) {
  if (!constraints || Object.keys(constraints).length === 0) {
    return prompt;
  }

  const sections = ['---', '# Constraints', '---', ''];

  if (constraints.maxTurns !== undefined && constraints.maxTurns > 0) {
    sections.push(`- You have a maximum of ${constraints.maxTurns} conversation turns to complete this task.`);
  }

  if (constraints.maxToolCalls !== undefined && constraints.maxToolCalls > 0) {
    sections.push(`- You are limited to ${constraints.maxToolCalls} tool calls. Use them wisely.`);
  }

  if (constraints.readOnly) {
    sections.push('- READ-ONLY MODE: You cannot modify any files. You may only read and analyze.');
  }

  if (Array.isArray(constraints.allowedTools) && constraints.allowedTools.length > 0) {
    sections.push(`- Allowed tools only: ${constraints.allowedTools.join(', ')}`);
  }

  if (Array.isArray(constraints.disallowedTools) && constraints.disallowedTools.length > 0) {
    sections.push(`- Do NOT use these tools: ${constraints.disallowedTools.join(', ')}`);
  }

  if (Array.isArray(constraints.limitedPaths) && constraints.limitedPaths.length > 0) {
    sections.push('- Restricted to these paths:');
    constraints.limitedPaths.forEach((p) => sections.push(`    ${p}`));
  }

  if (constraints.timeLimit) {
    sections.push(`- Time limit: ${constraints.timeLimit}`);
  }

  if (constraints.custom) {
    sections.push(`- ${constraints.custom}`);
  }

  if (sections.length <= 4) {
    return prompt;
  }

  return [prompt, sections.join('\n')].filter(Boolean).join(DEFAULT_SEPARATOR);
}

/**
 * Specify the desired output format for the agent's response.
 *
 * Adds instructions for how the agent should structure its final answer,
 * including format type, schema requirements, and structural guidelines.
 *
 * @param {string} prompt - The base system prompt.
 * @param {object|string} format - Output format specification.
 *   If a string, it is treated as the format name (json, markdown, text, etc.).
 *   If an object, supported keys are:
 *     type: 'json' | 'markdown' | 'text' | 'code' | 'structured'
 *     schema: description of the expected JSON schema (for json type)
 *     sections: array of section names (for structured type)
 *     language: programming language (for code type)
 * @returns {string} The prompt with output format instructions appended.
 */
function withOutputFormat(prompt, format) {
  if (!format) {
    return prompt;
  }

  let formatObj;
  if (typeof format === 'string') {
    formatObj = { type: format };
  } else {
    formatObj = format;
  }

  const type = (formatObj.type || 'text').toLowerCase();
  let instructions = '';

  switch (type) {
    case 'json':
      instructions = [
        '# Response Format',
        '',
        'You MUST respond with a valid JSON object. Do not wrap it in markdown code fences.',
        'The JSON must be parseable by `JSON.parse()`. Use double quotes for all strings.',
        '- No trailing commas',
        '- No comments',
        '- No markdown wrapping',
        formatObj.schema
          ? `\n## Expected JSON Schema\n\`\`\`\n${formatObj.schema}\n\`\`\``
          : '',
      ].filter(Boolean).join('\n');
      break;

    case 'markdown':
      instructions = [
        '# Response Format',
        '',
        'Format your response in Markdown.',
        '- Use headers (##, ###) for sections',
        '- Use bullet lists for multiple items',
        '- Use numbered lists for sequential steps',
        '- Use code fences with language identifiers for code blocks',
        '- Use tables for comparative data',
        '- Use **bold** for emphasis and `code` for identifiers',
      ].join('\n');
      break;

    case 'text':
      instructions = [
        '# Response Format',
        '',
        'Respond in plain text. Do not use markdown formatting.',
        '- Use line breaks to separate paragraphs',
        '- Use indentation or dashes for lists',
        '- Keep code examples minimal and clearly delimited',
      ].join('\n');
      break;

    case 'code':
      instructions = [
        '# Response Format',
        '',
        `Respond with only code in ${formatObj.language || 'the appropriate language'}.`,
        'Do not include explanations, markdown formatting, or code fences unless explicitly relevant.',
        'The code should be complete and ready to run or integrate.',
        formatObj.notes ? `\nAdditional notes: ${formatObj.notes}` : '',
      ].filter(Boolean).join('\n');
      break;

    case 'structured':
      instructions = [
        '# Response Format',
        '',
        'Structure your response using the following sections:',
        ...(Array.isArray(formatObj.sections)
          ? formatObj.sections.map((s, i) => `${i + 1}. **${s}**`)
          : ['1. **Summary**', '2. **Details**', '3. **Recommendations**']),
        '',
        'Each section should be clearly labeled with its header.',
        'Use markdown formatting within sections as appropriate.',
        formatObj.style ? `\nStyle: ${formatObj.style}` : '',
      ].filter(Boolean).join('\n');
      break;

    default:
      instructions = [
        '# Response Format',
        '',
        `Respond in ${type} format.`,
      ].join('\n');
      break;
  }

  return [prompt, '---', instructions].filter(Boolean).join(DEFAULT_SEPARATOR);
}

module.exports = {
  buildSystemPrompt,
  withRole,
  withContext,
  withConstraints,
  withOutputFormat,
};
