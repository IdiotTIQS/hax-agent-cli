"use strict";
function scoreMemoryRelevance(memory,query) { const q=query.toLowerCase(); const c=(memory.title+" "+memory.content).toLowerCase(); let s=0; if(c.includes(q)) s+=10; for(const kw of q.split(/\s+/)) if(c.includes(kw)) s+=2; s+=(memory.importance||3)*0.1; if(memory.tags) for(const t of memory.tags) if(q.includes(t.toLowerCase())) s+=5; return s; }
function rankMemories(memories,query,limit=5) { return memories.map(m=>({memory:m,score:scoreMemoryRelevance(m,query)})).filter(r=>r.score>0).sort((a,b)=>b.score-a.score).slice(0,limit).map(r=>r.memory); }
module.exports = { scoreMemoryRelevance, rankMemories };
