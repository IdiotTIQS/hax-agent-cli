const fs = require('fs');
const path = require('path');

function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);

  if (!match) {
    return { frontmatter: {}, content: content };
  }

  const rawFrontmatter = match[1];
  const markdownContent = match[2];

  const parsed = {};
  const lines = rawFrontmatter.split('\n');
  let currentKey = null;
  let currentArray = null;

  for (const line of lines) {
    const arrayMatch = line.match(/^(\w[\w-]*):\s*$/);
    const keyValueMatch = line.match(/^(\w[\w-]*):\s*(.+)$/);
    const arrayItemMatch = line.match(/^\s+-\s+(.+)$/);

    if (arrayMatch) {
      currentKey = arrayMatch[1];
      currentArray = [];
      parsed[currentKey] = currentArray;
    } else if (keyValueMatch) {
      currentKey = keyValueMatch[1];
      const value = keyValueMatch[2].trim();

      if (value.startsWith('[') && value.endsWith(']')) {
        parsed[currentKey] = value
          .slice(1, -1)
          .split(',')
          .map((item) => item.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean);
      } else {
        parsed[currentKey] = value.replace(/^["']|["']$/g, '');
      }

      currentArray = null;
    } else if (arrayItemMatch && currentArray) {
      currentArray.push(arrayItemMatch[1].trim());
    } else if (line.trim() === '' && currentArray) {
      continue;
    }
  }

  return { frontmatter: parsed, content: markdownContent };
}

function extractDescriptionFromMarkdown(content, fallback = 'Skill') {
  const firstLine = content.split('\n').find((line) => line.trim().length > 0);

  if (firstLine && firstLine.startsWith('# ')) {
    return firstLine.slice(2).trim();
  }

  return `${fallback} description`;
}

function parseArgumentNames(argumentsField) {
  if (!argumentsField) return [];

  if (typeof argumentsField === 'string') {
    return argumentsField
      .split(',')
      .map((arg) => arg.trim())
      .filter(Boolean);
  }

  if (Array.isArray(argumentsField)) {
    return argumentsField.filter((arg) => typeof arg === 'string');
  }

  return [];
}

function substituteArguments(content, args, argumentNames) {
  if (!args || !argumentNames || argumentNames.length === 0) {
    return content;
  }

  let result = content;

  for (let i = 0; i < argumentNames.length; i++) {
    const argName = argumentNames[i];
    const argValue = args[i] || '';
    result = result.replace(new RegExp(`\\$${argName}`, 'g'), argValue);
  }

  return result;
}

module.exports = {
  parseFrontmatter,
  extractDescriptionFromMarkdown,
  parseArgumentNames,
  substituteArguments,
};
