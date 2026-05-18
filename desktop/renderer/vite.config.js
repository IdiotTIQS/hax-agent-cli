import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [vue()],
  server: {
    fs: {
      allow: ['../..', '../../..'],  // allow imports from project root
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    commonjsOptions: {
      include: [/src[\\/]i18n[\\/].*\.js$/, /node_modules/],
    },
  },
});
