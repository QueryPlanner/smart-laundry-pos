import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const desktopOutput = path.resolve(projectRoot, 'dist-desktop');
const garmentAssetNames = [
  'blouse-transparent.png',
  'dhoti-transparent.png',
  'dress-transparent.png',
  'dupatta-transparent.png',
  'jacket-transparent.png',
  'jeans-transparent.png',
  'kurta-transparent.png',
  'leggings-transparent.png',
  'lungi-transparent.png',
  'petticoat-transparent.png',
  'pyjama-transparent.png',
  'salwar-transparent.png',
  'saree-transparent.png',
  'shirt-transparent.png',
  'shoes-transparent.png',
  'shorts-transparent.png',
  'sweater-transparent.png',
  'trousers-transparent.png',
  'tshirt-transparent.png',
];

export default defineConfig({
  root: path.resolve(projectRoot, 'desktop'),
  base: './',
  publicDir: false,
  plugins: [
    react(),
    {
      name: 'bundle-counter-garment-assets',
      apply: 'build',
      async closeBundle() {
        const garmentOutput = path.join(desktopOutput, 'garments');
        await mkdir(garmentOutput, { recursive: true });
        await Promise.all(
          garmentAssetNames.map((assetName) =>
            copyFile(
              path.join(projectRoot, 'public', 'garments', assetName),
              path.join(garmentOutput, assetName),
            ),
          ),
        );
      },
    },
  ],
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
    outDir: desktopOutput,
    emptyOutDir: true,
  },
});
