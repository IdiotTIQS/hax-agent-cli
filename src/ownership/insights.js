"use strict";

/**
 * Analyzes ownership data to surface organizational insights:
 * knowledge maps, bus factor risks, orphaned files, contribution stats,
 * and knowledge transfer recommendations.
 */
class OwnershipInsights {
  /**
   * @param {import('./tracker').OwnershipTracker} tracker - an OwnershipTracker instance
   * @param {import('./blame').BlameEngine} [blameEngine] - optional BlameEngine instance
   */
  constructor(tracker, blameEngine) {
    if (!tracker || typeof tracker.getOwner !== "function") {
      throw new Error("OwnershipInsights requires an OwnershipTracker instance");
    }
    this._tracker = tracker;
    this._blame = blameEngine || null;
  }

  // ─── public API ──────────────────────────────────────────

  /**
   * Build a knowledge map showing which agents/authors know which parts of the code.
   * Categorizes files into logical groups based on directory structure.
   * @returns {{ byAuthor: object, byDirectory: object, authorExpertise: object }}
   */
  getKnowledgeMap() {
    const byAuthor = Object.create(null);
    const byDirectory = Object.create(null);
    const authorExpertise = Object.create(null);

    const files = this._tracker.trackedFiles;

    for (const filePath of files) {
      const contributors = this._tracker.getContributors(filePath);
      const dir = _getDirectory(filePath);

      if (!byDirectory[dir]) {
        byDirectory[dir] = [];
      }
      byDirectory[dir].push({
        file: filePath,
        contributors: contributors.map((c) => ({
          author: c.author,
          share: c.share,
        })),
      });

      for (const { author, share } of contributors) {
        if (!byAuthor[author]) {
          byAuthor[author] = [];
        }
        byAuthor[author].push({
          file: filePath,
          directory: dir,
          contributionShare: share,
        });

        if (!authorExpertise[author]) {
          authorExpertise[author] = { directories: Object.create(null), fileCount: 0 };
        }

        const expertise = authorExpertise[author];
        expertise.fileCount++;
        if (!expertise.directories[dir]) {
          expertise.directories[dir] = { fileCount: 0, totalShare: 0 };
        }
        expertise.directories[dir].fileCount++;
        expertise.directories[dir].totalShare =
          Math.round((expertise.directories[dir].totalShare + share) * 10000) / 10000;
      }
    }

    return { byAuthor, byDirectory, authorExpertise };
  }

  /**
   * Identify files that have a single point of failure (only one contributor).
   * These are files where if the owner leaves, no one else knows the code.
   *
   * @param {string[]} [files] - optional subset of files to check
   * @returns {Array<{
   *   filePath: string,
   *   soleContributor: string,
   *   changeCount: number,
   *   lastModified: string,
   *   risk: 'critical' | 'high' | 'medium' | 'low'
   * }>}
   */
  identifyBusFactor(files) {
    const targetFiles = files || this._tracker.trackedFiles;
    const results = [];

    for (const filePath of targetFiles) {
      const contributors = this._tracker.getContributors(filePath);

      if (contributors.length === 0) continue;
      if (contributors.length === 1) {
        const fileChanges = this._tracker.getFileChanges(filePath);
        let lastMod = null;
        for (const c of fileChanges) {
          if (!lastMod || new Date(c.timestamp) > new Date(lastMod)) {
            lastMod = c.timestamp;
          }
        }

        const risk =
          contributors[0].changeCount >= 20
            ? "critical"
            : contributors[0].changeCount >= 10
            ? "high"
            : contributors[0].changeCount >= 5
            ? "medium"
            : "low";

        results.push({
          filePath,
          soleContributor: contributors[0].author,
          changeCount: contributors[0].changeCount,
          lastModified: lastMod,
          risk,
        });
      }
    }

    // Sort: critical first, then high, etc.
    const riskOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    results.sort(
      (a, b) => (riskOrder[a.risk] ?? 4) - (riskOrder[b.risk] ?? 4)
    );

    return results;
  }

  /**
   * Identify files that have no clear owner (orphans).
   * A file is orphaned if it has no recorded changes, or all contributors
   * have very low contribution counts (below the threshold).
   *
   * @param {{ threshold?: number }} [opts]
   * @returns {Array<{ filePath: string, contributors: string[], totalChanges: number, reason: string }>}
   */
  identifyOrphans(opts = {}) {
    const threshold = opts.threshold || 1;
    const files = this._tracker.trackedFiles;
    const results = [];

    for (const filePath of files) {
      const fileChanges = this._tracker.getFileChanges(filePath);

      if (fileChanges.length === 0) {
        results.push({
          filePath,
          contributors: [],
          totalChanges: 0,
          reason: "No recorded changes",
        });
        continue;
      }

      const contributors = this._tracker.getContributors(filePath);
      const maxChanges = contributors.length > 0 ? contributors[0].changeCount : 0;

      if (maxChanges < threshold) {
        results.push({
          filePath,
          contributors: contributors.map((c) => c.author),
          totalChanges: fileChanges.length,
          reason: `Top contributor has only ${maxChanges} change(s), below threshold of ${threshold}`,
        });
      }
    }

    return results;
  }

  /**
   * Get a comprehensive contribution summary for an author.
   * @param {string} author
   * @returns {{
   *   author: string,
   *   totalChanges: number,
   *   filesTouched: number,
   *   ownedFiles: number,
   *   directories: object,
   *   firstChange: string|null,
   *   lastChange: string|null,
   *   changeTypes: object,
   *   topFiles: Array<{ filePath: string, changeCount: number }>
   * }}
   */
  getContributionStats(author) {
    const changes = this._tracker.getAuthorChanges(author);

    if (changes.length === 0) {
      return {
        author,
        totalChanges: 0,
        filesTouched: 0,
        ownedFiles: 0,
        directories: {},
        firstChange: null,
        lastChange: null,
        changeTypes: {},
        topFiles: [],
      };
    }

    const fileCounts = new Map();
    const directories = {};
    const changeTypes = {};
    let firstChange = changes[0].timestamp;
    let lastChange = changes[0].timestamp;

    for (const change of changes) {
      // File counts
      fileCounts.set(change.filePath, (fileCounts.get(change.filePath) || 0) + 1);

      // Directory counts
      const dir = _getDirectory(change.filePath);
      directories[dir] = (directories[dir] || 0) + 1;

      // Change types
      changeTypes[change.type] = (changeTypes[change.type] || 0) + 1;

      // Time range
      if (new Date(change.timestamp) < new Date(firstChange)) {
        firstChange = change.timestamp;
      }
      if (new Date(change.timestamp) > new Date(lastChange)) {
        lastChange = change.timestamp;
      }
    }

    const ownedFiles = this._tracker.getOwnedFiles(author);

    const topFiles = Array.from(fileCounts.entries())
      .map(([filePath, changeCount]) => ({ filePath, changeCount }))
      .sort((a, b) => b.changeCount - a.changeCount)
      .slice(0, 10);

    return {
      author,
      totalChanges: changes.length,
      filesTouched: fileCounts.size,
      ownedFiles: ownedFiles.length,
      directories,
      firstChange,
      lastChange,
      changeTypes,
      topFiles,
    };
  }

  /**
   * Generate a comprehensive ownership report for the entire codebase.
   * @returns {{
   *   generatedAt: string,
   *   summary: { totalFiles: number, totalAuthors: number, totalChanges: number },
   *   busFactorRisks: { critical: number, high: number, medium: number, low: number },
   *   orphans: number,
   *   topAuthors: Array<{ author: string, ownedFiles: number, totalChanges: number }>,
   *   mostChangedFiles: Array<{ filePath: string, changeCount: number, owner: string }>,
   *   directoryOwnership: object,
   *   knowledgeTransferSuggestions: Array<{ filePath: string, from: string, suggestedTo: string }>
   * }}
   */
  generateOwnershipReport() {
    const files = this._tracker.trackedFiles;
    const authors = this._tracker.trackedAuthors;

    // Summary
    const summary = {
      totalFiles: files.length,
      totalAuthors: authors.length,
      totalChanges: this._tracker.changeCount,
    };

    // Bus factor
    const busFactorRisks = this.identifyBusFactor();
    const riskCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const r of busFactorRisks) {
      riskCounts[r.risk]++;
    }

    // Orphans
    const orphans = this.identifyOrphans();

    // Top authors
    const authorStats = [];
    for (const author of authors) {
      const ownedFiles = this._tracker.getOwnedFiles(author);
      const changes = this._tracker.getAuthorChanges(author);
      authorStats.push({
        author,
        ownedFiles: ownedFiles.length,
        totalChanges: changes.length,
      });
    }
    authorStats.sort((a, b) => b.ownedFiles - a.ownedFiles);

    // Most changed files
    const fileChangeCounts = [];
    for (const filePath of files) {
      const changes = this._tracker.getFileChanges(filePath);
      const owner = this._tracker.getOwner(filePath);
      fileChangeCounts.push({
        filePath,
        changeCount: changes.length,
        owner: owner ? owner.author : "none",
      });
    }
    fileChangeCounts.sort((a, b) => b.changeCount - a.changeCount);

    // Directory ownership
    const directoryOwnership = Object.create(null);
    for (const filePath of files) {
      const dir = _getDirectory(filePath);
      const owner = this._tracker.getOwner(filePath);
      if (!directoryOwnership[dir]) {
        directoryOwnership[dir] = { fileCount: 0, owners: Object.create(null) };
      }
      directoryOwnership[dir].fileCount++;
      if (owner) {
        directoryOwnership[dir].owners[owner.author] =
          (directoryOwnership[dir].owners[owner.author] || 0) + 1;
      }
    }

    // Knowledge transfer suggestions
    const knowledgeTransfer = this.suggestKnowledgeTransfer();

    return {
      generatedAt: new Date().toISOString(),
      summary,
      busFactorRisks: riskCounts,
      orphans: orphans.length,
      topAuthors: authorStats.slice(0, 10),
      mostChangedFiles: fileChangeCounts.slice(0, 20),
      directoryOwnership,
      knowledgeTransferSuggestions: knowledgeTransfer,
    };
  }

  /**
   * Suggest files that need backup owners (knowledge transfer targets).
   * Identifies files owned by a single author and suggests other authors
   * who have contributed to similar files in the same directory.
   *
   * @returns {Array<{
   *   filePath: string,
   *   currentOwner: string,
   *   suggestedBackups: Array<{ author: string, relevanceScore: number, reason: string }>,
   *   risk: string
   * }>}
   */
  suggestKnowledgeTransfer() {
    const busFactorFiles = this.identifyBusFactor();
    const knowledgeMap = this.getKnowledgeMap();
    const suggestions = [];

    for (const item of busFactorFiles) {
      const dir = _getDirectory(item.filePath);
      const dirData = knowledgeMap.byDirectory[dir] || [];

      // Find authors who have contributed to files in the same directory
      // but are not the sole contributor of this file
      const candidateAuthors = new Map();

      for (const entry of dirData) {
        if (entry.file === item.filePath) continue;

        for (const { author, share } of entry.contributors) {
          if (author === item.soleContributor) continue;

          if (!candidateAuthors.has(author)) {
            candidateAuthors.set(author, { totalShare: 0, filesInDir: 0 });
          }
          const c = candidateAuthors.get(author);
          c.totalShare = Math.round((c.totalShare + share) * 10000) / 10000;
          c.filesInDir++;
        }
      }

      const backups = Array.from(candidateAuthors.entries())
        .map(([author, data]) => ({
          author,
          relevanceScore: Math.round(data.totalShare * 100) / 100,
          reason:
            data.filesInDir === 1
              ? `Has contributed to 1 file in ${dir}`
              : `Has contributed to ${data.filesInDir} files in ${dir}`,
        }))
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, 3);

      suggestions.push({
        filePath: item.filePath,
        currentOwner: item.soleContributor,
        suggestedBackups: backups,
        risk: item.risk,
      });
    }

    return suggestions;
  }
}

// ─── module helpers ───────────────────────────────────────

function _getDirectory(filePath) {
  const normalized = String(filePath || "").replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) return "(root)";
  return normalized.slice(0, lastSlash) || "(root)";
}

module.exports = { OwnershipInsights };
