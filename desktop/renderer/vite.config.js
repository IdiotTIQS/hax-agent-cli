import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

const srcI18n = path.resolve(__dirname, '..', '..', 'src', 'i18n.js');

function commonJsI18nInterop() {
  const normalizedSrcI18n = path.normalize(srcI18n);

  return {
    name: 'hax-agent-commonjs-i18n-interop',
    enforce: 'pre',
    transform(code, id) {
      const normalizedId = path.normalize(id.split('?')[0]);
      if (normalizedId !== normalizedSrcI18n) return null;

      return {
        code: `const module = { exports: {} };
const exports = module.exports;

${code}

const sharedI18n = module.exports;

const __haxDefaultLocale = sharedI18n.DEFAULT_LOCALE;
const __haxSupportedLocales = sharedI18n.SUPPORTED_LOCALES;
const __haxCreateTranslator = sharedI18n.createTranslator;
const __haxGetLocaleLabel = sharedI18n.getLocaleLabel;
const __haxIsSupportedLocale = sharedI18n.isSupportedLocale;
const __haxListLocales = sharedI18n.listLocales;
const __haxNormalizeLocale = sharedI18n.normalizeLocale;

export {
  __haxCreateTranslator as createTranslator,
  __haxDefaultLocale as DEFAULT_LOCALE,
  __haxGetLocaleLabel as getLocaleLabel,
  __haxIsSupportedLocale as isSupportedLocale,
  __haxListLocales as listLocales,
  __haxNormalizeLocale as normalizeLocale,
  __haxSupportedLocales as SUPPORTED_LOCALES,
};
export default sharedI18n;
`,
        map: null,
      };
    },
  };
}

export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [commonJsI18nInterop(), vue()],
  server: {
    fs: {
      allow: ['../..', '../../..'],  // allow imports from project root
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    commonjsOptions: {
      include: [/src[\\/]i18n\.js$/, /node_modules/],
    },
  },
});
