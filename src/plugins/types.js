"use strict";
class PluginType { static TOOLS="tools"; static SKILLS="skills"; static COMMANDS="commands"; static HOOKS="hooks"; static PROVIDERS="providers"; }
class PluginMetadata { constructor(o={}) { this.name=o.name||""; this.version=o.version||"0.1.0"; this.category=o.category||PluginType.TOOLS; this.author=o.author||""; this.license=o.license||"MIT"; } }
module.exports = { PluginType, PluginMetadata };
