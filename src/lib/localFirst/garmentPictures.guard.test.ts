import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GARMENT_PICTURES, pictureSrc } from './garmentPictures';

/**
 * Picture drift guard. The counter shows /garments/<image_key>-transparent.png for every garment the
 * migrations seed, and the desktop build bundles whatever sits in public/garments. A garment whose
 * picture file is missing silently falls back to its first letter, so this fails instead.
 */
const root = fileURLToPath(new URL('../../../', import.meta.url));
const migrationsDir = `${root}src-tauri/migrations/`;

/** The image_key (6th value) of every row in a `garments(...)` INSERT, in any migration. */
const seededImageKeys = (): string[] => {
  const keys = new Set<string>();
  for (const file of readdirSync(migrationsDir).filter(name => name.endsWith('.sql'))) {
    const sql = readFileSync(`${migrationsDir}${file}`, 'utf8');
    const inserts = sql.match(/INSERT (?:OR IGNORE )?INTO garments\([^)]*\) VALUES[\s\S]*?;/g) ?? [];
    for (const insert of inserts) {
      for (const row of insert.matchAll(/\('g-[^']+','[^']+','[^']*','[^']*','[^']*','([^']+)','(?:piece|pair)',\d+\)/g)) keys.add(row[1]);
    }
  }
  return [...keys];
};

describe('garment pictures', () => {
  it('finds the seeded garments, so this guard cannot pass by matching nothing', () => {
    expect(seededImageKeys().length).toBeGreaterThanOrEqual(25);
  });

  it('has a picture file for every seeded garment', () => {
    const missing = seededImageKeys().filter(key => !existsSync(`${root}public/garments/${key}-transparent.png`));
    expect(missing).toEqual([]);
  });

  it('bundles every picture in public/garments into the desktop build', () => {
    const config = readFileSync(`${root}vite.desktop.config.ts`, 'utf8');
    expect(config).toContain("readdir(garmentSource)");
    expect(readdirSync(`${root}public/garments`).filter(name => name.endsWith('-transparent.png')).length).toBeGreaterThanOrEqual(28);
  });

  it('offers every picture added by the catalogue refresh', () => {
    const added = [
      'heavy-saree',
      'shirt-only',
      'polo-tshirt',
      'zip-jacket',
      'saree-blouse',
      'long-kurti',
      'lehenga-cotton',
      'lehenga-heavy',
      'heavy-frock',
      'leather-shoes',
      'bedsheet-single-folded',
      'bedsheet-double-folded',
      'window-curtain',
      'door-curtain',
      'pillow-cover-pair',
      'sofa-cover-fitted',
      'table-cloth-draped',
    ];
    const listed = GARMENT_PICTURES.map(picture => picture.key);
    for (const key of added) expect(listed, key).toContain(key);
  });

  it('registers every picture key used by the catalogue migration', () => {
    const sql = readFileSync(`${migrationsDir}010_catalogue_pictures.sql`, 'utf8');
    const keys = [...sql.matchAll(/image_key = '([^']+)'/g)].map(match => match[1]);
    const listed = GARMENT_PICTURES.map(picture => picture.key);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(listed, key).toContain(key);
  });

  it('records every bundled picture in the asset manifest', () => {
    const manifest = JSON.parse(readFileSync(`${root}public/garments/manifest.json`, 'utf8')) as { assets: Array<{ key: string }> };
    const files = readdirSync(`${root}public/garments`).filter(name => name.endsWith('-transparent.png')).map(name => name.replace('-transparent.png', '')).sort();
    expect(manifest.assets.map(asset => asset.key).sort()).toEqual(files);
  });

  it('offers the administrator every bundled picture, each once, and each with a file', () => {
    const files = readdirSync(`${root}public/garments`).filter(name => name.endsWith('-transparent.png')).map(name => name.replace('-transparent.png', '')).sort();
    const listed = GARMENT_PICTURES.map(picture => picture.key);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(files);
    for (const { key, label } of GARMENT_PICTURES) {
      expect(key, key).toMatch(/^[a-z0-9-]{1,40}$/);
      expect(label.trim().length, key).toBeGreaterThan(0);
      expect(existsSync(`${root}public${pictureSrc(key)}`), key).toBe(true);
    }
  });
});
