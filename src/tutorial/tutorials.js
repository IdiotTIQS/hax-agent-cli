"use strict";

/**
 * Tutorial definitions for HaxAgent's interactive onboarding system.
 *
 * Each tutorial is a named export with:
 *   id              — unique identifier string
 *   name            — human-readable display name
 *   description     — one-paragraph summary of what the user will learn
 *   difficulty      — "beginner" | "intermediate" | "advanced"
 *   estimatedMinutes — approximate completion time
 *   steps           — ordered array of step objects
 *
 * Each step:
 *   id              — unique identifier within the tutorial
 *   title           — short heading shown to the user
 *   instruction     — text explaining what the user should do
 *   expectedAction  — action string (used for validation / hint matching)
 *   hints           — optional array of progressively revealing hints
 *   validation      — optional function / config for validating user action
 */

const GETTING_STARTED = {
  id: "getting-started",
  name: "Getting Started",
  description:
    "Learn the basics of HaxAgent: open the interface, send your first chat message, and understand how the agent responds. By the end you will be comfortable with the core conversation loop.",
  difficulty: "beginner",
  estimatedMinutes: 5,
  steps: [
    {
      id: "welcome",
      title: "Welcome to HaxAgent",
      instruction:
        "Welcome! HaxAgent is an AI-powered coding assistant that runs in your terminal. In this tutorial you will get comfortable with the basics. Press Enter or type 'next' to continue.",
      expectedAction: "acknowledge",
      hints: ["Just press Enter to advance."],
      validation: null,
    },
    {
      id: "open-interface",
      title: "Open the Interface",
      instruction:
        "Open HaxAgent by running `hax` in your terminal. If you installed globally with npm, just type `hax` and press Enter. You should see the HaxAgent welcome screen.",
      expectedAction: "run-command",
      hints: [
        "Make sure you are in a terminal window.",
        "Type `hax` and press Enter.",
        "If `hax` is not found, try `npx haxagent` instead.",
      ],
      validation: null,
    },
    {
      id: "first-message",
      title: "Your First Message",
      instruction:
        "Once HaxAgent is open, type a simple question like 'What can you help me with?' and press Enter. The agent will respond with a helpful message explaining its capabilities.",
      expectedAction: "send-message",
      hints: [
        "Look for the prompt `>` or `You:` in the interface.",
        "Type your message and press Enter.",
        "Wait for the agent to generate its response — it usually takes a few seconds.",
      ],
      validation: null,
    },
    {
      id: "read-response",
      title: "Read the Response",
      instruction:
        "The agent will reply in the chat window. Read through the response — it explains what HaxAgent can do. Notice the formatting: code blocks are syntax-highlighted, and the response may include tool-use results.",
      expectedAction: "observe",
      hints: [
        "Code blocks use syntax highlighting.",
        "The agent may suggest specific slash commands you can try.",
        "Scroll up if the response is longer than your terminal window.",
      ],
      validation: null,
    },
    {
      id: "ask-follow-up",
      title: "Ask a Follow-Up",
      instruction:
        "Now try a follow-up question about your current project. For example: 'What files are in this directory?' or 'Explain the project structure.' The agent remembers context from previous messages.",
      expectedAction: "send-message",
      hints: [
        "Try asking about a specific file: 'What does package.json contain?'",
        "You can ask the agent to explain something in simple terms.",
        "The conversation history is maintained until you start a new session.",
      ],
      validation: null,
    },
    {
      id: "completion",
      title: "Tutorial Complete",
      instruction:
        "Great job! You have completed the Getting Started tutorial. You now know how to open HaxAgent, send messages, and read responses. Try the Slash Commands tutorial next to learn about built-in commands.",
      expectedAction: "acknowledge",
      hints: [],
      validation: null,
    },
  ],
};

const SLASH_COMMANDS = {
  id: "slash-commands",
  name: "Slash Commands",
  description:
    "Explore every slash command HaxAgent offers. Learn how to change models, manage sessions, configure settings, switch modes, and more — all from the chat prompt.",
  difficulty: "beginner",
  estimatedMinutes: 10,
  steps: [
    {
      id: "intro",
      title: "Introduction to Slash Commands",
      instruction:
        "Slash commands start with `/` and let you control HaxAgent without leaving the chat. Type `/help` in the chat to see the full list of available commands.",
      expectedAction: "run-slash",
      hints: ["Type `/help` and press Enter.", "A list of all slash commands will appear."],
      validation: null,
    },
    {
      id: "model-switch",
      title: "Switch Models",
      instruction:
        "Use `/model` to see available AI models and switch between them. Type `/model list` to see options, then `/model <name>` to switch.",
      expectedAction: "run-slash",
      hints: [
        "Type `/model list` to see available models.",
        "Try `/model claude-sonnet-4-20250514` or another available model.",
        "The model change takes effect on your next message.",
      ],
      validation: null,
    },
    {
      id: "session-management",
      title: "Session Management",
      instruction:
        "Manage chat sessions with `/session`. Try `/session new` to start a fresh conversation, `/session list` to see past sessions, and `/session resume <id>` to go back.",
      expectedAction: "run-slash",
      hints: [
        "Each session has a unique ID.",
        "Sessions persist across HaxAgent restarts.",
        "Use `/session delete <id>` to remove old sessions.",
      ],
      validation: null,
    },
    {
      id: "config-commands",
      title: "Configuration Commands",
      instruction:
        "Adjust settings on the fly. Try `/config` to view current settings, `/config set <key> <value>` to change a setting, and `/config reset` to restore defaults.",
      expectedAction: "run-slash",
      hints: [
        "Current settings are shown in a formatted table.",
        "Changes via `/config set` are saved immediately.",
        "Use `/config export` to save your configuration to a file.",
      ],
      validation: null,
    },
    {
      id: "mode-toggle",
      title: "Permission Modes",
      instruction:
        "HaxAgent has permission modes that control tool access. Try `/mode` to see your current mode, and `/mode yolo` to auto-approve all tool calls (use with caution).",
      expectedAction: "run-slash",
      hints: [
        "Normal mode asks for confirmation before risky operations.",
        "YOLO mode auto-approves everything.",
        "You can switch modes at any time during a session.",
      ],
      validation: null,
    },
    {
      id: "memory-commands",
      title: "Memory Commands",
      instruction:
        "Use `/memory` to view, search, and manage the agent's persistent memory. Type `/memory list` to see saved items, `/memory search <query>` to find specific items.",
      expectedAction: "run-slash",
      hints: [
        "Memory items can have namespaces and tags.",
        "Use `/memory forget <id>` to remove items.",
        "Memory persists across sessions until explicitly cleared.",
      ],
      validation: null,
    },
    {
      id: "info-diagnostics",
      title: "Info and Diagnostics",
      instruction:
        "Get system information with `/info` (shows provider, model, token usage) and `/debug` (shows internal state for troubleshooting).",
      expectedAction: "run-slash",
      hints: [
        "/info shows your current session details.",
        "/debug is useful when reporting issues.",
        "Token usage estimates help you track context window consumption.",
      ],
      validation: null,
    },
    {
      id: "completion",
      title: "Slash Commands Complete",
      instruction:
        "You now know all the major slash commands! Practice them in your daily workflow — they become second nature quickly. Next, try the Agent Teams tutorial.",
      expectedAction: "acknowledge",
      hints: [],
      validation: null,
    },
  ],
};

const AGENT_TEAMS = {
  id: "agent-teams",
  name: "Agent Teams",
  description:
    "Learn how to create, configure, and run teams of AI agents that collaborate on complex tasks. Define roles, chain agents together, and review team output.",
  difficulty: "intermediate",
  estimatedMinutes: 15,
  steps: [
    {
      id: "intro",
      title: "What Are Agent Teams?",
      instruction:
        "Agent teams let you assign different roles to multiple AI agents. They work together — one might research, another might write code, a third might review. Press Enter to continue.",
      expectedAction: "acknowledge",
      hints: [],
      validation: null,
    },
    {
      id: "create-team",
      title: "Create a Team",
      instruction:
        "Create a team configuration file. Teams are defined in JSON or YAML with a name, description, and list of agent roles. Type `/team create <name>` to get started.",
      expectedAction: "run-slash",
      hints: [
        "Team configs are stored in your project or user settings.",
        "Each agent role has a name, instructions, and optionally a model.",
        "Use `/team list` to see your existing teams.",
      ],
      validation: null,
    },
    {
      id: "define-roles",
      title: "Define Agent Roles",
      instruction:
        "Each agent in a team needs a clear role. Examples: 'architect' designs solutions, 'coder' implements them, 'reviewer' checks for issues. Define 2-3 roles for your first team.",
      expectedAction: "configure",
      hints: [
        "Give each agent a specific, focused job.",
        "Instructions can include coding style, constraints, and output format.",
        "Different agents can use different models to optimize cost.",
      ],
      validation: null,
    },
    {
      id: "run-team",
      title: "Run Your Team",
      instruction:
        "Start your team with `/team run <name>`. Provide a goal like 'Build a REST API for a todo app' and watch the agents collaborate — each agent sees the output of the previous one.",
      expectedAction: "run-slash",
      hints: [
        "The first agent receives the goal and produces output.",
        "Subsequent agents receive previous output plus their own instructions.",
        "You can interrupt a team run with Ctrl+C.",
      ],
      validation: null,
    },
    {
      id: "review-output",
      title: "Review Team Output",
      instruction:
        "After the team finishes, review the final output. Check the intermediate results too — each agent's contribution is saved. Use `/team history <name>` to see past runs.",
      expectedAction: "observe",
      hints: [
        "Each agent's output is timestamped.",
        "You can re-run a team with modified instructions.",
        "Output is saved in your session for reference.",
      ],
      validation: null,
    },
    {
      id: "completion",
      title: "Agent Teams Complete",
      instruction:
        "You now know how to create and run agent teams. Experiment with different role combinations and see how collaboration improves output quality.",
      expectedAction: "acknowledge",
      hints: [],
      validation: null,
    },
  ],
};

const PLUGIN_BASICS = {
  id: "plugin-basics",
  name: "Plugin Basics",
  description:
    "Extend HaxAgent with plugins. Install community plugins, create your own, and configure them to work with your workflow. Plugins can add tools, commands, hooks, and more.",
  difficulty: "intermediate",
  estimatedMinutes: 12,
  steps: [
    {
      id: "intro",
      title: "What Are Plugins?",
      instruction:
        "Plugins are JavaScript modules that extend HaxAgent with new tools, slash commands, hooks, and integrations. They live in `~/.haxagent/plugins/` and are auto-loaded on startup.",
      expectedAction: "acknowledge",
      hints: [],
      validation: null,
    },
    {
      id: "list-plugins",
      title: "List Installed Plugins",
      instruction:
        "Type `/plugin list` to see all currently installed plugins. Each plugin shows its name, version, description, and whether it is enabled.",
      expectedAction: "run-slash",
      hints: [
        "Plugins can be user-level or project-level.",
        "Use `/plugin info <name>` for detailed information.",
        "Disabled plugins are shown in dimmed text.",
      ],
      validation: null,
    },
    {
      id: "install-plugin",
      title: "Install a Plugin",
      instruction:
        "Install a plugin with `/plugin install <name>`. Try installing a popular one. Plugins are downloaded and placed in your plugins directory automatically.",
      expectedAction: "run-slash",
      hints: [
        "Plugin names follow the pattern `@scope/name` or just `name`.",
        "Use `/plugin search <query>` to discover plugins.",
        "After installing, the plugin is available immediately.",
      ],
      validation: null,
    },
    {
      id: "enable-disable",
      title: "Enable and Disable Plugins",
      instruction:
        "Enable or disable plugins without uninstalling. Use `/plugin enable <name>` to activate a plugin and `/plugin disable <name>` to temporarily turn it off.",
      expectedAction: "run-slash",
      hints: [
        "Disabling a plugin keeps it installed but inactive.",
        "You can re-enable it at any time.",
      ],
      validation: null,
    },
    {
      id: "create-plugin",
      title: "Create Your Own Plugin",
      instruction:
        "Create a basic plugin by writing a JavaScript file in `~/.haxagent/plugins/`. A minimal plugin exports a `name`, `version`, and an `activate` function. Try creating one now.",
      expectedAction: "create-file",
      hints: [
        "The file should export `{ name, version, activate(ctx) }`.",
        "`ctx` provides access to the HaxAgent API, tools registry, and hooks.",
        "Use `ctx.registerTool(...)` to add a new tool.",
        "Use `ctx.registerCommand(...)` to add a new slash command.",
      ],
      validation: null,
    },
    {
      id: "configure-plugin",
      title: "Configure Your Plugin",
      instruction:
        "Plugins can have settings. Configure them in your settings file under the `plugins.<name>` key. Type `/config set plugins.<name>.<key> <value>` to adjust.",
      expectedAction: "run-slash",
      hints: [
        "Each plugin's settings schema is shown in `/plugin info <name>`.",
        "Settings are validated against the plugin's schema.",
        "Changes take effect on the next message or after a reload.",
      ],
      validation: null,
    },
    {
      id: "completion",
      title: "Plugin Basics Complete",
      instruction:
        "You are now ready to extend HaxAgent with plugins! Explore the plugin ecosystem or build your own — the possibilities are endless.",
      expectedAction: "acknowledge",
      hints: [],
      validation: null,
    },
  ],
};

const SKILL_BASICS = {
  id: "skill-basics",
  name: "Skill Basics",
  description:
    "Skills package reusable prompts, tools, and workflows. Learn to create, share, and invoke skills to automate common tasks and share knowledge with your team.",
  difficulty: "intermediate",
  estimatedMinutes: 12,
  steps: [
    {
      id: "intro",
      title: "What Are Skills?",
      instruction:
        "Skills are packaged capabilities — reusable prompt templates, tool chains, and workflows. They let you encapsulate expertise and share it. Press Enter to learn more.",
      expectedAction: "acknowledge",
      hints: [],
      validation: null,
    },
    {
      id: "list-skills",
      title: "List Available Skills",
      instruction:
        "Type `/skill list` to see all available skills. Skills can come from your configuration, installed plugins, or built-in sources.",
      expectedAction: "run-slash",
      hints: [
        "Built-in skills are always available.",
        "Plugin-provided skills appear when the plugin is enabled.",
        "Custom skills are loaded from your settings.",
      ],
      validation: null,
    },
    {
      id: "invoke-skill",
      title: "Invoke a Skill",
      instruction:
        "Invoke a skill with `/skill <name>`. For example, `/skill code-review` would start a code review workflow. Try invoking any available skill now.",
      expectedAction: "run-slash",
      hints: [
        "Skills may ask follow-up questions.",
        "Some skills accept arguments: `/skill <name> <args>`.",
        "The skill's prompt is injected into the conversation context.",
      ],
      validation: null,
    },
    {
      id: "create-skill",
      title: "Create a Skill",
      instruction:
        "Create your own skill by writing a skill definition file. Skills can include: metadata (name, description), a system prompt, tool configurations, and arguments.",
      expectedAction: "create-file",
      hints: [
        "Skills are defined as JavaScript or JSON files.",
        "Use `name`, `description`, `prompt`, and optional `args` fields.",
        "Place custom skills in `~/.hax-agent/skills/`.",
      ],
      validation: null,
    },
    {
      id: "skill-args",
      title: "Passing Arguments to Skills",
      instruction:
        "Skills can accept arguments. Define them in your skill's `args` array with name, type, description, and whether they are required. Then invoke with `/skill <name> key=value`.",
      expectedAction: "run-slash",
      hints: [
        "Arguments are validated against the skill's schema.",
        "Required arguments must be provided on invocation.",
        "Boolean flags use `--flag` syntax.",
      ],
      validation: null,
    },
    {
      id: "share-skill",
      title: "Sharing Skills",
      instruction:
        "Skills can be shared via files or repositories. Export a skill with `/skill export <name>` to get a portable JSON file. Others can import it with `/skill import <file>`.",
      expectedAction: "run-slash",
      hints: [
        "Exported skills include all metadata and prompts.",
        "Import validates the skill before adding it.",
        "Shared skills keep their original name but can be aliased.",
      ],
      validation: null,
    },
    {
      id: "completion",
      title: "Skill Basics Complete",
      instruction:
        "Skills are a powerful way to automate and share workflows. Start building your own skill library to speed up common tasks.",
      expectedAction: "acknowledge",
      hints: [],
      validation: null,
    },
  ],
};

const MEMORY_SYSTEM = {
  id: "memory-system",
  name: "Memory System",
  description:
    "Master HaxAgent's persistent memory system. Store facts, preferences, and context across sessions using namespaces, tags, and search — so the agent remembers what matters.",
  difficulty: "intermediate",
  estimatedMinutes: 10,
  steps: [
    {
      id: "intro",
      title: "Understanding Memory",
      instruction:
        "HaxAgent's memory system persists information across sessions. The agent can remember your preferences, project details, and important context. Type `/memory` to see the memory overview.",
      expectedAction: "acknowledge",
      hints: [],
      validation: null,
    },
    {
      id: "store-item",
      title: "Store a Memory Item",
      instruction:
        "Ask the agent to remember something: 'Remember that I prefer TypeScript over JavaScript for new projects.' The agent will store this and recall it in future sessions.",
      expectedAction: "send-message",
      hints: [
        "Use natural language — the agent decides what to store.",
        "You can be explicit: `/memory store I prefer TypeScript`.",
        "Each stored item has a unique ID you can reference later.",
      ],
      validation: null,
    },
    {
      id: "namespaces",
      title: "Using Namespaces",
      instruction:
        "Organize memory with namespaces. Use `/memory namespace <name>` to switch context. For example, create 'work' and 'personal' namespaces to keep contexts separate.",
      expectedAction: "run-slash",
      hints: [
        "Namespaces isolate memory — items in one namespace are not visible in another.",
        "Use `/memory namespace list` to see all namespaces.",
        "The default namespace is used when none is specified.",
      ],
      validation: null,
    },
    {
      id: "tags",
      title: "Tagging Memory",
      instruction:
        "Add tags to memory items for easy categorization and retrieval. Ask the agent: 'Tag that last fact about TypeScript with #languages #preferences.' Tags are searchable.",
      expectedAction: "send-message",
      hints: [
        "Tags start with # and can contain letters, numbers, and hyphens.",
        "Use `/memory search #languages` to find all items with that tag.",
        "An item can have multiple tags.",
      ],
      validation: null,
    },
    {
      id: "search-memory",
      title: "Search Memory",
      instruction:
        "Find stored information with `/memory search <query>`. Search works across namespaces and matches against content, tags, and metadata.",
      expectedAction: "run-slash",
      hints: [
        "Search supports partial matches.",
        "Results are ranked by relevance.",
        "You can limit search to a specific namespace.",
      ],
      validation: null,
    },
    {
      id: "eviction",
      title: "Managing Memory Capacity",
      instruction:
        "Memory has a configurable capacity limit. When the limit is reached, old or low-priority items are evicted. Configure limits with `/config set memory.maxItems <number>`.",
      expectedAction: "run-slash",
      hints: [
        "Default max items is typically 1000.",
        "Eviction uses LRU (least recently used) policy by default.",
        "You can protect important items from eviction with `/memory protect <id>`.",
      ],
      validation: null,
    },
    {
      id: "completion",
      title: "Memory System Complete",
      instruction:
        "You now understand HaxAgent's memory system! Use it to build persistent context that makes the agent more helpful over time.",
      expectedAction: "acknowledge",
      hints: [],
      validation: null,
    },
  ],
};

const BATCH_MODE = {
  id: "batch-mode",
  name: "Batch Mode",
  description:
    "Use HaxAgent non-interactively for scripts, CI/CD pipelines, and bulk processing. Learn to pipe input, capture output, and process multiple prompts in a single invocation.",
  difficulty: "advanced",
  estimatedMinutes: 10,
  steps: [
    {
      id: "intro",
      title: "What Is Batch Mode?",
      instruction:
        "Batch mode runs HaxAgent without the interactive UI. It is perfect for scripts, automation, and CI/CD pipelines where you want the agent to process a prompt and exit.",
      expectedAction: "acknowledge",
      hints: [],
      validation: null,
    },
    {
      id: "basic-invoke",
      title: "Basic Batch Invocation",
      instruction:
        "Run a single prompt in batch mode: `hax --batch \"Summarize this project\"` or `echo 'Explain the architecture' | hax --batch`. The agent processes the prompt and prints the result.",
      expectedAction: "run-command",
      hints: [
        "The `--batch` flag enables non-interactive mode.",
        "Output goes to stdout, errors to stderr.",
        "The process exit code indicates success (0) or failure (1).",
      ],
      validation: null,
    },
    {
      id: "multi-prompt",
      title: "Multiple Prompts",
      instruction:
        "Process multiple prompts by piping them in, separated by newlines. Create a file with one prompt per line and run: `cat prompts.txt | hax --batch`.",
      expectedAction: "run-command",
      hints: [
        "Each line is treated as a separate prompt.",
        "Responses are separated by a delimiter.",
        "Use `--batch-delimiter` to customize the separator.",
      ],
      validation: null,
    },
    {
      id: "output-format",
      title: "Output Format Options",
      instruction:
        "Control output format with flags. Use `--batch-output json` for structured JSON output, `--batch-output text` for plain text (default), or `--batch-output markdown` for formatted output.",
      expectedAction: "run-command",
      hints: [
        "JSON output includes metadata: model, tokens used, timing.",
        "Markdown output renders rich formatting.",
        "Use `--no-color` to strip ANSI codes from output.",
      ],
      validation: null,
    },
    {
      id: "env-config",
      title: "Environment Configuration",
      instruction:
        "In batch mode, configure the agent via environment variables or a config file. Set `HAX_AGENT_PROVIDER`, `HAX_AGENT_MODEL`, and other settings before running.",
      expectedAction: "run-command",
      hints: [
        "Environment variables override config file settings.",
        "Use `--settings <path>` to specify a settings file.",
        "API keys can be set via environment variables (e.g., ANTHROPIC_API_KEY).",
      ],
      validation: null,
    },
    {
      id: "ci-integration",
      title: "CI/CD Integration",
      instruction:
        "Integrate HaxAgent into your CI pipeline. Use batch mode to run code reviews, generate documentation, or check for issues on every commit or PR.",
      expectedAction: "configure",
      hints: [
        "Add a step in your CI config: `hax --batch 'Review the latest commit for issues'`.",
        "Use `--batch-output json` to parse results programmatically.",
        "Set a timeout with `--batch-timeout` to prevent hanging builds.",
      ],
      validation: null,
    },
    {
      id: "completion",
      title: "Batch Mode Complete",
      instruction:
        "You can now use HaxAgent in automated workflows. Batch mode unlocks scripting, CI/CD integration, and bulk processing — greatly expanding when and where you can use the agent.",
      expectedAction: "acknowledge",
      hints: [],
      validation: null,
    },
  ],
};

const CONFIGURATION = {
  id: "configuration",
  name: "Configuration",
  description:
    "Configure every aspect of HaxAgent: providers and models, API endpoints, memory settings, UI preferences, permission modes, and more. Make the agent work exactly how you want.",
  difficulty: "intermediate",
  estimatedMinutes: 12,
  steps: [
    {
      id: "intro",
      title: "Configuration Overview",
      instruction:
        "HaxAgent is highly configurable. Settings are loaded from multiple sources (env vars, settings files, defaults) and deep-merged. This tutorial covers the most important options.",
      expectedAction: "acknowledge",
      hints: [],
      validation: null,
    },
    {
      id: "view-config",
      title: "View Current Configuration",
      instruction:
        "Type `/config` to see all current settings. The output shows where each setting comes from (env var, user settings, project settings, or default).",
      expectedAction: "run-slash",
      hints: [
        "Settings are shown in a tree format.",
        "The source of each setting is indicated.",
        "Overridden settings are highlighted.",
      ],
      validation: null,
    },
    {
      id: "provider-config",
      title: "Configure Providers",
      instruction:
        "Set your AI provider and model. Use `/config set agent.provider anthropic` and `/config set agent.model claude-sonnet-4-20250514`. You can also set the API key and custom endpoint URL.",
      expectedAction: "run-slash",
      hints: [
        "Supported providers: anthropic, openai, google.",
        "Each provider has its own set of available models.",
        "API keys can be set via environment variables for security.",
      ],
      validation: null,
    },
    {
      id: "memory-config",
      title: "Memory Configuration",
      instruction:
        "Configure memory behaviour: enable/disable memory, set max items, choose eviction policy, and configure auto-store behaviour. Try `/config set memory.enabled true`.",
      expectedAction: "run-slash",
      hints: [
        "`memory.enabled` turns memory on or off globally.",
        "`memory.maxItems` sets the storage limit.",
        "`memory.autoStore` controls whether the agent automatically stores context.",
      ],
      validation: null,
    },
    {
      id: "context-config",
      title: "Context Window Configuration",
      instruction:
        "Manage the context window: enable context management, set reserve output tokens, and configure compaction. Use `/config set context.enabled true` and adjust related settings.",
      expectedAction: "run-slash",
      hints: [
        "Context management prevents token overflow.",
        "Reserve output tokens ensure the model has room to respond.",
        "Compaction summarizes old messages to save space.",
      ],
      validation: null,
    },
    {
      id: "ui-config",
      title: "UI and Display Settings",
      instruction:
        "Customize the interface: set the language/locale, toggle color output, adjust the prompt style, and configure display density. Try `/config set ui.locale en`.",
      expectedAction: "run-slash",
      hints: [
        "Available locales are listed with `/config list locales`.",
        "Color output can be disabled with `--no-color` or in settings.",
        "Theme can be set to 'dark' or 'light'.",
      ],
      validation: null,
    },
    {
      id: "export-import",
      title: "Export and Import Configuration",
      instruction:
        "Share or back up your configuration. Use `/config export` to write settings to a file, and `/config import <file>` to load settings from a file.",
      expectedAction: "run-slash",
      hints: [
        "Exported config excludes sensitive values like API keys.",
        "Imported settings are merged, not replaced.",
        "Use `--settings <path>` to specify a config file on startup.",
      ],
      validation: null,
    },
    {
      id: "completion",
      title: "Configuration Complete",
      instruction:
        "Your HaxAgent is now configured exactly how you want it. Remember you can always adjust settings later — the configuration system is designed to grow with you.",
      expectedAction: "acknowledge",
      hints: [],
      validation: null,
    },
  ],
};

module.exports = {
  GETTING_STARTED,
  SLASH_COMMANDS,
  AGENT_TEAMS,
  PLUGIN_BASICS,
  SKILL_BASICS,
  MEMORY_SYSTEM,
  BATCH_MODE,
  CONFIGURATION,
};
