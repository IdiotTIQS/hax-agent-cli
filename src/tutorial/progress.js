"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const TUTORIALS = require("./tutorials");

const PROGRESS_FILE = path.join(os.homedir(), ".haxagent", "tutorial-progress.json");

/**
 * Tracks and persists tutorial completion progress.
 *
 * Progress is stored as JSON at ~/.haxagent/tutorial-progress.json.
 * Each entry records the tutorial id, completion timestamp, and optional
 * metadata describing how the user completed it.
 *
 *   const progress = new TutorialProgress();
 *   progress.markComplete("getting-started");
 *   console.log(progress.getOverallProgress());
 *   progress.reset();
 */
class TutorialProgress {
  /**
   * @param {object} [options]
   * @param {string} [options.progressFile]  — override default progress file path
   * @param {object} [options.fs]            — injectable fs for testing
   * @param {string} [options.homeDir]       — injectable home directory for testing
   */
  constructor(options = {}) {
    this._progressFile = options.progressFile || PROGRESS_FILE;
    this._fs = options.fs || fs;
    this._homeDir = options.homeDir || os.homedir();
    this._tutorials = options.tutorials || TUTORIALS;
    this._data = null;
  }

  /**
   * Load progress from disk. Called automatically on first access.
   * @returns {object} the raw progress data
   */
  _load() {
    if (this._data !== null) return this._data;

    try {
      const raw = this._fs.readFileSync(this._progressFile, "utf8");
      this._data = JSON.parse(raw);
    } catch {
      this._data = { completed: {} };
    }

    return this._data;
  }

  /**
   * Persist current progress to disk.
   */
  _save() {
    const dir = path.dirname(this._progressFile);
    this._fs.mkdirSync(dir, { recursive: true });
    this._fs.writeFileSync(this._progressFile, JSON.stringify(this._data, null, 2), "utf8");
  }

  /**
   * Record that the user has completed a tutorial.
   * @param {string} tutorialId
   * @throws {Error} if tutorial id is unknown
   */
  markComplete(tutorialId) {
    if (!this._tutorials[tutorialId]) {
      throw new Error(`Unknown tutorial: "${tutorialId}"`);
    }

    const data = this._load();
    data.completed[tutorialId] = {
      completedAt: new Date().toISOString(),
    };

    this._save();
  }

  /**
   * Check whether a specific tutorial has been completed.
   * @param {string} tutorialId
   * @returns {boolean}
   */
  isComplete(tutorialId) {
    const data = this._load();
    return Boolean(data.completed && data.completed[tutorialId]);
  }

  /**
   * Get an array of all completed tutorial ids.
   * @returns {string[]}
   */
  getCompletedTutorials() {
    const data = this._load();
    return Object.keys(data.completed || {});
  }

  /**
   * Suggest the next tutorial the user should try based on what they have
   * already completed. Returns null when all tutorials are finished.
   *
   * Logic: returns the first uncompleted tutorial in definition order.
   * @returns {object|null} { id, name, description, difficulty, estimatedMinutes }
   */
  getNextRecommended() {
    const completed = this.getCompletedTutorials();
    const allIds = Object.keys(this._tutorials);

    for (const id of allIds) {
      if (!completed.includes(id)) {
        const tutorial = this._tutorials[id];
        return {
          id: tutorial.id,
          name: tutorial.name,
          description: tutorial.description,
          difficulty: tutorial.difficulty,
          estimatedMinutes: tutorial.estimatedMinutes,
        };
      }
    }

    return null;
  }

  /**
   * Get overall progress across all tutorials as a percentage.
   * @returns {{ completed: number, total: number, percent: number }}
   */
  getOverallProgress() {
    const completedCount = this.getCompletedTutorials().length;
    const totalCount = Object.keys(this._tutorials).length;
    const percent = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100);

    return {
      completed: completedCount,
      total: totalCount,
      percent,
    };
  }

  /**
   * Reset all progress by clearing the completed map.
   */
  reset() {
    this._data = { completed: {} };
    this._save();
  }
}

module.exports = { TutorialProgress };
