"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { SkillRegistry } = require("../src/skills/registry");

/**
 * Helper: create a temporary SKILL.md file with given frontmatter fields.
 */
function tmpSkillDir(fields = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-registry-"));
  const content = [
    "---",
    `name: ${fields.name || "test-skill"}`,
    `description: ${fields.description || "A test skill"}`,
    fields.version ? `version: ${fields.version}` : "",
    fields.tags ? `tags:\n${fields.tags.map((t) => `  - ${t}`).join("\n")}` : "",
    fields.arguments ? `arguments:\n${fields.arguments.map((a) => `  - ${a}`).join("\n")}` : "",
    "---",
    "",
    "# Test Skill",
    "",
    "Some content for testing.",
  ]
    .filter((l) => l !== "")
    .join("\n");

  fs.writeFileSync(path.join(dir, "SKILL.md"), content, "utf-8");
  return dir;
}

/**
 * Helper: create a single SKILL.md file (not in a directory).
 */
function tmpSkillFile(fields = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-registry-file-"));
  const filePath = path.join(dir, "SKILL.md");
  const content = [
    "---",
    `name: ${fields.name || "single-file-skill"}`,
    `description: ${fields.description || "A single-file skill"}`,
    "---",
    "",
    "# Single File Skill",
    "",
    "Content.",
  ]
    .filter((l) => l !== "")
    .join("\n");

  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

test("SkillRegistry: constructor accepts projectRoot", () => {
  const registry = new SkillRegistry("/fake/root");
  assert.equal(registry._projectRoot, "/fake/root");
});

test("SkillRegistry: constructor defaults to cwd", () => {
  const registry = new SkillRegistry();
  assert.ok(typeof registry._projectRoot === "string");
  assert.ok(registry._projectRoot.length > 0);
});

test("SkillRegistry: install skill from directory", () => {
  const skillDir = tmpSkillDir({ name: "my-skill", description: "Test install" });
  const registry = new SkillRegistry();
  const result = registry.install(skillDir, { target: "user" });
  try {
    assert.equal(result.name, "my-skill");
    assert.equal(result.source, "userSettings");
    assert.ok(result.installDir.includes("my-skill"));
    assert.ok(fs.existsSync(result.installDir));
    assert.ok(fs.existsSync(path.join(result.installDir, "SKILL.md")));
  } finally {
    registry.uninstall("my-skill");
  }
});

test("SkillRegistry: install skill from single file", () => {
  const skillFile = tmpSkillFile({ name: "file-skill" });
  const registry = new SkillRegistry();
  const result = registry.install(skillFile, { target: "user" });
  try {
    assert.equal(result.name, "file-skill");
    assert.ok(fs.existsSync(path.join(result.installDir, "SKILL.md")));
  } finally {
    registry.uninstall("file-skill");
  }
});

test("SkillRegistry: install throws on overwrite without flag", () => {
  const skillDir = tmpSkillDir({ name: "dup-skill" });
  const registry = new SkillRegistry();
  registry.install(skillDir, { target: "user" });
  try {
    assert.throws(() => {
      registry.install(skillDir, { target: "user" });
    }, /already installed/);
  } finally {
    registry.uninstall("dup-skill");
  }
});

test("SkillRegistry: install with overwrite flag succeeds", () => {
  const skillDir = tmpSkillDir({ name: "overwrite-skill", description: "First" });
  const skillDir2 = tmpSkillDir({ name: "overwrite-skill", description: "Second" });
  const registry = new SkillRegistry();
  registry.install(skillDir, { target: "user" });
  try {
    const result = registry.install(skillDir2, {
      target: "user",
      overwrite: true,
    });
    assert.equal(result.name, "overwrite-skill");
    // Read the installed SKILL.md to verify it's the second one
    const content = fs.readFileSync(
      path.join(result.installDir, "SKILL.md"),
      "utf-8"
    );
    assert.ok(content.includes("Second"));
  } finally {
    registry.uninstall("overwrite-skill");
  }
});

test("SkillRegistry: uninstall removes an installed skill", () => {
  const skillDir = tmpSkillDir({ name: "remove-me" });
  const registry = new SkillRegistry();
  registry.install(skillDir, { target: "user" });
  const result = registry.uninstall("remove-me");
  assert.equal(result.removed, true);
  assert.ok(!fs.existsSync(result.path));
});

test("SkillRegistry: uninstall returns {removed:false} for unknown skill", () => {
  const registry = new SkillRegistry();
  const result = registry.uninstall("nonexistent-skill-xyz");
  assert.equal(result.removed, false);
  assert.equal(result.path, null);
});

test("SkillRegistry: list returns installed skills", () => {
  const skillDir = tmpSkillDir({ name: "list-skill", description: "List test" });
  const registry = new SkillRegistry();
  registry.install(skillDir, { target: "user" });
  try {
    const skills = registry.list();
    assert.ok(skills.length >= 1);
    const found = skills.find((s) => s.name === "list-skill");
    assert.ok(found);
    assert.equal(found.description, "List test");
  } finally {
    registry.uninstall("list-skill");
  }
});

test("SkillRegistry: list filters by source", () => {
  const skillDir = tmpSkillDir({ name: "source-test-skill" });
  const registry = new SkillRegistry();
  registry.install(skillDir, { target: "user" });
  try {
    const userList = registry.list({ source: "user" });
    assert.ok(userList.some((s) => s.name === "source-test-skill"));

    const projectList = registry.list({ source: "project" });
    // No project skills installed for this name
    assert.ok(!projectList.some((s) => s.name === "source-test-skill"));
  } finally {
    registry.uninstall("source-test-skill");
  }
});

test("SkillRegistry: list supports sortBy name", () => {
  const skillDirA = tmpSkillDir({ name: "aaa-skill" });
  const skillDirB = tmpSkillDir({ name: "zzz-skill" });
  const registry = new SkillRegistry();
  registry.install(skillDirA, { target: "user" });
  registry.install(skillDirB, { target: "user" });
  try {
    const skills = registry.list({ sortBy: "name" });
    const names = skills.map((s) => s.name);
    // Names should be sorted alphabetically
    for (let i = 1; i < names.length; i++) {
      assert.ok(names[i].localeCompare(names[i - 1]) >= 0);
    }

    const skillsDesc = registry.list({ sortBy: "name", sortDesc: true });
    const namesDesc = skillsDesc.map((s) => s.name);
    for (let i = 1; i < namesDesc.length; i++) {
      assert.ok(namesDesc[i].localeCompare(namesDesc[i - 1]) <= 0);
    }
  } finally {
    registry.uninstall("aaa-skill");
    registry.uninstall("zzz-skill");
  }
});

test("SkillRegistry: search finds skills by name", () => {
  const skillDir = tmpSkillDir({
    name: "searchable-skill",
    description: "Something unique here",
    tags: ["testing", "example"],
  });
  const registry = new SkillRegistry();
  registry.install(skillDir, { target: "user" });
  try {
    const results = registry.search("searchable");
    assert.ok(results.some((s) => s.name === "searchable-skill"));
  } finally {
    registry.uninstall("searchable-skill");
  }
});

test("SkillRegistry: search finds skills by description", () => {
  const skillDir = tmpSkillDir({
    name: "desc-skill",
    description: "A uniquely identifiable description phrase",
  });
  const registry = new SkillRegistry();
  registry.install(skillDir, { target: "user" });
  try {
    const results = registry.search("identifiable");
    assert.ok(results.some((s) => s.name === "desc-skill"));
  } finally {
    registry.uninstall("desc-skill");
  }
});

test("SkillRegistry: search finds skills by tags", () => {
  const skillDir = tmpSkillDir({
    name: "tagged-skill",
    description: "Tag test",
    tags: ["machine-learning", "python"],
  });
  const registry = new SkillRegistry();
  registry.install(skillDir, { target: "user" });
  try {
    const results = registry.search("machine-learning");
    assert.ok(results.some((s) => s.name === "tagged-skill"));
  } finally {
    registry.uninstall("tagged-skill");
  }
});

test("SkillRegistry: search with empty query returns all", () => {
  const registry = new SkillRegistry();
  const all = registry.search("");
  assert.ok(Array.isArray(all));

  const all2 = registry.search("   ");
  assert.ok(Array.isArray(all2));
});

test("SkillRegistry: update reloads skill metadata", () => {
  const skillDir = tmpSkillDir({ name: "update-skill", description: "Original desc" });
  const registry = new SkillRegistry();
  const installResult = registry.install(skillDir, { target: "user" });
  try {
    // Modify the installed SKILL.md directly
    const skillMdPath = path.join(installResult.installDir, "SKILL.md");
    let content = fs.readFileSync(skillMdPath, "utf-8");
    content = content.replace("Original desc", "Updated desc");
    fs.writeFileSync(skillMdPath, content, "utf-8");

    const updateResult = registry.update("update-skill");
    assert.equal(updateResult.updated, true);
    assert.equal(updateResult.skill.description, "Updated desc");
  } finally {
    registry.uninstall("update-skill");
  }
});

test("SkillRegistry: update throws for non-installed skill", () => {
  const registry = new SkillRegistry();
  assert.throws(() => {
    registry.update("this-skill-does-not-exist-anywhere");
  }, /not installed/);
});

test("SkillRegistry: getInfo returns full details", () => {
  const skillDir = tmpSkillDir({
    name: "info-skill",
    description: "Info test",
    version: "2.0.0",
    tags: ["info"],
    arguments: ["input", "output"],
  });
  const registry = new SkillRegistry();
  registry.install(skillDir, { target: "user" });
  try {
    const info = registry.getInfo("info-skill");
    assert.equal(info.name, "info-skill");
    assert.equal(info.description, "Info test");
    assert.equal(info.version, "2.0.0");
    assert.deepEqual(info.tags, ["info"]);
    assert.deepEqual(info.arguments, ["input", "output"]);
    assert.ok(info.usage !== undefined);
    assert.equal(typeof info.usage.installCount, "number");
    assert.ok(info.usage.installCount >= 1);
    assert.ok(info.usage.installedAt !== null);
  } finally {
    registry.uninstall("info-skill");
  }
});

test("SkillRegistry: getInfo returns null for unknown skill", () => {
  const registry = new SkillRegistry();
  assert.equal(registry.getInfo("completely-unknown"), null);
});

test("SkillRegistry: count returns installed skill count", () => {
  const skillDir = tmpSkillDir({ name: "count-skill" });
  const registry = new SkillRegistry();
  const before = registry.count();
  registry.install(skillDir, { target: "user" });
  try {
    const after = registry.count();
    assert.ok(after >= before + 1);
  } finally {
    registry.uninstall("count-skill");
  }
});

test("SkillRegistry: isInstalled returns true for installed skill", () => {
  const skillDir = tmpSkillDir({ name: "check-installed" });
  const registry = new SkillRegistry();
  registry.install(skillDir, { target: "user" });
  try {
    assert.equal(registry.isInstalled("check-installed"), true);
  } finally {
    registry.uninstall("check-installed");
  }
});

test("SkillRegistry: isInstalled returns false for unknown skill", () => {
  const registry = new SkillRegistry();
  assert.equal(registry.isInstalled("never-installed"), false);
});
