interface MemoryItem { title?: string; content?: string; importance?: number; tags?: string[] }
interface ScoredMemory { memory: MemoryItem; score: number }
function scoreMemoryRelevance(memory: MemoryItem, query: string): number { const q=query.toLowerCase(); const c=((memory.title||"")+" "+(memory.content||"")).toLowerCase(); let s=0; if(c.includes(q)) s+=10; for(const kw of q.split(/\s+/)) if(c.includes(kw)) s+=2; s+=(memory.importance||3)*0.1; if(memory.tags) for(const t of memory.tags) if(q.includes(t.toLowerCase())) s+=5; return s; }
function rankMemories(memories: MemoryItem[], query: string, limit=5): MemoryItem[] { return memories.map((m: MemoryItem)=>({memory:m,score:scoreMemoryRelevance(m,query)})).filter((r: ScoredMemory)=>r.score>0).sort((a: ScoredMemory,b: ScoredMemory)=>b.score-a.score).slice(0,limit).map((r: ScoredMemory)=>r.memory); }
export { scoreMemoryRelevance, rankMemories };
