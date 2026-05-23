"use strict";

/**
 * PromptEvolution — Evolves prompts over generations using mutation, selection,
 * breeding, and iterative improvement driven by performance scores.
 *
 *   const { PromptEvolution } = require("./prompts/evolution");
 *   const evolver = new PromptEvolution({ seed: "You are a code reviewer." });
 *   const winner = evolver.evolve(5, async (prompt) => evaluate(prompt));
 *   console.log(evolver.getLineage(winner));
 *
 * Suppported mutation strategies:
 *   - "rephrase"     — Change wording without altering meaning.
 *   - "restructure"  — Reorganise sections and headings.
 *   - "addDetail"    — Inject additional context or instructions.
 *   - "simplify"     — Remove verbosity while preserving core intent.
 *   - "specialize"   — Narrow focus to a specific domain or task.
 */

// ---------------------------------------------------------------------------
// PromptEvolution
// ---------------------------------------------------------------------------

class PromptEvolution {
  /**
   * @param {object} [options]
   * @param {string} [options.seed]            The initial prompt to evolve.
   * @param {number} [options.populationSize=6]  Number of candidates per generation.
   * @param {number} [options.survivors=2]       Number of top candidates kept each generation.
   * @param {number} [options.mutationRate=0.4]  Probability a candidate is mutated.
   * @param {Array<string>} [options.strategies] Mutation strategies to use (defaults to all).
   */
  constructor(options = {}) {
    this._seed = options.seed || "";
    this._populationSize = options.populationSize || 6;
    this._survivors = options.survivors || 2;
    this._mutationRate = options.mutationRate || 0.4;
    this._strategies = options.strategies || [
      "rephrase",
      "restructure",
      "addDetail",
      "simplify",
      "specialize",
    ];

    /** @type {Map<string, object>}  prompt -> lineage record */
    this._lineage = new Map();
  }

  // -----------------------------------------------------------------------
  // Mutation strategies
  // -----------------------------------------------------------------------

  /**
   * Canned mutations.  Each receives a prompt string and returns a variant.
   *
   * @param {string} prompt
   * @param {string} strategy
   * @returns {string}
   */
  mutate(prompt, strategy) {
    if (typeof prompt !== "string") {
      throw new TypeError("mutate: prompt must be a string");
    }

    switch (strategy) {
      case "rephrase":
        return this._rephrase(prompt);
      case "restructure":
        return this._restructure(prompt);
      case "addDetail":
        return this._addDetail(prompt);
      case "simplify":
        return this._simplify(prompt);
      case "specialize":
        return this._specialize(prompt);
      default:
        throw new Error(`mutate: unknown strategy "${strategy}". Valid: ${this._strategies.join(", ")}`);
    }
  }

  /** @private */
  _rephrase(prompt) {
    const prefixes = [
      "IMPORTANT: ",
      "Your primary objective: ",
      "Key directive: ",
      "Above all else, ",
    ];
    const suffixes = [
      " Ensure thoroughness.",
      " Be precise and concise.",
      " Prioritize correctness above all.",
      " Double-check your work before responding.",
    ];

    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];

    // Find a reasonable insertion point — after the first heading if present
    const headingMatch = prompt.match(/^(#[^\n]*\n)/);
    if (headingMatch) {
      const idx = headingMatch.index + headingMatch[0].length;
      return prompt.slice(0, idx) + prefix + prompt.slice(idx) + suffix;
    }

    return prefix + prompt + suffix;
  }

  /** @private */
  _restructure(prompt) {
    const lines = prompt.split("\n");

    // Collect headings with their positions
    const headings = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(#{1,4})\s/);
      if (m) {
        headings.push({ line: i, level: m[1].length, text: lines[i] });
      }
    }

    if (headings.length < 2) return prompt;

    // Swap two adjacent top-level headings and their sections
    const topLevel = headings.filter((h) => h.level <= 2);
    if (topLevel.length < 2) return prompt;

    // Pick a random adjacent pair and swap their sections
    const idx = Math.floor(Math.random() * (topLevel.length - 1));
    const h1 = topLevel[idx];
    const h2 = topLevel[idx + 1];

    const section1 = lines.slice(h1.line, h2.line);
    const section2End =
      idx + 2 < topLevel.length
        ? topLevel[idx + 2].line
        : lines.length;
    const section2 = lines.slice(h2.line, section2End);

    const result = [
      ...lines.slice(0, h1.line),
      ...section2,
      ...section1,
      ...lines.slice(section2End),
    ];

    return result.join("\n");
  }

  /** @private */
  _addDetail(prompt) {
    const details = [
      "\n\n## Additional Context\n- Consider edge cases such as null, empty, and boundary values.\n- Verify assumptions before proceeding.\n- Document any constraints that affect the response.",
      "\n\n## Extended Instructions\n- Break the task into smaller steps.\n- Explain your reasoning for each decision.\n- Flag any ambiguity in the request.",
      "\n\n## Quality Checklist\n- [ ] All requirements are addressed\n- [ ] Output is well-structured\n- [ ] Edge cases are covered\n- [ ] No assumptions go unverified",
      "\n\n## Performance Note\n- Aim for optimal algorithmic complexity.\n- Avoid repeated work or unnecessary allocations.\n- Consider scalability if the input size grows.",
    ];

    return prompt + details[Math.floor(Math.random() * details.length)];
  }

  /** @private */
  _simplify(prompt) {
    const lines = prompt.split("\n");

    // Remove lines that are purely decorative or low-signal
    const filtered = lines.filter((line) => {
      const trimmed = line.trim();
      // Keep headings
      if (/^#{1,4}\s/.test(trimmed)) return true;
      // Drop separator lines like "---", "===", "***"
      if (/^[-=*]{3,}$/.test(trimmed)) return false;
      // Drop empty lines that appear in runs of 3+
      if (trimmed === "") return true; // keep single blank lines (compacted later)
      return true;
    });

    // Compact runs of blank lines
    const compacted = [];
    let blankCount = 0;
    for (const line of filtered) {
      if (line.trim() === "") {
        blankCount++;
        if (blankCount <= 1) compacted.push(line);
      } else {
        blankCount = 0;
        compacted.push(line);
      }
    }

    return compacted.join("\n").trim() + "\n";
  }

  /** @private */
  _specialize(prompt) {
    const domains = [
      "React",
      "Python backend",
      "DevOps / CI-CD",
      "SQL databases",
      "REST APIs",
      "security auditing",
    ];
    const domain = domains[Math.floor(Math.random() * domains.length)];
    const specialization = [
      "",
      `## Domain Specialization: ${domain}`,
      `Focus your analysis through the lens of ${domain} best practices and conventions.`,
      `If you encounter ${domain}-specific patterns, highlight them explicitly.`,
      "",
    ].join("\n");

    // Insert specialization after the first major heading
    const headingMatch = prompt.match(/^(#[^\n]*\n)/);
    if (headingMatch) {
      const idx = headingMatch.index + headingMatch[0].length;
      return prompt.slice(0, idx) + specialization + prompt.slice(idx);
    }

    return specialization + "\n" + prompt;
  }

  // -----------------------------------------------------------------------
  // Selection
  // -----------------------------------------------------------------------

  /**
   * Select the best-performing candidates from a population.
   *
   * @param {Array<string>} population  Array of prompt strings.
   * @param {Array<number>} scores      Numeric score for each prompt (higher = better).
   * @param {number} [topN]             How many to keep (defaults to this._survivors).
   * @returns {Array<{ prompt: string, score: number, rank: number }>}
   *   Ranked survivors (best first).
   */
  select(population, scores, topN) {
    if (!Array.isArray(population) || !Array.isArray(scores)) {
      throw new TypeError("select: population and scores must be arrays");
    }
    if (population.length !== scores.length) {
      throw new Error(
        `select: population length (${population.length}) must match scores length (${scores.length})`
      );
    }

    const n = topN != null ? topN : this._survivors;

    // Pair up and sort by score descending
    const ranked = population
      .map((prompt, i) => ({ prompt, score: scores[i] }))
      .sort((a, b) => b.score - a.score)
      .map((entry, i) => ({ ...entry, rank: i + 1 }));

    return ranked.slice(0, Math.max(1, n));
  }

  // -----------------------------------------------------------------------
  // Breeding
  // -----------------------------------------------------------------------

  /**
   * Combine two prompt strings to produce a child prompt.
   *
   * The child takes the first half of parentA and the second half of parentB,
   * split on a major heading boundary to keep structure coherent.
   *
   * @param {string} parentA  First parent prompt.
   * @param {string} parentB  Second parent prompt.
   * @returns {string}        Child prompt.
   */
  breed(parentA, parentB) {
    if (typeof parentA !== "string" || typeof parentB !== "string") {
      throw new TypeError("breed: both parents must be strings");
    }

    const aLines = parentA.split("\n");
    const bLines = parentB.split("\n");

    // Find heading boundaries in parentA
    const aHeadingIndices = [];
    for (let i = 0; i < aLines.length; i++) {
      if (/^#{1,3}\s/.test(aLines[i])) {
        aHeadingIndices.push(i);
      }
    }

    // Split point: halfway through headings, or half the lines
    let splitA;
    if (aHeadingIndices.length >= 2) {
      const mid = Math.floor(aHeadingIndices.length / 2);
      splitA = aHeadingIndices[mid];
    } else {
      splitA = Math.floor(aLines.length / 2);
    }

    // Find heading boundaries in parentB
    const bHeadingIndices = [];
    for (let i = 0; i < bLines.length; i++) {
      if (/^#{1,3}\s/.test(bLines[i])) {
        bHeadingIndices.push(i);
      }
    }

    let startB;
    if (bHeadingIndices.length >= 2) {
      const mid = Math.floor(bHeadingIndices.length / 2);
      startB = bHeadingIndices[mid];
    } else {
      startB = Math.floor(bLines.length / 2);
    }

    const child = [
      ...aLines.slice(0, splitA),
      ...bLines.slice(startB),
    ];

    return child.join("\n");
  }

  // -----------------------------------------------------------------------
  // Evolution
  // -----------------------------------------------------------------------

  /**
   * Run evolution for a given number of generations.
   *
   * Each generation:
   *   1. Select the top survivors from the previous generation.
   *   2. Breed survivors together to produce children.
   *   3. Mutate some children.
   *   4. Evaluate the new population via the evaluator callback.
   *
   * @param {number} generations    Number of generations to run.
   * @param {Function} evaluator    async (prompt: string) => number
   *                                Returns a numeric score (higher = better).
   * @returns {Promise<string>}     The best prompt after all generations.
   */
  async evolve(generations, evaluator) {
    if (typeof generations !== "number" || generations < 1) {
      throw new TypeError("evolve: generations must be a positive integer");
    }
    if (typeof evaluator !== "function") {
      throw new TypeError("evolve: evaluator must be a function");
    }

    // Initialize population from seed
    let population = [this._seed];

    // Track lineage
    this._lineage.clear();
    this._lineage.set(this._seed, { parents: [], generation: 0 });

    for (let gen = 1; gen <= generations; gen++) {
      // Expand population
      while (population.length < this._populationSize) {
        // Breed random pairs
        const parentA = population[Math.floor(Math.random() * population.length)];
        const parentB = population[Math.floor(Math.random() * population.length)];
        let child = this.breed(parentA, parentB);

        // Optionally mutate
        if (Math.random() < this._mutationRate) {
          const strategy =
            this._strategies[Math.floor(Math.random() * this._strategies.length)];
          child = this.mutate(child, strategy);
        }

        // Avoid exact duplicates
        if (!population.includes(child)) {
          population.push(child);

          // Record lineage
          if (!this._lineage.has(child)) {
            this._lineage.set(child, {
              parents: [parentA, parentB],
              generation: gen,
            });
          }
        }
      }

      // Evaluate
      const scores = [];
      for (const prompt of population) {
        const score = await evaluator(prompt);
        scores.push(
          typeof score === "number" ? score : Number(score) || 0
        );
      }

      // Select survivors
      const ranked = this.select(population, scores, this._survivors);
      population = ranked.map((r) => r.prompt);
    }

    // Return the best (only one, since select already sorts)
    return population[0];
  }

  // -----------------------------------------------------------------------
  // Lineage
  // -----------------------------------------------------------------------

  /**
   * Get the evolution history for a prompt.
   *
   * @param {string} prompt  The prompt whose lineage to retrieve.
   * @returns {{ prompt: string, parents: Array<string>, generation: number } | null}
   */
  getLineage(prompt) {
    if (!this._lineage.has(prompt)) return null;
    const record = this._lineage.get(prompt);
    return {
      prompt,
      parents: record.parents,
      generation: record.generation,
    };
  }

  /**
   * Return all lineage records.
   *
   * @returns {Map<string, object>}
   */
  getAllLineage() {
    return new Map(this._lineage);
  }

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  /** @returns {string} */
  get seed() {
    return this._seed;
  }

  /** @returns {number} */
  get populationSize() {
    return this._populationSize;
  }

  /** @returns {number} */
  get survivors() {
    return this._survivors;
  }

  /** @returns {number} */
  get mutationRate() {
    return this._mutationRate;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  PromptEvolution,
};
