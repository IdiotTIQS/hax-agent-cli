'use strict';

const changeLog = require('./change-log');
const hotReload = require('./hot-reload');
const fsWatcher = require('./fs-watcher');

module.exports = {
  ...changeLog,
  ...hotReload,
  ...fsWatcher,
};
