"use strict";

const fs = require('node:fs');
const path = require('node:path');
const { debug } = require('./debug');
const { listMemories, deleteMemory, createStorage } = require('./memory');

/**
 * Memory eviction manager.
 *
 * Automatically removes old/least-used memories when the configured
 * maxItems limit is exceeded. Supports multiple eviction strategies.
 */

const EVICTION_STRATEGIES = {
  LEAST_RECENTLY_UPDATED: 'lru',
  LEAST_RECENTLY_CREATED: 'lrc',
  OLDEST_FIRST: 'fifo',
};

/**
 * Apply eviction to memory storage if over the configured limit.
 *
 * @param {object} options
 * @param {object} [options.settings] - Resolved settings object
 * @param {number} [options.maxItems] - Override max items from settings
 * @param {string} [options.strategy='lru'] - Eviction strategy
 * @returns {{ evicted: number, kept: number, exceededBy: number }}
 */
function evictMemories(options = {}) {
  const settings = options.settings || {};
  const maxItems = positiveInteger(
    options.maxItems ?? settings.memory?.maxItems ?? 20,
    20,
  );
  const strategy = normalizeStrategy(options.strategy || EVICTION_STRATEGIES.LEAST_RECENTLY_UPDATED);

  const all = listMemories(settings);

  if (all.length <= maxItems) {
    return { evicted: 0, kept: all.length, exceededBy: 0 };
  }

  debug('memory-eviction', `Memories exceed limit: ${all.length}/${maxItems}. Strategy: ${strategy}`);

  const sorted = sortMemories(all, strategy);
  const toEvict = sorted.slice(maxItems);
  let evicted = 0;

  for (const memory of toEvict) {
    try {
      const deleted = deleteMemory(memory.name, settings);
      if (deleted) {
        evicted += 1;
        debug('memory-eviction', `Evicted memory: ${memory.name}`);
      }
    } catch (error) {
      debug('memory-eviction', `Failed to evict ${memory.name}: ${error.message}`);
    }
  }

  return {
    evicted,
    kept: all.length - evicted,
    exceededBy: all.length - maxItems,
  };
}

/**
 * Check if eviction is needed without actually performing it.
 *
 * @param {object} options
 * @param {object} [options.settings]
 * @param {number} [options.maxItems]
 * @returns {{ needsEviction: boolean, currentCount: number, maxItems: number }}
 */
function checkEvictionNeeded(options = {}) {
  const settings = options.settings || {};
  const maxItems = positiveInteger(
    options.maxItems ?? settings.memory?.maxItems ?? 20,
    20,
  );
  const all = listMemories(settings);

  return {
    needsEviction: all.length > maxItems,
    currentCount: all.length,
    maxItems,
  };
}

/**
 * Get a summary of memory storage usage.
 *
 * @param {object} options
 * @param {object} [options.settings]
 * @returns {{ total: number, maxItems: number, utilization: number, oldestCreatedAt: string|null, newestCreatedAt: string|null }}
 */
function getMemoryStorageStats(options = {}) {
  const settings = options.settings || {};
  const maxItems = positiveInteger(settings.memory?.maxItems || 20, 20);
  const all = listMemories(settings);

  let oldestCreatedAt = null;
  let newestCreatedAt = null;

  for (const mem of all) {
    if (mem.createdAt) {
      if (!oldestCreatedAt || mem.createdAt < oldestCreatedAt) oldestCreatedAt = mem.createdAt;
      if (!newestCreatedAt || mem.createdAt > newestCreatedAt) newestCreatedAt = mem.createdAt;
    }
  }

  return {
    total: all.length,
    maxItems,
    utilization: all.length > 0 ? Math.round((all.length / maxItems) * 100) : 0,
    oldestCreatedAt,
    newestCreatedAt,
  };
}

/**
 * Evict all memories for a reset.
 *
 * @param {object} options
 * @param {object} [options.settings]
 * @returns {number} number of evicted
 */
function evictAllMemories(options = {}) {
  const settings = options.settings || {};
  const all = listMemories(settings);
  let evicted = 0;

  for (const memory of all) {
    try {
      const deleted = deleteMemory(memory.name, settings);
      if (deleted) evicted += 1;
    } catch (_) {
      // skip individual failures
    }
  }

  return evicted;
}

/**
 * Sort memories according to eviction strategy.
 * Returns in priority order — first entries are kept, last are evicted.
 */
function sortMemories(memories, strategy) {
  const sorted = [...memories];

  switch (strategy) {
    case EVICTION_STRATEGIES.LEAST_RECENTLY_UPDATED:
      sorted.sort((a, b) => {
        const aTime = a.updatedAt || a.createdAt || '0';
        const bTime = b.updatedAt || b.createdAt || '0';
        return bTime.localeCompare(aTime); // newest first, oldest last
      });
      return sorted;

    case EVICTION_STRATEGIES.LEAST_RECENTLY_CREATED:
      sorted.sort((a, b) => {
        const aTime = a.createdAt || a.updatedAt || '0';
        const bTime = b.createdAt || b.updatedAt || '0';
        return bTime.localeCompare(aTime); // newest first
      });
      return sorted;

    case EVICTION_STRATEGIES.OLDEST_FIRST:
      sorted.sort((a, b) => {
        const aTime = a.createdAt || a.updatedAt || '0';
        const bTime = b.createdAt || b.updatedAt || '0';
        return aTime.localeCompare(bTime); // oldest first (will be evicted)
      });
      // Reverse because we want oldest to be evicted (at end of "keep" list)
      return sorted.reverse();

    default:
      return sorted;
  }
}

function normalizeStrategy(strategy) {
  const valid = Object.values(EVICTION_STRATEGIES);
  if (valid.includes(strategy)) return strategy;
  return EVICTION_STRATEGIES.LEAST_RECENTLY_UPDATED;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = {
  EVICTION_STRATEGIES,
  checkEvictionNeeded,
  evictAllMemories,
  evictMemories,
  getMemoryStorageStats,
};
