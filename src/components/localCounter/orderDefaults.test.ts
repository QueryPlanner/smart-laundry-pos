import { describe, expect, it } from 'vitest';
import { defaultServiceId } from './orderDefaults';
import type { CounterCatalogue } from '@/lib/localFirst/counter';

const catalogue = (keys: Array<'wash' | 'iron' | 'wash_iron' | 'dry_clean'>): CounterCatalogue => ({
  garments: [], rates: [], services: keys.map(key => ({ id: `id-${key}`, key, name: key, active: true })),
});

describe('defaultServiceId', () => {
  it('prefers Wash + Iron wherever it is listed', () => {
    expect(defaultServiceId(catalogue(['wash', 'iron', 'wash_iron']))).toBe('id-wash_iron');
  });
  it('falls back to the first service when Wash + Iron is not offered', () => {
    expect(defaultServiceId(catalogue(['dry_clean', 'wash']))).toBe('id-dry_clean');
  });
  it('is empty before the catalogue loads or when it has no services', () => {
    expect(defaultServiceId(null)).toBe('');
    expect(defaultServiceId(catalogue([]))).toBe('');
  });
});
