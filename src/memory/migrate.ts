import fs from "fs";
import path from "path";
import { getMemoryDir } from "./memdir.js";

interface MigrationResult {
  migrated: number;
  error?: string;
}

function migrateLegacyMemories(): MigrationResult {
  const dir = getMemoryDir();
  const legacy = path.join(dir, "memories.json");
  if (!fs.existsSync(legacy)) return { migrated: 0 };
  try {
    const data = JSON.parse(fs.readFileSync(legacy, "utf-8")) as { memories?: unknown[] } | unknown[];
    let count = 0;
    const memories: unknown[] = Array.isArray(data) ? data : ((data as { memories?: unknown[] }).memories || []);
    for (const m of memories) {
      const mem = m as Record<string, unknown>;
      const fp = path.join(dir, String(mem["id"] || mem["name"] || "mem_" + count) + ".md");
      if (!fs.existsSync(fp)) {
        fs.writeFileSync(fp,
          "---\ntitle: " + String(mem["title"] || mem["name"] || "") +
          "\ncategory: " + String(mem["category"] || "user_preference") +
          "\n---\n\n" + String(mem["content"] || "")
        );
        count++;
      }
    }
    fs.renameSync(legacy, legacy + ".bak");
    return { migrated: count };
  } catch (err: unknown) {
    return { migrated: 0, error: (err as Error).message };
  }
}

export { migrateLegacyMemories };
