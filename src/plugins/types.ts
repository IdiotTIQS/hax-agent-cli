class PluginType {
  static TOOLS = "tools";
  static SKILLS = "skills";
  static COMMANDS = "commands";
  static HOOKS = "hooks";
  static PROVIDERS = "providers";
}

interface PluginMetadataOptions {
  name?: string;
  version?: string;
  category?: string;
  author?: string;
  license?: string;
}

class PluginMetadata {
  name: string;
  version: string;
  category: string;
  author: string;
  license: string;

  constructor(o: PluginMetadataOptions = {}) {
    this.name = o.name || "";
    this.version = o.version || "0.1.0";
    this.category = o.category || PluginType.TOOLS;
    this.author = o.author || "";
    this.license = o.license || "MIT";
  }
}

export { PluginType, PluginMetadata };
