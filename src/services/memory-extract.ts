/**
 * Memory Extract — LLM-based memory extraction from conversation.
 * Ported from OpenHarness services/memory_extract/
 *
 * Analyzes user messages and assistant responses to extract
 * durable memories: preferences, project facts, techniques,
 * conventions, error solutions, and more.
 *
 * Features:
 * - Categorized memory extraction (6 categories)
 * - Confidence scoring (1-5)
 * - Deduplication against existing memories
 * - Rate limiting (max extractions per session)
 * - Prompt template with existing memory context
 */

import crypto from "crypto";

// === Memory Categories ===

const MemoryCategory = {
  USER_PREFERENCE: "user_preference",   // "I prefer tabs over spaces"
  PROJECT_FACT: "project_fact",         // "This project uses Vue 3 with Vite"
  TECHNIQUE: "technique",               // "We use the Strategy pattern for..."
  CONVENTION: "convention",             // "Always use kebab-case for filenames"
  ERROR_SOLUTION: "error_solution",     // "When X fails, run Y to fix"
  WORKFLOW: "workflow",                 // "The deploy process involves..."
};

// === Memory Entry ===

class MemoryEntry {
  constructor(o = {}) {
    this.id = o.id || crypto.createHash("sha256").update(o.content || "").digest("hex").slice(0, 12);
    this.content = o.content || "";
    this.category = o.category || MemoryCategory.PROJECT_FACT;
    this.confidence = o.confidence || 3; // 1-5
    this.source = o.source || "extracted"; // "extracted" | "manual" | "imported"
    this.timestamp = o.timestamp || Date.now();
    this.expiresAt = o.expiresAt || null;
    this.tags = o.tags || [];
    this.occurrenceCount = o.occurrenceCount || 1;
  }

  get signature() {
    // Normalize for dedup
    return this.content.toLowerCase().replace(/\s+/g, " ").trim();
  }

  toJSON() {
    return {
      id: this.id,
      content: this.content,
      category: this.category,
      confidence: this.confidence,
      source: this.source,
      timestamp: this.timestamp,
      expiresAt: this.expiresAt,
      tags: this.tags,
      occurrenceCount: this.occurrenceCount,
    };
  }

  static fromJSON(json) {
    return new MemoryEntry(json);
  }
}

// === Memory Extractor ===

class MemoryExtractor {
  constructor(options = {}) {
    this._lastExtractionTime = null;
    this._extractionCount = 0;
    this._maxExtractionsPerSession = options.maxExtractionsPerSession || 5;
    this._minTurnsBetweenExtractions = options.minTurnsBetweenExtractions || 3;
    this._existingMemories = options.existingMemories || [];
  }

  /**
   * Check if extraction should run now.
   * @param {number} turnCount — current turn number
   * @returns {boolean}
   */
  shouldExtract(turnCount) {
    if (this._extractionCount >= this._maxExtractionsPerSession) return false;
    if (this._lastExtractionTime) {
      const elapsed = Date.now() - this._lastExtractionTime;
      if (elapsed < 60000) return false; // at least 1 minute between extractions
    }
    return true;
  }

  /**
   * Build the extraction prompt for the LLM.
   * @param {Array} messages — recent conversation messages
   * @param {Array} existingMemories — current memory entries
   * @returns {string} prompt for LLM
   */
  buildExtractionPrompt(messages, existingMemories = []) {
    // Format recent messages
    const conversationText = messages
      .slice(-10)
      .map((m) => {
        const role = m.role === "user" ? "User" : "Assistant";
        const content = typeof m.content === "string"
          ? m.content
          : Array.isArray(m.content)
            ? m.content.filter((c) => c.type === "text" || typeof c === "string")
                .map((c) => typeof c === "string" ? c : c.text).join(" ")
            : String(m.content);
        return `[${role}] ${content.slice(0, 500)}`;
      })
      .join("\n");

    // Format existing memories for context
    const existingText = existingMemories.length > 0
      ? existingMemories.map((m) => `- [${m.category}] ${m.content}`).join("\n")
      : "(none)";

    return `Extract durable memories from this conversation. A memory is a fact, preference, convention, or technique that should persist across sessions.

## Existing Memories (DO NOT duplicate these)
${existingText}

## Recent Conversation
${conversationText}

## Instructions
Analyze the conversation and extract memories that:
1. Represent user preferences ("I prefer...", "I like...", "I always...")
2. Contain project facts ("This project uses...", "The framework is...")
3. Describe techniques or patterns used
4. Establish conventions ("always use X for Y")
5. Document error solutions ("when X fails, do Y")
6. Define workflows ("the deploy process is...")

For each memory:
- Assign a category from: user_preference, project_fact, technique, convention, error_solution, workflow
- Rate confidence 1-5 (5 = explicitly stated, 1 = weakly implied)
- Skip if the memory already exists above

Return JSON array:
[
  {"content": "...", "category": "project_fact", "confidence": 5, "reason": "explicitly mentioned"}
]

If nothing new is worth remembering, return an empty array.`;
  }

  /**
   * Parse LLM response into memory entries.
   * @param {string} llmResponse — raw LLM output
   * @param {Array} existingMemories — current memories for dedup
   * @returns {Array<MemoryEntry>}
   */
  parseExtraction(llmResponse, existingMemories = []) {
    try {
      // Try to extract JSON from response
      const jsonMatch = llmResponse.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const items = JSON.parse(jsonMatch[0]);
      const entries = [];

      for (const item of items) {
        if (!item.content) continue;

        const entry = new MemoryEntry({
          content: item.content,
          category: Object.values(MemoryCategory).includes(item.category)
            ? item.category
            : MemoryCategory.PROJECT_FACT,
          confidence: Math.min(5, Math.max(1, item.confidence || 3)),
          source: "extracted",
          timestamp: Date.now(),
        });

        // Dedup against existing memories
        if (!this._isDuplicate(entry, existingMemories)) {
          entries.push(entry);
        }
      }

      return entries;
    } catch (_) {
      return [];
    }
  }

  /**
   * Merge extracted memories with existing ones.
   * @param {Array<MemoryEntry>} newMemories
   * @param {Array<MemoryEntry>} existingMemories
   * @returns {Object} { added, updated, unchanged }
   */
  mergeMemories(newMemories, existingMemories) {
    const added = [];
    const updated = [];
    const unchanged = [];

    for (const newMem of newMemories) {
      const existing = existingMemories.find(
        (em) => em.signature === newMem.signature
      );

      if (existing) {
        // Update occurrence count
        existing.occurrenceCount = (existing.occurrenceCount || 1) + 1;
        // Boost confidence if repeatedly confirmed
        if (existing.occurrenceCount >= 3 && existing.confidence < 5) {
          existing.confidence = Math.min(5, existing.confidence + 1);
        }
        updated.push(existing);
      } else {
        // Only add high-confidence new memories
        if (newMem.confidence >= 3) {
          added.push(newMem);
        }
      }
    }

    return { added, updated, unchanged };
  }

  /**
   * Record an extraction attempt.
   */
  recordExtraction() {
    this._lastExtractionTime = Date.now();
    this._extractionCount++;
  }

  /**
   * Check if a memory entry is a duplicate of existing ones.
   */
  _isDuplicate(entry, existing) {
    if (existing.length === 0) return false;

    const sig = entry.signature;

    for (const em of existing) {
      const existingSig = em.signature || em.content.toLowerCase().replace(/\s+/g, " ").trim();

      // Exact match
      if (existingSig === sig) return true;

      // Near-duplicate: Jaccard similarity on words
      const newWords = new Set(sig.split(" ").filter((w) => w.length > 2));
      const oldWords = new Set(existingSig.split(" ").filter((w) => w.length > 2));
      const intersection = [...newWords].filter((w) => oldWords.has(w));
      const union = new Set([...newWords, ...oldWords]);
      const similarity = intersection.length / union.size;

      if (similarity > 0.75) return true;
    }

    return false;
  }
}

// === Prompt Builder (for use by provider) ===

/**
 * Build a complete extraction request for a provider.
 * @param {Array} messages
 * @param {Array} existingMemories
 * @returns {Object} { messages, system }
 */
function buildExtractionRequest(messages, existingMemories = []) {
  const extractor = new MemoryExtractor();
  const prompt = extractor.buildExtractionPrompt(messages, existingMemories);

  return {
    messages: [{ role: "user", content: prompt }],
    system: "You are a memory extraction system. Extract durable facts from conversations. Always output valid JSON.",
    maxTokens: 1000,
    temperature: 0.1,
  };
}

export {
  MemoryCategory,
  MemoryEntry,
  MemoryExtractor,
  buildExtractionRequest,
};
