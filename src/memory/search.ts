import { MemoryStore } from "./store.js";

interface SearchMemoryOptions {
  dir?: string;
  limit?: number;
}

async function searchMemory(query: string, opts: SearchMemoryOptions = {}) {
  const store = new MemoryStore(opts);
  await store.init();
  return store.search(query, opts.limit || 10);
}

export { searchMemory };
