/**
 * NotificationManager — central hub for channel registration, event
 * subscriptions, and notification delivery.
 *
 *   const manager = new NotificationManager();
 *   manager.registerChannel('desktop', new DesktopChannel());
 *   manager.subscribe('desktop', ['task.complete', 'task.error']);
 *   manager.notify('task.complete', { title: 'Done', message: 'Build passed' });
 */
"use strict";

const { createNotification } = require("./channels");

// ---- NotificationManager ---------------------------------------------------

class NotificationManager {
  /**
   * @param {object} [options]
   * @param {boolean} [options.strict=false] - Throw when sending to an unknown channel
   * @param {number} [options.maxHistory=200] - Max number of past notifications to keep
   */
  constructor(options = {}) {
    this._channels = new Map();        // name -> { channel, status }
    this._subscriptions = new Map();   // channelName -> Set<eventType>
    this._history = [];                // recent notifications
    this._strict = options.strict === true;
    this._maxHistory = positiveInteger(options.maxHistory, 200);
  }

  // -- Channel management ----------------------------------------------------

  /**
   * Register a channel instance under a name.
   *
   * @param {string} name - Unique channel name
   * @param {object} channel - Channel instance (must have `send` method)
   * @throws {Error} if a channel with that name already exists
   */
  registerChannel(name, channel) {
    if (typeof name !== "string" || name.trim() === "") {
      throw new Error("Channel name must be a non-empty string");
    }
    if (this._channels.has(name)) {
      throw new Error(`Channel "${name}" is already registered`);
    }
    if (!channel || typeof channel.send !== "function") {
      throw new Error("Channel must implement a `send(notification)` method");
    }

    this._channels.set(name, {
      channel,
      failures: 0,
      lastError: null,
      lastSentAt: null,
      totalSent: 0,
    });

    this._subscriptions.set(name, new Set());
  }

  /**
   * Remove a registered channel.
   *
   * @param {string} name
   * @returns {boolean} true if a channel was removed
   */
  unregisterChannel(name) {
    this._subscriptions.delete(name);
    return this._channels.delete(name);
  }

  /**
   * Check if a channel is registered.
   * @param {string} name
   * @returns {boolean}
   */
  hasChannel(name) {
    return this._channels.has(name);
  }

  /**
   * @returns {string[]} Names of all registered channels
   */
  listChannels() {
    return Array.from(this._channels.keys());
  }

  // -- Event subscriptions ---------------------------------------------------

  /**
   * Subscribe a channel to one or more event types.
   *
   * When `notify(eventType, data)` is called, the notification is
   * dispatched to every channel subscribed to that event type.
   *
   * @param {string} channelName - Must be a registered channel
   * @param {string|string[]} eventTypes - Event type(s) to subscribe to
   * @throws {Error} if the channel is not registered
   */
  subscribe(channelName, eventTypes) {
    this._requireChannel(channelName);

    const types = Array.isArray(eventTypes) ? eventTypes : [eventTypes];
    const subscribed = this._subscriptions.get(channelName);

    for (const type of types) {
      if (typeof type !== "string" || type.trim() === "") {
        throw new Error("Event type must be a non-empty string");
      }
      subscribed.add(type);
    }
  }

  /**
   * Unsubscribe a channel from one or more event types.
   * If no eventTypes are given, removes all subscriptions for the channel.
   *
   * @param {string} channelName
   * @param {string|string[]} [eventTypes]
   * @throws {Error} if the channel is not registered
   */
  unsubscribe(channelName, eventTypes) {
    this._requireChannel(channelName);

    if (eventTypes === undefined) {
      this._subscriptions.set(channelName, new Set());
      return;
    }

    const types = Array.isArray(eventTypes) ? eventTypes : [eventTypes];
    const subscribed = this._subscriptions.get(channelName);
    for (const type of types) {
      subscribed.delete(type);
    }
  }

  /**
   * Get the event types a channel is subscribed to.
   * @param {string} channelName
   * @returns {string[]}
   */
  getSubscriptions(channelName) {
    this._requireChannel(channelName);
    return Array.from(this._subscriptions.get(channelName));
  }

  // -- Sending ---------------------------------------------------------------

  /**
   * Send a notification to specific channels (or all registered channels).
   *
   * @param {object} notification - Notification object or raw options
   * @param {string|string[]} [channels] - Channel name(s); sends to ALL if omitted
   * @returns {Promise<object>} summary: { delivered, errors, notification }
   * @throws {Error} if strict mode and a requested channel does not exist
   */
  async send(notification, channels) {
    const n = createNotification(notification);

    let targetNames;
    if (channels === undefined) {
      targetNames = this.listChannels();
    } else {
      targetNames = Array.isArray(channels) ? channels : [channels];
    }

    const errors = [];
    let delivered = 0;

    for (const name of targetNames) {
      if (!this._channels.has(name)) {
        if (this._strict) {
          throw new Error(`Channel "${name}" is not registered`);
        }
        errors.push({ channel: name, error: "Channel not registered" });
        continue;
      }

      const entry = this._channels.get(name);
      try {
        await entry.channel.send(n);
        entry.totalSent += 1;
        entry.lastSentAt = Date.now();
        entry.failures = Math.max(0, entry.failures - 1); // success heals
        delivered += 1;
      } catch (err) {
        entry.failures += 1;
        entry.lastError = err.message;
        errors.push({ channel: name, error: err.message });
      }
    }

    this._addToHistory(n);

    return { delivered, errors, notification: n };
  }

  /**
   * Convenience method: builds a notification from event + data and
   * sends it to all channels subscribed to that event type.
   *
   * @param {string} eventType
   * @param {object} [data] - Merged into notification (title, message, severity, etc.)
   * @returns {Promise<object>} send summary
   */
  async notify(eventType, data = {}) {
    const notification = createNotification({
      type: eventType,
      ...data,
    });

    const targetChannels = [];
    for (const [name, subscribed] of this._subscriptions) {
      if (subscribed.has(eventType)) {
        targetChannels.push(name);
      }
    }

    if (targetChannels.length === 0) {
      this._addToHistory(notification);
      return { delivered: 0, errors: [], notification };
    }

    return this.send(notification, targetChannels);
  }

  // -- Status -----------------------------------------------------------------

  /**
   * Return a health/status snapshot for every registered channel.
   *
   * @returns {object[]}
   */
  getStatus() {
    const result = [];

    for (const [name, entry] of this._channels) {
      const channel = entry.channel;
      let validation = null;
      if (typeof channel.validate === "function") {
        try {
          validation = channel.validate();
        } catch (err) {
          validation = { valid: false, errors: [err.message] };
        }
      }

      result.push({
        name,
        healthy: validation ? validation.valid : null,
        validationErrors: validation ? validation.errors : [],
        failures: entry.failures,
        lastError: entry.lastError,
        totalSent: entry.totalSent,
        lastSentAt: entry.lastSentAt,
        subscriptions: Array.from(this._subscriptions.get(name) || []),
      });
    }

    return result;
  }

  /**
   * Retrieve recent notification history.
   * @param {number} [limit] - Max entries (defaults to all in buffer)
   * @returns {object[]}
   */
  getHistory(limit) {
    if (limit !== undefined) {
      return this._history.slice(-limit);
    }
    return [...this._history];
  }

  /**
   * Clear notification history.
   */
  clearHistory() {
    this._history.length = 0;
  }

  // -- Internal helpers ------------------------------------------------------

  /** @private */
  _requireChannel(name) {
    if (!this._channels.has(name)) {
      throw new Error(`Channel "${name}" is not registered`);
    }
  }

  /** @private */
  _addToHistory(notification) {
    this._history.push(notification);
    if (this._history.length > this._maxHistory) {
      this._history = this._history.slice(-this._maxHistory);
    }
  }
}

// ---- Helpers ---------------------------------------------------------------

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

// ---- Exports ---------------------------------------------------------------

module.exports = {
  NotificationManager,
};
