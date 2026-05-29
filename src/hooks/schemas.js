"use strict";
const HOOK_SCHEMA = { type:"object",required:["event","type"],properties:{event:{type:"string",enum:["session.start","session.end","pre.compact","post.compact","pre.tool_use","post.tool_use","user.prompt_submit","notification","stop","subagent.stop"]},type:{type:"string",enum:["command","http","prompt","agent"]},matcher:{type:"string"},priority:{type:"number"},command:{type:"string"},url:{type:"string"},timeoutMs:{type:"number",default:10000}} };
function validateHook(hook) { if(!hook||!hook.event||!hook.type) return {valid:false,errors:["event and type are required"]}; if(!HOOK_SCHEMA.properties.event.enum.includes(hook.event)) return {valid:false,errors:["Unknown event: "+hook.event]}; return {valid:true,errors:[]}; }
module.exports = { HOOK_SCHEMA, validateHook };
