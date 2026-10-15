import { describe, expect, it } from 'vitest';
import { createSalt, hashPin, verifyPin } from './security';

describe('local PIN hashing', () => {
  it('creates a fresh 16-byte salt and a stable SHA-256 hash for its input', async () => {
    const salt = createSalt();
    const secondSalt = createSalt();

    expect(Uint8Array.from(atob(salt), character => character.charCodeAt(0))).toHaveLength(16);
    expect(secondSalt).not.toBe(salt);
    await expect(hashPin('4812', salt)).resolves.toBe(await hashPin('4812', salt));
    await expect(hashPin('4813', salt)).resolves.not.toBe(await hashPin('4812', salt));
  });

  it('verifies the matching PIN and rejects a different PIN or malformed hash length', async () => {
    const salt = createSalt();
    const expected = await hashPin('1357', salt);

    await expect(verifyPin('1357', salt, expected)).resolves.toBe(true);
    await expect(verifyPin('1358', salt, expected)).resolves.toBe(false);
    await expect(verifyPin('1357', salt, 'AA==')).resolves.toBe(false);
  });
});
