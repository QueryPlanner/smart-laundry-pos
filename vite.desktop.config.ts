import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.resolve(projectRoot, 'desktop'),
  base: './',
  publicDir: false,
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(projectRoot, 'src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 8080,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(projectRoot, 'dist-desktop'),
    emptyOutDir: true,
  },
});
