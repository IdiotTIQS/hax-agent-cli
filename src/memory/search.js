"use strict";
const { MemoryStore } = require("./store");
async function searchMemory(query,opts={}) { const store=new MemoryStore(opts); await store.init(); return store.search(query,opts.limit||10); }
module.exports = { searchMemory };
