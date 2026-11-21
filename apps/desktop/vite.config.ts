import { defineConfig } from 'vite';

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // O Rust compila dentro de src-tauri; vigiar lá trava o Vite (EBUSY).
    watch: { ignored: ['**/src-tauri/**'] },
  },
});
