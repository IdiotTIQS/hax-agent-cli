const SUPPORTED_LOCALES = Object.freeze({
  en: 'English',
  'zh-CN': '中文简体',
  'zh-TW': '中文繁體（台灣地區）',
  ru: 'Русский',
});

const DEFAULT_LOCALE = 'en';

const TRANSLATIONS = {
  en: require('./en'),
  'zh-CN': require('./zh-CN'),
  'zh-TW': require('./zh-TW'),
  ru: require('./ru'),
};

function normalizeLocale(locale) {
  const value = String(locale || '').trim();
  if (!value) return DEFAULT_LOCALE;

  const lower = value.toLowerCase();
  if (lower === 'en' || lower === 'english') return 'en';
  if (lower === 'zh' || lower === 'zh-cn' || lower === 'zh_hans' || lower === 'zh-hans' || value === '中文简体') return 'zh-CN';
  if (lower === 'zh-tw' || lower === 'zhtw' || lower === 'zh-twarea' || lower === 'zh_hant' || lower === 'zh-hant' || value === '中文繁體' || value === '中文繁体') return 'zh-TW';
  if (lower === 'ru' || lower === 'russian' || value === 'русский') return 'ru';
  return SUPPORTED_LOCALES[value] ? value : DEFAULT_LOCALE;
}

function isSupportedLocale(locale) {
  return Object.prototype.hasOwnProperty.call(SUPPORTED_LOCALES, normalizeLocale(locale));
}

function getLocaleLabel(locale) {
  const normalized = normalizeLocale(locale);
  return SUPPORTED_LOCALES[normalized] || SUPPORTED_LOCALES[DEFAULT_LOCALE];
}

function listLocales() {
  return Object.entries(SUPPORTED_LOCALES).map(([value, label]) => ({ value, label }));
}

function createTranslator(locale) {
  const normalizedLocale = normalizeLocale(locale);
  const dictionary = TRANSLATIONS[normalizedLocale] || TRANSLATIONS[DEFAULT_LOCALE];

  return function translate(key, values = {}) {
    const template = dictionary[key] || TRANSLATIONS[DEFAULT_LOCALE][key] || key;
    return template.replace(/\{(\w+)\}/g, (_match, name) => {
      const value = values[name];
      return value === undefined || value === null ? '' : String(value);
    });
  };
}

module.exports = {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  createTranslator,
  getLocaleLabel,
  isSupportedLocale,
  listLocales,
  normalizeLocale,
};
