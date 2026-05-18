const assert = require('node:assert/strict');
const test = require('node:test');

const api = require('../src');

test('public API exposes basic runtime under an explicit namespace', () => {
  assert.equal(typeof api.basicRuntime, 'object');
  assert.equal(api.basicRuntime.Session, api.Session);
  assert.equal(api.basicRuntime.createSession, api.createSession);
  assert.equal(api.basicRuntime.TaskList, api.TaskList);
  assert.equal(api.basicRuntime.CommandRegistry, api.CommandRegistry);
});
