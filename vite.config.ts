import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()], publicDir: 'web/public', envDir: 'config',
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: { outDir: 'dist', sourcemap: false },
});
