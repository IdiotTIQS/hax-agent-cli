import fs from "fs";
import path from "path";
import { HookDefinition, HookType } from "./registry.js";

function loadHooksFromDir(dir: string): HookDefinition[] {
  if (!fs.existsSync(dir)) return [];
  const hooks: HookDefinition[] = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".json"))) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as unknown;
      const items: unknown[] = Array.isArray(data) ? data : [data];
      for (const h of items) {
        const hd = h as Record<string, unknown>;
        hooks.push(new HookDefinition({
          event: hd["event"] as string || "",
          type: (hd["type"] as string) || HookType.COMMAND,
          matcher: (hd["matcher"] as string) || null,
          priority: (hd["priority"] as number) || 0,
          command: (hd["command"] as string) || null,
          url: (hd["url"] as string) || null,
        }));
      }
    } catch (_) {}
  }
  return hooks;
}

export { loadHooksFromDir };
