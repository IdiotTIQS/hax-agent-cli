function estimateTokens(text) { if (!text) return 0; let t = 0; for (const ch of String(text)) { const c = ch.codePointAt(0); if ((c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3040 && c <= 0x30FF)) t += 0.6; else if (c > 127) t += 0.4; else t += 0.25; } return Math.ceil(t) + 4; }
function estimateConversationTokens(msgs) { return msgs.reduce((s, m) => { const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content || ""); return s + estimateTokens(c); }, 0); }
export { estimateTokens, estimateConversationTokens };
