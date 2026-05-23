"use strict";

/**
 * Lightweight JSON Schema validator for tool input schemas.
 * Supports a useful subset of JSON Schema: type, required, properties, enum, minimum, maximum.
 */

class SchemaValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'SchemaValidationError';
    this.details = details;
  }
}

function validate(schema, value) {
  const errors = [];
  _validate(schema, value, '', errors);
  if (errors.length > 0) {
    const msg = errors.length === 1 ? errors[0].message : `${errors.length} validation errors`;
    throw new SchemaValidationError(msg, errors);
  }
  return value;
}

function isValid(schema, value) {
  try {
    validate(schema, value);
    return true;
  } catch (_) {
    return false;
  }
}

function _validate(schema, value, path, errors) {
  if (!schema || typeof schema !== 'object') return;

  if (schema.type) {
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    const expectedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    // 'integer' accepts number values that are integers (checked below)
    const typeOk = expectedTypes.includes(actualType) ||
      (expectedTypes.includes('integer') && actualType === 'number');
    if (!typeOk) {
      if (value === null && expectedTypes.includes('null')) return;
      errors.push({
        path: path || '(root)',
        message: `${path || 'value'} must be of type ${expectedTypes.join('/')}, got ${actualType}`,
        expected: expectedTypes,
        actual: actualType,
      });
      return;
    }
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push({
      path: path || '(root)',
      message: `${path || 'value'} must be one of: ${schema.enum.join(', ')}`,
      expected: schema.enum,
      actual: value,
    });
  }

  if (schema.type === 'string' || (Array.isArray(schema.type) && schema.type.includes('string'))) {
    if (typeof value === 'string') {
      if (Number.isInteger(schema.minLength) && value.length < schema.minLength) {
        errors.push({
          path: path || '(root)',
          message: `${path || 'value'} must be at least ${schema.minLength} characters`,
        });
      }
      if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) {
        errors.push({
          path: path || '(root)',
          message: `${path || 'value'} must be at most ${schema.maxLength} characters`,
        });
      }
      if (schema.pattern && typeof schema.pattern === 'string') {
        try {
          if (!new RegExp(schema.pattern).test(value)) {
            errors.push({
              path: path || '(root)',
              message: `${path || 'value'} must match pattern ${schema.pattern}`,
            });
          }
        } catch (_) { /* invalid regex */ }
      }
    }
  }

  if ((schema.type === 'number' || schema.type === 'integer') && typeof value === 'number') {
    if (schema.type === 'integer' && !Number.isInteger(value)) {
      errors.push({
        path: path || '(root)',
        message: `${path || 'value'} must be an integer`,
      });
    }
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push({
        path: path || '(root)',
        message: `${path || 'value'} must be >= ${schema.minimum}`,
      });
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push({
        path: path || '(root)',
        message: `${path || 'value'} must be <= ${schema.maximum}`,
      });
    }
  }

  if (schema.required && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const key of schema.required) {
      if (!(key in value) || value[key] === undefined) {
        errors.push({
          path: path ? `${path}.${key}` : key,
          message: `${path ? path + '.' : ''}${key} is required`,
        });
      }
    }
  }

  if (schema.properties && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (key in value && value[key] !== undefined) {
        _validate(propSchema, value[key], path ? `${path}.${key}` : key, errors);
      }
    }
  }

  if (schema.items && Array.isArray(value)) {
    if (Array.isArray(schema.items)) {
      for (let i = 0; i < Math.min(schema.items.length, value.length); i++) {
        _validate(schema.items[i], value[i], `${path}[${i}]`, errors);
      }
    } else {
      for (let i = 0; i < value.length; i++) {
        _validate(schema.items, value[i], `${path}[${i}]`, errors);
      }
    }
  }
}

module.exports = { validate, isValid, SchemaValidationError };
