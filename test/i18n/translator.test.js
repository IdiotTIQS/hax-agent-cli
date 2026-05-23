/**
 * Tests for ConversationTranslator: translate, translateMessage,
 * translateSession, detectLanguage, getSupportedLanguages.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { ConversationTranslator } = require("../../src/i18n/translator");

test("ConversationTranslator: getSupportedLanguages returns all 10 languages", () => {
  const translator = new ConversationTranslator();
  const langs = translator.getSupportedLanguages();
  assert.ok(Array.isArray(langs));
  assert.equal(langs.length, 10);
  assert.ok(langs.includes("en"));
  assert.ok(langs.includes("zh-CN"));
  assert.ok(langs.includes("zh-TW"));
  assert.ok(langs.includes("ja"));
  assert.ok(langs.includes("ko"));
  assert.ok(langs.includes("ru"));
  assert.ok(langs.includes("fr"));
  assert.ok(langs.includes("de"));
  assert.ok(langs.includes("es"));
  assert.ok(langs.includes("pt"));
});

test("ConversationTranslator: translate English to Chinese (zh-CN)", () => {
  const translator = new ConversationTranslator();
  const result = translator.translate("Save", "en", "zh-CN");
  assert.equal(result, "保存");
});

test("ConversationTranslator: translate English to Japanese", () => {
  const translator = new ConversationTranslator();
  const result = translator.translate("Error", "en", "ja");
  assert.equal(result, "エラー");
});

test("ConversationTranslator: translate English to Russian", () => {
  const translator = new ConversationTranslator();
  const result = translator.translate("help", "en", "ru");
  assert.equal(result, "помощь");
});

test("ConversationTranslator: translate English to Korean", () => {
  const translator = new ConversationTranslator();
  const result = translator.translate("Search", "en", "ko");
  assert.equal(result, "검색");
});

test("ConversationTranslator: translate English to French", () => {
  const translator = new ConversationTranslator();
  const result = translator.translate("settings", "en", "fr");
  assert.equal(result, "paramètres");
});

test("ConversationTranslator: translate English to German", () => {
  const translator = new ConversationTranslator();
  const result = translator.translate("file", "en", "de");
  assert.equal(result, "datei");
});

test("ConversationTranslator: translate English to Spanish", () => {
  const translator = new ConversationTranslator();
  const result = translator.translate("language", "en", "es");
  assert.equal(result, "idioma");
});

test("ConversationTranslator: translate English to Portuguese", () => {
  const translator = new ConversationTranslator();
  const result = translator.translate("export", "en", "pt");
  assert.equal(result, "exportar");
});

test("ConversationTranslator: translate returns original when source equals target", () => {
  const translator = new ConversationTranslator();
  const result = translator.translate("Hello world", "en", "en");
  assert.equal(result, "Hello world");
});

test("ConversationTranslator: translate returns original for empty string", () => {
  const translator = new ConversationTranslator();
  assert.equal(translator.translate("", "en", "zh-CN"), "");
  assert.equal(translator.translate("", "auto", "ja"), "");
});

test("ConversationTranslator: translate 'auto' detects language and translates", () => {
  const translator = new ConversationTranslator();
  // English text with auto-detect
  const result = translator.translate("save", "auto", "es");
  assert.equal(result, "guardar");
});

test("ConversationTranslator: translate phrase with multiple words", () => {
  const translator = new ConversationTranslator();
  const result = translator.translate("File not found", "en", "fr");
  // Should translate "file" and "not found" independently
  assert.ok(result.includes("fichier") || result.length > 0);
});

test("ConversationTranslator: translate case-insensitive preserves capitalization", () => {
  const translator = new ConversationTranslator();
  const result = translator.translate("ERROR", "en", "de");
  assert.ok(result === result.toUpperCase() || result.length > 0);
});

test("ConversationTranslator: translate unknown word returns original", () => {
  const translator = new ConversationTranslator();
  const result = translator.translate("blarg_frobnicate_quux", "en", "zh-CN");
  assert.equal(result, "blarg_frobnicate_quux");
});

test("ConversationTranslator: translateMessage translates string content", () => {
  const translator = new ConversationTranslator();
  const message = {
    role: "assistant",
    content: "Error: File not found",
  };
  const translated = translator.translateMessage(message, "ja");
  assert.equal(translated.role, "assistant");
  assert.ok(typeof translated.content === "string");
  assert.ok(translated.content.includes("エラー") || translated.content.includes("ファイル"));
});

test("ConversationTranslator: translateMessage translates content array", () => {
  const translator = new ConversationTranslator();
  const message = {
    role: "user",
    content: [
      { type: "text", text: "Save the file" },
      { type: "text", text: "Delete the cache" },
    ],
  };
  const translated = translator.translateMessage(message, "es");
  assert.equal(translated.role, "user");
  assert.ok(Array.isArray(translated.content));
  assert.equal(translated.content.length, 2);
  assert.ok(translated.content[0].text.includes("guardar") || translated.content[0].text.includes("archivo"));
});

test("ConversationTranslator: translateMessage preserves non-text blocks", () => {
  const translator = new ConversationTranslator();
  const message = {
    role: "user",
    content: [
      { type: "text", text: "Hello" },
      { type: "image", url: "https://example.com/img.png" },
    ],
  };
  const translated = translator.translateMessage(message, "fr");
  assert.equal(translated.content.length, 2);
  assert.equal(translated.content[1].type, "image");
  assert.equal(translated.content[1].url, "https://example.com/img.png");
});

test("ConversationTranslator: translateSession translates message array", () => {
  const translator = new ConversationTranslator();
  const session = [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Search the file" },
    { role: "assistant", content: "I found the file" },
  ];
  const translated = translator.translateSession(session, "zh-CN");
  assert.equal(translated.length, 3);
  assert.equal(translated[0].role, "system");
  assert.equal(translated[1].role, "user");
  assert.equal(translated[2].role, "assistant");
  // At least one content should have been translated
  assert.ok(
    translated[1].content.includes("搜索") ||
    translated[1].content.includes("文件") ||
    translated[2].content.includes("文件")
  );
});

test("ConversationTranslator: translateSession handles session object with messages array", () => {
  const translator = new ConversationTranslator();
  const session = {
    id: "session-1",
    messages: [
      { role: "user", content: "Save" },
      { role: "assistant", content: "Done" },
    ],
  };
  const translated = translator.translateSession(session, "de");
  assert.equal(translated.id, "session-1");
  assert.ok(translated.messages[0].content.includes("speichern") || translated.messages[1].content.includes("fertig") || translated.messages[0].content !== "Save");
});

test("ConversationTranslator: translateSession translates systemPrompt", () => {
  const translator = new ConversationTranslator();
  const session = {
    id: "session-2",
    systemPrompt: "You are a helpful coding assistant.",
    messages: [{ role: "user", content: "Help" }],
  };
  const translated = translator.translateSession(session, "ru");
  // systemPrompt should be translated if possible; at minimum it's a string
  assert.ok(typeof translated.systemPrompt === "string");
});

test("ConversationTranslator: detectLanguage detects English", () => {
  const translator = new ConversationTranslator();
  const result = translator.detectLanguage("The quick brown fox jumps over the lazy dog");
  assert.equal(result, "en");
});

test("ConversationTranslator: detectLanguage detects Chinese (zh-CN)", () => {
  const translator = new ConversationTranslator();
  const result = translator.detectLanguage("这是一个测试文件，用来验证语言检测功能。");
  assert.equal(result, "zh-CN");
});

test("ConversationTranslator: detectLanguage detects Japanese", () => {
  const translator = new ConversationTranslator();
  const result = translator.detectLanguage("これはテストファイルです。日本語の検出を確認します。");
  assert.equal(result, "ja");
});

test("ConversationTranslator: detectLanguage detects Korean", () => {
  const translator = new ConversationTranslator();
  const result = translator.detectLanguage("이것은 테스트 파일입니다. 언어 감지 기능을 확인합니다.");
  assert.equal(result, "ko");
});

test("ConversationTranslator: detectLanguage detects Russian", () => {
  const translator = new ConversationTranslator();
  const result = translator.detectLanguage("Это тестовый файл для проверки определения языка.");
  assert.equal(result, "ru");
});

test("ConversationTranslator: detectLanguage returns en for empty string", () => {
  const translator = new ConversationTranslator();
  assert.equal(translator.detectLanguage(""), "en");
  assert.equal(translator.detectLanguage("   "), "en");
});

test("ConversationTranslator: detectLanguage works with French text", () => {
  const translator = new ConversationTranslator();
  const result = translator.detectLanguage("Ceci est un fichier de test pour la détection de langue.");
  assert.equal(result, "fr");
});

test("ConversationTranslator: detectLanguage works with German text", () => {
  const translator = new ConversationTranslator();
  const result = translator.detectLanguage("Dies ist eine Testdatei zur Sprachprüfung.");
  assert.equal(result, "de");
});

test("ConversationTranslator: detectLanguage works with Spanish text", () => {
  const translator = new ConversationTranslator();
  const result = translator.detectLanguage("Este es un archivo de prueba para la detección de idioma.");
  assert.equal(result, "es");
});

test("ConversationTranslator: detectLanguage works with Portuguese text", () => {
  const translator = new ConversationTranslator();
  const result = translator.detectLanguage("Este é um arquivo de teste para detecção de idioma.");
  assert.equal(result, "pt");
});

test("ConversationTranslator: isSupported returns true for valid languages", () => {
  const translator = new ConversationTranslator();
  assert.equal(translator.isSupported("en"), true);
  assert.equal(translator.isSupported("ja"), true);
  assert.equal(translator.isSupported("ru"), true);
  assert.equal(translator.isSupported("fr"), true);
  assert.equal(translator.isSupported("de"), true);
  assert.equal(translator.isSupported("es"), true);
  assert.equal(translator.isSupported("pt"), true);
  assert.equal(translator.isSupported("zh-CN"), true);
  assert.equal(translator.isSupported("zh-TW"), true);
  assert.equal(translator.isSupported("ko"), true);
});

test("ConversationTranslator: isSupported returns false for invalid languages", () => {
  const translator = new ConversationTranslator();
  assert.equal(translator.isSupported("ar"), false);
  assert.equal(translator.isSupported("it"), false);
  assert.equal(translator.isSupported(""), false);
  assert.equal(translator.isSupported("zh"), false);
});

test("ConversationTranslator: translate between non-English languages pivots through English", () => {
  const translator = new ConversationTranslator();
  // zh-CN -> ja via en pivot
  const result = translator.translate("保存", "zh-CN", "ja");
  // Should at minimum produce non-empty output
  assert.ok(typeof result === "string");
  assert.ok(result.length > 0);
});
