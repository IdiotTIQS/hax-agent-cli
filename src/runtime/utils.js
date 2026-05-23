'use strict';

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function requireEnum(value, options, name) {
  if (!Object.values(options).includes(value)) {
    throw new TypeError(`${name} must be one of: ${Object.values(options).join(', ')}`);
  }
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function toIsoString(value, name) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`${name} must be a valid date`);
  }

  return date.toISOString();
}

module.exports = { createId, requireEnum, requireString, toIsoString };
