"use strict";

/**
 * Training data augmenter for HaxAgent.
 *
 * Generates synthetic variations of extracted training examples to increase
 * dataset diversity and improve model robustness.
 */

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function isArray(v) {
  return Array.isArray(v);
}

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isString(v) {
  return typeof v === "string";
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[randomInt(0, arr.length - 1)];
}

function pickRandomN(arr, n) {
  if (!arr || arr.length === 0) return [];
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, shuffled.length));
}

function clampAugmentationFactor(factor) {
  const f = Number(factor);
  if (!Number.isFinite(f) || f < 1) return 1;
  if (f > 5) return 5;
  return f;
}

function deepClone(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(deepClone);
  const clone = {};
  for (const key of Object.keys(obj)) {
    clone[key] = deepClone(obj[key]);
  }
  return clone;
}

// ---------------------------------------------------------------------------
// augmentation config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG = {
  /** How many variants to generate per original example (1-5) */
  factor: 2,
  /** Seed for reproducible randomness (null = random) */
  seed: null,
};

function applyConfig(config) {
  const merged = { ...DEFAULT_CONFIG, ...config };
  merged.factor = clampAugmentationFactor(merged.factor);
  if (merged.seed !== null && merged.seed !== undefined) {
    seedRng(Number(merged.seed));
  }
  return merged;
}

// Simple seeded RNG
let _rngState = Date.now();
function seedRng(s) {
  _rngState = s | 0;
  if (_rngState <= 0) _rngState = 1;
}

function rng() {
  _rngState = (_rngState * 16807) % 2147483647;
  return (_rngState - 1) / 2147483646;
}

function seededRandomInt(min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function seededPickRandom(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[seededRandomInt(0, arr.length - 1)];
}

// ---------------------------------------------------------------------------
// path, arg, and instruction variation pools
// ---------------------------------------------------------------------------

const ALTERNATIVE_FILE_PATHS = [
  "/src/utils/helpers.js",
  "/src/components/App.tsx",
  "/src/services/api.ts",
  "/src/lib/database.js",
  "/config/settings.json",
  "/tests/unit/module.test.js",
  "/docs/API.md",
  "/scripts/deploy.sh",
  "/src/routes/index.ts",
  "/package.json",
  "/src/models/user.ts",
  "/src/middleware/auth.js",
  "/public/index.html",
  "/src/styles/main.css",
  "/src/hooks/useData.ts",
  "/Dockerfile",
  "/.github/workflows/ci.yml",
  "/src/plugins/logger.js",
  "/src/core/engine.ts",
  "/README.md",
];

const ALTERNATIVE_ARGS = {
  "file.read": [
    { path: "/src/index.js", offset: 0, limit: 100 },
    { path: "/config/app.json", encoding: "utf8" },
    { path: "/docs/guide.md" },
    { path: "/src/utils/format.ts", limit: 200 },
    { path: "/tests/fixtures/data.json" },
  ],
  "file.write": [
    { path: "/src/output.txt", content: "Generated content" },
    { path: "/temp/cache.json", content: JSON.stringify({ cached: true }) },
    { path: "/logs/summary.log", content: "Log entry..." },
  ],
  "file.edit": [
    { path: "/src/module.js", oldString: "// old", newString: "// new" },
    { path: "/config/routes.ts", oldString: "/api/v1", newString: "/api/v2" },
    { path: "/src/components/Header.tsx", oldString: "<div>", newString: "<header>" },
  ],
  "file.search": [
    { pattern: "TODO", path: "/src" },
    { pattern: "import.*from", path: "/src", fileTypes: ".ts" },
    { pattern: "useEffect", path: "/src/components" },
  ],
  "shell": [
    { command: "npm run build" },
    { command: "git log --oneline -10" },
    { command: "ls -la /src" },
    { command: "node --version" },
    { command: "npm test -- --coverage" },
  ],
  "web.search": [
    { query: "JavaScript best practices 2025" },
    { query: "React hooks performance optimization" },
    { query: "Node.js memory leak debugging" },
  ],
  "web.fetch": [
    { url: "https://api.example.com/data" },
    { url: "https://docs.example.com/reference" },
  ],
};

const INSTRUCTION_REPHRASES = {
  formal: [
    "Please perform the following task with utmost precision.",
    "I would kindly request that you execute this operation.",
    "Your assistance with the following matter would be greatly appreciated.",
  ],
  casual: [
    "Hey, can you help me with this thing?",
    "Quick question — could you take a look at this?",
    "Got a sec? I need a hand with something.",
  ],
  imperative: [
    "Do this now.",
    "Execute the following:",
    "Run this and report back.",
  ],
  detailed: [
    "I need you to carefully analyze the situation and then take the appropriate action. Here are the specifics:",
    "After reviewing the context thoroughly, please proceed with the most suitable approach:",
    "Consider all edge cases, then implement the solution. The requirements are:",
  ],
  question: [
    "What would be the best way to handle this?",
    "How would you approach solving this problem?",
    "Can you figure out why this isn't working?",
  ],
};

const ERROR_TYPES = {
  file_not_found: {
    messages: [
      "ENOENT: no such file or directory",
      "File not found at the specified path",
      "The requested file does not exist",
    ],
    recoveryArgs: [{ path: "/correct/path/file.js" }, { path: "/alternative/location.js" }],
  },
  permission_denied: {
    messages: [
      "EACCES: permission denied",
      "You do not have permission to access this resource",
      "Operation not permitted",
    ],
    recoveryArgs: [{ path: "/accessible/path/file.js" }, { sudo: true }],
  },
  network_error: {
    messages: [
      "ECONNREFUSED: connection refused",
      "Network request failed: timeout",
      "DNS resolution failed for host",
    ],
    recoveryArgs: [{ retryCount: 1 }, { timeout: 30000 }],
  },
  parse_error: {
    messages: [
      "SyntaxError: Unexpected token",
      "JSON.parse failed: invalid input",
      "Failed to parse response data",
    ],
    recoveryArgs: [{ encoding: "utf8" }, { format: "json" }],
  },
  rate_limit: {
    messages: [
      "429: Too many requests",
      "Rate limit exceeded, try again later",
      "API quota exhausted",
    ],
    recoveryArgs: [{ retryAfter: 5000 }, { backoff: "exponential" }],
  },
};

const EDGE_CASES = [
  {
    name: "empty_file",
    description: "Reading an empty file",
    args: { path: "/src/empty.txt" },
    data: "",
  },
  {
    name: "large_file",
    description: "Reading a very large file",
    args: { path: "/logs/huge.log", offset: 0, limit: 100 },
    data: "x".repeat(10000),
  },
  {
    name: "binary_file",
    description: "Attempting to read a binary file as text",
    args: { path: "/assets/image.png" },
    data: "[binary data]",
    isError: true,
  },
  {
    name: "special_chars_path",
    description: "File path with special characters",
    args: { path: "/src/data/my file (copy).txt" },
    data: "content",
  },
  {
    name: "unicode_content",
    description: "File with unicode/emoji content",
    args: { path: "/src/messages.json" },
    data: JSON.stringify({ greeting: "Hello 你好 👋" }),
  },
  {
    name: "very_long_path",
    description: "Extremely long file path",
    args: { path: "/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/t/u/v/w/x/y/z/file.js" },
    data: null,
    isError: true,
  },
  {
    name: "nested_json",
    description: "Deeply nested JSON response",
    args: { query: "complex data" },
    data: { a: { b: { c: { d: { e: { f: { g: { h: "deep" } } } } } } } },
  },
  {
    name: "null_response",
    description: "Tool returns null/undefined",
    args: { path: "/src/missing.js" },
    data: null,
  },
  {
    name: "whitespace_only",
    description: "Content is only whitespace",
    args: { path: "/src/whitespace.txt" },
    data: "   \n\t  \n  ",
  },
  {
    name: "concurrent_modification",
    description: "File modified between read and write",
    args: { path: "/src/locked.json" },
    data: { error: "File was modified by another process" },
    isError: true,
  },
];

// ---------------------------------------------------------------------------
// augmentToolCalls
// ---------------------------------------------------------------------------

/**
 * Create variations of tool-call examples by altering file paths, arguments,
 * and error modes.
 *
 * @param {Array<object>} examples - source examples with toolCall field
 * @param {object} [config] - { factor: 1-5, seed?: number }
 * @returns {Array<object>} augmented examples (original + variants)
 */
function augmentToolCalls(examples, config = {}) {
  const cfg = applyConfig(config);
  const result = [...examples];

  for (const ex of examples) {
    if (!ex.toolCall) continue;
    const variantsToCreate = cfg.factor - 1;

    for (let v = 0; v < variantsToCreate; v++) {
      const variant = deepClone(ex);
      const toolName = (ex.toolCall.name || "unknown").toLowerCase();

      // Vary the file path
      if (variant.toolCall.args && isObject(variant.toolCall.args)) {
        if (variant.toolCall.args.path) {
          const newPath = seededPickRandom(ALTERNATIVE_FILE_PATHS) || variant.toolCall.args.path;
          if (cfg.seed === null) {
            // Random mode: occasionally substitute
            if (Math.random() > 0.5) variant.toolCall.args.path = newPath;
          } else {
            variant.toolCall.args.path = newPath;
          }
        }

        // Vary tool-specific args
        const argPool = ALTERNATIVE_ARGS[toolName];
        if (argPool && argPool.length > 0) {
          const altArgs = seededPickRandom(argPool);
          if (altArgs) {
            variant.toolCall.args = { ...variant.toolCall.args, ...altArgs };
          }
        }
      }

      // Vary error mode (occasionally flip isError)
      if (variant.toolResult && v % 3 === 0) {
        variant.toolResult.isError = !variant.toolResult.isError;
        if (variant.toolResult.isError && !variant.toolResult.data?.error) {
          const errKey = seededPickRandom(Object.keys(ERROR_TYPES));
          variant.toolResult.data = { error: seededPickRandom(ERROR_TYPES[errKey].messages) };
        }
      }

      // Vary args that have common patterns
      if (variant.toolCall.args && isObject(variant.toolCall.args)) {
        variant.toolCall.args = varyNumericArgs(variant.toolCall.args);
      }

      variant._augmented = true;
      variant._augmentedFrom = ex.type;
      result.push(variant);
    }
  }

  return result;
}

function varyNumericArgs(args) {
  const varied = { ...args };
  if (typeof varied.limit === "number") varied.limit = varied.limit + seededRandomInt(-50, 50);
  if (typeof varied.offset === "number") varied.offset = Math.max(0, varied.offset + seededRandomInt(-20, 20));
  if (typeof varied.maxResults === "number") varied.maxResults = varied.maxResults + seededRandomInt(-5, 5);
  if (typeof varied.timeout === "number") varied.timeout = varied.timeout + seededRandomInt(-5000, 5000);
  if (typeof varied.retryCount === "number") varied.retryCount = Math.max(0, varied.retryCount + seededRandomInt(-2, 2));
  return varied;
}

// ---------------------------------------------------------------------------
// augmentInstructions
// ---------------------------------------------------------------------------

/**
 * Rephrase user instructions / userMessage fields in different styles.
 *
 * @param {Array<object>} examples - source examples with userMessage or goal field
 * @param {object} [config] - { factor: 1-5, seed?: number }
 * @returns {Array<object>} augmented examples
 */
function augmentInstructions(examples, config = {}) {
  const cfg = applyConfig(config);
  const result = [...examples];
  const styles = Object.keys(INSTRUCTION_REPHRASES);

  for (const ex of examples) {
    const originalText = ex.userMessage || ex.goal;
    if (!isString(originalText) || !originalText.trim()) continue;

    const variantsToCreate = Math.min(cfg.factor - 1, styles.length);

    const selectedStyles = cfg.seed === null
      ? pickRandomN(styles, variantsToCreate)
      : styles.slice(0, variantsToCreate);

    for (const style of selectedStyles) {
      const variant = deepClone(ex);
      const prefix = seededPickRandom(INSTRUCTION_REPHRASES[style]) || "";

      if (variant.userMessage !== undefined) {
        variant.userMessage = `${prefix}\n\n${originalText}`;
      }
      if (variant.goal !== undefined) {
        variant.goal = `${prefix}\n\n${originalText}`;
      }

      variant._augmented = true;
      variant._augmentedStyle = style;
      variant._augmentedFrom = ex.type;
      result.push(variant);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// augmentErrors
// ---------------------------------------------------------------------------

/**
 * Inject synthetic error/recovery patterns into examples.
 *
 * For examples that don't already have error patterns, creates variants
 * where the first tool call fails and the agent must retry.
 *
 * @param {Array<object>} examples - source examples
 * @param {object} [config] - { factor: 1-5, seed?: number }
 * @returns {Array<object>} augmented examples
 */
function augmentErrors(examples, config = {}) {
  const cfg = applyConfig(config);
  const result = [...examples];

  for (const ex of examples) {
    const variantsToCreate = cfg.factor - 1;
    let created = 0;

    for (let v = 0; v < variantsToCreate && created < 3; v++) {
      const variant = deepClone(ex);

      if (variant.type === "error_recovery") {
        // Vary the error type
        const errType = seededPickRandom(Object.keys(ERROR_TYPES));
        const errInfo = ERROR_TYPES[errType];
        variant.errorResult = {
          data: { error: seededPickRandom(errInfo.messages) },
          isError: true,
        };
        variant.recoveryToolCall = {
          ...variant.recoveryToolCall,
          args: { ...variant.recoveryToolCall?.args, ...seededPickRandom(errInfo.recoveryArgs) },
        };
        created++;
        variant._augmented = true;
        result.push(variant);
        continue;
      }

      if (variant.type === "tool_use" && variant.toolResult && !variant.toolResult.isError) {
        // Create an error variant: first attempt fails, then succeeds
        const errType = seededPickRandom(Object.keys(ERROR_TYPES));
        const errInfo = ERROR_TYPES[errType];

        variant.toolResult = {
          data: { error: seededPickRandom(errInfo.messages) },
          isError: true,
        };

        // Add a recovery step
        variant._errorInjected = true;
        variant._recoverySuggestion = {
          toolName: variant.toolCall?.name,
          args: { ...variant.toolCall?.args, ...seededPickRandom(errInfo.recoveryArgs) },
        };
        created++;
        variant._augmented = true;
        result.push(variant);
        continue;
      }

      if (variant.type === "agent_workflow" && variant.steps && variant.steps.length >= 2) {
        // Make one of the middle steps fail, then add a recovery step
        const failIndex = seededRandomInt(0, variant.steps.length - 2);
        const failStep = variant.steps[failIndex];
        const errType = seededPickRandom(Object.keys(ERROR_TYPES));
        const errInfo = ERROR_TYPES[errType];

        failStep.isError = true;
        failStep.result = { error: seededPickRandom(errInfo.messages) };

        // Insert recovery step after failure
        const recoveryStep = {
          toolName: failStep.toolName || "unknown",
          toolArgs: { ...failStep.toolArgs, ...seededPickRandom(errInfo.recoveryArgs) },
          result: failStep.result && !failStep.result.error ? failStep.result : { success: true },
          isError: false,
          _isRecovery: true,
        };

        variant.steps.splice(failIndex + 1, 0, recoveryStep);
        variant.stepCount = variant.steps.length;
        created++;
        variant._augmented = true;
        result.push(variant);
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// augmentEdgeCases
// ---------------------------------------------------------------------------

/**
 * Add boundary-condition examples by injecting edge-case tool results and
 * argument values.
 *
 * @param {Array<object>} examples - source examples
 * @param {object} [config] - { factor: 1-5, seed?: number }
 * @returns {Array<object>} augmented examples
 */
function augmentEdgeCases(examples, config = {}) {
  const cfg = applyConfig(config);
  const result = [...examples];

  for (const ex of examples) {
    if (!ex.toolCall && !ex.steps) continue;
    const variantsToCreate = Math.min(cfg.factor - 1, 3);

    for (let v = 0; v < variantsToCreate; v++) {
      const variant = deepClone(ex);
      const edgeCase = EDGE_CASES[seededRandomInt(0, EDGE_CASES.length - 1)];

      if (variant.toolCall) {
        // Apply edge case to tool args and result
        if (variant.toolCall.args && isObject(variant.toolCall.args)) {
          variant.toolCall.args = { ...variant.toolCall.args, ...edgeCase.args };
        }
        if (variant.toolResult) {
          variant.toolResult.data = edgeCase.data;
          if (edgeCase.isError) {
            variant.toolResult.isError = true;
          }
        }
        variant._edgeCase = edgeCase.name;
      }

      if (variant.steps && isArray(variant.steps) && variant.steps.length > 0) {
        const targetStep = variant.steps[seededRandomInt(0, variant.steps.length - 1)];
        if (targetStep) {
          targetStep.toolArgs = { ...targetStep.toolArgs, ...edgeCase.args };
          targetStep.result = edgeCase.data;
          if (edgeCase.isError) targetStep.isError = true;
        }
        variant._edgeCase = edgeCase.name;
      }

      variant._augmented = true;
      result.push(variant);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// generateSyntheticExamples
// ---------------------------------------------------------------------------

const SYNTHETIC_TEMPLATES = {
  tool_use: [
    {
      type: "tool_use",
      sessionId: "synthetic",
      context: [],
      assistantMessage: { role: "assistant", content: "Let me read the configuration file to understand the setup." },
      toolCall: { name: "file.read", args: { path: "/config/settings.json" } },
      toolResult: { role: "tool", name: "file.read", data: '{"debug": true, "port": 3000}', isError: false },
    },
    {
      type: "tool_use",
      sessionId: "synthetic",
      context: [
        { role: "user", content: "Help me fix the authentication bug." },
        { role: "assistant", content: "I'll investigate the auth flow. Let me start by examining the relevant files." },
      ],
      assistantMessage: { role: "assistant", content: "Let me search for authentication-related code." },
      toolCall: { name: "file.search", args: { pattern: "authenticate|login|verifyToken", path: "/src" } },
      toolResult: { role: "tool", name: "file.search", data: { matches: ["/src/auth/login.js", "/src/auth/verify.js", "/src/middleware/auth.js"] }, isError: false },
    },
    {
      type: "tool_use",
      sessionId: "synthetic",
      context: [
        { role: "user", content: "Write a function to format dates in ISO 8601." },
      ],
      assistantMessage: { role: "assistant", content: "Let me check if there's an existing utility I can reference." },
      toolCall: { name: "file.glob", args: { pattern: "**/utils/date*" } },
      toolResult: { role: "tool", name: "file.glob", data: [], isError: false },
    },
  ],
  conversation_turn: [
    {
      type: "conversation_turn",
      sessionId: "synthetic",
      turnIndex: 1,
      userMessage: "Explain the difference between Promise.all and Promise.allSettled.",
      assistantMessages: [
        {
          role: "assistant",
          content: "Promise.all rejects immediately if any promise rejects, while Promise.allSettled waits for all promises to settle (either resolve or reject) and returns an array of result objects. Use Promise.all when you need all results to succeed; use Promise.allSettled when you want to collect outcomes regardless of failures.",
        },
      ],
      toolCalls: [],
    },
    {
      type: "conversation_turn",
      sessionId: "synthetic",
      turnIndex: 1,
      userMessage: "How do I optimize React re-renders?",
      assistantMessages: [
        {
          role: "assistant",
          content: "Key strategies for optimizing React re-renders:\n\n1. Use React.memo for pure components\n2. Use useMemo and useCallback for expensive computations and stable callbacks\n3. Lift state up only as high as needed\n4. Use the key prop properly in lists\n5. Consider virtualization for long lists (react-window)\n6. Profile with React DevTools before optimizing",
        },
      ],
      toolCalls: [],
    },
  ],
  agent_workflow: [
    {
      type: "agent_workflow",
      sessionId: "synthetic",
      goal: "Add input validation to the user registration endpoint.",
      steps: [
        { toolName: "file.search", toolArgs: { pattern: "register|signup", path: "/src" }, result: { matches: ["/src/routes/auth.js", "/src/controllers/userController.js"] }, isError: false },
        { toolName: "file.read", toolArgs: { path: "/src/controllers/userController.js" }, result: "// userController.js content...\nexports.register = async (req, res) => {\n  const { email, password } = req.body;\n  // no validation\n  await db.users.create({ email, password });\n  res.json({ ok: true });\n};", isError: false },
        { toolName: "file.edit", toolArgs: { path: "/src/controllers/userController.js", oldString: "const { email, password } = req.body;\n  // no validation", newString: "const { email, password } = req.body;\n  if (!email || !password) return res.status(400).json({ error: 'Missing fields' });\n  if (!/\\S+@\\S+\\.\\S+/.test(email)) return res.status(400).json({ error: 'Invalid email' });\n  if (password.length < 8) return res.status(400).json({ error: 'Password too short' });" }, result: { success: true }, isError: false },
      ],
      finalResponse: { role: "assistant", content: "I've added input validation to the register endpoint. It now checks for missing fields, email format, and minimum password length." },
      stepCount: 3,
    },
  ],
  error_recovery: [
    {
      type: "error_recovery",
      sessionId: "synthetic",
      errorToolCall: { name: "file.read", args: { path: "/src/missing-file.js" } },
      errorResult: { data: { error: "ENOENT: no such file or directory, open '/src/missing-file.js'" }, isError: true },
      recoveryToolCall: { name: "file.glob", args: { pattern: "**/*missing*" } },
      recoveryResult: { data: ["/src/utils/missing-file.js"], isError: false },
      recoveryStrategy: "retry_alternative_tool",
      context: [{ role: "user", content: "Read the missing-file.js contents." }],
    },
    {
      type: "error_recovery",
      sessionId: "synthetic",
      errorToolCall: { name: "web.fetch", args: { url: "https://api.example.com/endpoint" } },
      errorResult: { data: { error: "429: Too many requests" }, isError: true },
      recoveryToolCall: { name: "web.fetch", args: { url: "https://api.example.com/endpoint", retryAfter: 5000 } },
      recoveryResult: { data: { status: 200, data: { result: "success" } }, isError: false },
      recoveryStrategy: "retry_same_tool",
      context: [{ role: "user", content: "Fetch the latest data from the API." }],
    },
  ],
  decision_point: [
    {
      type: "decision_point",
      subtype: "deliberation",
      sessionId: "synthetic",
      context: [{ role: "user", content: "The build is slow. What should I do?" }],
      reasoning: "There are two main approaches to speeding up builds: 1) enable caching in the build tool configuration, and 2) optimize the dependency tree by removing unused packages. I'll start with caching since it's less risky and provides immediate benefits.",
      options: ["Enable build caching", "Optimize dependency tree"],
      chosenAction: { toolName: "file.read", args: { path: "/webpack.config.js" } },
    },
    {
      type: "decision_point",
      subtype: "parallel_tool_choice",
      sessionId: "synthetic",
      context: [{ role: "user", content: "Refactor the entire auth module." }],
      reasoning: "I need to understand the full scope. I'll read the main auth file, search for all references, and check the test file simultaneously.",
      options: [
        { toolName: "file.read", args: { path: "/src/auth/index.js" } },
        { toolName: "file.search", args: { pattern: "require.*auth", path: "/src" } },
        { toolName: "file.read", args: { path: "/test/auth.test.js" } },
      ],
      chosenAction: "all_parallel",
    },
  ],
};

/**
 * Generate synthetic training examples from built-in templates.
 *
 * @param {number} count - number of examples to generate
 * @param {object} [templates] - custom template sets (merged with defaults)
 * @returns {Array<object>} synthetic examples
 */
function generateSyntheticExamples(count, templates = {}) {
  const raw = Math.floor(Number(count) || 0);
  const n = Math.max(0, raw);
  if (n === 0) return [];

  const result = [];

  // Merge default + custom templates
  const allTemplates = {};
  for (const type of Object.keys(SYNTHETIC_TEMPLATES)) {
    allTemplates[type] = [
      ...SYNTHETIC_TEMPLATES[type],
      ...(isArray(templates[type]) ? templates[type] : []),
    ];
  }

  const templateTypes = Object.keys(allTemplates);
  if (templateTypes.length === 0) return result;

  for (let i = 0; i < n; i++) {
    const type = templateTypes[i % templateTypes.length];
    const typeTemplates = allTemplates[type];
    const tpl = typeTemplates[i % typeTemplates.length];
    const example = deepClone(tpl);

    // Add some randomness to avoid identical examples when count > templates
    example._synthetic = true;
    example._syntheticIndex = i;

    if (example.userMessage || example.goal) {
      const target = example.userMessage !== undefined ? "userMessage" : "goal";
      example[target] = varyInstructionText(example[target], i);
    }

    result.push(example);
  }

  return result;
}

function varyInstructionText(text, index) {
  if (!isString(text)) return text;

  const variations = [
    (t) => t,
    (t) => `Please ${t.charAt(0).toLowerCase() + t.slice(1)}`,
    (t) => `I need you to ${t.charAt(0).toLowerCase() + t.slice(1)}`,
    (t) => `Could you ${t.charAt(0).toLowerCase() + t.slice(1)}`,
    (t) => `${t} (urgent)`,
  ];

  const fn = variations[index % variations.length];
  return fn(text);
}

// ---------------------------------------------------------------------------
// module exports
// ---------------------------------------------------------------------------

module.exports = {
  augmentToolCalls,
  augmentInstructions,
  augmentErrors,
  augmentEdgeCases,
  generateSyntheticExamples,
};
