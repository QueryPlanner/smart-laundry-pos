import { describe, expect, it } from 'vitest';
import type { CounterOrderSummary } from '../counter';
import { dayHeading, groupByDay } from './orderDays';

const order = (id: string, receivedAt: string) => ({ id, receivedAt }) as CounterOrderSummary;

describe('dayHeading', () => {
  it('says Today and Yesterday, and writes any other day out', () => {
    expect(dayHeading('2026-10-20', '2026-10-20')).toBe('Today');
    expect(dayHeading('2026-10-19', '2026-10-20')).toBe('Yesterday');
    expect(dayHeading('2026-10-17', '2026-10-20')).toBe('17 Oct 2026');
    expect(dayHeading('2026-10-31', '2026-11-01')).toBe('Yesterday');
  });
});

describe('groupByDay', () => {
  it('starts a new group when the shop day changes, keeping the list order', () => {
    const groups = groupByDay([
      order('a', '2026-10-20T10:00:00Z'), order('b', '2026-10-20T03:00:00Z'),
      order('c', '2026-10-19T10:00:00Z'), order('d', '2026-10-15T10:00:00Z'),
    ], '2026-10-20');
    expect(groups.map(group => [group.heading, group.orders.map(item => item.id)])).toEqual([
      ['Today', ['a', 'b']], ['Yesterday', ['c']], ['15 Oct 2026', ['d']],
    ]);
  });

  it('uses the shop day, not the UTC day: 20:00 UTC is already the next morning in India', () => {
    const groups = groupByDay([order('late', '2026-10-19T20:00:00Z'), order('early', '2026-10-19T17:00:00Z')], '2026-10-20');
    expect(groups.map(group => group.date)).toEqual(['2026-10-20', '2026-10-19']);
  });

  it('does not merge a day that comes back after another one', () => {
    const groups = groupByDay([order('a', '2026-10-20T10:00:00Z'), order('b', '2026-10-19T10:00:00Z'), order('c', '2026-10-20T09:00:00Z')], '2026-10-20');
    expect(groups.map(group => group.date)).toEqual(['2026-10-20', '2026-10-19', '2026-10-20']);
  });

  it('is empty for no orders', () => {
    expect(groupByDay([], '2026-10-20')).toEqual([]);
  });
});
