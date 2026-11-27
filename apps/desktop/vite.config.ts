import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const raiz = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  clearScreen: false,
  build: {
    rollupOptions: {
      input: {
        main: resolve(raiz, 'index.html'),
        faixa: resolve(raiz, 'faixa.html'),
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    // O Rust compila dentro de src-tauri; vigiar lá trava o Vite (EBUSY).
    watch: { ignored: ['**/src-tauri/**'] },
  },
});
