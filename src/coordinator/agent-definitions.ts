/** Agent role definitions. Ported from OpenHarness coordinator/agent_definitions.py */

const BUILTIN_AGENTS = {
  architect: { name: "architect", role: "Software Architect", description: "Designs system architecture, component boundaries, and data flow", tools: ["file.read", "file.glob", "file.search", "web.search"] },
  reviewer: { name: "reviewer", role: "Code Reviewer", description: "Reviews code for correctness, readability, security, and performance", tools: ["file.read", "file.glob", "file.search", "shell.run"] },
  tester: { name: "tester", role: "Test Engineer", description: "Designs and writes tests, analyzes coverage gaps", tools: ["file.read", "file.write", "file.edit", "file.glob", "file.search", "shell.run"] },
  implementer: { name: "implementer", role: "Software Engineer", description: "Implements features following specifications", tools: ["file.read", "file.write", "file.edit", "file.glob", "file.search", "shell.run"] },
  debugger: { name: "debugger", role: "Debugger", description: "Systematically identifies and fixes bugs", tools: ["file.read", "file.edit", "file.search", "shell.run", "web.search"] },
  security: { name: "security", role: "Security Auditor", description: "Finds vulnerabilities and recommends hardening", tools: ["file.read", "file.glob", "file.search", "web.search"] },
  researcher: { name: "researcher", role: "Researcher", description: "Explores codebases, gathers context, answers questions", tools: ["file.read", "file.glob", "file.search", "web.search", "web.fetch"] },
};

class AgentDefinition {
  constructor(o = {}) { this.name = o.name || ""; this.role = o.role || ""; this.description = o.description || ""; this.tools = o.tools || []; this.systemPrompt = o.systemPrompt || ""; }
}

function getBuiltinAgent(name) { return BUILTIN_AGENTS[name] ? new AgentDefinition(BUILTIN_AGENTS[name]) : null; }
function listBuiltinAgents() { return Object.values(BUILTIN_AGENTS).map(a => new AgentDefinition(a)); }

export { BUILTIN_AGENTS, AgentDefinition, getBuiltinAgent, listBuiltinAgents };
