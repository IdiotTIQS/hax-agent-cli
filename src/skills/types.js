class SkillType { static BUNDLED="bundled"; static USER="user"; static PROJECT="project"; }
class SkillMetadata { constructor(o={}) { this.name=o.name||""; this.description=o.description||""; this.trigger=o.trigger||""; this.type=o.type||SkillType.PROJECT; this.version=o.version||"1.0"; } }
export { SkillType, SkillMetadata };
