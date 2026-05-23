"use strict";

/**
 * CodeReviewEngine — automated multi-perspective code review.
 *
 * Reviews source files from four complementary perspectives:
 *   - Security:      secrets, injection risks, unsafe patterns
 *   - Performance:   runtime efficiency, algorithmic bottlenecks
 *   - Maintainability: readability, complexity, error handling
 *   - Style:         formatting consistency, conventions
 *
 * Each finding has a severity (BLOCKER > CRITICAL > MAJOR > MINOR > SUGGESTION),
 * a line number, a descriptive title, and an actionable suggestion.
 *
 * The aggregate score is a weighted average of per-perspective scores.
 */

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

const SEVERITY_ORDER = {
  BLOCKER: 0,
  CRITICAL: 1,
  MAJOR: 2,
  MINOR: 3,
  SUGGESTION: 4,
};

/**
 * Create a finding object with all expected fields.
 */
function makeFinding(file, line, perspective, severity, title, message, suggestion) {
  if (!SEVERITY_ORDER.hasOwnProperty(severity)) {
    throw new Error(`Invalid severity: ${severity}. Must be one of BLOCKER, CRITICAL, MAJOR, MINOR, SUGGESTION`);
  }
  return { file: file || "<unknown>", line: line || 1, perspective, severity, title, message, suggestion };
}

/**
 * Compute a 0-100 score from findings: deduct points per severity.
 * BLOCKER: -25, CRITICAL: -15, MAJOR: -8, MINOR: -3, SUGGESTION: -1
 */
function scoreFromFindings(findings) {
  const deductions = { BLOCKER: 25, CRITICAL: 15, MAJOR: 8, MINOR: 3, SUGGESTION: 1 };
  let score = 100;
  for (const f of findings) {
    score -= (deductions[f.severity] || 0);
  }
  return Math.max(0, Math.min(100, score));
}

/**
 * Generate a one-line summary from findings.
 */
function summarizeFindings(findings, score) {
  const bySeverity = { BLOCKER: 0, CRITICAL: 0, MAJOR: 0, MINOR: 0, SUGGESTION: 0 };
  for (const f of findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
  }
  const parts = [];
  if (bySeverity.BLOCKER > 0) parts.push(`${bySeverity.BLOCKER} blocker(s)`);
  if (bySeverity.CRITICAL > 0) parts.push(`${bySeverity.CRITICAL} critical issue(s)`);
  if (bySeverity.MAJOR > 0) parts.push(`${bySeverity.MAJOR} major issue(s)`);
  if (bySeverity.MINOR > 0) parts.push(`${bySeverity.MINOR} minor issue(s)`);
  if (bySeverity.SUGGESTION > 0) parts.push(`${bySeverity.SUGGESTION} suggestion(s)`);

  if (parts.length === 0) return `Score ${score}/100. No issues found.`;
  return `Score ${score}/100. Found ${findings.length} issue(s): ${parts.join(", ")}.`;
}

/**
 * Generate top recommendations from findings, deduplicated and sorted by severity.
 */
function recommendationsFromFindings(findings) {
  const severityNum = (s) => {
    const v = SEVERITY_ORDER[s];
    return v !== undefined ? v : 99;
  };
  const best = new Map(); // key -> { severity, suggestion, file, line } (keeps most severe)
  for (const f of findings) {
    const key = f.suggestion || f.message;
    if (!key) continue;
    const existing = best.get(key);
    if (!existing || severityNum(f.severity) < severityNum(existing.severity)) {
      best.set(key, { severity: f.severity, suggestion: f.suggestion || f.message, file: f.file, line: f.line });
    }
  }
  const recs = Array.from(best.values());
  // Sort most severe first
  recs.sort((a, b) => severityNum(a.severity) - severityNum(b.severity));
  return recs.slice(0, 20);
}

// ---------------------------------------------------------------------------
// Pattern helpers
// ---------------------------------------------------------------------------

function countMatches(str, pattern) {
  const m = str.match(pattern);
  return m ? m.length : 0;
}

/**
 * Find all line numbers where a regex pattern matches.
 */
function findLineNumbers(content, pattern) {
  const lines = content.split("\n");
  const results = [];
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      results.push(i + 1); // 1-indexed
    }
  }
  return results;
}

/**
 * Find all matches of a regex pattern, returning { line, match } objects.
 */
function findMatches(content, pattern) {
  const lines = content.split("\n");
  const results = [];
  for (let i = 0; i < lines.length; i++) {
    let m;
    const linePattern = new RegExp(pattern.source, pattern.flags);
    while ((m = linePattern.exec(lines[i])) !== null) {
      results.push({ line: i + 1, match: m[0] });
      if (!linePattern.global) break;
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Security review
// ---------------------------------------------------------------------------

/**
 * Review a single file from a security perspective.
 *
 * Checks: hardcoded secrets, eval/exec, injection vectors, unsafe crypto,
 * path traversal, XSS, unsafe regex (ReDoS).
 *
 * @param {{ path: string, content: string }} file
 * @param {{ [key: string]: any }} [options]
 * @returns {{ perspective: string, findings: Array, score: number }}
 */
function reviewSecurity(file, options) {
  const findings = [];
  const content = file.content;
  const filePath = file.path;

  // 1) Hardcoded secrets
  const secretPatterns = [
    { pattern: /api[_-]?key\s*[:=]\s*['"`][A-Za-z0-9_\-]{16,}['"`]/gi, label: "API key" },
    { pattern: /secret\s*[:=]\s*['"`][A-Za-z0-9_\-]{8,}['"`]/gi, label: "secret" },
    { pattern: /password\s*[:=]\s*['"`][^'"]+['"`]/gi, label: "password" },
    { pattern: /token\s*[:=]\s*['"`][A-Za-z0-9_\-]{12,}['"`]/gi, label: "token" },
    { pattern: /ghp_[A-Za-z0-9]{36,}/g, label: "GitHub personal access token" },
    { pattern: /sk-[A-Za-z0-9]{32,}/g, label: "OpenAI/Stripe API key" },
    { pattern: /AKIA[0-9A-Z]{16}/g, label: "AWS access key" },
    { pattern: /\bBEGIN\s+(RSA|EC|DSA|OPENSSH)\s+PRIVATE\s+KEY\b/gi, label: "private key" },
    { pattern: /-----BEGIN\s+(RSA|EC|DSA|OPENSSH)\s+PRIVATE\s+KEY-----/gi, label: "PEM private key" },
    { pattern: /(?:access|auth|bearer)\s*[:=]\s*['"`][A-Za-z0-9_\-]{16,}['"`]/gi, label: "credential" },
  ];

  for (const { pattern, label } of secretPatterns) {
    const matches = findMatches(content, pattern);
    for (const m of matches) {
      findings.push(makeFinding(
        filePath, m.line, "security", "BLOCKER",
        `Hardcoded ${label}`,
        `Found a potential hardcoded ${label.toLowerCase()} on line ${m.line}. This is a severe security risk and should never be committed to version control.`,
        `Move ${label.toLowerCase()} to an environment variable (process.env.SECRET_NAME) or a secure secrets manager. Use dotenv for development.`,
      ));
    }
  }

  // 2) eval() usage
  const evalMatches = findMatches(content, /\beval\s*\(/g);
  for (const m of evalMatches) {
    findings.push(makeFinding(
      filePath, m.line, "security", "CRITICAL",
      "Use of eval()",
      "eval() executes arbitrary strings as code, creating a code injection vulnerability. Any user-controlled input passed to eval() is a critical security risk.",
      "Replace eval() with JSON.parse() for data, a parser for DSLs, or the Function() constructor only when input is fully trusted.",
    ));
  }

  // 3) child_process.exec with user input risk
  const execMatches = findMatches(content, /(?:child_process\.)?exec\s*\(/g);
  for (const m of execMatches) {
    findings.push(makeFinding(
      filePath, m.line, "security", "CRITICAL",
      "Potentially unsafe child_process.exec()",
      "exec() spawns a shell and interprets the full command string, making it vulnerable to shell injection if any part includes unsanitized user input.",
      "Use child_process.execFile() with argument arrays instead of exec(). Always sanitize user input before passing to shell commands.",
    ));
  }

  // 4) Command injection via string interpolation in spawn
  const spawnInjection = findMatches(content, /(?:child_process\.)?spawn\s*\(\s*['"`][^'"]*\$\{?/g);
  for (const m of spawnInjection) {
    findings.push(makeFinding(
      filePath, m.line, "security", "CRITICAL",
      "Potential command injection in spawn()",
      "String interpolation inside spawn() command strings can lead to command injection if variables contain unsanitized user input.",
      "Pass the command and arguments as separate array elements to spawn(). Sanitize all user-supplied values.",
    ));
  }

  // 5) SQL injection patterns
  const sqlInjectionPatterns = [
    { pattern: /(["']\s*\+\s*\w+\s*\+\s*["'])\s*(?:SELECT|INSERT|UPDATE|DELETE|DROP)/gi, label: "Concatenated SQL" },
    { pattern: /`\$\{[^}]*\}\s*(?:SELECT|INSERT|UPDATE|DELETE|DROP)/gi, label: "Template-literal SQL" },
  ];

  for (const { pattern, label } of sqlInjectionPatterns) {
    const matches = findMatches(content, pattern);
    for (const m of matches) {
      findings.push(makeFinding(
        filePath, m.line, "security", "CRITICAL",
        `Potential SQL injection: ${label}`,
        `Building SQL queries with string concatenation or template literals is highly vulnerable to SQL injection attacks.`,
        "Use parameterized queries (prepared statements) with ? placeholders. Never concatenate user input directly into SQL strings.",
      ));
    }
  }

  // 6) XSS patterns (innerHTML, document.write)
  const xssPatterns = [
    { pattern: /\.innerHTML\s*=/g, label: "innerHTML" },
    { pattern: /document\.write\s*\(/g, label: "document.write()" },
    { pattern: /dangerouslySetInnerHTML/g, label: "dangerouslySetInnerHTML" },
    { pattern: /\$\(['"`].*<.*>['"`]\)/g, label: "jQuery HTML injection" },
  ];

  for (const { pattern, label } of xssPatterns) {
    const matches = findMatches(content, pattern);
    for (const m of matches) {
      findings.push(makeFinding(
        filePath, m.line, "security", "CRITICAL",
        `Potential XSS vulnerability: ${label}`,
        `Using ${label} with unsanitized input allows cross-site scripting (XSS) attacks. Attackers can inject arbitrary scripts into the page.`,
        `Use textContent instead of innerHTML, React's JSX (auto-escapes), or a sanitization library like DOMPurify before inserting HTML.`,
      ));
    }
  }

  // 7) Path traversal
  const pathTraversalPatterns = [
    { pattern: /path\.join\s*\(\s*[^,]*\$\{?.*\.\./g, label: "path.join with '../'" },
    { pattern: /\+\s*['"`]\/.*\.\.[\/\\]/g, label: "string concatenated path traversal" },
    { pattern: /\.\.\/\.\./g, label: "relative path traversal" },
  ];

  for (const { pattern, label } of pathTraversalPatterns) {
    const matches = findMatches(content, pattern);
    for (const m of matches) {
      findings.push(makeFinding(
        filePath, m.line, "security", "MAJOR",
        `Potential path traversal: ${label}`,
        `Constructing file paths with '../' can lead to directory traversal, allowing access to files outside the intended directory.`,
        "Use path.resolve() to normalize paths, then verify the result starts with the expected base directory before accessing files.",
      ));
    }
  }

  // 8) Unsafe RegExp (ReDoS)
  const redosPatterns = [
    { pattern: /\(\.\+\)\+/g, label: "nested quantifiers (.+)+" },
    { pattern: /\(\.\*\)\*/g, label: "nested quantifiers (.*)*" },
    { pattern: /\(\?:\.\+\|[\s\S]\)\*\+/g, label: "polynomial backtracking" },
  ];

  for (const { pattern, label } of redosPatterns) {
    const matches = findMatches(content, pattern);
    for (const m of matches) {
      findings.push(makeFinding(
        filePath, m.line, "security", "MAJOR",
        `ReDoS vulnerability: ${label}`,
        `This regular expression pattern can cause catastrophic backtracking (ReDoS), leading to CPU exhaustion on certain inputs.`,
        "Rewrite the regex to be non-backtracking, or add a timeout mechanism. Use possessive quantifiers (++) or atomic groups where available.",
      ));
    }
  }

  // 9) Weak crypto
  const weakCryptoPatterns = [
    { pattern: /\bcreateHash\s*\(\s*['"]md5['"]\s*\)/g, label: "MD5" },
    { pattern: /\bcreateHash\s*\(\s*['"]sha1['"]\s*\)/g, label: "SHA-1" },
    { pattern: /\bMath\.random\s*\(\)/g, label: "Math.random() for security" },
    { pattern: /['"]des['"]/gi, label: "DES cipher" },
    { pattern: /['"]rc4['"]/gi, label: "RC4 cipher" },
  ];

  for (const { pattern, label } of weakCryptoPatterns) {
    const matches = findMatches(content, pattern);
    for (const m of matches) {
      findings.push(makeFinding(
        filePath, m.line, "security", "MAJOR",
        `Weak cryptography: ${label}`,
        `${label} is cryptographically broken and should not be used for security-sensitive operations.`,
        `Use SHA-256 or SHA-3 for hashing, crypto.randomBytes() for randomness, and AES-GCM for encryption.`,
      ));
    }
  }

  // 10) console.log of sensitive data
  const consoleSensitive = findMatches(content, /console\.(?:log|debug|info)\s*\(\s*(?:password|secret|token|key|credential)/gi);
  for (const m of consoleSensitive) {
    findings.push(makeFinding(
      filePath, m.line, "security", "MAJOR",
      "Sensitive data logged to console",
      "Logging sensitive data to stdout/stderr can expose secrets in production logs or terminal output.",
      "Remove or redact sensitive values from console output. Use a structured logger with PII scrubbing for production.",
    ));
  }

  const score = scoreFromFindings(findings);
  return { perspective: "security", findings, score };
}

// ---------------------------------------------------------------------------
// Performance review
// ---------------------------------------------------------------------------

/**
 * Review a single file from a performance perspective.
 *
 * Checks: sync operations in async context, nested loops (O(n^2)),
 * regex in loops, large array copies, missing batch operations,
 * string concatenation in loops, unbounded loops.
 *
 * @param {{ path: string, content: string }} file
 * @param {{ [key: string]: any }} [options]
 * @returns {{ perspective: string, findings: Array, score: number }}
 */
function reviewPerformance(file, options) {
  const findings = [];
  const content = file.content;
  const filePath = file.path;
  const lines = content.split("\n");

  // 1) Sync file operations in async context
  const syncFsPatterns = [
    { pattern: /\bfs\.readFileSync\b/g, label: "fs.readFileSync" },
    { pattern: /\bfs\.writeFileSync\b/g, label: "fs.writeFileSync" },
    { pattern: /\bfs\.readdirSync\b/g, label: "fs.readdirSync" },
    { pattern: /\bfs\.statSync\b/g, label: "fs.statSync" },
    { pattern: /\bfs\.mkdirSync\b/g, label: "fs.mkdirSync" },
  ];

  for (const { pattern, label } of syncFsPatterns) {
    const matches = findMatches(content, pattern);
    for (const m of matches) {
      findings.push(makeFinding(
        filePath, m.line, "performance", "MAJOR",
        `Synchronous file operation: ${label}`,
        `${label} blocks the event loop, preventing concurrent I/O and degrading performance in server applications.`,
        `Use the async equivalents (fs.promises.readFile, fs/promises.writeFile) with await, or fs.readFile with callbacks.`,
      ));
    }
  }

  // 2) Nested loops (potential O(n^2))
  // Track nesting depth of for/while loops by scanning lines
  let loopDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const opensLoop = /\b(for|while)\s*\(/.test(trimmed) && /[{;]\s*$/.test(trimmed);
    const closesBlock = /^\s*\}?\s*\}?\s*$/.test(trimmed);

    if (opensLoop) {
      loopDepth++;
      if (loopDepth >= 2) {
        findings.push(makeFinding(
          filePath, i + 1, "performance", "MAJOR",
          "Nested loop (potential O(n^2) complexity)",
          "A loop inside another loop can cause quadratic time complexity, which degrades quickly as input size grows.",
          "Consider using a Map/Set for O(1) lookups, pre-compute values outside the inner loop, or restructure the algorithm for O(n log n) or O(n).",
        ));
        loopDepth--; // Only report once per nesting level
      }
    }
    if (closesBlock && loopDepth > 0) {
      // Count closing braces to handle multiple blocks closing on same line
      const closeCount = (trimmed.match(/\}/g) || []).length;
      loopDepth = Math.max(0, loopDepth - closeCount);
    }
  }

  // 3) Regex in loops
  const regexInLoopLines = [];
  let insideLoop = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/\b(for|while)\s*\(/.test(line)) insideLoop = true;
    if (insideLoop && /\.match\(|\.test\(|\.exec\(|\.replace\(.*\/|RegExp/.test(line) && !/^\s*\}?\s*$/.test(line)) {
      regexInLoopLines.push(i + 1);
    }
    if (insideLoop && /^\s*\}\s*$/.test(line)) insideLoop = false;
  }
  for (const line of regexInLoopLines) {
    findings.push(makeFinding(
      filePath, line, "performance", "MAJOR",
      "Regular expression executed inside a loop",
      "Compiling/executing a regex on every loop iteration is costly. If the same regex is used repeatedly, compile it once outside the loop.",
      "Move the RegExp or compiled regex outside the loop so it is created only once. Cache the regex in a constant.",
    ));
  }

  // 4) String concatenation in loops
  const stringConcatInLoopLines = [];
  insideLoop = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/\b(for|while)\s*\(/.test(line)) insideLoop = true;
    if (insideLoop && /\+\=/.test(line) && !/^\s*\}?\s*$/.test(line) && !/number|= \d/.test(line)) {
      stringConcatInLoopLines.push(i + 1);
    }
    if (insideLoop && /^\s*\}\s*$/.test(line)) insideLoop = false;
  }
  for (const line of stringConcatInLoopLines) {
    findings.push(makeFinding(
      filePath, line, "performance", "MINOR",
      "String concatenation in loop",
      "Using += to build strings in a loop creates many intermediate string objects. Use an array with .push() and .join() instead for better performance.",
      "Push items to an array inside the loop and call array.join('') after the loop completes.",
    ));
  }

  // 5) Large array/object copies (spread or slice in hot path indicators)
  const largeCopyIndicators = findMatches(content, /\.\.\.(?![\s]*\w+\s*[,;)}\]])\w+\.(?:map|filter|reduce)\b/g);
  for (const m of largeCopyIndicators) {
    findings.push(makeFinding(
      filePath, m.line, "performance", "MINOR",
      "Potential unnecessary array copy before chaining",
      "Spreading a potentially large array before chaining .map()/.filter() creates an intermediate copy, doubling memory usage.",
      "Avoid unnecessary intermediate copies. Chain .map().filter() directly on the original array where possible, or use .flatMap().",
    ));
  }

  // 6) Missing pagination / LIMIT on queries
  const unboundedQueryPatterns = [
    { pattern: /\bSELECT\b(?!.*\bLIMIT\b)/gi, label: "SELECT without LIMIT" },
    { pattern: /\bfind\s*\(\s*\{\s*\}\s*\)/g, label: "find({}) without limit" },
  ];

  for (const { pattern, label } of unboundedQueryPatterns) {
    const matches = findMatches(content, pattern);
    for (const m of matches) {
      findings.push(makeFinding(
        filePath, m.line, "performance", "MINOR",
        `Potentially unbounded query: ${label}`,
        "Queries without LIMIT or pagination can return all rows, causing memory pressure and slow responses on large datasets.",
        "Add LIMIT and pagination (offset/cursor-based) to all queries. Consider streaming results for very large datasets.",
      ));
    }
  }

  // 7) console.time / console.timeEnd left in production
  const timeDebug = findMatches(content, /\bconsole\.(?:time|timeEnd|profile)\s*\(/g);
  for (const m of timeDebug) {
    findings.push(makeFinding(
      filePath, m.line, "performance", "SUGGESTION",
      "Debug timing left in code",
      "console.time()/timeEnd() calls are useful for development debugging but may add noise to production output.",
      "Remove debug timing calls before merging, or guard them behind a debug flag (if (DEBUG) console.time(...)).",
    ));
  }

  const score = scoreFromFindings(findings);
  return { perspective: "performance", findings, score };
}

// ---------------------------------------------------------------------------
// Maintainability review
// ---------------------------------------------------------------------------

/**
 * Review a single file from a maintainability perspective.
 *
 * Checks: magic numbers, deep nesting, long functions, too many parameters,
 * duplicate code, unclear names, missing error handling, dead/commented code.
 *
 * @param {{ path: string, content: string }} file
 * @param {{ [key: string]: any }} [options]
 * @returns {{ perspective: string, findings: Array, score: number }}
 */
function reviewMaintainability(file, options) {
  const findings = [];
  const content = file.content;
  const filePath = file.path;
  const lines = content.split("\n");
  const nonEmpty = lines.filter((l) => l.trim().length > 0);

  // 1) Magic numbers (excluding common ones: 0, 1, -1, 2, 100, 1000)
  const magicNumberExclusions = /(?:\b(?:0|1|2|-1|100|1000|255|60|24|365|1024|12|10|8|7)\b|^\s*(?:import|const|let|var|function|class|if|for|while|switch|case|return|module\.exports|exports\.))/;
  const magicNumberPattern = /\b(?<!['"`])(\d{2,})(?!['"`])\b/g;
  const magicMatches = findMatches(content, magicNumberPattern);
  for (const m of magicMatches) {
    const lineContent = lines[m.line - 1];
    if (magicNumberExclusions.test(lineContent)) continue;
    const num = parseInt(m.match, 10);
    if (num < 3 || num === 100 || num === 1000 || num === 1024 || num === 365 || num === 255 || num === 60 || num === 24 || num === 12 || num === 10 || num === 8 || num === 7) continue;
    findings.push(makeFinding(
      filePath, m.line, "maintainability", "MINOR",
      "Magic number detected",
      `The number ${num} appears without a named constant, making the code harder to understand and maintain. Future changes require finding every occurrence.`,
      `Extract ${num} into a named constant (e.g., const MAX_RETRIES = ${num};) that describes its purpose.`,
    ));
  }

  // 2) Deep nesting
  let maxDepth = 0;
  for (const line of nonEmpty) {
    const depth = Math.floor((line.match(/^(\s*)/) || [""])[0].length / 2);
    if (depth > maxDepth) maxDepth = depth;
  }
  if (maxDepth > 5) {
    // Find the deepest line
    let deepestLine = 0;
    let deepestIndent = 0;
    for (let i = 0; i < lines.length; i++) {
      const indent = (lines[i].match(/^(\s*)/) || [""])[0].length;
      if (indent > deepestIndent) {
        deepestIndent = indent;
        deepestLine = i + 1;
      }
    }
    findings.push(makeFinding(
      filePath, deepestLine, "maintainability", "MAJOR",
      "Deep nesting detected",
      `Maximum nesting depth is approximately ${maxDepth} levels. Deeply nested code is hard to read, test, and modify.`,
      "Refactor by extracting inner blocks into well-named helper functions. Use early returns and guard clauses to flatten the nesting.",
    ));
  }

  // 3) Long functions (heuristic: many lines between function/class def and next def)
  {
    const fnStartPattern = /^(?:\s*)(?:async\s+)?(?:function\s+\w+|(?:\w+\s*[:=]\s*(?:async\s+)?)?(?:function\s*)?\([^)]*\)\s*(?:=>\s*)?\{)/;
    const classMethodPattern = /^\s*(?:async\s+)?(?:\w+)\s*\([^)]*\)\s*\{/;
    let fnStart = null;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (fnStartPattern.test(lines[i]) || classMethodPattern.test(lines[i])) {
        if (fnStart && (i - fnStart > 80)) {
          findings.push(makeFinding(
            filePath, fnStart + 1, "maintainability", "MAJOR",
            "Long function detected",
            `Function starting near line ${fnStart + 1} is approximately ${i - fnStart} lines long (threshold: 80). Long functions are harder to understand and test.`,
            "Break the function into smaller, focused functions that each handle one concern. A good target is < 30 lines per function.",
          ));
        }
        fnStart = i;
      }
    }
    // Check last function
    if (fnStart && (lines.length - fnStart > 80)) {
      findings.push(makeFinding(
        filePath, fnStart + 1, "maintainability", "MAJOR",
        "Long function detected",
        `Function starting near line ${fnStart + 1} is approximately ${lines.length - fnStart} lines long.`,
        "Break the function into smaller, focused helper functions.",
      ));
    }
  }

  // 4) Too many function parameters (heuristic: > 5)
  const tooManyParamsPattern = /(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:function)?)\s*\(([^)]{30,})\)/g;
  let mp;
  while ((mp = tooManyParamsPattern.exec(content)) !== null) {
    const paramsStr = mp[1];
    const paramCount = paramsStr.split(",").length;
    if (paramCount > 5) {
      const lineNum = content.slice(0, mp.index).split("\n").length;
      findings.push(makeFinding(
        filePath, lineNum, "maintainability", "MAJOR",
        "Too many function parameters",
        `Function has ${paramCount} parameters (threshold: 5). Many parameters make the function hard to call correctly and indicate the function does too much.`,
        "Group related parameters into a configuration object. This improves readability and makes the function easier to extend.",
      ));
    }
  }

  // 5) Catch blocks that swallow errors
  const emptyCatch = findMatches(content, /\bcatch\s*\([^)]*\)\s*\{\s*\}/g);
  for (const m of emptyCatch) {
    findings.push(makeFinding(
      filePath, m.line, "maintainability", "MAJOR",
      "Empty catch block (swallowed error)",
      "An empty catch block silently discards errors, making debugging extremely difficult. Failures will go completely unnoticed.",
      "At minimum, log the error. Better: handle it explicitly (retry, fallback, re-throw, or report to error monitoring).",
    ));
  }

  // 6) Commented-out code blocks (heuristic: > 3 consecutive commented lines that look like code)
  let consecutiveCommented = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^\s*\/\//.test(trimmed) && /[{}();=]/.test(trimmed)) {
      consecutiveCommented++;
      if (consecutiveCommented === 4) {
        findings.push(makeFinding(
          filePath, i - 2, "maintainability", "MINOR",
          "Commented-out code detected",
          "Blocks of commented-out code clutter the file and create confusion about whether the code is needed. Version control tracks removed code.",
          "Remove commented-out code. If the logic is genuinely needed later, reference a git commit SHA or create a ticket with the old code.",
        ));
        break;
      }
    } else if (!/^\s*\/\//.test(trimmed) || !/[{}();=]/.test(trimmed)) {
      consecutiveCommented = 0;
    }
  }

  // 7) TODO / FIXME / HACK without tracking
  const todoMatches = findMatches(content, /\b(?:TODO|FIXME|HACK)\b(?!\s*(?:#|\/\/|:)\s*(?:JIRA-|GH-\d+|issue\s*#?\d+|[A-Z]+-\d+))/gi);
  for (const m of todoMatches) {
    findings.push(makeFinding(
      filePath, m.line, "maintainability", "SUGGESTION",
      "Untracked TODO/FIXME/HACK",
      "A TODO, FIXME, or HACK comment exists without a tracking reference (issue number, ticket ID). Untracked tasks are often forgotten.",
      "Add a reference like TODO(#123), FIXME(JIRA-456), or HACK(GH-789) so the task can be tracked and prioritized.",
    ));
  }

  // 8) Duplicate code: exact lines repeated
  const lineFreq = new Map();
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length > 8 && !/^\s*(?:\/\/|\/\*|\*|import |const |let |var |export |module\.|require\()/.test(lines[i])) {
      if (!lineFreq.has(trimmed)) lineFreq.set(trimmed, []);
      lineFreq.get(trimmed).push(i + 1);
    }
  }
  const duplicateCount = Array.from(lineFreq.values()).filter((indices) => indices.length > 2).length;
  if (duplicateCount > 3) {
    findings.push(makeFinding(
      filePath, 1, "maintainability", "MINOR",
      "Code duplication detected",
      `Found ${duplicateCount} line patterns repeated more than twice, suggesting copy-paste code that should be extracted.`,
      "Extract repeated logic into a shared function or constant. This reduces bugs and makes future changes easier.",
    ));
  }

  const score = scoreFromFindings(findings);
  return { perspective: "maintainability", findings, score };
}

// ---------------------------------------------------------------------------
// Style review
// ---------------------------------------------------------------------------

/**
 * Review a single file from a style/consistency perspective.
 *
 * Checks: inconsistent indentation, mixed quotes, trailing whitespace,
 * missing/excess semicolons, line length, console.log in production code,
 * inconsistent brace style, mixed naming conventions.
 *
 * @param {{ path: string, content: string }} file
 * @param {{ [key: string]: any }} [options]
 * @returns {{ perspective: string, findings: Array, score: number }}
 */
function reviewStyle(file, options) {
  const findings = [];
  const content = file.content;
  const filePath = file.path;
  const lines = content.split("\n");

  // 1) Trailing whitespace
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > 0 && /[ \t]$/.test(lines[i])) {
      findings.push(makeFinding(
        filePath, i + 1, "style", "MINOR",
        "Trailing whitespace",
        `Line ${i + 1} has trailing whitespace, which creates unnecessary diffs and is considered a code smell.`,
        "Configure your editor to strip trailing whitespace on save. Most linters (ESLint, biome) can auto-fix this.",
      ));
      if (findings.filter((f) => f.title === "Trailing whitespace").length >= 5) break;
    }
  }

  // 2) Mixed quotes (single vs double)
  const singleQuoteCount = countMatches(content, /'[^']*'/g);
  const doubleQuoteCount = countMatches(content, /"[^"]*"/g);
  const templateLiteralCount = countMatches(content, /`[^`]*\$\{[^}]*\}[^`]*`/g);

  const totalQuotes = singleQuoteCount + doubleQuoteCount - templateLiteralCount;
  if (totalQuotes > 0 && singleQuoteCount > 0 && doubleQuoteCount > 0) {
    const pctSingle = Math.round((singleQuoteCount / totalQuotes) * 100);
    const pctDouble = Math.round((doubleQuoteCount / totalQuotes) * 100);
    if (pctSingle >= 20 && pctDouble >= 20) {
      findings.push(makeFinding(
        filePath, 1, "style", "MINOR",
        "Inconsistent quote usage",
        `File uses both single quotes (${pctSingle}%) and double quotes (${pctDouble}%). Consistency improves readability.`,
        `Choose one quote style (e.g., single quotes) and use it consistently. Use template literals only when embedding expressions.`,
      ));
    }
  }

  // 3) Line length > 120 characters
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > 120) {
      findings.push(makeFinding(
        filePath, i + 1, "style", "MINOR",
        "Line exceeds 120 characters",
        `Line ${i + 1} is ${lines[i].length} characters long. Long lines are hard to read in side-by-side diffs and on smaller screens.`,
        "Break the line at logical points using method chaining, intermediate variables, or multi-line template literals.",
      ));
      if (findings.filter((f) => f.title === "Line exceeds 120 characters").length >= 5) break;
    }
  }

  // 4) console.log in production code (exclude test files)
  if (!filePath.includes(".test.") && !filePath.includes(".spec.") && !filePath.includes("/test/") && !filePath.includes("\\test\\")) {
    const consoleMatches = findMatches(content, /\bconsole\.(?:log|debug|info|warn|dir)\s*\(/g);
    for (const m of consoleMatches) {
      findings.push(makeFinding(
        filePath, m.line, "style", "MINOR",
        "console.log in non-test code",
        "console.log() calls in production code can leak information, clutter logs, and indicate missing structured logging.",
        "Replace with a proper logging library (winston, pino) with configurable log levels. Remove debug logging before merging.",
      ));
      if (findings.filter((f) => f.title === "console.log in non-test code").length >= 3) break;
    }
  }

  // 5) Missing "use strict" at top of file
  if (!/^["']use strict["'];?\s*$/m.test(content) && !filePath.endsWith(".mjs") && !filePath.endsWith(".cjs") && !filePath.endsWith(".json")) {
    findings.push(makeFinding(
      filePath, 1, "style", "MINOR",
      "Missing 'use strict' directive",
      "The file does not start with 'use strict', which enables stricter parsing and error handling in JavaScript.",
      "Add '\"use strict\";' as the first line of the file (after the hashbang if present).",
    ));
  }

  // 6) Mixed naming conventions (camelCase vs snake_case variables)
  const camelConsts = countMatches(content, /\b(?:const|let|var)\s+([a-z]+[A-Z][a-zA-Z]*)\s*=/g);
  const snakeConsts = countMatches(content, /\b(?:const|let|var)\s+([a-z]+(?:_[a-z]+)+)\s*=/g);
  if (camelConsts > 2 && snakeConsts > 2) {
    findings.push(makeFinding(
      filePath, 1, "style", "MINOR",
      "Mixed naming conventions",
      `File uses both camelCase (${camelConsts} variables) and snake_case (${snakeConsts} variables). Pick one convention for consistency.`,
      "Use camelCase for all JavaScript variable names per the standard convention. Reserve UPPER_SNAKE_CASE for true constants only.",
    ));
  }

  // 7) Console.assert in production
  const assertMatches = findMatches(content, /\bconsole\.assert\s*\(/g);
  for (const m of assertMatches) {
    findings.push(makeFinding(
      filePath, m.line, "style", "MINOR",
      "console.assert in production code",
      "console.assert() only logs a message in most environments; it does not throw or stop execution, making it a poor replacement for real assertions.",
      "Use real assertions (Node.js assert module) or throw Error for invalid states. Remove debug-only console.assert calls.",
    ));
    break;
  }

  // 8) Multiple empty lines in a row
  let consecutiveEmpty = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "") {
      consecutiveEmpty++;
      if (consecutiveEmpty === 3) {
        findings.push(makeFinding(
          filePath, i - 1, "style", "SUGGESTION",
          "Multiple consecutive blank lines",
          "Found 3 or more consecutive blank lines, which adds unnecessary vertical space and hurts readability.",
          "Use a maximum of 1 blank line between logical sections. Use section comments (// ----) if more separation is needed.",
        ));
        break;
      }
    } else {
      consecutiveEmpty = 0;
    }
  }

  const score = scoreFromFindings(findings);
  return { perspective: "style", findings, score };
}

// ---------------------------------------------------------------------------
// CodeReviewEngine
// ---------------------------------------------------------------------------

const PERSPECTIVES = ["security", "performance", "maintainability", "style"];

class CodeReviewEngine {
  /**
   * @param {{ perspectives?: string[], scoreThreshold?: number, severityFilter?: string }} [options]
   */
  constructor(options = {}) {
    this._options = options;
    this._perspectives = options.perspectives ? [...options.perspectives] : [...PERSPECTIVES];
    this._scoreThreshold = options.scoreThreshold || 0;
    this._severityFilter = options.severityFilter || null;
    this._reviewers = {
      security: reviewSecurity,
      performance: reviewPerformance,
      maintainability: reviewMaintainability,
      style: reviewStyle,
    };
    this._lastResult = null;
  }

  /**
   * Get the list of enabled review perspectives.
   * @returns {string[]}
   */
  getPerspectives() {
    return [...this._perspectives];
  }

  /**
   * Register a custom reviewer for a perspective.
   * @param {string} name - perspective name
   * @param {function} reviewerFn - (file, options) => { perspective, findings, score }
   */
  registerReviewer(name, reviewerFn) {
    if (typeof name !== "string" || !name.trim()) {
      throw new Error("Reviewer name must be a non-empty string");
    }
    if (typeof reviewerFn !== "function") {
      throw new Error("Reviewer must be a function");
    }
    this._reviewers[name] = reviewerFn;
    if (!this._perspectives.includes(name)) {
      this._perspectives.push(name);
    }
    return this;
  }

  /**
   * Remove a reviewer by name.
   * @param {string} name
   */
  removeReviewer(name) {
    delete this._reviewers[name];
    this._perspectives = this._perspectives.filter((p) => p !== name);
    return this;
  }

  /**
   * Review a single file from a specific perspective.
   *
   * @param {{ path: string, content: string }} file
   * @param {string} perspective - "security" | "performance" | "maintainability" | "style" (or custom)
   * @param {{ [key: string]: any }} [options]
   * @returns {{ perspective: string, findings: Array, score: number }}
   */
  reviewPerspective(file, perspective, options) {
    if (!file || typeof file.content !== "string") {
      throw new TypeError("file must be an object with { path, content }");
    }
    if (typeof file.path !== "string") {
      throw new TypeError("file.path must be a string");
    }

    const reviewer = this._reviewers[perspective];
    if (!reviewer) {
      throw new Error(`Unknown perspective: ${perspective}. Available: ${Object.keys(this._reviewers).join(", ")}`);
    }

    let result;
    try {
      result = reviewer(file, options);
    } catch (error) {
      result = {
        perspective,
        findings: [
          makeFinding(file.path, 1, perspective, "CRITICAL", "Reviewer error", `Reviewer '${perspective}' threw: ${error.message}`, "Check reviewer implementation for bugs."),
        ],
        score: 0,
      };
    }

    // Validate result shape
    if (!result.findings || !Array.isArray(result.findings)) {
      result.findings = [];
    }
    if (result.score === undefined) {
      result.score = scoreFromFindings(result.findings);
    }

    return result;
  }

  /**
   * Convenience: security-focused review of a single file.
   */
  reviewSecurity(file, options) {
    return this.reviewPerspective(file, "security", options);
  }

  /**
   * Convenience: performance-focused review of a single file.
   */
  reviewPerformance(file, options) {
    return this.reviewPerspective(file, "performance", options);
  }

  /**
   * Convenience: maintainability review of a single file.
   */
  reviewMaintainability(file, options) {
    return this.reviewPerspective(file, "maintainability", options);
  }

  /**
   * Convenience: style/consistency review of a single file.
   */
  reviewStyle(file, options) {
    return this.reviewPerspective(file, "style", options);
  }

  /**
   * Review one or more files from all enabled perspectives.
   *
   * @param {{ path: string, content: string } | Array<{ path: string, content: string }>} files - single file or array of files
   * @param {{ perspectives?: string[], scoreThreshold?: number, severityFilter?: string }} [options]
   * @returns {{ findings: Array, score: number, summary: string, recommendations: Array, fileCount: number, perspectives: Array }}
   */
  review(files, options = {}) {
    const fileList = Array.isArray(files) ? files : [files];
    if (fileList.length === 0) {
      return {
        findings: [],
        score: 100,
        summary: "No files to review.",
        recommendations: [],
        fileCount: 0,
        perspectives: [],
      };
    }

    const perspectives = options.perspectives || this._perspectives;
    const allFindings = [];
    const perFileResults = [];

    for (const file of fileList) {
      for (const perspective of perspectives) {
        if (!this._reviewers[perspective]) continue;
        const result = this.reviewPerspective(file, perspective, options);
        allFindings.push(...result.findings);
        perFileResults.push({ file: file.path, ...result });
      }
    }

    // Apply severity filter if set
    let filteredFindings = allFindings;
    const severityFilter = options.severityFilter || this._severityFilter;
    if (severityFilter) {
      const allowed = new Set();
      const levels = ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "SUGGESTION"];
      let include = false;
      for (const level of levels) {
        if (level === severityFilter) include = true;
        if (include) allowed.add(level);
      }
      filteredFindings = allFindings.filter((f) => allowed.has(f.severity));
    }

    // Deduplicate findings with same title+file+line
    const seen = new Set();
    const deduped = [];
    for (const f of filteredFindings) {
      const key = `${f.file}:${f.line}:${f.title}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(f);
      }
    }

    const overallScore = scoreFromFindings(deduped);
    const summary = summarizeFindings(deduped, overallScore);
    const recommendations = recommendationsFromFindings(deduped);

    const result = {
      findings: deduped,
      score: overallScore,
      summary,
      recommendations,
      fileCount: fileList.length,
      perspectives,
    };

    this._lastResult = result;
    return result;
  }

  /**
   * Get the most recent review result.
   * @returns {object|null}
   */
  getLastResult() {
    return this._lastResult;
  }
}

module.exports = {
  CodeReviewEngine,
  reviewSecurity,
  reviewPerformance,
  reviewMaintainability,
  reviewStyle,
  makeFinding,
  scoreFromFindings,
  summarizeFindings,
  recommendationsFromFindings,
  SEVERITY_ORDER,
  PERSPECTIVES,
};
