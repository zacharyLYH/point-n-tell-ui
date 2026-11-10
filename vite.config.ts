import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler', {}]],
      },
    }),
    tailwindcss(),
  ],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    cssCodeSplit: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/overlay/main.tsx'),
      formats: ['iife'],
      name: 'PointAndTell',
      fileName: () => 'overlay.js',
    },
  },
});
