'use strict';

const {
  SmokeTest,
  QUICK_TESTS,
  STANDARD_TESTS,
  FULL_TESTS,
  CRITICAL_TESTS,
  TEST_IMPLS,
} = require('./smoke-test');

const {
  SelfTest,
  TEST_CATEGORIES,
  CATEGORY_WEIGHTS,
} = require('./selftest');

module.exports = {
  SmokeTest,
  QUICK_TESTS,
  STANDARD_TESTS,
  FULL_TESTS,
  CRITICAL_TESTS,
  TEST_IMPLS,
  SelfTest,
  TEST_CATEGORIES,
  CATEGORY_WEIGHTS,
};
