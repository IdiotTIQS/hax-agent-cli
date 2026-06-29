/**
 * Personalization — extract environment facts from conversation.
 * Ported from OpenHarness personalization/extractor.py.
 */

const FACT_PATTERNS = [
  { type: "ssh_host", label: "SSH Hosts", pattern: /ssh\s+\S+@(\S+)/g },
  { type: "ip_address", label: "Known Servers", pattern: /\b(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/g },
  { type: "data_path", label: "Data Paths", pattern: /(?:\/[\w.-]+){2,}/g },
  { type: "conda_env", label: "Python Environments", pattern: /conda\s+(?:activate|env)\s+(\S+)/g },
  { type: "python_version", label: "Python Versions", pattern: /python\s*3\.\d{1,2}/gi },
  { type: "api_endpoint", label: "API Endpoints", pattern: /https?:\/\/api\.\S+/g },
  { type: "env_var", label: "Environment Variables", pattern: /[A-Z_]{3,30}=[\S]+/g },
  { type: "git_remote", label: "Git Remotes", pattern: /(?:github|gitlab)\.com[:/](\S+)(?:\.git)?/g },
  { type: "cron_schedule", label: "Cron Schedules", pattern: /(?:every|每个|每隔)\s+(\d+\s*(?:minute|hour|day|week|分钟|小时|天|周)s?)/gi },
  { type: "docker_image", label: "Docker Images", pattern: /(?:docker|image)\s+(\S+:\S+)/gi },
];

const FALSE_POSITIVE_IPS = new Set(["127.0.0.1", "0.0.0.0", "255.255.255.255"]);

function extractFacts(text) {
  const facts = [];
  const seen = new Set();
  const ct = String(text || "");

  for (const { type, label, pattern } of FACT_PATTERNS) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(ct)) !== null) {
      const value = m[1] || m[0];
      if (FALSE_POSITIVE_IPS.has(value)) continue;
      if (type === "ip_address" && (value.startsWith("0.") || value.startsWith("255."))) continue;
      const key = `${type}:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      facts.push({ key, type, label, value: value.trim(), confidence: 0.7 });
    }
  }
  return facts;
}

function extractLocalRules(messages) {
  const texts = [];
  for (const m of messages || []) {
    if (typeof m.content === "string") texts.push(m.content);
    else if (Array.isArray(m.content)) {
      for (const b of m.content) {
        if (typeof b === "string") texts.push(b);
        else if (b?.text) texts.push(b.text);
      }
    }
  }
  return extractFacts(texts.join("\n"));
}

function factsToMarkdown(facts) {
  const groups = {};
  for (const f of facts) {
    if (!groups[f.label]) groups[f.label] = [];
    groups[f.label].push(f);
  }

  const lines = ["# Environment Facts", `Auto-generated: ${new Date().toISOString()}`, ""];
  for (const [label, items] of Object.entries(groups)) {
    lines.push(`## ${label}`, "");
    for (const item of items) lines.push(`- ${item.value}`);
    lines.push("");
  }
  return lines.join("\n");
}

export { FACT_PATTERNS, extractFacts, extractLocalRules, factsToMarkdown };
