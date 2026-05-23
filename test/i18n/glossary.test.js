/**
 * Tests for TranslationGlossary: addTerm, lookup, importGlossary,
 * exportGlossary, getLanguages, getTermCount, getTranslations,
 * removeTerm, clear.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { TranslationGlossary } = require("../../src/i18n/glossary");

test("TranslationGlossary: pre-loaded with 200+ terms", () => {
  const glossary = new TranslationGlossary();
  assert.ok(glossary.getTermCount() >= 200);
});

test("TranslationGlossary: pre-loaded terms have expected languages", () => {
  const glossary = new TranslationGlossary();
  const langs = glossary.getLanguages();
  assert.ok(langs.includes("en"));
  assert.ok(langs.includes("zh-CN"));
  assert.ok(langs.includes("ja"));
  assert.ok(langs.includes("ru"));
  assert.ok(langs.includes("es"));
  assert.ok(langs.includes("fr"));
});

test("TranslationGlossary: lookup returns translation for known term + language", () => {
  const glossary = new TranslationGlossary();
  assert.equal(glossary.lookup("Error", "zh-CN"), "错误");
  assert.equal(glossary.lookup("Error", "ja"), "エラー");
  assert.equal(glossary.lookup("Error", "ru"), "Ошибка");
  assert.equal(glossary.lookup("Error", "es"), "Error");
  assert.equal(glossary.lookup("Error", "fr"), "Erreur");
});

test("TranslationGlossary: lookup returns null for unknown term", () => {
  const glossary = new TranslationGlossary();
  assert.equal(glossary.lookup("NonexistentTermXYZ", "ja"), null);
});

test("TranslationGlossary: lookup returns null for unknown language", () => {
  const glossary = new TranslationGlossary();
  assert.equal(glossary.lookup("File", "it"), null);
});

test("TranslationGlossary: addTerm adds a new translation", () => {
  const glossary = new TranslationGlossary();
  glossary.addTerm("Microservice", "微服务", "zh-CN");
  assert.equal(glossary.lookup("Microservice", "zh-CN"), "微服务");
});

test("TranslationGlossary: addTerm adds a new language to existing term", () => {
  const glossary = new TranslationGlossary();
  glossary.addTerm("Settings", "Налаштування", "uk");
  assert.equal(glossary.lookup("Settings", "uk"), "Налаштування");
  assert.ok(glossary.getLanguages().includes("uk"));
});

test("TranslationGlossary: addTerm overrides existing translation", () => {
  const glossary = new TranslationGlossary();
  glossary.addTerm("Error", "过错", "zh-CN");
  assert.equal(glossary.lookup("Error", "zh-CN"), "过错");
});

test("TranslationGlossary: addTerm throws for empty source", () => {
  const glossary = new TranslationGlossary();
  assert.throws(() => glossary.addTerm("", "test", "en"), { message: /source must be/ });
});

test("TranslationGlossary: addTerm throws for empty target", () => {
  const glossary = new TranslationGlossary();
  assert.throws(() => glossary.addTerm("test", "", "en"), { message: /target must be/ });
});

test("TranslationGlossary: addTerm throws for empty lang", () => {
  const glossary = new TranslationGlossary();
  assert.throws(() => glossary.addTerm("test", "test", ""), { message: /lang must be/ });
});

test("TranslationGlossary: addTerm is chainable", () => {
  const glossary = new TranslationGlossary();
  const result = glossary.addTerm("A", "B", "en");
  assert.equal(result, glossary);
});

test("TranslationGlossary: getTranslations returns a Map copy for known term", () => {
  const glossary = new TranslationGlossary();
  const translations = glossary.getTranslations("File");
  assert.ok(translations instanceof Map);
  assert.ok(translations.has("zh-CN"));
  assert.equal(translations.get("zh-CN"), "文件");
  // Should be a copy, not the internal reference
  translations.set("zh-CN", "MODIFIED");
  assert.equal(glossary.lookup("File", "zh-CN"), "文件");
});

test("TranslationGlossary: getTranslations returns null for unknown term", () => {
  const glossary = new TranslationGlossary();
  assert.equal(glossary.getTranslations("NoSuchTerm"), null);
});

test("TranslationGlossary: removeTerm removes a term and returns true", () => {
  const glossary = new TranslationGlossary();
  assert.equal(glossary.removeTerm("Error"), true);
  assert.equal(glossary.lookup("Error", "zh-CN"), null);
});

test("TranslationGlossary: removeTerm returns false for unknown term", () => {
  const glossary = new TranslationGlossary();
  assert.equal(glossary.removeTerm("XYZUnknown"), false);
});

test("TranslationGlossary: importGlossary loads entries from JSON file", () => {
  const glossary = new TranslationGlossary();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-glossary-"));
  const filePath = path.join(tmpDir, "glossary.json");

  const entries = [
    { source: "Webhook", target: "Webhook", lang: "es" },
    { source: "Webhook", target: "Webhook", lang: "fr" },
    { source: "Idempotency", target: "幂等性", lang: "zh-CN" },
    { source: "Idempotency", target: "冪等性", lang: "ja" },
  ];
  fs.writeFileSync(filePath, JSON.stringify(entries), "utf8");

  const count = glossary.importGlossary(filePath);
  assert.equal(count, 4);
  assert.equal(glossary.lookup("Webhook", "es"), "Webhook");
  assert.equal(glossary.lookup("Webhook", "fr"), "Webhook");
  assert.equal(glossary.lookup("Idempotency", "zh-CN"), "幂等性");
  assert.equal(glossary.lookup("Idempotency", "ja"), "冪等性");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("TranslationGlossary: importGlossary skips malformed entries", () => {
  const glossary = new TranslationGlossary();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-glossary-"));
  const filePath = path.join(tmpDir, "bad.json");

  fs.writeFileSync(filePath, JSON.stringify([
    { source: "Good", target: "Bueno", lang: "es" },
    { source: "", target: "Bad", lang: "es" },
    { source: "Bad2", target: "", lang: "es" },
    { source: "Bad3", target: "Bad3-es", lang: "" },
    { source: "Good2", target: "Bien", lang: "fr" },
  ]), "utf8");

  const count = glossary.importGlossary(filePath);
  assert.equal(count, 2);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("TranslationGlossary: importGlossary throws for non-array JSON", () => {
  const glossary = new TranslationGlossary();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-glossary-"));
  const filePath = path.join(tmpDir, "bad.json");

  fs.writeFileSync(filePath, JSON.stringify({ not: "an array" }), "utf8");

  assert.throws(
    () => glossary.importGlossary(filePath),
    { message: /must contain a JSON array/ }
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("TranslationGlossary: exportGlossary writes JSON file and returns count", () => {
  const glossary = new TranslationGlossary();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-glossary-"));
  const filePath = path.join(tmpDir, "export.json");

  const count = glossary.exportGlossary(filePath);
  assert.ok(count > 0);

  // File should exist and be valid JSON
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  assert.ok(Array.isArray(parsed));
  assert.ok(parsed.length > 0);
  assert.equal(parsed.length, count);

  // Each entry should have source, target, lang
  for (const entry of parsed) {
    assert.ok(typeof entry.source === "string");
    assert.ok(typeof entry.target === "string");
    assert.ok(typeof entry.lang === "string");
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("TranslationGlossary: export then import roundtrips correctly", () => {
  const glossary1 = new TranslationGlossary();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hax-glossary-"));
  const filePath = path.join(tmpDir, "roundtrip.json");

  glossary1.addTerm("CustomTerm", "カスタム用語", "ja");
  glossary1.addTerm("CustomTerm", "Término personalizado", "es");

  glossary1.exportGlossary(filePath);

  const glossary2 = new TranslationGlossary();
  glossary2.clear();
  assert.equal(glossary2.getTermCount(), 0);

  glossary2.importGlossary(filePath);
  assert.equal(glossary2.lookup("CustomTerm", "ja"), "カスタム用語");
  assert.equal(glossary2.lookup("CustomTerm", "es"), "Término personalizado");
  assert.ok(glossary2.getTermCount() > 0);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("TranslationGlossary: clear removes all terms", () => {
  const glossary = new TranslationGlossary();
  assert.ok(glossary.getTermCount() > 0);
  glossary.clear();
  assert.equal(glossary.getTermCount(), 0);
  assert.equal(glossary.lookup("Error", "zh-CN"), null);
});

test("TranslationGlossary: programming terms cover required categories", () => {
  const glossary = new TranslationGlossary();

  // UI terms
  assert.ok(glossary.lookup("Settings", "ja") !== null);
  assert.ok(glossary.lookup("Save", "ru") !== null);
  assert.ok(glossary.lookup("Cancel", "es") !== null);

  // Error terms
  assert.ok(glossary.lookup("Error", "zh-CN") !== null);
  assert.ok(glossary.lookup("Timeout", "fr") !== null);
  assert.ok(glossary.lookup("Type error", "ja") !== null);

  // Tool terms
  assert.ok(glossary.lookup("File", "ja") !== null);
  assert.ok(glossary.lookup("Execute", "ru") !== null);
  assert.ok(glossary.lookup("Deploy", "es") !== null);

  // Command terms
  assert.ok(glossary.lookup("Command", "fr") !== null);
  assert.ok(glossary.lookup("Argument", "es") !== null);

  // General programming terms
  assert.ok(glossary.lookup("Function", "zh-CN") !== null);
  assert.ok(glossary.lookup("Algorithm", "es") !== null);
  assert.ok(glossary.lookup("Async", "ja") !== null);
  assert.ok(glossary.lookup("Database", "ru") !== null);
});
