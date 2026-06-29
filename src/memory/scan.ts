import path from "path";
import fs from "fs";

interface FactPattern {
  type: string;
  re: RegExp;
}

interface MemoryCandidate {
  type: string;
  value: string;
}

const FACT_PATTERNS: FactPattern[] = [
  { type: "file_path", re: /[\w/\-]+\.[a-z]{2,4}/g },
  { type: "version",   re: /(?:version|v)\s*[:=]?\s*(\d+\.\d+\.\d+)/gi },
  { type: "url",       re: /https?:\/\/[^\s"'<>]+/g },
  { type: "command",   re: /`([^`]+)`/g },
  { type: "error",     re: /(?:Error|Exception|错误)[:\s]+(\S[\s\S]{5,200}?)[.;\n]/gi },
];

function scanTextForMemories(text: string): MemoryCandidate[] {
  const results: MemoryCandidate[] = [];
  const seen = new Set<string>();
  for (const { type, re } of FACT_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const v = m[1] || m[0];
      const key = type + ":" + v;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ type, value: v.trim().slice(0, 200) });
      }
    }
  }
  return results;
}

export { FACT_PATTERNS, scanTextForMemories };
