import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'node:path';

// Builds the MV3 extension into dist/: two HTML entry points (popup + full-page tab)
// that share one Preact app, and a module service worker at a fixed path.
export default defineConfig(({ mode }) => ({
  plugins: [preact()],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  base: './',
  // the storage-scan worker is loaded as a module worker from the extension's own origin
  worker: { format: 'es' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome110',
    sourcemap: mode === 'development',
    // Unminified on purpose: the Chrome Web Store reviews readable code faster, and size is irrelevant
    // for a locally installed extension. Never obfuscate.
    minify: false,
    modulePreload: false,
    rollupOptions: {
      input: {
        popup: resolve(import.meta.dirname, 'popup.html'),
        app: resolve(import.meta.dirname, 'app.html'),
        background: resolve(import.meta.dirname, 'src/background/index.ts'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
}));
