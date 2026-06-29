import { MemoryStore } from "./store.js";
async function searchMemory(query,opts={}) { const store=new MemoryStore(opts); await store.init(); return store.search(query,opts.limit||10); }
export { searchMemory };
