"use strict";

const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * Tracks file edits/writes so they can be undone.
 * Each action stores the file path and the original content for rollback.
 */
class UndoStack {
  constructor(maxEntries = 50) {
    this._stack = [];
    this._redoStack = [];
    this._maxEntries = maxEntries;
  }

  /**
   * Record a file edit operation.
   * @param {{ toolName: string, filePath: string, originalContent: string, newContent: string, description?: string }} action
   */
  push(action) {
    if (!action || !action.filePath) return;

    this._stack.push({
      toolName: action.toolName || 'unknown',
      filePath: path.resolve(action.filePath),
      originalContent: action.originalContent || '',
      newContent: action.newContent || '',
      description: action.description || '',
      timestamp: new Date().toISOString(),
    });

    // Clear redo stack on new action
    this._redoStack = [];

    // Trim stack
    while (this._stack.length > this._maxEntries) {
      this._stack.shift();
    }
  }

  /** Remove all actions for a specific file path. */
  removeByPath(filePath) {
    const resolved = path.resolve(filePath);
    this._stack = this._stack.filter((a) => a.filePath !== resolved);
    this._redoStack = this._redoStack.filter((a) => a.filePath !== resolved);
  }

  /**
   * Undo the last action. Restores original file content.
   * @returns {Promise<{ undone: boolean, description: string, filePath: string }>}
   */
  async undo() {
    const action = this._stack.pop();
    if (!action) return { undone: false, description: 'Nothing to undo', filePath: '' };

    try {
      // Read current content before reverting (in case it changed since our edit)
      const currentContent = await fs.readFile(action.filePath, 'utf8').catch(() => null);

      if (currentContent !== null && currentContent !== action.newContent) {
        // File was modified externally; store current as the "before" for redo
        this._redoStack.push({
          ...action,
          originalContent: currentContent,
        });
      } else {
        this._redoStack.push(action);
      }

      await fs.writeFile(action.filePath, action.originalContent, 'utf8');

      return {
        undone: true,
        description: action.description || `Undo: ${action.toolName} on ${path.basename(action.filePath)}`,
        filePath: action.filePath,
      };
    } catch (error) {
      // Re-push on failure
      this._stack.push(action);
      return {
        undone: false,
        description: `Undo failed: ${error.message}`,
        filePath: action.filePath,
      };
    }
  }

  /**
   * Redo the last undone action. Re-applies the change.
   * @returns {Promise<{ redone: boolean, description: string, filePath: string }>}
   */
  async redo() {
    const action = this._redoStack.pop();
    if (!action) return { redone: false, description: 'Nothing to redo', filePath: '' };

    try {
      await fs.writeFile(action.filePath, action.newContent, 'utf8');

      // Push back to undo stack
      this._stack.push(action);

      return {
        redone: true,
        description: action.description || `Redo: ${action.toolName} on ${path.basename(action.filePath)}`,
        filePath: action.filePath,
      };
    } catch (error) {
      this._redoStack.push(action);
      return {
        redone: false,
        description: `Redo failed: ${error.message}`,
        filePath: action.filePath,
      };
    }
  }

  canUndo() {
    return this._stack.length > 0;
  }

  canRedo() {
    return this._redoStack.length > 0;
  }

  /**
   * Get a summary of the undo stack for display.
   * @returns {Array<{ index: number, toolName: string, file: string, description: string, timestamp: string }>}
   */
  list() {
    return this._stack
      .map((action, index) => ({
        index: index + 1,
        toolName: action.toolName,
        file: path.basename(action.filePath),
        filePath: action.filePath,
        description: action.description,
        timestamp: action.timestamp,
      }))
      .reverse();
  }

  clear() {
    this._stack = [];
    this._redoStack = [];
  }
}

module.exports = { UndoStack };
