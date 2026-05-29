"use strict";
const fs = require("fs"); const path = require("path");
const FACT_PATTERNS = [ {type:"file_path",re:/[\w\/\-]+\.[a-z]{2,4}/g}, {type:"version",re:/(?:version|v)\s*[:=]?\s*(\d+\.\d+\.\d+)/gi}, {type:"url",re:/https?:\/\/[^\s"'<>]+/g}, {type:"command",re:/`([^`]+)`/g}, {type:"error",re:/(?:Error|Exception|错误)[:\s]+(\S[\s\S]{5,200}?)[.;\n]/gi} ];
function scanTextForMemories(text) { const results=[]; const seen=new Set();
  for(const {type,re} of FACT_PATTERNS) { re.lastIndex=0; let m; while((m=re.exec(text))!==null) { const v=m[1]||m[0]; const key=type+":"+v; if(!seen.has(key)) { seen.add(key); results.push({type,value:v.trim().slice(0,200)}); } } }
  return results; }
module.exports = { FACT_PATTERNS, scanTextForMemories };
