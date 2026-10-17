import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = resolve(__dirname);
const outDir = resolve(__dirname, 'dist');

export default defineConfig({
  root,
  publicDir: false,
  plugins: [
    react(),
    {
      name: 'copy-extension-manifest',
      closeBundle() {
        const target = resolve(outDir, 'manifest.json');
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(resolve(root, 'manifest.json'), target);
      },
    },
  ],
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(root, 'popup.html'),
        sidePanel: resolve(root, 'sidePanel.html'),
        background: resolve(root, 'src/background.ts'),
        contentScript: resolve(root, 'src/contentScript.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
