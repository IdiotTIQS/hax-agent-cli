'use strict';

const { GoalTracker, VALID_GOAL_STATUSES, VALID_PRIORITIES, VALID_MILESTONE_STATUSES } = require('./tracker');
const { GoalHistory, DEFAULT_HISTORY_PATH } = require('./history');
const { TEMPLATES, TEMPLATE_NAMES, createFromTemplate } = require('./templates');

module.exports = {
  GoalTracker,
  VALID_GOAL_STATUSES,
  VALID_PRIORITIES,
  VALID_MILESTONE_STATUSES,
  GoalHistory,
  DEFAULT_HISTORY_PATH,
  TEMPLATES,
  TEMPLATE_NAMES,
  createFromTemplate,
};
