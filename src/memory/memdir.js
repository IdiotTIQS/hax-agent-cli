"use strict";
const path = require("path"); const os = require("os"); const fs = require("fs");
function getMemoryDir() { const d=path.join(os.homedir(),".haxagent","memory"); if(!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true}); return d; }
function getMemoryFilePath(id) { return path.join(getMemoryDir(),id+".md"); }
module.exports = { getMemoryDir, getMemoryFilePath };
