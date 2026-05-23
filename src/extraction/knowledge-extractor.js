"use strict";

/**
 * @fileoverview KnowledgeExtractor — extracts factual statements, how-to
 * procedures, configuration snippets, best practices, and gotchas from
 * conversation sessions.  Operates on message arrays
 * `{ role: string, content: string, timestamp?: string }` — no LLM
 * dependency, purely pattern and keyword driven.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize any message content to a plain string.
 * @param {*} content
 * @returns {string}
 */
function toText(content) {
  if (content === undefined || content === null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(toText).join(" ");
  if (typeof content === "object") {
    if (typeof content.text === "string") return content.text;
    if (typeof content.content === "string") return content.content;
    return JSON.stringify(content);
  }
  return String(content);
}

/**
 * Normalize a session/messages input to a stable message array.
 * @param {*} input
 * @returns {Array<{role: string, content: string, timestamp?: string, _index: number}>}
 */
function normalizeMessages(input) {
  const raw = input && Array.isArray(input.messages) ? input.messages
    : Array.isArray(input) ? input
    : [];
  return raw.map((m, i) => ({
    role: (m && typeof m.role === "string") ? m.role : "unknown",
    content: toText(m ? m.content : undefined),
    timestamp: (m && typeof m.timestamp === "string") ? m.timestamp : undefined,
    _index: i,
  }));
}

/**
 * Split text into sentences.
 * @param {string} text
 * @returns {string[]}
 */
function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);
}

/**
 * Score a text against a keyword list (case-insensitive).
 * @param {string} text
 * @param {string[]} keywords
 * @returns {number}
 */
function keywordScore(text, keywords) {
  const lower = text.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (lower.includes(kw)) score += 1;
  }
  return score;
}

/**
 * Deduplicate an array of items by a key extracted from each.
 * @param {Array} items
 * @param {Function} keyFn
 * @returns {Array}
 */
function deduplicate(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item).slice(0, 100).toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Keyword lists
// ---------------------------------------------------------------------------

const FACT_KEYWORDS = [
  "is a", "are a", "was a", "were a", "is the", "are the",
  "consists of", "composed of", "made up of", "contains", "includes",
  "defined as", "refers to", "means", "stands for",
  "located at", "found in", "resides in", "stored in",
  "supported by", "compatible with", "works with", "runs on",
  "version", "release", "published", "released in",
];

const HOW_TO_KEYWORDS = [
  "first", "second", "third", "fourth", "fifth",
  "step 1", "step 2", "step 3", "step 4", "step 5",
  "next", "then", "after that", "finally", "lastly",
  "begin by", "start by", "proceed to",
  "how to", "how do", "steps to", "procedure", "tutorial",
  "walkthrough", "guide",
];

const CONFIG_KEYWORDS = [
  "config", "configuration", "setting", "settings",
  "property", "properties", "option", "options",
  "parameter", "parameters", "argument", "arguments",
  "env", "environment variable", "secret", "credential",
  "api key", "token", "endpoint", "url",
];

const BEST_PRACTICE_KEYWORDS = [
  "should", "recommend", "recommended", "best practice",
  "it is better to", "prefer", "preferably", "ideally",
  "always", "never", "avoid", "do not", "don't",
  "make sure", "ensure", "be careful to",
  "consider", "it's worth", "it is worth",
  "good practice", "convention", "idiomatic",
  "standard way", "proper way", "correct way",
];

const GOTCHA_KEYWORDS = [
  "watch out", "beware", "be careful", "careful with",
  "pitfall", "gotcha", "trap", "caveat",
  "warning", "caution", "danger", "critical",
  "common mistake", "common error", "common pitfall",
  "easy to forget", "easy to miss", "overlook",
  "not obvious", "counterintuitive", "surprising",
  "unexpected", "might not", "may not", "does not work",
  "won't work", "will not work", "broken",
  "bug", "issue", "problem", "limitation", "downside",
  "drawback", "tradeoff", "trade-off",
  "compatibility issue", "breaking change",
  "deprecated", "removed", "no longer",
];

// ---------------------------------------------------------------------------
// extractFacts
// ---------------------------------------------------------------------------

/**
 * Extract factual statements from the session.
 *
 * @param {*} session - session object or message array
 * @returns {Array<{ fact: string, sourceIndex: number, category: string, confidence: string }>}
 */
function extractFacts(session) {
  const messages = normalizeMessages(session);
  const facts = [];

  for (const msg of messages) {
    const text = msg.content;
    if (!text) continue;

    // Prefer assistant messages for factual content.
    if (msg.role !== "assistant") continue;

    const sentences = splitSentences(text);

    for (const sentence of sentences) {
      const score = keywordScore(sentence, FACT_KEYWORDS);

      if (score >= 1 && sentence.length >= 10 && sentence.length <= 500) {
        // Determine category based on content.
        const lower = sentence.toLowerCase();
        let category = "general";
        if (/\b(?:version|release|v\d+)\b/i.test(lower)) category = "version";
        else if (/\b(?:located|found|stored|resides|path|directory)\b/i.test(lower)) category = "location";
        else if (/\b(?:defined|refers|means|stands for|is a type)\b/i.test(lower)) category = "definition";
        else if (/\b(?:compatible|supports|works with|runs on)\b/i.test(lower)) category = "compatibility";
        else if (/\b(?:consists|composed|contains|includes|made up)\b/i.test(lower)) category = "composition";

        const confidence = score >= 3 ? "high" : score >= 2 ? "medium" : "low";

        facts.push({
          fact: sentence.slice(0, 500),
          sourceIndex: msg._index,
          category,
          confidence,
        });
      }
    }

    // Also capture bullet-point facts from assistant messages.
    const bulletFacts = extractBulletFacts(text, FACT_KEYWORDS, "fact");
    for (const bf of bulletFacts) {
      facts.push({
        fact: bf,
        sourceIndex: msg._index,
        category: "general",
        confidence: "medium",
      });
    }
  }

  return deduplicate(facts, (f) => f.fact);
}

/**
 * Extract bullet-point items that match keywords.
 * @param {string} text
 * @param {string[]} keywords
 * @param {string} label
 * @returns {string[]}
 */
function extractBulletFacts(text, keywords, label) {
  const results = [];
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Bullet or numbered item.
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    const numMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);

    if (bulletMatch || numMatch) {
      const body = bulletMatch ? bulletMatch[1] : numMatch[1];
      if (body.length >= 10 && body.length <= 500 && keywordScore(body, keywords) >= 1) {
        results.push(body);
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// extractHowTo
// ---------------------------------------------------------------------------

/**
 * Extract step-by-step procedures from the session.
 *
 * @param {*} session - session object or message array
 * @returns {Array<{ title: string, steps: string[], sourceIndex: number, confidence: string }>}
 */
function extractHowTo(session) {
  const messages = normalizeMessages(session);
  const procedures = [];

  for (const msg of messages) {
    const text = msg.content;
    if (!text) continue;

    // First, look for explicit how-to sections.
    const howToSections = extractHowToSections(text);

    for (const section of howToSections) {
      const steps = extractSteps(section.content);
      if (steps.length >= 2) {
        procedures.push({
          title: section.title,
          steps,
          sourceIndex: msg._index,
          confidence: steps.length >= 4 ? "high" : "medium",
        });
      }
    }
  }

  return procedures;
}

/**
 * Extract sections of text that appear to be how-to guides.
 * @param {string} text
 * @returns {Array<{title: string, content: string}>}
 */
function extractHowToSections(text) {
  const sections = [];
  const paragraphs = text.split(/\n\s*\n/);

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (trimmed.length < 30) continue;

    const score = keywordScore(trimmed, HOW_TO_KEYWORDS);

    if (score >= 2) {
      // Try to extract a title from the first line.
      const firstLine = trimmed.split("\n")[0].replace(/^#+\s*/, "").trim();
      const title = firstLine.length < 100 ? firstLine : "How-to procedure";

      sections.push({ title, content: trimmed });
    }
  }

  return sections;
}

/**
 * Extract individual steps from a how-to section.
 * @param {string} content
 * @returns {string[]}
 */
function extractSteps(content) {
  const lines = content.split("\n");
  const steps = [];
  let inSteps = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (inSteps) inSteps = false;
      continue;
    }

    // Explicit step markers.
    const stepMatch = trimmed.match(/^(?:step\s+\d+[.:]\s*|(\d+)[.)]\s+)(.+)$/i);
    if (stepMatch) {
      inSteps = true;
      steps.push(stepMatch[2].trim());
      continue;
    }

    // Transition word steps (also serve as "inSteps" trigger).
    const transitionMatch = trimmed.match(/^(?:first|second|third|fourth|fifth|next|then|finally|lastly)[,:]\s*(.+)$/i);
    if (transitionMatch) {
      inSteps = true;
      steps.push(transitionMatch[1].trim());
      continue;
    }

    // Bullet items after a "steps" header.
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (bulletMatch && inSteps) {
      const body = bulletMatch[1];
      if (body.length >= 5) {
        steps.push(body);
      }
      continue;
    }
  }

  return steps;
}

// ---------------------------------------------------------------------------
// extractConfigurations
// ---------------------------------------------------------------------------

/**
 * Extract configuration snippets from the session.
 *
 * @param {*} session - session object or message array
 * @returns {Array<{ name: string, content: string, format: string, sourceIndex: number, confidence: string }>}
 */
function extractConfigurations(session) {
  const messages = normalizeMessages(session);
  const configs = [];

  for (const msg of messages) {
    const text = msg.content;
    if (!text) continue;

    // 1. Fenced code blocks with config-related language tags.
    const fencedBlockRe = /```(\w*)\s*\n([\s\S]*?)```/g;
    let match;
    while ((match = fencedBlockRe.exec(text)) !== null) {
      const lang = (match[1] || "").trim().toLowerCase();
      const configLangs = ["json", "yaml", "yml", "toml", "ini", "cfg", "conf", "env", "properties", "xml", "hcl", "tf"];
      if (configLangs.includes(lang)) {
        const body = match[2].trim();
        if (body.length < 5) continue;

        // Try to name the config from nearby context.
        const beforeMatch = text.slice(Math.max(0, match.index - 200), match.index);
        const name = inferConfigName(beforeMatch, lang);

        configs.push({
          name,
          content: body,
          format: lang,
          sourceIndex: msg._index,
          confidence: "high",
        });
      }
    }

    // 2. Inline key=value config lines in non-code text.
    const lines = text.split("\n");
    let configBlock = [];
    let inConfigBlock = false;

    for (const line of lines) {
      const trimmed = line.trim();
      const kvMatch = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/);

      if (kvMatch || /^[a-zA-Z_.]+\s*[:=]\s*/.test(trimmed)) {
        if (!inConfigBlock) {
          inConfigBlock = true;
          configBlock = [];
        }
        configBlock.push(trimmed);
      } else {
        if (inConfigBlock && configBlock.length >= 2) {
          configs.push({
            name: "inline-config",
            content: configBlock.join("\n"),
            format: "key-value",
            sourceIndex: msg._index,
            confidence: configBlock.length >= 4 ? "high" : "medium",
          });
        }
        inConfigBlock = false;
        configBlock = [];
      }
    }

    // Handle trailing block at end.
    if (inConfigBlock && configBlock.length >= 2) {
      configs.push({
        name: "inline-config",
        content: configBlock.join("\n"),
        format: "key-value",
        sourceIndex: msg._index,
        confidence: configBlock.length >= 4 ? "high" : "medium",
      });
    }

    // 3. Check for config keywords near these blocks.
    if (keywordScore(text, CONFIG_KEYWORDS) >= 1) {
      // Mark any configs from this message with higher confidence if not already high.
      for (const c of configs) {
        if (c.sourceIndex === msg._index && c.confidence !== "high") {
          c.confidence = "high";
        }
      }
    }
  }

  return deduplicate(configs, (c) => c.name + c.format + c.content.slice(0, 50));
}

/**
 * Infer a config name from context near a config block.
 * @param {string} context
 * @param {string} lang
 * @returns {string}
 */
function inferConfigName(context, lang) {
  // Look for explicit filename mentions.
  const fileMatch = context.match(/(?:file|path|from|in)\s+`?([\w.\-/\\]+\.\w{1,8})`?/i);
  if (fileMatch) return fileMatch[1];

  // Look for config purpose descriptions.
  const purposeMatch = context.match(/(\w+)\s+(?:config|configuration|settings|options)/i);
  if (purposeMatch) return purposeMatch[1] + "-config." + lang;

  return "config." + lang;
}

// ---------------------------------------------------------------------------
// extractBestPractices
// ---------------------------------------------------------------------------

/**
 * Extract recommended practices from the session.
 *
 * @param {*} session - session object or message array
 * @returns {Array<{ practice: string, sourceIndex: number, context: string, confidence: string }>}
 */
function extractBestPractices(session) {
  const messages = normalizeMessages(session);
  const practices = [];

  for (const msg of messages) {
    const text = msg.content;
    if (!text) continue;

    const paragraphs = text.split(/\n\s*\n/);

    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (trimmed.length < 20) continue;

      const score = keywordScore(trimmed, BEST_PRACTICE_KEYWORDS);
      if (score === 0) continue;

      // Extract the most relevant sentence.
      const sentences = splitSentences(trimmed);
      const practiceSentence = sentences.find((s) => keywordScore(s, BEST_PRACTICE_KEYWORDS) > 0)
        || sentences[0]
        || trimmed.slice(0, 300);

      // Determine context.
      let context = "general";
      const lower = practiceSentence.toLowerCase();
      if (/\b(?:security|vulnerab|auth|password|secret|token|encrypt)\b/i.test(lower)) context = "security";
      else if (/\b(?:performance|speed|fast|slow|optimize|efficien|memory|cache)\b/i.test(lower)) context = "performance";
      else if (/\b(?:style|format|indent|naming|convention|pattern|design)\b/i.test(lower)) context = "code-style";
      else if (/\b(?:test|testing|coverage|mock|stub|assert)\b/i.test(lower)) context = "testing";
      else if (/\b(?:error|exception|handling|catch|throw|retry|fallback)\b/i.test(lower)) context = "error-handling";
      else if (/\b(?:deploy|release|ci|cd|pipeline|production)\b/i.test(lower)) context = "deployment";

      practices.push({
        practice: practiceSentence.slice(0, 400),
        sourceIndex: msg._index,
        context,
        confidence: score >= 3 ? "high" : score >= 2 ? "medium" : "low",
      });
    }
  }

  return deduplicate(practices, (p) => p.practice);
}

// ---------------------------------------------------------------------------
// extractGotchas
// ---------------------------------------------------------------------------

/**
 * Extract pitfalls and warnings from the session.
 *
 * @param {*} session - session object or message array
 * @returns {Array<{ gotcha: string, severity: string, sourceIndex: number, context: string, confidence: string }>}
 */
function extractGotchas(session) {
  const messages = normalizeMessages(session);
  const gotchas = [];

  // Negation patterns that indicate the opposite of a gotcha.
  const negationPatterns = [
    /\bno\s+issues?\b/i,
    /\bno\s+problems?\b/i,
    /\bno\s+bugs?\b/i,
    /\bno\s+errors?\b/i,
    /\bno\s+pitfalls?\b/i,
    /\bno\s+gotchas?\b/i,
    /\bno\s+downsides?\b/i,
    /\bno\s+drawbacks?\b/i,
    /\bno\s+limitations?\b/i,
    /\bno\s+warnings?\b/i,
    /\bworks?\s+perfectly\b/i,
    /\bworks?\s+fine\b/i,
    /\bworks?\s+great\b/i,
    /\bwithout\s+(?:any\s+)?issues?\b/i,
    /\bwithout\s+(?:any\s+)?problems?\b/i,
    /\beverything\s+(?:is\s+)?(?:fine|great|good|perfect|ok|okay)\b/i,
    /\bno\s+(?:known\s+)?(?:significant|major|critical)\s+(?:issues|problems|bugs)\b/i,
  ];

  for (const msg of messages) {
    const text = msg.content;
    if (!text) continue;

    const paragraphs = text.split(/\n\s*\n/);

    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (trimmed.length < 15) continue;

      const score = keywordScore(trimmed, GOTCHA_KEYWORDS);
      if (score === 0) continue;

      // Skip paragraphs that are negations (e.g. "no issues", "works perfectly").
      if (negationPatterns.some((p) => p.test(trimmed))) continue;

      const sentences = splitSentences(trimmed);
      const gotchaSentence = sentences.find((s) => keywordScore(s, GOTCHA_KEYWORDS) > 0)
        || sentences[0]
        || trimmed.slice(0, 300);

      // Determine severity.
      let severity = "medium";
      const lower = gotchaSentence.toLowerCase();
      if (/\b(?:critical|danger|severe|fatal|crash|data loss|security|vulnerab)\b/i.test(lower)) severity = "high";
      else if (/\b(?:warning|caution|beware|careful)\b/i.test(lower)) severity = "medium";
      else if (/\b(?:note|tip|remember|minor|cosmetic)\b/i.test(lower)) severity = "low";

      // Determine context.
      let context = "general";
      if (/\b(?:api|endpoint|request|response|http|rest)\b/i.test(lower)) context = "api";
      else if (/\b(?:database|sql|query|migration|schema|table)\b/i.test(lower)) context = "database";
      else if (/\b(?:build|compile|bundl|webpack|vite|esbuild)\b/i.test(lower)) context = "build";
      else if (/\b(?:deploy|release|production|server|host|cloud)\b/i.test(lower)) context = "deployment";
      else if (/\b(?:dependency|package|module|import|require|version)\b/i.test(lower)) context = "dependency";
      else if (/\b(?:async|promise|callback|event|race condition|deadlock)\b/i.test(lower)) context = "async";
      else if (/\b(?:browser|dom|render|css|style|layout)\b/i.test(lower)) context = "frontend";

      gotchas.push({
        gotcha: gotchaSentence.slice(0, 400),
        severity,
        sourceIndex: msg._index,
        context,
        confidence: score >= 3 ? "high" : score >= 2 ? "medium" : "low",
      });
    }
  }

  return deduplicate(gotchas, (g) => g.gotcha);
}

// ---------------------------------------------------------------------------
// generateCheatsheet
// ---------------------------------------------------------------------------

/**
 * Generate a condensed reference cheatsheet from all extractions.
 *
 * @param {*} extractions - object with keys for each extraction type, or
 *   a Map/array of individual items.
 * @returns {string} formatted cheatsheet text
 */
function generateCheatsheet(extractions) {
  const lines = [];
  const divider = "=".repeat(60);

  lines.push(divider);
  lines.push("KNOWLEDGE CHEATSHEET");
  lines.push(divider);
  lines.push("");

  // Support both object form { facts: [...], howTo: [...], ... }
  // and raw arrays.
  const all = extractions && typeof extractions === "object" && !Array.isArray(extractions)
    ? extractions
    : { items: extractions };

  // Facts
  if (all.facts && all.facts.length > 0) {
    lines.push("--- FACTS (" + all.facts.length + " items) ---");
    for (const f of all.facts.slice(0, 10)) {
      const cat = f.category ? `[${f.category}] ` : "";
      lines.push(`  * ${cat}${f.fact}`);
    }
    lines.push("");
  }

  // How-to procedures
  if (all.howTo && all.howTo.length > 0) {
    lines.push("--- HOW-TO PROCEDURES (" + all.howTo.length + " items) ---");
    for (const h of all.howTo.slice(0, 5)) {
      lines.push(`  ## ${h.title}`);
      for (let i = 0; i < h.steps.length; i++) {
        lines.push(`    ${i + 1}. ${h.steps[i]}`);
      }
      lines.push("");
    }
    lines.push("");
  }

  // Configurations
  if (all.configurations && all.configurations.length > 0) {
    lines.push("--- CONFIGURATIONS (" + all.configurations.length + " items) ---");
    for (const c of all.configurations.slice(0, 10)) {
      lines.push(`  [${c.format}] ${c.name}`);
      const contentLines = c.content.split("\n").slice(0, 5);
      for (const cl of contentLines) {
        lines.push(`    ${cl}`);
      }
      if (c.content.split("\n").length > 5) {
        lines.push("    ...");
      }
      lines.push("");
    }
  }

  // Best practices
  if (all.bestPractices && all.bestPractices.length > 0) {
    lines.push("--- BEST PRACTICES (" + all.bestPractices.length + " items) ---");
    for (const bp of all.bestPractices.slice(0, 10)) {
      const ctx = bp.context ? `[${bp.context}] ` : "";
      lines.push(`  * ${ctx}${bp.practice}`);
    }
    lines.push("");
  }

  // Gotchas
  if (all.gotchas && all.gotchas.length > 0) {
    lines.push("--- GOTCHAS & WARNINGS (" + all.gotchas.length + " items) ---");
    for (const g of all.gotchas.slice(0, 10)) {
      const sev = g.severity ? `[${g.severity.toUpperCase()}] ` : "";
      const ctx = g.context ? `(${g.context}) ` : "";
      lines.push(`  * ${sev}${ctx}${g.gotcha}`);
    }
    lines.push("");
  }

  // Raw items fallback
  if (all.items && Array.isArray(all.items) && all.items.length > 0) {
    lines.push("--- EXTRACTED ITEMS ---");
    for (const item of all.items.slice(0, 15)) {
      const text = item.fact || item.practice || item.gotcha || item.title || JSON.stringify(item).slice(0, 100);
      lines.push(`  * ${text}`);
    }
    lines.push("");
  }

  if (lines.length <= 4) {
    lines.push("No knowledge was extracted from the conversation.");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// KnowledgeExtractor class
// ---------------------------------------------------------------------------

class KnowledgeExtractor {
  /**
   * @param {*} session - session object with .messages or message array
   */
  constructor(session) {
    this.session = session;
    this._messages = normalizeMessages(session);
  }

  /**
   * Extract factual statements.
   * @returns {Array<{ fact: string, sourceIndex: number, category: string, confidence: string }>}
   */
  extractFacts() {
    return extractFacts(this._messages);
  }

  /**
   * Extract step-by-step how-to procedures.
   * @returns {Array<{ title: string, steps: string[], sourceIndex: number, confidence: string }>}
   */
  extractHowTo() {
    return extractHowTo(this._messages);
  }

  /**
   * Extract configuration snippets.
   * @returns {Array<{ name: string, content: string, format: string, sourceIndex: number, confidence: string }>}
   */
  extractConfigurations() {
    return extractConfigurations(this._messages);
  }

  /**
   * Extract recommended practices.
   * @returns {Array<{ practice: string, sourceIndex: number, context: string, confidence: string }>}
   */
  extractBestPractices() {
    return extractBestPractices(this._messages);
  }

  /**
   * Extract pitfalls and warnings.
   * @returns {Array<{ gotcha: string, severity: string, sourceIndex: number, context: string, confidence: string }>}
   */
  extractGotchas() {
    return extractGotchas(this._messages);
  }

  /**
   * Generate a condensed cheatsheet from all extraction results.
   * @returns {string}
   */
  generateCheatsheet() {
    return generateCheatsheet({
      facts: this.extractFacts(),
      howTo: this.extractHowTo(),
      configurations: this.extractConfigurations(),
      bestPractices: this.extractBestPractices(),
      gotchas: this.extractGotchas(),
    });
  }

  /**
   * Run all extractors and return a composite result.
   * @returns {{ facts: Array, howTo: Array, configurations: Array, bestPractices: Array, gotchas: Array, cheatsheet: string }}
   */
  extractAll() {
    const facts = this.extractFacts();
    const howTo = this.extractHowTo();
    const configurations = this.extractConfigurations();
    const bestPractices = this.extractBestPractices();
    const gotchas = this.extractGotchas();
    const cheatsheet = generateCheatsheet({ facts, howTo, configurations, bestPractices, gotchas });

    return { facts, howTo, configurations, bestPractices, gotchas, cheatsheet };
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  KnowledgeExtractor,
  extractFacts,
  extractHowTo,
  extractConfigurations,
  extractBestPractices,
  extractGotchas,
  generateCheatsheet,
  // Helpers exported for testing.
  _internals: {
    toText,
    normalizeMessages,
    keywordScore,
    splitSentences,
    deduplicate,
    extractBulletFacts,
    extractHowToSections,
    extractSteps,
    inferConfigName,
  },
};
