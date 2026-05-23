'use strict';

const behaviorModifiers = require('./behavior-modifiers');
const profiles = require('./profiles');
const responseStyles = require('./response-styles');

module.exports = {
  ...behaviorModifiers,
  ...profiles,
  ...responseStyles,
};
