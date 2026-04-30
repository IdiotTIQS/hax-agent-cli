const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseFrontmatter, extractDescriptionFromMarkdown, parseArgumentNames, substituteArguments } = require('../src/skills/parser');
const { loadSkillsFromDir, loadAllSkills } = require('../src/skills/loader');
const { recordSkillUsage, getSkillUsageScore, getSkillUsageStats } = require('../src/skills/usage');
const { createSkillifySkill } = require('../src/skills/skillify');
const {
  buildSkillSystemPrompt,
  formatSkillsList,
  matchSkillByIntent,
  extractTriggerPhrases,
  getSkillsForSession,
  SKILL_BUDGET_CHARS,
  MAX_DESC_LENGTH,
} = require('../src/skills/intent-matcher');

describe('Skill Parser', () => {
  it('should parse frontmatter from markdown content', () => {
    const content = `---
name: test-skill
description: A test skill
arguments:
  - arg1
  - arg2
---

# Test Skill

This is the content.
`;

    const { frontmatter, content: markdownContent } = parseFrontmatter(content);

    assert.strictEqual(frontmatter.name, 'test-skill');
    assert.strictEqual(frontmatter.description, 'A test skill');
    assert.deepStrictEqual(frontmatter.arguments, ['arg1', 'arg2']);
    assert.ok(markdownContent.includes('# Test Skill'));
  });

  it('should handle content without frontmatter', () => {
    const content = '# Just content';
    const { frontmatter, content: markdownContent } = parseFrontmatter(content);

    assert.deepStrictEqual(frontmatter, {});
    assert.strictEqual(markdownContent, '# Just content');
  });

  it('should extract description from markdown heading', () => {
    const content = '# My Skill Description\n\nSome content';
    const description = extractDescriptionFromMarkdown(content);

    assert.strictEqual(description, 'My Skill Description');
  });

  it('should parse argument names from various formats', () => {
    assert.deepStrictEqual(parseArgumentNames('arg1,arg2,arg3'), ['arg1', 'arg2', 'arg3']);
    assert.deepStrictEqual(parseArgumentNames(['arg1', 'arg2']), ['arg1', 'arg2']);
    assert.deepStrictEqual(parseArgumentNames(undefined), []);
  });

  it('should substitute arguments in content', () => {
    const content = 'Hello $name, welcome to $place!';
    const result = substituteArguments(content, ['Alice', 'Wonderland'], ['name', 'place']);

    assert.strictEqual(result, 'Hello Alice, welcome to Wonderland!');
  });
});

describe('Skill Loader', () => {
  it('should load skills from a directory', () => {
    const testDir = path.join(os.tmpdir(), 'hax-agent-test-skills');
    const skillDir = path.join(testDir, 'test-skill');

    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---
name: test-skill
description: A test skill for loading
---

# Test Skill

Content here.
`
    );

    try {
      const skills = loadSkillsFromDir(testDir, 'userSettings');

      assert.strictEqual(skills.length, 1);
      assert.strictEqual(skills[0].name, 'test-skill');
      assert.strictEqual(skills[0].description, 'A test skill for loading');
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should return empty array for non-existent directory', () => {
    const skills = loadSkillsFromDir('/non-existent/path', 'userSettings');
    assert.strictEqual(skills.length, 0);
  });
});

describe('Skill Usage Tracking', () => {
  it('should record skill usage', () => {
    recordSkillUsage('test-skill');
    const stats = getSkillUsageStats();

    assert.ok(stats['test-skill']);
    assert.ok(stats['test-skill'].usageCount > 0);
  });

  it('should calculate usage score', () => {
    recordSkillUsage('scored-skill');
    const score = getSkillUsageScore('scored-skill');

    assert.ok(score > 0);
  });
});

describe('Skillify Skill', () => {
  it('should create a skillify skill with session context', () => {
    const transcript = [
      { role: 'user', content: 'Help me refactor this code' },
      { role: 'assistant', content: 'Sure, let me help you with that' },
      { role: 'user', content: 'Now extract it as a skill' },
    ];

    const skillify = createSkillifySkill(transcript);

    assert.strictEqual(skillify.name, 'skillify');
    assert.ok(skillify.description.includes('repeatable process'));
    assert.ok(skillify.userInvocable);
  });

  it('should generate prompt with user messages', async () => {
    const transcript = [
      { role: 'user', content: 'Test user message' },
      { role: 'assistant', content: 'Assistant response' },
    ];

    const skillify = createSkillifySkill(transcript);
    const promptBlock = await skillify.getPromptForCommand(['test description']);

    assert.ok(promptBlock[0].text.includes('Test user message'));
    assert.ok(promptBlock[0].text.includes('test description'));
  });
});

describe('Intent Matcher', () => {
  const mockSkills = [
    {
      name: 'code-review',
      displayName: 'code-review',
      description: 'Perform a thorough code review',
      whenToUse: 'Use when the user wants to review code, check for bugs, or analyze code quality. Example: "review my changes", "check this code"',
      isHidden: false,
      source: 'projectSettings',
    },
    {
      name: 'deploy',
      displayName: 'deploy',
      description: 'Deploy application to production',
      whenToUse: 'Use when the user wants to deploy, release, or publish to production. Example: "deploy to prod", "release new version"',
      isHidden: false,
      source: 'userSettings',
    },
    {
      name: 'test-runner',
      displayName: 'test-runner',
      description: 'Run tests and report results',
      isHidden: false,
      source: 'projectSettings',
    },
  ];

  describe('extractTriggerPhrases', () => {
    it('should extract phrases from when_to_use text', () => {
      const text = 'Use when the user wants to review code. Example: "review my changes", "check this code"';
      const phrases = extractTriggerPhrases(text);

      assert.ok(phrases.length > 0);
      assert.ok(phrases.some((p) => p.includes('review')));
    });

    it('should return empty array for text without trigger phrases', () => {
      const phrases = extractTriggerPhrases('');
      assert.deepStrictEqual(phrases, []);
    });
  });

  describe('matchSkillByIntent', () => {
    it('should match skill by trigger phrase', () => {
      const message = 'Can you review my changes in the auth module?';
      const matched = matchSkillByIntent(message, mockSkills);

      assert.strictEqual(matched?.name, 'code-review');
    });

    it('should match skill by name mention', () => {
      const message = 'I want to run the test-runner';
      const matched = matchSkillByIntent(message, mockSkills);

      assert.strictEqual(matched?.name, 'test-runner');
    });

    it('should match skill by deploy phrase', () => {
      const message = 'How do I deploy to production?';
      const matched = matchSkillByIntent(message, mockSkills);

      assert.strictEqual(matched?.name, 'deploy');
    });

    it('should return null for no matching skill', () => {
      const message = 'What is the weather today?';
      const matched = matchSkillByIntent(message, mockSkills);

      assert.strictEqual(matched, null);
    });

    it('should return null for empty skills list', () => {
      const matched = matchSkillByIntent('review my code', []);
      assert.strictEqual(matched, null);
    });
  });

  describe('formatSkillsList', () => {
    it('should format skills with when_to_use descriptions', () => {
      const formatted = formatSkillsList(mockSkills);

      assert.ok(formatted.includes('code-review'));
      assert.ok(formatted.includes('Perform a thorough code review'));
      assert.ok(formatted.includes('Use when the user wants to review code'));
    });

    it('should handle skills without when_to_use', () => {
      const formatted = formatSkillsList([mockSkills[2]]);

      assert.ok(formatted.includes('test-runner'));
      assert.ok(formatted.includes('Run tests and report results'));
    });

    it('should truncate long descriptions', () => {
      const longSkill = {
        name: 'long-skill',
        displayName: 'long-skill',
        description: 'A'.repeat(300),
        whenToUse: 'B'.repeat(300),
        isHidden: false,
        source: 'projectSettings',
      };

      const formatted = formatSkillsList([longSkill]);
      assert.ok(formatted.length <= MAX_DESC_LENGTH + 20);
    });

    it('should return empty string for empty skills list', () => {
      const formatted = formatSkillsList([]);
      assert.strictEqual(formatted, '');
    });
  });

  describe('buildSkillSystemPrompt', () => {
    it('should build system prompt with skills', () => {
      const prompt = buildSkillSystemPrompt(mockSkills);

      assert.ok(prompt.includes('<system-reminder>'));
      assert.ok(prompt.includes('Available skills:'));
      assert.ok(prompt.includes('code-review'));
      assert.ok(prompt.includes('BLOCKING REQUIREMENT'));
    });

    it('should return empty string for no skills', () => {
      const prompt = buildSkillSystemPrompt([]);
      assert.strictEqual(prompt, '');
    });
  });
});
