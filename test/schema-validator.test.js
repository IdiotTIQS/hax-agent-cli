"use strict";

const test = require('node:test');
const assert = require('node:assert/strict');
const { validate, isValid, SchemaValidationError } = require('../src/schema-validator');

test('validate passes for valid value', () => {
  const schema = { type: 'string' };
  assert.doesNotThrow(() => validate(schema, 'hello'));
  assert.equal(validate(schema, 'hello'), 'hello');
});

test('validate throws for wrong type', () => {
  assert.throws(
    () => validate({ type: 'number' }, 'not-a-number'),
    SchemaValidationError,
  );
});

test('isValid returns boolean', () => {
  assert.equal(isValid({ type: 'string' }, 'hello'), true);
  assert.equal(isValid({ type: 'string' }, 123), false);
});

test('required fields validation', () => {
  const schema = {
    type: 'object',
    required: ['name', 'age'],
  };
  assert.doesNotThrow(() => validate(schema, { name: 'Alice', age: 30 }));
  assert.throws(() => validate(schema, { name: 'Alice' }), SchemaValidationError);
  assert.throws(() => validate(schema, { age: 30 }), SchemaValidationError);
  assert.doesNotThrow(() => validate(schema, { name: 'Alice', age: 30, extra: true }));
});

test('nested properties validation', () => {
  const schema = {
    type: 'object',
    properties: {
      user: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string' },
          age: { type: 'integer' },
        },
      },
    },
  };
  assert.doesNotThrow(() => validate(schema, { user: { email: 'a@b.com' } }));
  assert.throws(() => validate(schema, { user: {} }), SchemaValidationError);
  assert.throws(() => validate(schema, { user: { email: 'a@b.com', age: 3.5 } }), SchemaValidationError);
  assert.doesNotThrow(() => validate(schema, { user: { email: 'a@b.com', age: 30 } }));
});

test('enum validation', () => {
  const schema = { type: 'string', enum: ['red', 'green', 'blue'] };
  assert.doesNotThrow(() => validate(schema, 'red'));
  assert.throws(() => validate(schema, 'yellow'), SchemaValidationError);
});

test('minimum and maximum for numbers', () => {
  const schema = { type: 'number', minimum: 0, maximum: 100 };
  assert.doesNotThrow(() => validate(schema, 50));
  assert.throws(() => validate(schema, -1), SchemaValidationError);
  assert.throws(() => validate(schema, 101), SchemaValidationError);
});

test('string length constraints', () => {
  const schema = { type: 'string', minLength: 3, maxLength: 10 };
  assert.doesNotThrow(() => validate(schema, 'hello'));
  assert.throws(() => validate(schema, 'hi'), SchemaValidationError);
  assert.throws(() => validate(schema, 'hello world!'), SchemaValidationError);
});

test('pattern validation', () => {
  const schema = { type: 'string', pattern: '^[a-z]+$' };
  assert.doesNotThrow(() => validate(schema, 'hello'));
  assert.throws(() => validate(schema, 'Hello123'), SchemaValidationError);
});

test('array items validation', () => {
  const schema = { type: 'array', items: { type: 'number' } };
  assert.doesNotThrow(() => validate(schema, [1, 2, 3]));
  assert.throws(() => validate(schema, [1, 'two', 3]), SchemaValidationError);
});

test('null type support', () => {
  const schema = { type: ['string', 'null'] };
  assert.doesNotThrow(() => validate(schema, 'hello'));
  assert.doesNotThrow(() => validate(schema, null));
  assert.throws(() => validate(schema, 123), SchemaValidationError);
});

test('error details contain path and message', () => {
  try {
    validate({ type: 'number' }, 'bad');
    assert.fail('Should have thrown');
  } catch (err) {
    assert.ok(err instanceof SchemaValidationError);
    assert.ok(Array.isArray(err.details));
    assert.ok(err.details.length > 0);
    assert.ok(err.details[0].path);
    assert.ok(err.details[0].message);
  }
});

test('multiple errors collected', () => {
  const schema = {
    type: 'object',
    required: ['name', 'email'],
    properties: {
      name: { type: 'string', minLength: 3 },
      email: { type: 'string' },
    },
  };
  try {
    validate(schema, { name: 'AB' });
    assert.fail('Should have thrown');
  } catch (err) {
    assert.ok(err.details.length >= 2);
  }
});
