'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Valid severity levels */
const SEVERITY_LEVELS = Object.freeze(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);

/** Valid rule categories */
const CATEGORIES = Object.freeze([
  'PII',
  'SECRET',
  'INJECTION',
  'HARMFUL',
  'PHISHING',
  'MALWARE',
  'OFFENSIVE',
]);

// ---------------------------------------------------------------------------
// Pre-built rules
// ---------------------------------------------------------------------------

/** @returns {RegExp} */
function buildPiiPatterns() {
  return [
    // SSN (US Social Security Number)
    { name: 'ssn', pattern: /\b\d{3}[ -]?\d{2}[ -]?\d{4}\b/g },
    // Credit card numbers (Visa, MC, Amex, Discover)
    { name: 'credit_card', pattern: /\b(?:\d{4}[ -]?){3}\d{4}\b|\b\d{4}[ -]?\d{6}[ -]?\d{5}\b/g },
    // Email addresses
    { name: 'email', pattern: /\b[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}\b/g },
    // Phone numbers (international and common formats)
    { name: 'phone', pattern: /\b(?:\+\d{1,3}[ -]?)?\(?\d{3}\)?[ -]?\d{3}[ -]?\d{4}\b/g },
    // IPv4 addresses
    { name: 'ipv4', pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
    // Passport numbers (US format: 9 digits)
    { name: 'passport', pattern: /\b[A-Z]\d{8}\b/g },
  ];
}

/** @returns {RegExp} */
function buildSecretPatterns() {
  return [
    // OpenAI API keys
    { name: 'openai_key', pattern: /sk-[A-Za-z0-9-_]{20,}/g },
    // GitHub tokens
    { name: 'github_token', pattern: /gh[pousr]_[A-Za-z0-9_]{20,}/g },
    // AWS access keys
    { name: 'aws_key', pattern: /AKIA[0-9A-Z]{16}/g },
    // Generic bearer tokens
    { name: 'bearer_token', pattern: /bearer\s+[A-Za-z0-9\-._~+/]+/gi },
    // JWT tokens
    { name: 'jwt', pattern: /eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/g },
    // Generic key-value secrets
    { name: 'secret_kv', pattern: /(api[_-]?key|secret|token|password|passwd|auth)\s*[:=]\s*\S+/gi },
  ];
}

// ---------------------------------------------------------------------------
// Rule evaluation context helpers
// ---------------------------------------------------------------------------

/**
 * Calculate a simple risk score from violation count and severity.
 * @param {Array<{ severity: string }>} violations
 * @returns {{ score: number, level: string }}
 */
function computeRiskScore(violations) {
  if (violations.length === 0) return { score: 0, level: 'NONE' };

  const weights = { CRITICAL: 25, HIGH: 15, MEDIUM: 8, LOW: 3, INFO: 1 };
  let score = 0;

  for (const v of violations) {
    score += weights[v.severity] || 1;
  }

  // Cap at 100
  score = Math.min(score, 100);

  let level;
  if (score >= 75) level = 'CRITICAL';
  else if (score >= 50) level = 'HIGH';
  else if (score >= 25) level = 'MEDIUM';
  else if (score >= 10) level = 'LOW';
  else if (score > 0) level = 'INFO';
  else level = 'NONE';

  return { score, level };
}

// ---------------------------------------------------------------------------
// Pre-built rule definitions
// ---------------------------------------------------------------------------

/**
 * @returns {object[]} the standard set of content-safety rules
 */
function createDefaultRules() {
  return [
    {
      name: 'piiDetection',
      category: 'PII',
      severity: 'HIGH',
      enabled: true,
      description: 'Detects personally identifiable information such as SSN, credit cards, emails, and phone numbers.',
      evaluate(text, _context) {
        const matches = [];
        const patterns = buildPiiPatterns();
        for (const { name, pattern } of patterns) {
          // Reset regex state
          pattern.lastIndex = 0;
          let match;
          while ((match = pattern.exec(text)) !== null) {
            matches.push({
              rule: 'piiDetection',
              type: 'PII',
              severity: name === 'ssn' || name === 'credit_card' ? 'CRITICAL' : 'HIGH',
              evidence: match[0],
              detail: `Detected potential PII (${name})`,
              location: match.index,
            });
          }
        }
        return matches;
      },
    },

    {
      name: 'secretLeakDetection',
      category: 'SECRET',
      severity: 'CRITICAL',
      enabled: true,
      description: 'Detects leaked secrets: API keys, tokens, passwords, and credentials.',
      evaluate(text, _context) {
        const matches = [];
        const patterns = buildSecretPatterns();
        for (const { name, pattern } of patterns) {
          pattern.lastIndex = 0;
          let match;
          while ((match = pattern.exec(text)) !== null) {
            matches.push({
              rule: 'secretLeakDetection',
              type: 'SECRET',
              severity: 'CRITICAL',
              evidence: match[0],
              detail: `Detected potential secret (${name})`,
              location: match.index,
            });
          }
        }
        return matches;
      },
    },

    {
      name: 'injectionDetection',
      category: 'INJECTION',
      severity: 'CRITICAL',
      enabled: true,
      description: 'Detects prompt injection, SQL injection, shell injection, and XSS attempts.',
      evaluate(text, _context) {
        const matches = [];
        const injectionPatterns = [
          // Prompt injection: "ignore previous instructions", "you are now", etc.
          { name: 'prompt_injection', pattern: /\b(?:ignore\s+(?:all\s+)?(?:previous|above|prior)\s+(?:instructions?|prompts?|commands?|directives?)|you\s+are\s+now\s+(?:a[n]?\s+)?(?:DAN|jailbroken|unshackled|free)|pretend\s+(?:to\s+be|you\s+are)|forget\s+(?:everything|all)\s+(?:above|before|previous)|system\s*:\s*you\s+(?:are|must|will|should))/gi },
          // SQL injection patterns
          { name: 'sql_injection', pattern: /(?:'|")\s*(?:OR|AND)\s+(?:'?\d+'?|=|LIKE)\s*(?:'?\d+'?|")|(?:;\s*(?:DROP|DELETE|INSERT|UPDATE|ALTER|CREATE)\s+|--\s*$)|(?:UNION\s+(?:ALL\s+)?SELECT)/gi },
          // Shell injection
          { name: 'shell_injection', pattern: /[;&|`$](?:\s*(?:rm\s+-rf|mkfs|dd\s+if|wget\s+|curl\s+)[^;\n]*|[^;\n]*\/etc\/(?:passwd|shadow))/gi },
          // XSS patterns
          { name: 'xss', pattern: /<script[^>]*>[\s\S]*?<\/script[^>]*>|javascript\s*:|on\w+\s*=\s*["'][^"']*["']/gi },
          // System prompt extraction
          { name: 'system_extraction', pattern: /\b(?:print|show|reveal|display|tell\s+me\s+(?:about\s+)?)\s+(?:your\s+(?:system\s+)?(?:prompt|instructions?)|everything\s+(?:above|before))\b/gi },
        ];

        for (const { name, pattern } of injectionPatterns) {
          pattern.lastIndex = 0;
          let match;
          while ((match = pattern.exec(text)) !== null) {
            matches.push({
              rule: 'injectionDetection',
              type: 'INJECTION',
              severity: 'CRITICAL',
              evidence: match[0].substring(0, 120),
              detail: `Detected potential ${name.replace(/_/g, ' ')}`,
              location: match.index,
            });
          }
        }
        return matches;
      },
    },

    {
      name: 'harmfulContentDetection',
      category: 'HARMFUL',
      severity: 'HIGH',
      enabled: true,
      description: 'Detects harmful content: violence, self-harm, illicit activities, hate speech.',
      evaluate(text, _context) {
        const matches = [];
        const harmfulPatterns = [
          { name: 'self_harm', pattern: /\b(?:suicide|self[ -]?harm|kill\s+(?:myself|yourself)|end\s+(?:my|your)\s+(?:life|existence)|cut\s+(?:myself|yourself))\b/gi },
          { name: 'violence_threat', pattern: /\b(?:i\s+(?:will|am\s+going\s+to)\s+(?:kill|murder|shoot|stab|bomb|attack)|shoot\s+(?:up|down)|pipe\s+bomb|mass\s+(?:shooting|murder))\b/gi },
          { name: 'hate_speech', pattern: /\b(?:(?:i\s+hate|kill\s+all|death\s+to)\s*(?:all\s+)?\w+(?:s|ers|ists)?|racial\s+(?:slur|epithet)|ethnic\s+cleansing)\b/gi },
          { name: 'illicit_activities', pattern: /\b(?:how\s+to\s+(?:make|build|create)\s+(?:a\s+)?(?:bomb|weapon|drug|meth|explosive)|buy\s+(?:illegal\s+)?(?:drugs|weapons|firearms)|hack\s+(?:into|someone)|crack\s+(?:passwords?|accounts?))\b/gi },
          { name: 'csam_indicators', pattern: /\b(?:child\s+(?:porn|abuse|exploitation)|underage\s+(?:sexual|nudity)|minor\s+(?:sexual|exploitation))\b/gi },
        ];

        for (const { name, pattern } of harmfulPatterns) {
          pattern.lastIndex = 0;
          let match;
          while ((match = pattern.exec(text)) !== null) {
            const evidence = match[0].substring(0, 150);
            matches.push({
              rule: 'harmfulContentDetection',
              type: 'HARMFUL',
              severity: name === 'csam_indicators' ? 'CRITICAL' : 'HIGH',
              evidence,
              detail: `Detected potentially harmful content (${name.replace(/_/g, ' ')})`,
              location: match.index,
            });
          }
        }
        return matches;
      },
    },

    {
      name: 'phishingDetection',
      category: 'PHISHING',
      severity: 'HIGH',
      enabled: true,
      description: 'Detects phishing attempts, social engineering, and credential harvesting.',
      evaluate(text, _context) {
        const matches = [];
        const phishingPatterns = [
          { name: 'credential_harvest', pattern: /\b(?:verify\s+(?:your|the)\s+(?:account|password|login|credentials)|update\s+(?:your|the)\s+(?:account|billing|payment)\s+(?:info|information|details)|confirm\s+(?:your|the)\s+(?:identity|credentials))\b/gi },
          { name: 'urgency_bait', pattern: /\b(?:your\s+account\s+(?:has\s+been|will\s+be)\s+(?:suspended|locked|limited|closed|terminated)|urgent\s+(?:action|security)\s+(?:required|needed|alert)|immediate\s+(?:action|attention)\s+required)\b/gi },
          { name: 'fake_reward', pattern: /\b(?:congratulations?\s*(?:!|,)\s*you\s+(?:have\s+)?(?:won|been\s+selected)|claim\s+(?:your|the)\s+(?:prize|reward|gift|refund)|free\s+(?:gift|iphone|money|crypto|bitcoin)|click\s+(?:here|below|this\s+link)\s+to\s+(?:claim|redeem|verify)|limited\s+(?:time|offer))\b/gi },
          { name: 'impersonation', pattern: /\b(?:we\s+are\s+(?:calling|writing|contacting)\s+(?:from|on\s+behalf\s+of)\s+(?:microsoft|apple|google|amazon|paypal|your\s+bank|irs|fbi)|official\s+(?:notice|communication)\s+from\b)/gi },
        ];

        for (const { name, pattern } of phishingPatterns) {
          pattern.lastIndex = 0;
          let match;
          while ((match = pattern.exec(text)) !== null) {
            matches.push({
              rule: 'phishingDetection',
              type: 'PHISHING',
              severity: 'HIGH',
              evidence: match[0].substring(0, 150),
              detail: `Detected potential phishing/social engineering (${name.replace(/_/g, ' ')})`,
              location: match.index,
            });
          }
        }
        return matches;
      },
    },

    {
      name: 'malwareDetection',
      category: 'MALWARE',
      severity: 'CRITICAL',
      enabled: true,
      description: 'Detects malware-related content: malicious scripts, payloads, C2 indicators.',
      evaluate(text, _context) {
        const matches = [];
        const malwarePatterns = [
          { name: 'obfuscated_script', pattern: /\b(?:eval\s*\(\s*(?:atob|unescape|String\.fromCharCode|decodeURIComponent)|\bfromCharCode\s*\(\s*\[.*?\]|atob\s*\(\s*['"][A-Za-z0-9+/=]{40,}['"])\b/gi },
          { name: 'reverse_shell', pattern: /\b(?:bash\s+-i\s*>&|nc\s+-[elnv]+\s+\S+\s+\d+|python\s+-c\s+['"]import\s+(?:socket|os|subprocess|pty)|powershell\s+(?:-e|-enc|-encodedcommand|-nop|-w\s+hidden))/gi },
          { name: 'payload_delivery', pattern: /\b(?:download\s+(?:and\s+)?execute|Invoke-Expression|IEX\s*\(|Start-Process\s+-FilePath|cmd\.exe\s+\/c|certutil\s+-urlcache|bitsadmin\s+\/transfer)\b/gi },
          { name: 'c2_patterns', pattern: /\b(?:beacon|callback|connectback|listener|bind\s+shell|meterpreter|cobalt\s+strike|empire\s+agent)\b/gi },
        ];

        for (const { name, pattern } of malwarePatterns) {
          pattern.lastIndex = 0;
          let match;
          while ((match = pattern.exec(text)) !== null) {
            matches.push({
              rule: 'malwareDetection',
              type: 'MALWARE',
              severity: 'CRITICAL',
              evidence: match[0].substring(0, 150),
              detail: `Detected potential malware indicator (${name.replace(/_/g, ' ')})`,
              location: match.index,
            });
          }
        }
        return matches;
      },
    },

    {
      name: 'offensiveContentDetection',
      category: 'OFFENSIVE',
      severity: 'MEDIUM',
      enabled: true,
      description: 'Detects offensive, abusive, or profane content.',
      evaluate(text, _context) {
        const matches = [];
        // This is a basic filter; production systems should use more comprehensive lists
        const profanityList = [
          /\b(?:profane1|profane2|profane3)\b/gi, // placeholder — replace with real profanity patterns
        ];

        const abusePatterns = [
          { name: 'threat', pattern: /\b(?:i(?:'ll| will)\s+(?:fuck(?:ing)?|f\*ck(?:ing)?)?\s*(?:kill|destroy|ruin)\s+(?:you|your))\b/gi },
          { name: 'harassment', pattern: /\b(?:shut\s+(?:the\s+)?(?:fuck|hell)\s+up|go\s+(?:fuck|kill)\s+(?:yourself|yourselves)|piece\s+of\s+shit)\b/gi },
          { name: 'doxxing', pattern: /\b(?:i(?:'ll| will)\s+(?:find|leak|post|publish)\s+(?:your\s+)?(?:address|location|info|information|personal\s+(?:info|data)))\b/gi },
        ];

        for (const { name, pattern } of abusePatterns) {
          pattern.lastIndex = 0;
          let match;
          while ((match = pattern.exec(text)) !== null) {
            matches.push({
              rule: 'offensiveContentDetection',
              type: 'OFFENSIVE',
              severity: name === 'doxxing' ? 'HIGH' : 'MEDIUM',
              evidence: match[0].substring(0, 120),
              detail: `Detected offensive content (${name})`,
              location: match.index,
            });
          }
        }

        for (const pattern of profanityList) {
          pattern.lastIndex = 0;
          let match;
          while ((match = pattern.exec(text)) !== null) {
            matches.push({
              rule: 'offensiveContentDetection',
              type: 'OFFENSIVE',
              severity: 'LOW',
              evidence: match[0],
              detail: 'Detected profane language',
              location: match.index,
            });
          }
        }

        return matches;
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// RulesEngine
// ---------------------------------------------------------------------------

/**
 * Content safety rules engine that manages a collection of rules and evaluates
 * text against them to detect policy violations.
 */
class RulesEngine {
  /**
   * @param {object[]} [rules] — initial set of rules (defaults to pre-built rules)
   */
  constructor(rules) {
    this._rules = new Map();

    if (rules === undefined || rules === null) {
      // No argument: use default rules
      for (const rule of createDefaultRules()) {
        this.addRule(rule);
      }
    } else {
      // Explicit array (may be empty): use provided rules
      for (const rule of rules) {
        this.addRule(rule);
      }
    }
  }

  /**
   * Add a content safety rule.
   *
   * @param {object} rule
   * @param {string} rule.name — unique rule name
   * @param {string} rule.category — category from CATEGORIES
   * @param {string} [rule.severity] — severity level (default: 'MEDIUM')
   * @param {boolean} [rule.enabled] — whether rule is enabled (default: true)
   * @param {string} [rule.description] — human-readable description
   * @param {function} rule.evaluate — (text: string, context?: object) => Array<object>
   * @throws {TypeError} if rule is missing required fields
   */
  addRule(rule) {
    if (!rule || typeof rule !== 'object') {
      throw new TypeError('addRule: rule must be an object');
    }
    if (typeof rule.name !== 'string' || rule.name.trim().length === 0) {
      throw new TypeError('addRule: rule must have a non-empty name');
    }
    if (typeof rule.evaluate !== 'function') {
      throw new TypeError('addRule: rule must have an evaluate function');
    }
    if (typeof rule.category !== 'string' || !CATEGORIES.includes(rule.category)) {
      throw new TypeError(`addRule: rule "${rule.name}" has invalid category "${rule.category}". Valid: ${CATEGORIES.join(', ')}`);
    }

    const normalized = {
      name: rule.name,
      category: rule.category,
      severity: SEVERITY_LEVELS.includes(rule.severity) ? rule.severity : 'MEDIUM',
      enabled: rule.enabled !== false,
      description: typeof rule.description === 'string' ? rule.description : '',
      evaluate: rule.evaluate,
    };

    this._rules.set(normalized.name, normalized);
    return this;
  }

  /**
   * Run all enabled rules against the given text.
   *
   * @param {string} text — text to evaluate
   * @param {object} [context] — optional context (e.g. { source: 'input', toolName: '...' })
   * @returns {object} with `violations`, `score`, `level`, and `summary` fields
   */
  evaluate(text, context = {}) {
    if (typeof text !== 'string') {
      throw new TypeError('evaluate: text must be a string');
    }

    const violations = [];

    for (const rule of this._rules.values()) {
      if (!rule.enabled) continue;

      let results;
      try {
        results = rule.evaluate(text, context);
      } catch (_err) {
        // If a rule throws, skip it but continue evaluating others
        continue;
      }

      if (!Array.isArray(results)) continue;

      for (const hit of results) {
        violations.push({
          type: hit.type || rule.category,
          severity: hit.severity || rule.severity,
          location: typeof hit.location === 'number' ? hit.location : -1,
          evidence: typeof hit.evidence === 'string' ? hit.evidence : '',
          rule: hit.rule || rule.name,
          detail: typeof hit.detail === 'string' ? hit.detail : '',
          category: rule.category,
          source: context.source || 'unknown',
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Deduplicate violations that have the same evidence at the same location
    const seen = new Set();
    const deduped = [];
    for (const v of violations) {
      const key = `${v.rule}:${v.location}:${v.evidence}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(v);
      }
    }

    const risk = computeRiskScore(deduped);

    return Object.freeze({
      violations: Object.freeze(deduped),
      score: risk.score,
      level: risk.level,
      summary: deduped.length === 0
        ? 'No content safety violations detected.'
        : `Found ${deduped.length} violation(s) across ${new Set(deduped.map((v) => v.rule)).size} rule(s). Risk level: ${risk.level} (${risk.score}/100).`,
    });
  }

  /**
   * Enable a rule by name.
   *
   * @param {string} name — rule name
   * @returns {boolean} true if the rule was found and enabled
   */
  enableRule(name) {
    const rule = this._rules.get(name);
    if (!rule) return false;
    rule.enabled = true;
    return true;
  }

  /**
   * Disable a rule by name.
   *
   * @param {string} name — rule name
   * @returns {boolean} true if the rule was found and disabled
   */
  disableRule(name) {
    const rule = this._rules.get(name);
    if (!rule) return false;
    rule.enabled = false;
    return true;
  }

  /**
   * Get all rules with their current status.
   *
   * @returns {object[]} array of rule descriptor objects
   */
  getRules() {
    const result = [];
    for (const rule of this._rules.values()) {
      result.push({
        name: rule.name,
        category: rule.category,
        severity: rule.severity,
        enabled: rule.enabled,
        description: rule.description,
      });
    }
    return result;
  }

  /**
   * Remove a rule by name.
   *
   * @param {string} name
   * @returns {boolean} true if removed
   */
  removeRule(name) {
    return this._rules.delete(name);
  }

  /**
   * Reset the engine to use the default pre-built rules.
   */
  reset() {
    this._rules.clear();
    for (const rule of createDefaultRules()) {
      this.addRule(rule);
    }
  }
}

module.exports = {
  RulesEngine,
  createDefaultRules,
  computeRiskScore,
  SEVERITY_LEVELS,
  CATEGORIES,
};
