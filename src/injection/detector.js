'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Threat levels ordered by severity.
 */
const THREAT_LEVELS = Object.freeze({
  NONE: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
});

/**
 * Named threat levels for getThreatLevel() return.
 */
const THREAT_LEVEL_NAMES = Object.freeze(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

/**
 * Detection categories emitted by the detector.
 */
const DETECTION_TYPES = Object.freeze([
  'instruction_override',
  'role_confusion',
  'delimiter_injection',
  'encoded_payload',
  'tool_manipulation',
]);

// ---------------------------------------------------------------------------
// Compiled detection patterns
// ---------------------------------------------------------------------------

/**
 * Each entry: { name, severity, category, rx (RegExp), desc }
 * Patterns are kept simple to avoid catastrophic backtracking.
 */
function buildPatterns() {
  return [
    // -- instruction_override --
    {
      name: 'ignore_instructions',
      severity: 'CRITICAL',
      category: 'instruction_override',
      rx: /ignore\s+(all\s+)?(previous|above|prior|earlier)\s+(instructions?|prompts?|commands?|directives?)/gi,
      desc: 'Attempt to ignore or override agent instructions',
    },
    {
      name: 'disregard_instructions',
      severity: 'CRITICAL',
      category: 'instruction_override',
      rx: /(disregard|forget|skip|override)\s+(all\s+)?(previous|above|prior|earlier|the\s+)?\s*(instructions?|prompts?|commands?|directives?)/gi,
      desc: 'Attempt to disregard or forget agent instructions',
    },
    {
      name: 'new_instruction',
      severity: 'CRITICAL',
      category: 'instruction_override',
      rx: /your\s+(new|updated|revised|actual|real|true)\s+(instructions?|prompts?|directives?|system\s+(?:prompt|message))/gi,
      desc: 'Attempt to inject new system instructions',
    },
    {
      name: 'override_command',
      severity: 'CRITICAL',
      category: 'instruction_override',
      rx: /(from\s+now\s+on|starting\s+now|henceforth|hereafter)\s+you\s+(are|will|must|should|can)/gi,
      desc: 'Attempt to permanently alter agent behavior',
    },
    {
      name: 'priority_override',
      severity: 'HIGH',
      category: 'instruction_override',
      rx: /(overrides?|takes?\s+precedence|has\s+(higher|top)\s+priority)\s+(than|over)/gi,
      desc: 'Attempt to establish instruction priority',
    },
    {
      name: 'reveal_system_prompt',
      severity: 'HIGH',
      category: 'instruction_override',
      rx: /(print|show|reveal|display|output|repeat|echo|tell\s+me)\s+your\s+(system\s+)?(prompt|instructions?|directives?|message)/gi,
      desc: 'Attempt to extract system prompt',
    },

    // -- role_confusion --
    {
      name: 'role_assignment',
      severity: 'CRITICAL',
      category: 'role_confusion',
      rx: /(you\s+are\s+now|pretend\s+(to\s+be|you\s+are|that\s+you\s+are)|act\s+as\s+(if\s+you\s+are|though\s+you\s+were))/gi,
      desc: 'Attempt to assign a new role to the agent',
    },
    {
      name: 'jailbreak_role',
      severity: 'CRITICAL',
      category: 'role_confusion',
      rx: /\b(DAN|jailbreak|unshackled|unchained|unfiltered|unrestricted|unlimited|developer\s*mode|god\s*mode|admin\s*mode|root\s*mode)\b/i,
      desc: 'Jailbreak role patterns',
    },
    {
      name: 'scenario_framing',
      severity: 'HIGH',
      category: 'role_confusion',
      rx: /let'?s\s+play\s+a\s+game|imagine\s+(that\s+)?you\s+are|in\s+this\s+(hypothetical|fictional|imaginary)\s+(scenario|world|story)/gi,
      desc: 'Role confusion via scenario framing',
    },
    {
      name: 'developer_impersonation',
      severity: 'HIGH',
      category: 'role_confusion',
      rx: /I\s+(am|was)\s+(the\s+)?(developer|creator|author|owner|admin|system\s+administrator|root)\s+(of\s+)?(this|the)\s+(system|agent|bot|app|project)/gi,
      desc: 'Impersonating developer or system administrator',
    },

    // -- delimiter_injection --
    {
      name: 'xml_tag_injection',
      severity: 'HIGH',
      category: 'delimiter_injection',
      rx: /<\/?(system|instructions?|prompts?|commands?|directives?|rules?|config|settings|memory|context|persona)[^>]*>/gi,
      desc: 'XML/HTML tag injection targeting system structure',
    },
    {
      name: 'markdown_header_injection',
      severity: 'MEDIUM',
      category: 'delimiter_injection',
      rx: /^#{1,6}\s+(system|instructions?|prompts?|configuration|settings|rules?)\s*$/gim,
      desc: 'Markdown header injection to create false structure',
    },
    {
      name: 'json_breakout',
      severity: 'MEDIUM',
      category: 'delimiter_injection',
      rx: /\}\s*,\s*\{?\s*"(system|role|instructions?)"/gi,
      desc: 'JSON structure breakout for role injection',
    },
    {
      name: 'separator_attack',
      severity: 'LOW',
      category: 'delimiter_injection',
      rx: /[-=_*]{3,}\s*(system|instructions?|prompts?|begin|end|start|sep(?:arator)?)/gi,
      desc: 'Separator-based structural injection',
    },

    // -- encoded_payload --
    {
      name: 'base64_payload',
      severity: 'HIGH',
      category: 'encoded_payload',
      rx: /(base64|b64)(\s*[:=]|encoded|decoded?)?\s*['"]?[A-Za-z0-9+/]{40,}={0,2}['"]?/gi,
      desc: 'Base64-encoded payload detection',
    },
    {
      name: 'url_long_encoded',
      severity: 'MEDIUM',
      category: 'encoded_payload',
      rx: /(?:%[0-9A-Fa-f]{2}){15,}/,
      desc: 'URL-encoded sequences exceeding reasonable length',
    },
    {
      name: 'hex_encoded',
      severity: 'MEDIUM',
      category: 'encoded_payload',
      rx: /(?:\\x[0-9A-Fa-f]{2}){8,}/,
      desc: 'Hex-encoded byte sequences',
    },

    // -- tool_manipulation --
    {
      name: 'fake_tool_call',
      severity: 'CRITICAL',
      category: 'tool_manipulation',
      rx: /(execute|run|invoke|call)\s+(the\s+)?(tool|function)\s+(named|called)?\s*['"]?\s*\w+\s*['"]?\s+(with|using|passing)/gi,
      desc: 'Attempt to trigger unauthorized tool execution',
    },
    {
      name: 'shell_execution',
      severity: 'CRITICAL',
      category: 'tool_manipulation',
      rx: /\b(rm\s+-rf|mkfs\.\w+|dd\s+if=|chmod\s+777|wget\s+\S+\s+-O|curl\s+\S+\s*\|?\s*(sh|bash|python|perl|ruby))\b/i,
      desc: 'Shell command injection in tool arguments',
    },
    {
      name: 'file_exfiltration',
      severity: 'HIGH',
      category: 'tool_manipulation',
      rx: /(read\s+(and\s+)?(send|forward|upload|post|transmit|email|exfiltrate)\s+(the\s+)?(file|content|data))/gi,
      desc: 'Attempt to exfiltrate file contents',
    },
    {
      name: 'permission_bypass',
      severity: 'MEDIUM',
      category: 'tool_manipulation',
      rx: /(without\s+(asking|confirming|permission|approval)|bypass\s+(confirmation|verification|check|approval)|skip\s+(the\s+)?(confirmation|verification|check))/gi,
      desc: 'Attempt to bypass tool permission checks',
    },
    {
      name: 'resource_exhaustion',
      severity: 'LOW',
      category: 'tool_manipulation',
      rx: /\b(loop|repeat|recursively|infinitely|forever|endless(?:ly)?|while\s+true|for\s*\(\s*;\s*;\s*\))\s+(read|write|fetch|search|call|execute)\b/gi,
      desc: 'Attempt to cause resource exhaustion via tool loops',
    },
  ];
}

// Pre-compiled pattern list
const ALL_PATTERNS = buildPatterns();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a severity-to-number mapping for sorting and comparison.
 */
function severityWeightMap() {
  return { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
}

/**
 * Compute overall threat level from a set of detection matches.
 */
function computeThreatLevel(matches) {
  if (matches.length === 0) return 'NONE';

  const weights = severityWeightMap();
  let maxWeight = 0;
  let totalWeight = 0;

  for (const m of matches) {
    const w = weights[m.severity] || 0;
    if (w > maxWeight) maxWeight = w;
    totalWeight += w;
  }

  if (maxWeight >= weights.CRITICAL) return 'CRITICAL';
  if (totalWeight >= 12 || maxWeight >= weights.HIGH) {
    return totalWeight >= 15 ? 'CRITICAL' : 'HIGH';
  }
  if (totalWeight >= 6 || maxWeight >= weights.MEDIUM) {
    return totalWeight >= 10 ? 'HIGH' : 'MEDIUM';
  }
  if (totalWeight >= 3) return 'LOW';
  return 'LOW';
}

/**
 * Check content for suspicious URL patterns.
 */
function detectUrlInjectionPatterns(url) {
  const matches = [];

  if (/^data:/i.test(url)) {
    const payload = url.slice(5);
    if (/[;&|`$(){}]/.test(payload) || /ignore|system|instruction/i.test(payload)) {
      matches.push({
        patternName: 'data_uri_payload',
        type: 'encoded_payload',
        severity: 'HIGH',
        evidence: url.substring(0, 100),
        detail: 'data: URI with suspicious embedded content',
      });
    }
  }

  if (/^javascript:/i.test(url)) {
    matches.push({
      patternName: 'javascript_uri',
      type: 'encoded_payload',
      severity: 'CRITICAL',
      evidence: url.substring(0, 100),
      detail: 'javascript: URI detected',
    });
  }

  if (/[?&](prompt|instruction|system|override|role|cmd|command|exec|inject|payload)=/i.test(url)) {
    matches.push({
      patternName: 'injection_query_param',
      type: 'tool_manipulation',
      severity: 'MEDIUM',
      evidence: url.substring(0, 150),
      detail: 'Suspicious query parameter names in URL',
    });
  }

  if (url.length > 2000) {
    matches.push({
      patternName: 'long_url',
      type: 'encoded_payload',
      severity: 'LOW',
      evidence: url.substring(0, 100) + '...',
      detail: 'Abnormally long URL',
    });
  }

  return matches;
}

// ---------------------------------------------------------------------------
// InjectionDetector
// ---------------------------------------------------------------------------

/**
 * Detector for prompt injection attacks in user input, file content,
 * and URLs. Supports five detection categories: instruction override,
 * role confusion, delimiter injection, encoded payloads, and tool manipulation.
 */
class InjectionDetector {
  /**
   * @param {object} [options]
   * @param {boolean} [options.strict] — enable stricter matching (default: false)
   * @param {string[]} [options.disabledTypes] — detection types to skip
   * @param {function} [options.onDetection] — callback: (detection) => void
   */
  constructor(options = {}) {
    this._matches = [];
    this._strict = options.strict === true;
    this._disabledTypes = new Set(
      Array.isArray(options.disabledTypes) ? options.disabledTypes : [],
    );
    this._onDetection = typeof options.onDetection === 'function' ? options.onDetection : null;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Detect injection attempts in user-provided input text.
   */
  detect(input) {
    this._matches = [];

    if (typeof input !== 'string' || input.trim().length === 0) {
      return this._buildResult();
    }

    this._scanText(input, 'user_input');
    return this._buildResult();
  }

  /**
   * Detect injection attempts embedded in file contents.
   */
  detectInFile(fileContent, fileName) {
    this._matches = [];

    if (typeof fileContent !== 'string' || fileContent.trim().length === 0) {
      return this._buildResult();
    }

    this._scanText(fileContent, 'file_content');
    this._scanFileSpecificPatterns(fileContent, fileName);
    return this._buildResult();
  }

  /**
   * Detect injection via URLs.
   */
  detectInUrl(url) {
    this._matches = [];

    if (typeof url !== 'string' || url.trim().length === 0) {
      return this._buildResult();
    }

    const urlMatches = detectUrlInjectionPatterns(url);
    for (const m of urlMatches) {
      this._addMatch(m);
    }

    let decoded;
    try {
      decoded = decodeURIComponent(url);
    } catch (_err) {
      decoded = url;
    }
    this._scanText(decoded, 'url');
    return this._buildResult();
  }

  /**
   * Get the current threat level as a string.
   */
  getThreatLevel() {
    return computeThreatLevel(this._matches);
  }

  /**
   * Get all detected patterns from the most recent scan.
   */
  getDetectedPatterns() {
    return this._matches.map((m) => ({
      patternName: m.patternName,
      type: m.type,
      severity: m.severity,
      evidence: m.evidence,
      detail: m.detail,
      source: m.source,
      location: m.location,
      timestamp: m.timestamp,
    }));
  }

  /**
   * Get the numeric threat level value.
   */
  getThreatLevelValue() {
    return THREAT_LEVELS[this.getThreatLevel()] || 0;
  }

  /**
   * Check whether the last scan passed (no matches found).
   */
  isClean() {
    return this._matches.length === 0;
  }

  /**
   * Get detection matches filtered by type.
   */
  getMatchesByType(type) {
    return this._matches.filter((m) => m.type === type);
  }

  /**
   * Get detection matches filtered by severity.
   */
  getMatchesBySeverity(severity) {
    return this._matches.filter((m) => m.severity === severity);
  }

  /**
   * Enable a detection type.
   */
  enableType(type) {
    return this._disabledTypes.delete(type);
  }

  /**
   * Disable a specific detection type.
   */
  disableType(type) {
    this._disabledTypes.add(type);
  }

  /**
   * Reset internal match state.
   */
  reset() {
    this._matches = [];
  }

  // -----------------------------------------------------------------------
  // Internal scanning
  // -----------------------------------------------------------------------

  /**
   * Scan text against all registered patterns using a depth-limited approach
   * to avoid catastrophic backtracking.
   */
  _scanText(text, source) {
    for (const pattern of ALL_PATTERNS) {
      if (this._disabledTypes.has(pattern.category)) continue;

      pattern.rx.lastIndex = 0;

      // Use a reasonable iteration cap to prevent infinite loops
      let iterations = 0;
      const maxIterations = 200;

      let match;
      while ((match = pattern.rx.exec(text)) !== null && iterations < maxIterations) {
        iterations++;

        const evidence = match[0].substring(0, 150);

        if (this._strict && !this._isCredibleMatch(pattern, evidence)) {
          continue;
        }

        this._addMatch({
          patternName: pattern.name,
          type: pattern.category,
          severity: pattern.severity,
          evidence,
          detail: pattern.desc,
          source,
          location: match.index,
        });
      }
    }
  }

  /**
   * Additional file-specific detection checks.
   */
  _scanFileSpecificPatterns(content, fileName) {
    // Check for shebang + injection in executable-looking files
    if (/^#!/.test(content) && /ignore|system|instruction|override/i.test(content)) {
      this._addMatch({
        patternName: 'executable_injection',
        type: 'tool_manipulation',
        severity: 'HIGH',
        evidence: content.substring(0, 100),
        detail: 'Executable file with injection patterns',
        source: 'file_content',
        location: 0,
      });
    }

    // Check filename
    if (fileName && /\.(sh|bash|bat|cmd|ps1|py|rb|pl|exe)$/i.test(fileName)) {
      if (/ignore|system|instruction|override/i.test(content)) {
        this._addMatch({
          patternName: 'executable_with_injection',
          type: 'tool_manipulation',
          severity: 'MEDIUM',
          evidence: fileName,
          detail: 'Executable file "' + fileName + '" contains suspicious content',
          source: 'file_content',
          location: 0,
        });
      }
    }

    // Check for large base64 blocks (limited scan)
    const base64Rx = /[A-Za-z0-9+/]{200,}={0,2}/g;
    let bMatch;
    let bCount = 0;
    while ((bMatch = base64Rx.exec(content)) !== null && bCount < 5) {
      bCount++;
      this._addMatch({
        patternName: 'large_base64_block',
        type: 'encoded_payload',
        severity: 'MEDIUM',
        evidence: bMatch[0].substring(0, 80) + '...',
        detail: 'Large base64 block in file content',
        source: 'file_content',
        location: bMatch.index,
      });
    }
  }

  /**
   * Additional validation for strict mode.
   */
  _isCredibleMatch(entry, evidence) {
    if (entry.severity === 'LOW' && evidence.length < 8) {
      return false;
    }

    if (/^[\s\d.,;:!?\-_=+*#$@%^&]+$/.test(evidence)) {
      return false;
    }

    return true;
  }

  /**
   * Add a match with deduplication.
   */
  _addMatch(match) {
    const entry = {
      patternName: match.patternName,
      type: match.type,
      severity: match.severity,
      evidence: match.evidence,
      detail: match.detail,
      source: match.source,
      location: typeof match.location === 'number' ? match.location : -1,
      timestamp: new Date().toISOString(),
    };

    // Deduplicate by same evidence + location
    const key = entry.patternName + ':' + entry.location + ':' + entry.evidence;
    const exists = this._matches.some(
      (m) => m.patternName + ':' + m.location + ':' + m.evidence === key,
    );
    if (exists) return;

    this._matches.push(entry);

    if (this._onDetection) {
      this._onDetection(entry);
    }
  }

  /**
   * Build the standardized result object.
   */
  _buildResult() {
    const threatLevel = computeThreatLevel(this._matches);
    const categories = [...new Set(this._matches.map((m) => m.type))];

    return Object.freeze({
      threatLevel,
      threatLevelValue: THREAT_LEVELS[threatLevel] || 0,
      matchCount: this._matches.length,
      categories: Object.freeze(categories),
      matches: Object.freeze(this._matches.map((m) => ({ ...m }))),
      isClean: this._matches.length === 0,
      summary:
        this._matches.length === 0
          ? 'No injection patterns detected.'
          : 'Detected ' + this._matches.length + ' injection pattern(s) across ' +
            categories.length + ' categor' +
            (categories.length === 1 ? 'y' : 'ies') +
            '. Threat level: ' + threatLevel + '.',
    });
  }
}

module.exports = {
  InjectionDetector,
  THREAT_LEVELS,
  THREAT_LEVEL_NAMES,
  DETECTION_TYPES,
};
