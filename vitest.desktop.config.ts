import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vitest/config';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(projectRoot, 'src') } },
  test: {
    environment: 'node',
    include: [
      'src/lib/localFirst/**/*.test.ts',
      'src/pages/LocalFirstApp.test.tsx',
      'src/desktop.test.tsx',
    ],
    coverage: {
      provider: 'v8',
      include: [
        'src/lib/localFirst/**/*.ts',
        'src/pages/LocalFirstApp.tsx',
        'src/desktop.tsx',
      ],
      exclude: [
        'src/lib/localFirst/**/*.test.ts',
        'src/pages/LocalFirstApp.test.tsx',
        'src/desktop.test.tsx',
      ],
      reportsDirectory: 'coverage/desktop',
      reporter: ['text', 'html', 'json-summary'],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
