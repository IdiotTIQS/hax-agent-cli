"use strict";
const path = require("path"); const os = require("os");
function getProjectMemoryDir(cwd) { return path.join(cwd||process.cwd(),".hax-agent","memory"); }
function getUserMemoryDir() { return path.join(os.homedir(),".haxagent","memory"); }
module.exports = { getProjectMemoryDir, getUserMemoryDir };
