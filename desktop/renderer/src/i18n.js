// Desktop i18n wrapper — imports shared CommonJS i18n for Vue 3 usage via provide/inject.
import sharedI18n from '../../../src/i18n.js';

const { createTranslator: createBaseTranslator, DEFAULT_LOCALE } = sharedI18n;

let currentTranslator = createBaseTranslator(DEFAULT_LOCALE);

/** Set active locale. Call from App.vue when settings load or locale changes. */
export function setLocale(locale) {
  currentTranslator = createBaseTranslator(locale);
}

/** Translation function — compatible with Vue template interpolation in v-bind / {{ }} */
export function t(key, values) {
  return currentTranslator(key, values || {});
}

export { DEFAULT_LOCALE };
