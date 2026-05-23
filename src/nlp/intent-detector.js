"use strict";

/**
 * IntentDetector — pattern-based natural language intent detection.
 *
 * Detects the user's intent from free-form text using regex patterns and
 * keyword density analysis. No ML dependency; purely heuristic.
 *
 * Supported intents:
 *   CODE_REVIEW     — review / audit / check code for issues
 *   EXPLAIN_CODE    — explain / describe / walk through code
 *   WRITE_TESTS     — write / generate / add tests
 *   REFACTOR        — refactor / restructure / clean up code
 *   DEBUG           — debug / fix / troubleshoot issues
 *   OPTIMIZE        — optimize / improve performance / speed up
 *   DOCUMENT        — generate docs / write documentation
 *   DEPLOY          — deploy / ship / publish / release
 *   ANALYZE         — analyze / investigate / profile / measure
 *   SEARCH_CODEBASE — find / search / locate / grep
 */

// ── Intent definitions with keywords, patterns, and weights ──────────────
const INTENT_DEFINITIONS = Object.freeze([
  {
    intent: "CODE_REVIEW",
    keywords: [
      "review", "audit", "check", "inspect", "assess", "evaluate", "critique", "examine",
      "security", "vulnerability", "vulnerabilities", "bug", "issue", "flaw", "risk",
    ],
    phrases: [
      "code review", "security review", "quality check", "pull request", "peer review",
    ],
    patterns: [
      /\breview\b.{0,40}\b(code|security|changes?|diff|patch|commit|PR|pull.?request|class|function|module|file)\b/i,
      /\b(audit|assess|evaluate)\b.{0,30}\b(code|security|file|module|class|function)\b/i,
      /\b(password|secret|token|vulnerabilit|exploit|injection)\b.{0,20}\b(review|check|audit)\b/i,
      /\b(review|assess)\b.{0,50}\b(for|the)\b.{0,15}\b(security|quality|bugs?|vulnerabilit|issues?)\b/i,
    ],
    weight: 1.0,
  },
  {
    intent: "EXPLAIN_CODE",
    keywords: [
      "explain", "describe", "walk through", "elaborate", "clarify", "summarize", "understand",
      "walk me through",
    ],
    phrases: [
      "explain this", "what does", "how does", "walk me through", "describe the", "summarize",
    ],
    patterns: [
      /\b(explain|describe|walk.through|elaborate)\b.{0,50}\b(code|function|class|file|module|logic|algorithm|works|auth|middleware|service|component|method|system)\b/i,
      /\bwhat.?(does|is)\b.{0,30}\b(this|that|the)\b.{0,20}\b(code|function|class|do|mean)\b/i,
      /\bhow.?(does|is|can)\b.{0,50}\b(work|function|implement|behave)\b/i,
      /\b(break.?down|summarize|clarify)\b.{0,30}\b(code|function|class|module|logic)\b/i,
      /\b(walk|guide).{0,20}\b(through|me)\b.{0,30}\b(code|function|class|flow|process|logic|module|system|how|what)\b/i,
    ],
    weight: 0.9,
  },
  {
    intent: "WRITE_TESTS",
    keywords: [
      "test", "spec", "unit test", "integration test", "e2e test", "coverage",
      "mock", "stub", "assert", "assertEquals",
    ],
    phrases: [
      "write tests", "add tests", "generate tests", "create tests",
      "test coverage", "write unit tests", "add test cases",
    ],
    patterns: [
      /\b(write|add|generate|create)\b.{0,20}\b(tests?|specs?|unit.?tests?|integration.?tests?)\b/i,
      /\b(test.?coverage|testing|unit.?testing)\b.{0,20}\b(for|of|on|increase|improve)\b/i,
      /\b(add|generate)\b.{0,20}\b(test.?cases?|assertions?)\b/i,
      /\b(write|add|create)\b.{0,10}\b(unit|integration|e2e|end.to.end)\b.{0,10}\b(test)\b/i,
    ],
    weight: 0.95,
  },
  {
    intent: "REFACTOR",
    keywords: [
      "refactor", "restructure", "reorganize", "clean up", "simplify",
      "extract", "modularize", "decouple", "rename", "split", "separate",
    ],
    phrases: [
      "refactor this", "clean up", "restructure the", "simplify this", "extract method",
    ],
    patterns: [
      /\b(refactor|restructure|reorganize)\b.{0,50}\b(code|function|class|module|file|service|component|system)\b/i,
      /\b(clean.?up|simplify)\b.{0,30}\b(code|functions?|class(?:es)?|logic|module|service)\b/i,
      /\b(extract|modularize|decouple|separate)\b.{0,50}\b(method|function|class|module|component|logic|validation|service)\b/i,
      /\b(rename|split|merge)\b.{0,30}\b(function|class|file|module|variable)\b/i,
    ],
    weight: 0.9,
  },
  {
    intent: "DEBUG",
    keywords: [
      "debug", "fix", "bug", "error", "crash", "broken", "not working",
      "troubleshoot", "diagnose", "resolve", "exception", "stack trace",
      "returning", "failing", "failure", "wrong", "race condition", "async",
    ],
    phrases: [
      "fix this", "debug this", "not working", "throws error", "something wrong",
      "help me fix", "why is it crashing",
    ],
    patterns: [
      /\b(fix|debug|resolve|troubleshoot|diagnose)\b.{0,50}\b(bug|error|issue|crash|problem|exception)\b/i,
      /\b(not.working|broken|crashing|failing)\b/i,
      /\b(throws?|raises?|gives?|produces?|returns?)\b.{0,20}\b(error|exception|bug|crash)\b/i,
      /\b(why|what.?s).{0,40}\b(wrong|error|crash|fail|broken)\b/i,
      /\b(stack.?trace|backtrace|error.?message)\b/i,
    ],
    weight: 1.0,
  },
  {
    intent: "OPTIMIZE",
    keywords: [
      "optimize", "performance", "speed up", "faster", "slow", "bottleneck",
      "improve performance", "profile", "cache", "lazy load", "memory",
    ],
    phrases: [
      "optimize this", "speed up", "improve performance", "make faster", "too slow",
      "performance issue", "memory leak",
    ],
    patterns: [
      /\b(optimize|speed.?up|improve.?performance)\b.{0,30}\b(code|function|query|rendering|loading)\b/i,
      /\b(make|render?)\b.{0,20}\b(faster|quicker|speedier|efficient)\b/i,
      /\b(too.?slow|laggy|sluggish|bottleneck|performance.?issue)\b/i,
      /\b(memory.?leak|profile|cache|memoize|lazy.?load)\b/i,
    ],
    weight: 0.85,
  },
  {
    intent: "DOCUMENT",
    keywords: [
      "document", "docs", "documentation", "readme", "comment", "jsdoc",
      "api docs", "manual", "guide", "reference",
    ],
    phrases: [
      "write docs", "generate documentation", "document this", "add comments",
      "create readme", "api documentation",
    ],
    patterns: [
      /\b(write|generate|create|add|update)\b.{0,20}\b(docs?|documentation|readme|comments?|jsdoc)\b/i,
      /\b(document|describe)\b.{0,20}\b(api|interface|function|class|module|method)\b/i,
      /\b(api.?docs?|usage.?guide|reference.?doc)\b/i,
    ],
    weight: 0.85,
  },
  {
    intent: "DEPLOY",
    keywords: [
      "deploy", "ship", "publish", "release", "push to", "production",
      "launch", "roll out", "deliver", "continuous deployment",
    ],
    phrases: [
      "deploy to", "ship this", "publish the", "push to production", "create release",
      "release this",
    ],
    patterns: [
      /\b(deploy|ship|publish|release|launch)\b.{0,30}\b(to|this|the|app|website|production|staging)\b/i,
      /\b(push|roll.?out|deliver)\b.{0,20}\b(to|production|staging|server)\b/i,
      /\b(create|make|cut).{0,10}\b(release|deploy)\b/i,
    ],
    weight: 0.9,
  },
  {
    intent: "ANALYZE",
    keywords: [
      "analyze", "profile", "measure", "benchmark", "inspect", "investigate",
      "trace", "monitor", "audit trail", "metrics", "insights",
    ],
    phrases: [
      "analyze the", "profile this", "measure performance", "benchmark this",
      "investigate the", "trace the", "look into",
    ],
    patterns: [
      /\b(analyze|analyse|profile|benchmark|measure|investigate)\b.{0,40}\b(code|performance|function|module|system|algorithm|sorting)\b/i,
      /\b(metrics?|insights?|audit.?trail)\b.{0,20}\b(for|of|on|about)\b/i,
      /\b(measure|trace|monitor)\b.{0,20}\b(performance|latency|throughput|memory|cpu)\b/i,
    ],
    weight: 0.8,
  },
  {
    intent: "SEARCH_CODEBASE",
    keywords: [
      "find", "search", "locate", "grep", "look for", "look", "discover", "hunt",
      "where is", "show me", "list all", "explore",
    ],
    phrases: [
      "find the", "search for", "look for", "where is", "show me", "locate the",
      "list all",
    ],
    patterns: [
      /\b(find|search|locate|grep)\b.{0,40}\b(file|function|class|module|import|reference|usage|use|code|call|place)\b/i,
      /\b(where.?is|show.?me|list.?all)\b.{0,30}\b(file|function|class|module|code|the)\b/i,
      /\b(look.?for|look.?up|hunt.?down)\b.{0,20}\b(code|file|function|class|module)\b/i,
      /\b(search|find)\b.{0,15}\b(codebase|project|repo|deprecated|hardcoded|all)\b/i,
    ],
    weight: 0.85,
  },
]);

// ── Sub-intent mapping ──────────────────────────────────────────────────
const SUB_INTENT_MAP = Object.freeze({
  CODE_REVIEW: {
    security: ["security", "vulnerability", "exploit", "injection", "auth", "token", "secret", "password"],
    style: ["style", "lint", "format", "prettier", "eslint", "convention", "naming"],
    correctness: ["correctness", "logic", "bug", "error", "edge case", "regression"],
    performance: ["performance", "slow", "bottleneck", "optimize", "memory"],
    completeness: ["complete", "missing", "coverage", "edge", "boundary"],
  },
  REFACTOR: {
    extract: ["extract", "separate", "split out"],
    rename: ["rename", "rebrand", "alias"],
    simplify: ["simplify", "reduce", "shorten", "clean"],
    modularize: ["modularize", "modularise", "decouple", "component"],
    migrate: ["migrate", "upgrade", "convert", "port"],
  },
  DEBUG: {
    runtime: ["runtime", "crash", "exception", "error", "throw"],
    logic: ["logic", "wrong", "incorrect", "unexpected", "off by"],
    type: ["type", "typescript", "ts", "type error", "annotation"],
    nullref: ["null", "undefined", "nil", "none", "not defined", "cannot read"],
    async: ["async", "promise", "await", "callback", "race condition", "deadlock"],
  },
});

// ── Constructor ─────────────────────────────────────────────────────────

class IntentDetector {
  /**
   * @param {object} [options]
   * @param {number} [options.minConfidence=0.3] — minimum confidence to return an intent
   * @param {boolean} [options.allowMultiple=false] — return multiple intents if confidence ties
   */
  constructor(options = {}) {
    this._minConfidence = typeof options.minConfidence === "number" ? options.minConfidence : 0.3;
    this._allowMultiple = Boolean(options.allowMultiple);
  }

  /**
   * Detect the primary intent from a natural-language input string.
   *
   * @param {string} text — user input
   * @returns {{ intent: string|null, confidence: number, entities: object, subIntent: string|null }}
   */
  detect(text) {
    const input = String(text || "").trim();

    if (!input) {
      return { intent: null, confidence: 0, entities: {}, subIntent: null };
    }

    const normalized = input.toLowerCase();
    const words = normalized.replace(/[^a-z0-9\s-]/g, "").split(/\s+/).filter(Boolean);

    // Score every defined intent
    const scored = INTENT_DEFINITIONS.map((def) => {
      const score = this._scoreIntent(def, normalized, words, input);
      return { intent: def.intent, score };
    });

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);

    // Extract entities early — always do this regardless of intent confidence
    const entities = this._extractEntitiesInline(normalized, input);

    // Pick the best match(es)
    if (scored.length === 0 || scored[0].score < this._minConfidence) {
      return { intent: null, confidence: 0, entities, subIntent: null };
    }

    const best = scored[0];

    // Detect sub-intent
    const subIntent = this._detectSubIntent(best.intent, normalized);

    return {
      intent: best.intent,
      confidence: Math.min(1, Math.round(best.score * 100) / 100),
      entities,
      subIntent,
    };
  }

  /**
   * Return all intent scores (for debugging or multi-intent UIs).
   * @param {string} text
   * @returns {Array<{ intent: string, score: number }>}
   */
  detectAll(text) {
    const input = String(text || "").trim();
    if (!input) return [];

    const normalized = input.toLowerCase();
    const words = normalized.replace(/[^a-z0-9\s-]/g, "").split(/\s+/).filter(Boolean);

    return INTENT_DEFINITIONS.map((def) => ({
      intent: def.intent,
      score: Math.min(1, Math.round(this._scoreIntent(def, normalized, words, input) * 100) / 100),
    })).sort((a, b) => b.score - a.score);
  }

  // ── Scoring helpers ──────────────────────────────────────────────────

  /**
   * Score a single intent definition against the input.
   * @returns {number} 0–1 continuous score
   */
  _scoreIntent(def, normalized, words, input) {
    let score = 0;
    const wordSet = new Set(words);

    // 1. Keyword matches (each unique keyword adds to score)
    const matchedKeywords = def.keywords.filter((kw) => {
      const kwLower = kw.toLowerCase();
      // Multi-word keywords need phrase matching
      if (kw.includes(" ")) return normalized.includes(kwLower);
      // Exact word match
      if (wordSet.has(kwLower)) return true;
      // Stemming approximation: for keywords >=3 chars, check if any word
      // starts with the keyword (handles plurals and derived forms)
      if (kwLower.length >= 3) {
        for (const w of wordSet) {
          if (w.startsWith(kwLower)) return true;
        }
      }
      return false;
    });

    // Cap the denominator so a few strong keyword matches can dominate
    const kwDenom = Math.min(def.keywords.length, 5);
    score += (matchedKeywords.length / Math.max(kwDenom, 1)) * 0.5;

    // 2. Phrase matches (stronger signal)
    const matchedPhrases = def.phrases.filter((ph) => normalized.includes(ph.toLowerCase()));
    score += Math.min(matchedPhrases.length * 0.15, 0.3);

    // 3. Regex pattern matches (strongest signal)
    // Test against both original and normalized text for robustness
    const matchedPatterns = def.patterns.filter((re) => re.test(input) || re.test(normalized));
    score += Math.min(matchedPatterns.length * 0.25, 0.5);

    // 4. Keyword density (ratio of matched keywords to text length)
    if (words.length > 0) {
      const density = matchedKeywords.length / Math.min(words.length, 20);
      score += density * 0.15;
    }

    // 5. Position bonus — if a keyword or its stem appears in the first 3 words
    if (words.length >= 3) {
      const firstThree = new Set(words.slice(0, 3));
      const earlyMatch = def.keywords.some((kw) => {
        const kwLower = kw.toLowerCase();
        if (kw.includes(" ")) return false;
        if (firstThree.has(kwLower)) return true;
        // Check stems in first three words
        if (kwLower.length >= 3) {
          for (const w of firstThree) {
            if (w.startsWith(kwLower)) return true;
          }
        }
        return false;
      });
      if (earlyMatch) score += 0.1;
    }

    // 6. Apply the definition weight
    score *= def.weight;

    return Math.min(1, score);
  }

  /**
   * Detect the sub-intent (e.g., CODE_REVIEW → security).
   */
  _detectSubIntent(intent, normalized) {
    const map = SUB_INTENT_MAP[intent];
    if (!map) return null;

    let bestSub = null;
    let bestCount = 0;

    for (const [sub, keywords] of Object.entries(map)) {
      const count = keywords.filter((kw) => normalized.includes(kw.toLowerCase())).length;
      if (count >= bestCount) {
        bestCount = count;
        bestSub = sub;
      }
    }

    return bestCount > 0 ? bestSub : null;
  }

  /**
   * Lightweight inline entity extraction (no dependency on EntityExtractor).
   * Captures the most common entity types for intent scoring purposes.
   */
  _extractEntitiesInline(normalized, input) {
    const entities = {};

    // -- file paths --
    // Match paths like "src/auth.js", "./lib/helpers.ts", "app/models/user.rb"
    // Note: path segments use [\w-]+ (no dot) to avoid consuming the extension dot
    const filePathRe = /(?:\.{0,2}[/\\])?(?:[\w-]+[/\\])*[\w-]+\.(?:js|ts|jsx|tsx|py|go|rs|java|cpp|c|h|rb|php|swift|kt|css|scss|html|json|yaml|yml|md|sql|sh|bash|zsh|env|cfg|toml|ini|xml|vue|svelte|mjs|cjs)\b/gi;
    const fileMatches = input.match(filePathRe);
    if (fileMatches) {
      entities.files = [...new Set(fileMatches.map((f) => f.trim()))];
    }

    // -- line numbers --
    const lineMatches = input.match(/\b(?:line|lines?|:)\s*(\d+)(?:\s*[-–—to]+\s*(\d+))?/gi);
    if (lineMatches) {
      const numbers = [];
      for (const m of lineMatches) {
        const digits = m.match(/\d+/g);
        if (digits) numbers.push(...digits.map(Number));
      }
      if (numbers.length > 0) entities.lineNumbers = [...new Set(numbers)];
    }

    // -- function/class names (CamelCase or snake_case identifiers near code-context words) --
    const codeContextRe = /\b(function|method|class|component|hook|module|file)\s+`?([A-Z][A-Za-z0-9]+|[a-z][a-zA-Z0-9_]{2,})`?\b/g;
    const codeRefs = [];
    let crMatch;
    while ((crMatch = codeContextRe.exec(input)) !== null) {
      codeRefs.push(crMatch[2]);
    }
    if (codeRefs.length > 0) entities.codeReferences = [...new Set(codeRefs)];

    // -- technologies --
    const techList = [
      "react", "angular", "vue", "svelte", "next", "nuxt", "remix", "express",
      "django", "flask", "fastapi", "rails", "laravel", "spring", "dotnet",
      "node", "deno", "bun", "python", "ruby", "go", "rust", "elixir", "php",
      "kotlin", "swift", "typescript", "javascript", "graphql", "rest", "grpc",
      "postgres", "mysql", "mongodb", "redis", "sqlite", "cassandra", "dynamodb",
      "docker", "kubernetes", "aws", "azure", "gcp", "firebase", "supabase",
      "tailwind", "bootstrap", "mui", "chakra", "antd",
      "webpack", "vite", "esbuild", "rollup", "parcel",
      "jest", "mocha", "cypress", "playwright", "vitest",
      "eslint", "prettier", "husky",
      "redux", "zustand", "mobx", "recoil", "jotai",
      "prisma", "drizzle", "sequelize", "typeorm",
    ];
    const mentioned = techList.filter((t) => normalized.includes(t.toLowerCase()));
    if (mentioned.length > 0) {
      entities.technologies = mentioned;
    }

    // -- URLs --
    const urlMatches = input.match(/https?:\/\/[^\s)]+/g);
    if (urlMatches) entities.urls = [...new Set(urlMatches)];

    // -- commit hashes --
    // Match hex strings of 7-40 characters, optionally preceded by "commit" or "hash"
    const hashRe = /(?:commit|hash|SHA)\s*[:#]?\s*\b([0-9a-f]{7,40})\b|\b([0-9a-f]{7,40})\b/gi;
    const hashMatches = [];
    let hm;
    while ((hm = hashRe.exec(input)) !== null) {
      const h = hm[1] || hm[2];
      if (h) hashMatches.push(h.toLowerCase());
    }
    if (hashMatches.length > 0) entities.commitHashes = [...new Set(hashMatches)];

    return entities;
  }
}

// ── Quick convenience export ─────────────────────────────────────────────

/**
 * Convenience: detect intent in one call without constructing an instance.
 * @param {string} text
 * @returns {{ intent: string|null, confidence: number, entities: object, subIntent: string|null }}
 */
function detectIntent(text) {
  return new IntentDetector().detect(text);
}

module.exports = {
  IntentDetector,
  detectIntent,
  INTENT_DEFINITIONS,
  SUB_INTENT_MAP,
};
