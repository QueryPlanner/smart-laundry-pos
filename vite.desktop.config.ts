import { copyFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const desktopOutput = path.resolve(projectRoot, 'dist-desktop');
/** Every garment picture in public/garments is bundled, so a new picture needs no edit here. */
const isGarmentPicture = (fileName: string) => fileName.endsWith('-transparent.png');

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
        const garmentSource = path.join(projectRoot, 'public', 'garments');
        const assetNames = (await readdir(garmentSource)).filter(isGarmentPicture);
        await Promise.all(
          assetNames.map((assetName) =>
            copyFile(
              path.join(garmentSource, assetName),
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
