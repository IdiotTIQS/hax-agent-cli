class SkillType {
  static BUNDLED = "bundled";
  static USER = "user";
  static PROJECT = "project";
}

interface SkillMetadataOptions {
  name?: string;
  description?: string;
  trigger?: string;
  type?: string;
  version?: string;
}

class SkillMetadata {
  name: string;
  description: string;
  trigger: string;
  type: string;
  version: string;

  constructor(o: SkillMetadataOptions = {}) {
    this.name = o.name || "";
    this.description = o.description || "";
    this.trigger = o.trigger || "";
    this.type = o.type || SkillType.PROJECT;
    this.version = o.version || "1.0";
  }
}

export { SkillType, SkillMetadata };
