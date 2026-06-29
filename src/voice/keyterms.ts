/** Voice keyterms — wake words and command phrases. Ported from OpenHarness voice/keyterms.py */

const WAKE_WORDS = ["hey claude", "hey hax", "ok claude", "computer", "agent"];
const STOP_PHRASES = ["stop listening", "stop voice", "exit voice", "quit voice", "goodbye"];
const COMMAND_PREFIXES = ["run", "execute", "search for", "find", "show me", "tell me", "explain", "write", "fix", "create", "build"];

function isWakeWord(text: string): boolean { const t = text.toLowerCase().trim(); return WAKE_WORDS.some(w => t.includes(w)); }
function isStopPhrase(text: string): boolean { const t = text.toLowerCase().trim(); return STOP_PHRASES.some(p => t.includes(p)); }

export { WAKE_WORDS, STOP_PHRASES, COMMAND_PREFIXES, isWakeWord, isStopPhrase };
