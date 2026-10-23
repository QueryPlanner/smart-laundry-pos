import { describe, expect, it } from 'vitest';
import { MAX_TRAIL, backStep, pushTrail } from './backTrail';

describe('pushTrail', () => {
  it('adds the screen that was left', () => {
    expect(pushTrail(['order'], 'orders', 'detail')).toEqual(['order', 'orders']);
  });

  it('records nothing when the screen does not change, and never mutates the old trail', () => {
    const trail = ['order'];
    expect(pushTrail(trail, 'orders', 'orders')).toEqual(['order']);
    expect(pushTrail(trail, 'orders', 'detail')).not.toBe(trail);
    expect(trail).toEqual(['order']);
  });

  it('forgets the oldest entries past the limit', () => {
    const long = Array.from({ length: MAX_TRAIL }, (_, index) => `p${index}`);
    const next = pushTrail(long, 'last', 'next');
    expect(next).toHaveLength(MAX_TRAIL);
    expect(next[0]).toBe('p1');
    expect(next[MAX_TRAIL - 1]).toBe('last');
  });
});

describe('backStep', () => {
  it('returns the newest entry and the trail before it', () => {
    expect(backStep(['a', 'b', 'c'], () => true)).toEqual({ target: 'c', rest: ['a', 'b'] });
  });

  it('skips entries that cannot be shown and drops them', () => {
    expect(backStep(['a', 'b', 'c'], page => page === 'a')).toEqual({ target: 'a', rest: [] });
  });

  it('is null for an empty trail or when nothing can be shown', () => {
    expect(backStep([], () => true)).toBeNull();
    expect(backStep(['a'], () => false)).toBeNull();
  });
});
