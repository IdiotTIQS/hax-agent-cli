"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createSkillPackage,
  installSkillPackage,
  validateSkillPackage,
  listPackages,
} = require("../src/skills/package-skills");

/**
 * Helper: create a skill directory with SKILL.md and optional extra files/dirs.
 */
function makeSkillDir(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-pkg-skill-"));
  const content = [
    "---",
    `name: ${options.name || "test-skill"}`,
    `description: ${options.description || "A packaged skill"}`,
    options.version ? `version: ${options.version}` : "",
    options.author ? `author: ${options.author}` : "",
    options.tags ? `tags:\n${options.tags.map((t) => `  - ${t}`).join("\n")}` : "",
    "---",
    "",
    "# Test Skill",
    "",
    "Content.",
  ]
    .filter((l) => l !== "")
    .join("\n");

  fs.writeFileSync(path.join(dir, "SKILL.md"), content, "utf-8");

  if (options.hasScripts) {
    fs.mkdirSync(path.join(dir, "scripts"));
    fs.writeFileSync(path.join(dir, "scripts", "setup.sh"), "#!/bin/bash\necho hello", "utf-8");
  }

  if (options.hasAssets) {
    fs.mkdirSync(path.join(dir, "assets"));
    fs.writeFileSync(path.join(dir, "assets", "config.json"), '{"key":"value"}', "utf-8");
  }

  return dir;
}

test("validateSkillPackage: valid package passes", () => {
  const skillDir = makeSkillDir({ name: "valid-pkg" });
  const result = validateSkillPackage(skillDir);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
  assert.ok(result.meta);
  assert.equal(result.meta.name, "valid-pkg");
});

test("validateSkillPackage: missing SKILL.md fails", () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-pkg-empty-"));
  const result = validateSkillPackage(emptyDir);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("SKILL.md")));
});

test("validateSkillPackage: non-existent path fails", () => {
  const result = validateSkillPackage("/i/definitely/do/not/exist/path");
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("does not exist")));
});

test("validateSkillPackage: warns on missing name in frontmatter", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-pkg-noname-"));
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    "---\ndescription: No name here\n---\n\n# No Name",
    "utf-8"
  );
  const result = validateSkillPackage(dir);
  // Still valid (SKILL.md exists) but warns about name
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((w) => w.includes("name")));
});

test("createSkillPackage: packages a valid skill directory", () => {
  const skillDir = makeSkillDir({
    name: "packaged-skill",
    version: "1.0.0",
    author: "tester",
    tags: ["tag1", "tag2"],
    hasScripts: true,
    hasAssets: true,
  });

  const outputDir = path.join(os.tmpdir(), "hax-pkg-output-packaged-skill");
  if (fs.existsSync(outputDir)) fs.rmSync(outputDir, { recursive: true, force: true });

  const result = createSkillPackage(skillDir, outputDir);
  try {
    assert.equal(result.skillName, "packaged-skill");
    assert.ok(result.filesCopied >= 3); // SKILL.md + manifest.json + scripts/setup.sh + assets/config.json
    assert.ok(fs.existsSync(path.join(outputDir, "SKILL.md")));
    assert.ok(fs.existsSync(path.join(outputDir, "manifest.json")));
    assert.ok(fs.existsSync(path.join(outputDir, "scripts", "setup.sh")));
    assert.ok(fs.existsSync(path.join(outputDir, "assets", "config.json")));

    // Verify manifest.json content
    const manifestRaw = fs.readFileSync(path.join(outputDir, "manifest.json"), "utf-8");
    const manifest = JSON.parse(manifestRaw);
    assert.equal(manifest.name, "packaged-skill");
    assert.equal(manifest.version, "1.0.0");
    assert.equal(manifest.author, "tester");
    assert.deepEqual(manifest.tags, ["tag1", "tag2"]);
  } finally {
    if (fs.existsSync(outputDir)) fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("createSkillPackage: throws on non-existent source", () => {
  assert.throws(() => {
    createSkillPackage("/does/not/exist", "/tmp/output");
  }, /does not exist/);
});

test("createSkillPackage: throws on overwrite without flag", () => {
  const skillDir = makeSkillDir({ name: "overwrite-test" });
  const outputDir = path.join(os.tmpdir(), "hax-pkg-output-overwrite");
  if (fs.existsSync(outputDir)) fs.rmSync(outputDir, { recursive: true, force: true });

  // First create
  createSkillPackage(skillDir, outputDir);
  try {
    assert.throws(() => {
      createSkillPackage(skillDir, outputDir);
    }, /already exists/);
  } finally {
    if (fs.existsSync(outputDir)) fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("createSkillPackage: overwrite flag replaces existing output", () => {
  const skillDir = makeSkillDir({ name: "force-overwrite", description: "Version 1" });
  const skillDir2 = makeSkillDir({ name: "force-overwrite", description: "Version 2" });

  const outputDir = path.join(os.tmpdir(), "hax-pkg-output-force");
  if (fs.existsSync(outputDir)) fs.rmSync(outputDir, { recursive: true, force: true });

  createSkillPackage(skillDir, outputDir);
  const result = createSkillPackage(skillDir2, outputDir, { overwrite: true });
  try {
    assert.equal(result.skillName, "force-overwrite");
    const content = fs.readFileSync(path.join(outputDir, "SKILL.md"), "utf-8");
    assert.ok(content.includes("Version 2"));
  } finally {
    if (fs.existsSync(outputDir)) fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test("installSkillPackage: installs from a valid package", () => {
  const skillDir = makeSkillDir({
    name: "installable-pkg",
    version: "1.2.3",
    hasScripts: true,
  });

  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-pkg-target-"));
  const result = installSkillPackage(skillDir, targetDir);
  try {
    assert.equal(result.installed, true);
    assert.equal(result.skillName, "installable-pkg");
    assert.ok(result.installDir.includes("installable-pkg"));
    assert.ok(fs.existsSync(path.join(result.installDir, "SKILL.md")));
    assert.ok(fs.existsSync(path.join(result.installDir, "scripts", "setup.sh")));
  } finally {
    if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
  }
});

test("installSkillPackage: throws for invalid package", () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-pkg-invalid-"));
  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-pkg-target2-"));
  try {
    assert.throws(() => {
      installSkillPackage(emptyDir, targetDir);
    }, /Invalid skill package/);
  } finally {
    if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
  }
});

test("installSkillPackage: throws on overwrite without flag", () => {
  const skillDir = makeSkillDir({ name: "dup-install" });
  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-pkg-target3-"));
  installSkillPackage(skillDir, targetDir);
  try {
    assert.throws(() => {
      installSkillPackage(skillDir, targetDir);
    }, /already installed/);
  } finally {
    if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
  }
});

test("installSkillPackage: overwrite flag replaces existing install", () => {
  const skillDir = makeSkillDir({ name: "re-install", description: "Original" });
  const skillDir2 = makeSkillDir({ name: "re-install", description: "Replaced" });

  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-pkg-target4-"));
  installSkillPackage(skillDir, targetDir);
  const result = installSkillPackage(skillDir2, targetDir, { overwrite: true });
  try {
    assert.equal(result.installed, true);
    const content = fs.readFileSync(path.join(result.installDir, "SKILL.md"), "utf-8");
    assert.ok(content.includes("Replaced"));
  } finally {
    if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
  }
});

test("listPackages: finds valid packages in a directory", () => {
  const scanDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-pkg-scan-"));
  // Create two valid skill dirs and one invalid (no SKILL.md)
  const dirA = path.join(scanDir, "pkg-a");
  fs.mkdirSync(dirA);
  fs.writeFileSync(
    path.join(dirA, "SKILL.md"),
    "---\nname: pkg-a\ndescription: First package\nversion: 1.0.0\n---\n\n# Pkg A",
    "utf-8"
  );

  const dirB = path.join(scanDir, "pkg-b.haxpkg");
  fs.mkdirSync(dirB);
  fs.writeFileSync(
    path.join(dirB, "SKILL.md"),
    "---\nname: pkg-b\ndescription: Second package\n---\n\n# Pkg B",
    "utf-8"
  );

  // Invalid: no SKILL.md
  const dirC = path.join(scanDir, "not-a-pkg");
  fs.mkdirSync(dirC);

  const packages = listPackages(scanDir);
  try {
    assert.ok(packages.length >= 2);
    const a = packages.find((p) => p.name === "pkg-a");
    const b = packages.find((p) => p.name === "pkg-b");
    assert.ok(a);
    assert.ok(b);
    assert.equal(a.valid, true);
    assert.equal(b.valid, true);
    assert.equal(a.version, "1.0.0");
    // The invalid one should still be listed but marked invalid
    const invalid = packages.find((p) => p.directoryName === "not-a-pkg");
    if (invalid) {
      assert.equal(invalid.valid, false);
    }
  } finally {
    if (fs.existsSync(scanDir)) fs.rmSync(scanDir, { recursive: true, force: true });
  }
});

test("listPackages: returns empty array for non-existent directory", () => {
  assert.deepEqual(listPackages("/does/not/exist"), []);
});
