import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
});
