import { describe, expect, it } from 'vitest';
import { formatShopDate, orUndefined, shopMonthStart, shopToday, statusLabel } from './officeFormat';

describe('office formatting helpers', () => {
  it('uses the shop calendar day, not the UTC one, around midnight', () => {
    expect(shopToday(new Date('2026-01-31T18:29:59Z'))).toBe('2026-01-31');
    expect(shopToday(new Date('2026-01-31T18:30:00Z'))).toBe('2026-02-01');
    expect(shopMonthStart(new Date('2026-01-31T18:30:00Z'))).toBe('2026-02-01');
    expect(shopMonthStart(new Date('2026-03-15T05:00:00Z'))).toBe('2026-03-01');
    expect(typeof shopToday()).toBe('string');
  });

  it('formats timestamps and plain dates in shop time', () => {
    expect(formatShopDate('2026-01-05')).toBe('05 Jan 2026');
    expect(formatShopDate('2026-01-31T19:00:00.000Z')).toBe('01 Feb 2026');
    expect(formatShopDate('2026-01-31T10:00:00+00:00')).toBe('31 Jan 2026');
    expect(formatShopDate(null)).toBe('—');
    expect(formatShopDate(undefined)).toBe('—');
    expect(formatShopDate('')).toBe('—');
    expect(formatShopDate('not a date')).toBe('—');
  });

  it('turns status codes into words', () => {
    expect(statusLabel('ready_for_pickup')).toBe('Ready for pickup');
    expect(statusLabel('received')).toBe('Received');
  });

  it('turns blank form values into undefined', () => {
    expect(orUndefined('   ')).toBeUndefined();
    expect(orUndefined(' hi ')).toBe('hi');
  });
});
