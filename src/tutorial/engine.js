"use strict";

const TUTORIALS = require("./tutorials");

/**
 * TutorialEngine drives the interactive tutorial experience.
 *
 * Manages a cursor through a sequence of tutorial steps, providing
 * navigation (next/previous/skip) and progress tracking.
 *
 *   const engine = new TutorialEngine();
 *   engine.start("getting-started");
 *   console.log(engine.getCurrentStep());
 *   engine.next();
 *   console.log(engine.getProgress());
 */
class TutorialEngine {
  constructor(tutorials = TUTORIALS) {
    this._tutorials = tutorials;
    this._currentTutorialId = null;
    this._currentStepIndex = 0;
    this._started = false;
  }

  /**
   * Begin a tutorial by its id.
   * Resets the step cursor to the first step.
   * @param {string} tutorialId
   * @throws {Error} if tutorial id is unknown
   */
  start(tutorialId) {
    const tutorial = this._tutorials[tutorialId];
    if (!tutorial) {
      throw new Error(`Unknown tutorial: "${tutorialId}". Available: ${this._listIds()}`);
    }

    this._currentTutorialId = tutorialId;
    this._currentStepIndex = 0;
    this._started = true;
  }

  /**
   * Advance to the next step in the current tutorial.
   * If already on the last step, stays in place.
   * @returns {boolean} true if the step advanced, false if already at end
   */
  next() {
    this._requireStarted();

    const tutorial = this._tutorials[this._currentTutorialId];
    const maxIndex = tutorial.steps.length - 1;

    if (this._currentStepIndex < maxIndex) {
      this._currentStepIndex += 1;
      return true;
    }

    return false;
  }

  /**
   * Go back to the previous step.
   * If already on the first step, stays in place.
   * @returns {boolean} true if the step retreated, false if already at start
   */
  previous() {
    this._requireStarted();

    if (this._currentStepIndex > 0) {
      this._currentStepIndex -= 1;
      return true;
    }

    return false;
  }

  /**
   * Skip the current step. Advances to the next step.
   * Same behaviour as next() but with semantic intent.
   * @returns {boolean} true if the step advanced, false if already at end
   */
  skip() {
    return this.next();
  }

  /**
   * Get the current step object, including its tutorial context.
   * @returns {object|null} { tutorialId, tutorialName, step, stepIndex }
   */
  getCurrentStep() {
    if (!this._started) return null;

    const tutorial = this._tutorials[this._currentTutorialId];
    const step = tutorial.steps[this._currentStepIndex];

    if (!step) return null;

    return {
      tutorialId: this._currentTutorialId,
      tutorialName: tutorial.name,
      step,
      stepIndex: this._currentStepIndex,
    };
  }

  /**
   * Get progress information for the current tutorial.
   * @returns {{ current: number, total: number, percent: number }}
   */
  getProgress() {
    this._requireStarted();

    const tutorial = this._tutorials[this._currentTutorialId];
    const total = tutorial.steps.length;
    const current = this._currentStepIndex + 1;
    const percent = Math.round((current / total) * 100);

    return { current, total, percent };
  }

  /**
   * Check whether the user has reached the final step.
   * @returns {boolean}
   */
  isComplete() {
    if (!this._started) return false;

    const tutorial = this._tutorials[this._currentTutorialId];
    return this._currentStepIndex >= tutorial.steps.length - 1;
  }

  // ── Helpers ─────────────────────────────────────────────────

  _requireStarted() {
    if (!this._started) {
      throw new Error("No tutorial started. Call start(tutorialId) first.");
    }
  }

  _listIds() {
    return Object.keys(this._tutorials).join(", ");
  }
}

module.exports = { TutorialEngine };
