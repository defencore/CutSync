import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  base: './',
  esbuild: { legalComments: 'eof' },
  build: {
    rollupOptions: {
      output: {
        banner: '/*! Includes Mediabunny 1.66.2, Copyright (c) 2026-present Vanilagy and contributors, MPL-2.0. License and corresponding source: third-party-notices.txt at the application root. */',
      },
    },
  },
});
