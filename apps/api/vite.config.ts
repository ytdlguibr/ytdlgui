import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    ssr: resolve(__dirname, 'src/server.ts'),
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'node20',
    rollupOptions: {
      output: {
        entryFileNames: 'server.mjs',
      },
      external: [...builtinModules, ...builtinModules.map((module) => `node:${module}`)],
    },
  },
});
