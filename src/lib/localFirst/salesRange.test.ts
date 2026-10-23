import { describe, expect, it } from 'vitest';
import {
  addDays, allowedBuckets, autoBucket, bucketLabel, bucketTick, formatDay, formatLocal, formatShopDateTime, joinLocal, lastDaysRange,
  methodText, presetRange, rangeProblem, shopDateOf, spanDays, splitLocal,
} from './salesRange';

// 15 March 2026, 00:30 in shop time = 14 March 19:00 UTC.
const justAfterMidnight = new Date('2026-03-14T19:00:00Z');

describe('shop calendar', () => {
  it('works out the shop day whatever the computer zone is', () => {
    expect(shopDateOf(justAfterMidnight)).toBe('2026-03-15');
    expect(shopDateOf(new Date('2026-03-14T18:29:59Z'))).toBe('2026-03-14');
    expect(shopDateOf(new Date('2026-03-14T18:30:00Z'))).toBe('2026-03-15');
  });

  it('shifts days across month and year ends', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });
});

describe('presets', () => {
  it('uses shop midnight to shop midnight', () => {
    expect(presetRange('today', justAfterMidnight)).toEqual({ from: '2026-03-15T00:00', to: '2026-03-16T00:00' });
    expect(presetRange('yesterday', justAfterMidnight)).toEqual({ from: '2026-03-14T00:00', to: '2026-03-15T00:00' });
    expect(presetRange('last7', justAfterMidnight)).toEqual({ from: '2026-03-09T00:00', to: '2026-03-16T00:00' });
    expect(presetRange('month', justAfterMidnight)).toEqual({ from: '2026-03-01T00:00', to: '2026-04-01T00:00' });
  });

  it('rolls the month window over a year end', () => {
    expect(presetRange('month', new Date('2025-12-20T06:00:00Z'))).toEqual({ from: '2025-12-01T00:00', to: '2026-01-01T00:00' });
  });

  it('builds the dashboard window of the last days including today', () => {
    expect(lastDaysRange('2026-03-15', 14)).toEqual({ from: '2026-03-02T00:00', to: '2026-03-16T00:00' });
    expect(spanDays(lastDaysRange('2026-03-15', 14))).toBe(14);
  });
});

describe('range checks and buckets', () => {
  it('explains why a range cannot be queried', () => {
    expect(rangeProblem({ from: '', to: '2026-03-02T00:00' })).toContain('start and an end');
    expect(rangeProblem({ from: '2026-03-01T00:00', to: '2026-03-02' })).toContain('start and an end');
    expect(rangeProblem({ from: '2026-13-01T00:00', to: '2026-14-02T00:00' })).toContain('start and an end');
    expect(rangeProblem({ from: '2026-03-02T00:00', to: '2026-03-02T00:00' })).toContain('after the start');
    expect(rangeProblem({ from: '2000-01-01T00:00', to: '2026-03-02T00:00' })).toContain('10 years');
    expect(rangeProblem({ from: '2026-03-01T00:00', to: '2026-03-01T00:01' })).toBeNull();
  });

  it('picks hours for a day or two, days for a quarter, months beyond', () => {
    const range = (from: string, to: string) => ({ from, to });
    expect(autoBucket(range('2026-03-05T00:00', '2026-03-06T00:00'))).toBe('hour');
    expect(autoBucket(range('2026-03-05T00:00', '2026-03-07T00:00'))).toBe('hour');
    expect(autoBucket(range('2026-03-05T00:00', '2026-03-07T00:01'))).toBe('day');
    expect(autoBucket(range('2026-01-01T00:00', '2026-04-03T00:00'))).toBe('day');
    expect(autoBucket(range('2026-01-01T00:00', '2026-04-04T00:00'))).toBe('month');
  });

  it('offers only the buckets the native query accepts', () => {
    expect(allowedBuckets({ from: '2026-03-05T00:00', to: '2026-03-06T00:00' })).toEqual(['hour', 'day', 'month']);
    expect(allowedBuckets({ from: '2026-01-01T00:00', to: '2026-03-01T00:00' })).toEqual(['day', 'month']);
    expect(allowedBuckets({ from: '2024-01-01T00:00', to: '2026-03-01T00:00' })).toEqual(['month']);
  });

  it('splits and joins date and time inputs', () => {
    expect(splitLocal('2026-03-05T09:30')).toEqual({ date: '2026-03-05', time: '09:30' });
    expect(joinLocal('2026-03-05', '09:30')).toBe('2026-03-05T09:30');
  });
});

describe('labels', () => {
  it('names buckets in full and for an axis', () => {
    expect(bucketLabel('2026-03-05T14:00', 'hour')).toBe('5 Mar, 2 pm');
    expect(bucketLabel('2026-03-05T00:00', 'hour')).toBe('5 Mar, 12 am');
    expect(bucketLabel('2026-03-05T12:00', 'hour')).toBe('5 Mar, 12 pm');
    expect(bucketLabel('2026-03-05', 'day')).toBe('5 Mar');
    expect(bucketLabel('2026-03', 'month')).toBe('Mar 2026');
    expect(bucketTick('2026-03-05T09:00', 'hour')).toBe('9 am');
    expect(bucketTick('2026-03-05', 'day')).toBe('5 Mar');
    expect(bucketTick('2026-12', 'month')).toBe('Dec');
  });

  it('formats stored timestamps in shop time, in every stored shape', () => {
    expect(formatShopDateTime('2026-03-05T09:00:00.000Z')).toMatch(/05 Mar 2026.*2:30\s?pm/i);
    expect(formatShopDateTime('2026-03-05T09:00:00+00:00')).toMatch(/2:30\s?pm/i);
    expect(formatShopDateTime('2026-03-05 09:00:00')).toMatch(/2:30\s?pm/i);
    expect(formatShopDateTime('2026-03-04T18:30:00.000Z')).toMatch(/05 Mar 2026.*12:00\s?am/i);
    expect(formatShopDateTime('not a time')).toBe('—');
    expect(formatShopDateTime(null)).toBe('—');
    expect(formatShopDateTime(undefined)).toBe('—');
    expect(formatShopDateTime('')).toBe('—');
  });

  it('formats a shop-local range edge without any time zone shift', () => {
    expect(formatLocal('2026-03-05T14:30')).toMatch(/05 Mar 2026.*2:30\s?pm/i);
    expect(formatLocal('2026-03-06T00:00')).toMatch(/06 Mar 2026.*12:00\s?am/i);
  });

  it('formats a shop day on its own', () => {
    expect(formatDay('2026-03-05')).toBe('05 Mar 2026');
    expect(formatDay('2026-01-01')).toBe('01 Jan 2026');
  });

  it('shows readable payment methods, and passes unknown ones through', () => {
    expect(methodText('bank_transfer')).toBe('Bank transfer');
    expect(methodText('credit')).toContain('Credit');
    expect(methodText('voucher')).toBe('voucher');
  });
});
