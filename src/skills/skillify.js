const fs = require('fs');
const path = require('path');
const { getUserSkillsDir, getProjectSkillsDir } = require('./loader');

const SKILLIFY_PROMPT = `# Skillify {{userDescriptionBlock}}

You are capturing this session's repeatable process as a reusable skill.

## Your Session Context

Here are the user's messages during this session. Pay attention to how they steered the process, to help capture their detailed preferences in the skill:
<user_messages>
{{userMessages}}
</user_messages>

## Your Task

### Step 1: Analyze the Session

Before asking any questions, analyze the session to identify:
- What repeatable process was performed
- What the inputs/parameters were
- The distinct steps (in order)
- The success artifacts/criteria
- Where the user corrected or steered you
- What tools and permissions were needed
- What the goals and success criteria were

### Step 2: Interview the User

**Round 1: High level confirmation**
- Suggest a name and description for the skill based on your analysis. Ask the user to confirm or rename.
- Suggest high-level goal(s) and specific success criteria for the skill.

**Round 2: More details**
- Present the high-level steps you identified as a numbered list.
- If you think the skill will require arguments, suggest arguments based on what you observed.
- Ask where the skill should be saved. Suggest a default based on context (repo-specific workflows -> project, cross-repo personal workflows -> user). Options:
  - **Project** (\`.hax-agent/skills/<name>/SKILL.md\`) - for workflows specific to this project
  - **Personal** (\`~/.hax-agent/skills/<name>/SKILL.md\`) - follows you across all projects

**Round 3: Breaking down each step**
For each major step, if it's not clear:
- What does this step produce that later steps need?
- What proves that this step succeeded?
- Should the user be asked to confirm before proceeding?
- What are the hard constraints or preferences?

### Step 3: Write the SKILL.md

Create the skill directory and file at the location the user chose.

Use this format:

\`\`\`markdown
---
name: {{skill-name}}
description: {{one-line description}}
allowed-tools:
  {{list of tool permission patterns observed during session}}
when_to_use: {{detailed description of when to automatically invoke this skill, including trigger phrases and example user messages}}
argument-hint: "{{hint showing argument placeholders}}"
arguments:
  {{list of argument names}}
---

# {{Skill Title}}

Description of skill

## Inputs
- \`$arg_name\`: Description of this input

## Goal
Clearly stated goal for this workflow.

## Steps

### 1. Step Name
What to do in this step. Be specific and actionable.

**Success criteria**: ALWAYS include this! This shows that the step is done and we can move on.

...
\`\`\`

**Per-step annotations**:
- **Success criteria** is REQUIRED on every step.
- **Execution**: \`Direct\` (default), \`Task agent\`, or \`[human]\` (user does it).
- **Artifacts**: Data this step produces that later steps need.
- **Human checkpoint**: When to pause and ask the user before proceeding.

**Frontmatter rules**:
- \`allowed-tools\`: Minimum permissions needed (use patterns like \`shell(node:*)\` not \`shell\`)
- \`when_to_use\` is CRITICAL - tells the model when to auto-invoke. Start with "Use when..." and include trigger phrases.
- \`arguments\` and \`argument-hint\`: Only include if the skill takes parameters. Use \`$name\` in the body for substitution.

### Step 4: Confirm and Save

Before writing the file, output the complete SKILL.md content so the user can review it. Then ask for confirmation.

After writing, tell the user:
- Where the skill was saved
- How to invoke it: \`/{{skill-name}} [arguments]\`
- That they can edit the SKILL.md directly to refine it
`;

function extractUserMessages(messages) {
  return messages
    .filter((m) => m.role === 'user')
    .map((m) => {
      if (typeof m.content === 'string') return m.content;
      return '';
    })
    .filter((text) => text.trim().length > 0);
}

function createSkillifySkill(transcript) {
  return {
    type: 'skill',
    name: 'skillify',
    description: "Capture this session's repeatable process into a skill. Call at end of the process you want to capture with an optional description.",
    displayName: 'skillify',
    hasUserSpecifiedDescription: true,
    allowedTools: ['file.read', 'file.write', 'file.glob', 'file.search', 'shell.run'],
    argumentHint: '[description of the process you want to capture]',
    argNames: ['description'],
    userInvocable: true,
    isHidden: false,
    source: 'bundled',
    loadedFrom: 'bundled',
    baseDir: undefined,
    contentLength: 0,
    progressMessage: 'running',
    getPromptForCommand(args) {
      const userMessages = extractUserMessages(transcript || []);

      const userDescriptionBlock = args && args[0]
        ? `The user described this process as: "${args[0]}"`
        : '';

      const prompt = SKILLIFY_PROMPT
        .replace('{{userMessages}}', userMessages.join('\n\n---\n\n'))
        .replace('{{userDescriptionBlock}}', userDescriptionBlock);

      return [{ type: 'text', text: prompt }];
    },
  };
}

module.exports = {
  createSkillifySkill,
  SKILLIFY_PROMPT,
};
