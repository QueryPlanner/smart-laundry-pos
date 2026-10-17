// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CounterOrderSummary, CounterQueueCounts } from '../counter';
import { useOrderList } from './useOrderList';

const api = vi.hoisted(() => ({ searchCounterOrders: vi.fn(), getCounterOrderQueueCounts: vi.fn() }));
vi.mock('@/lib/localFirst/counter', () => api);

const summary = (id: string): CounterOrderSummary => ({
  id, orderNumber: `2026101700${id}`, customerName: 'Rita Joshi', customerPhone: '9876543210', status: 'ready',
  receivedAt: '2026-10-17T05:00:00Z', promisedAt: '2026-10-17T11:30:00Z', totalMinor: 10000, paidMinor: 3000,
  balanceMinor: 7000, pieceCount: 3, paymentStatus: 'partially_paid', overdue: false, untaggedCount: 0, matchReason: null,
});
const page = (size: number, from = 0): CounterOrderSummary[] => Array.from({ length: size }, (_, i) => summary(String(from + i)));
const countsOf = (over: Partial<CounterQueueCounts> = {}): CounterQueueCounts => ({
  ready: 2, balanceDue: 3, overdue: 1, inProcess: 4, today: 5, all: 9, balanceDueMinor: 12000, ...over,
});

interface Deferred<T> { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void }
const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const setup = (initial: { active?: boolean; debounceMs?: number } = {}) => {
  const onError = vi.fn();
  const hook = renderHook((props: { active: boolean }) => useOrderList({ ...props, onError, debounceMs: initial.debounceMs }), {
    initialProps: { active: initial.active ?? true },
  });
  return { ...hook, onError };
};
/** Let timers and promise callbacks run. */
const settle = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  api.getCounterOrderQueueCounts.mockResolvedValue(countsOf());
  api.searchCounterOrders.mockResolvedValue(page(3));
});
afterEach(() => { vi.useRealTimers(); });

describe('while the Orders page is not showing', () => {
  it('fetches nothing and shows nothing', async () => {
    const { result } = setup({ active: false });
    await settle(1000);
    expect(api.getCounterOrderQueueCounts).not.toHaveBeenCalled();
    expect(api.searchCounterOrders).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ results: [], counts: null, loading: false, hasMore: false, segment: 'ready', query: '' });
  });

  it('starts fetching when the page becomes active and stops showing a spinner when it is left', async () => {
    const pending = deferred<CounterOrderSummary[]>();
    api.searchCounterOrders.mockReturnValueOnce(pending.promise);
    const { result, rerender } = setup({ active: false });
    rerender({ active: true });
    await settle();
    expect(result.current.loading).toBe(true);
    rerender({ active: false });
    await settle();
    expect(result.current.loading).toBe(false);
    pending.resolve(page(2));
    await settle();
    expect(result.current.results).toEqual([]);
  });
});

describe('the first load', () => {
  it('fetches the counts and the first page of the ready segment', async () => {
    const { result } = setup();
    expect(result.current.loading).toBe(true);
    await settle();
    expect(api.getCounterOrderQueueCounts).toHaveBeenCalledTimes(1);
    expect(api.searchCounterOrders).toHaveBeenCalledWith('', 0, 50, 'ready');
    expect(result.current.counts).toEqual(countsOf());
    expect(result.current.results).toHaveLength(3);
    expect(result.current.loading).toBe(false);
    expect(result.current.hasMore).toBe(false);
  });

  it('opens on In process when nothing is ready and the cashier has not chosen a segment', async () => {
    api.getCounterOrderQueueCounts.mockResolvedValue(countsOf({ ready: 0 }));
    const { result } = setup();
    await settle();
    expect(result.current.segment).toBe('in_process');
    // The switch re-fetches the list for the new segment in a second step.
    await settle();
    expect(api.searchCounterOrders).toHaveBeenLastCalledWith('', 0, 50, 'in_process');
  });

  it('keeps Ready when something is ready', async () => {
    const { result } = setup();
    await settle();
    expect(result.current.segment).toBe('ready');
  });

  it('never overrides a segment the cashier already chose', async () => {
    api.getCounterOrderQueueCounts.mockResolvedValue(countsOf({ ready: 0 }));
    const { result } = setup();
    act(() => result.current.setSegment('balance_due'));
    await settle();
    expect(result.current.segment).toBe('balance_due');
  });

  it('makes the automatic choice only once, not on every reload', async () => {
    api.getCounterOrderQueueCounts.mockResolvedValue(countsOf({ ready: 0 }));
    const { result } = setup();
    await settle();
    expect(result.current.segment).toBe('in_process');
    act(() => result.current.setSegment('today'));
    await settle();
    api.getCounterOrderQueueCounts.mockResolvedValue(countsOf({ ready: 0 }));
    act(() => result.current.reload());
    await settle();
    expect(result.current.segment).toBe('today');
  });
});

describe('searching', () => {
  it('searches the trimmed text across every order whatever the segment', async () => {
    const { result } = setup();
    await settle();
    act(() => result.current.setSegment('balance_due'));
    await settle();
    act(() => result.current.setQuery('  rita  '));
    await settle(180);
    expect(api.searchCounterOrders).toHaveBeenLastCalledWith('rita', 0, 50, 'all');
  });

  it('waits for typing to pause: a burst of keystrokes causes one search', async () => {
    const { result } = setup();
    await settle();
    api.searchCounterOrders.mockClear();
    act(() => result.current.setQuery('r'));
    await settle(100);
    act(() => result.current.setQuery('ri'));
    await settle(100);
    act(() => result.current.setQuery('rit'));
    await settle(179);
    expect(api.searchCounterOrders).not.toHaveBeenCalled();
    await settle(1);
    expect(api.searchCounterOrders).toHaveBeenCalledTimes(1);
    expect(api.searchCounterOrders).toHaveBeenCalledWith('rit', 0, 50, 'all');
  });

  it('honours a custom pause length', async () => {
    const { result } = setup({ debounceMs: 20 });
    await settle();
    api.searchCounterOrders.mockClear();
    act(() => result.current.setQuery('rita'));
    await settle(20);
    expect(api.searchCounterOrders).toHaveBeenCalledTimes(1);
  });

  it('does not wait when a segment is picked or the text is cleared', async () => {
    const { result } = setup();
    await settle();
    api.searchCounterOrders.mockClear();
    act(() => result.current.setSegment('overdue'));
    await settle();
    expect(api.searchCounterOrders).toHaveBeenLastCalledWith('', 0, 50, 'overdue');
    act(() => result.current.setQuery('rita'));
    await settle(180);
    act(() => result.current.setQuery(''));
    await settle();
    expect(api.searchCounterOrders).toHaveBeenLastCalledWith('', 0, 50, 'overdue');
  });

  it('ignores an older answer that arrives after a newer one', async () => {
    const slow = deferred<CounterOrderSummary[]>();
    const { result } = setup();
    await settle();
    api.searchCounterOrders.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(page(1, 40));
    act(() => result.current.setSegment('today'));
    await settle();
    act(() => result.current.setSegment('all'));
    await settle();
    expect(result.current.results.map(order => order.id)).toEqual(['40']);
    slow.resolve(page(5));
    await settle();
    expect(result.current.results.map(order => order.id)).toEqual(['40']);
    expect(result.current.loading).toBe(false);
  });
});

describe('more pages', () => {
  it('says there is more only when exactly a full page came back', async () => {
    api.searchCounterOrders.mockResolvedValue(page(50));
    const { result } = setup();
    await settle();
    expect(result.current.hasMore).toBe(true);
  });

  it('appends the next page after the ones already shown and stops when a short page comes back', async () => {
    api.searchCounterOrders.mockResolvedValueOnce(page(50)).mockResolvedValueOnce(page(10, 50));
    const { result } = setup();
    await settle();
    act(() => result.current.loadMore());
    expect(result.current.loading).toBe(true);
    await settle();
    expect(api.searchCounterOrders).toHaveBeenLastCalledWith('', 50, 50, 'ready');
    expect(result.current.results).toHaveLength(60);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it('keeps going while full pages keep coming', async () => {
    api.searchCounterOrders.mockResolvedValueOnce(page(50)).mockResolvedValueOnce(page(50, 50));
    const { result } = setup();
    await settle();
    act(() => result.current.loadMore());
    await settle();
    expect(result.current.hasMore).toBe(true);
  });

  it('does nothing when there is no more, when inactive, or while a load is running', async () => {
    const { result, rerender } = setup();
    await settle();
    act(() => result.current.loadMore());
    expect(api.searchCounterOrders).toHaveBeenCalledTimes(1);

    api.searchCounterOrders.mockResolvedValue(page(50));
    act(() => result.current.reload());
    await settle();
    const more = deferred<CounterOrderSummary[]>();
    api.searchCounterOrders.mockReturnValueOnce(more.promise);
    act(() => result.current.loadMore());
    act(() => result.current.loadMore());
    expect(api.searchCounterOrders).toHaveBeenCalledTimes(3);
    more.resolve(page(1, 50));
    await settle();

    rerender({ active: false });
    await settle();
    act(() => result.current.loadMore());
    expect(api.searchCounterOrders).toHaveBeenCalledTimes(3);
  });

  it('does not start a second load while the first page is still arriving', async () => {
    api.searchCounterOrders.mockResolvedValue(page(50));
    const { result } = setup();
    await settle();
    const slow = deferred<CounterOrderSummary[]>();
    api.searchCounterOrders.mockReturnValueOnce(slow.promise);
    act(() => result.current.setSegment('today'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.loading).toBe(true);
    act(() => result.current.loadMore());
    expect(api.searchCounterOrders).toHaveBeenCalledTimes(2);
    slow.resolve(page(2));
    await settle();
  });

  it('drops a next page that arrives after the question changed', async () => {
    api.searchCounterOrders.mockResolvedValueOnce(page(50));
    const { result } = setup();
    await settle();
    const late = deferred<CounterOrderSummary[]>();
    api.searchCounterOrders.mockReturnValueOnce(late.promise).mockResolvedValueOnce(page(2, 90));
    act(() => result.current.loadMore());
    act(() => result.current.setSegment('today'));
    await settle();
    late.resolve(page(50, 100));
    await settle();
    expect(result.current.results.map(order => order.id)).toEqual(['90', '91']);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it('drops a next-page failure that arrives after the question changed', async () => {
    api.searchCounterOrders.mockResolvedValueOnce(page(50));
    const { result, onError } = setup();
    await settle();
    const late = deferred<CounterOrderSummary[]>();
    api.searchCounterOrders.mockReturnValueOnce(late.promise).mockResolvedValueOnce(page(1, 90));
    act(() => result.current.loadMore());
    act(() => result.current.setSegment('today'));
    await settle();
    late.reject(new Error('too late'));
    await settle();
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });
});

describe('reloading', () => {
  it('fetches the counts and the first page again', async () => {
    const { result } = setup();
    await settle();
    api.getCounterOrderQueueCounts.mockResolvedValue(countsOf({ ready: 7 }));
    api.searchCounterOrders.mockResolvedValue(page(1, 70));
    act(() => result.current.reload());
    await settle();
    expect(result.current.counts?.ready).toBe(7);
    expect(result.current.results.map(order => order.id)).toEqual(['70']);
  });
});

describe('resetting', () => {
  it('forgets the text, the segment, the counts and the orders, and lets the automatic choice happen again', async () => {
    api.getCounterOrderQueueCounts.mockResolvedValue(countsOf({ ready: 0 }));
    const { result } = setup();
    await settle();
    await settle();
    act(() => result.current.setQuery('rita'));
    act(() => result.current.setSegment('today'));
    await settle(180);
    expect(result.current.segment).toBe('today');
    api.searchCounterOrders.mockResolvedValue(page(50));
    act(() => result.current.reset());
    expect(result.current).toMatchObject({ query: '', segment: 'ready', counts: null, results: [], hasMore: false });
    await settle();
    await settle();
    // Nothing was ready, and the cashier has not chosen anything since the reset: In process opens again.
    expect(result.current.segment).toBe('in_process');
  });
});

describe('failures', () => {
  it('reports a counts failure and keeps going', async () => {
    api.getCounterOrderQueueCounts.mockRejectedValue(new Error('counts down'));
    const { result, onError } = setup();
    await settle();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'counts down' }));
    expect(result.current.counts).toBeNull();
    expect(result.current.results).toHaveLength(3);
  });

  it('reports a list failure and stops the spinner', async () => {
    api.searchCounterOrders.mockRejectedValue(new Error('list down'));
    const { result, onError } = setup();
    await settle();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'list down' }));
    expect(result.current.loading).toBe(false);
  });

  it('reports a next-page failure and allows another try', async () => {
    api.searchCounterOrders.mockResolvedValueOnce(page(50)).mockRejectedValueOnce(new Error('page down'));
    const { result, onError } = setup();
    await settle();
    act(() => result.current.loadMore());
    await settle();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'page down' }));
    expect(result.current.loading).toBe(false);
    api.searchCounterOrders.mockResolvedValueOnce(page(2, 50));
    act(() => result.current.loadMore());
    await settle();
    expect(result.current.results).toHaveLength(52);
  });

  it('ignores a failure that arrives after the question changed', async () => {
    const slow = deferred<CounterOrderSummary[]>();
    api.searchCounterOrders.mockReturnValueOnce(slow.promise);
    const { result, onError } = setup();
    await settle();
    api.searchCounterOrders.mockResolvedValueOnce(page(1, 60));
    act(() => result.current.setSegment('today'));
    await settle();
    slow.reject(new Error('stale failure'));
    await settle();
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.results.map(order => order.id)).toEqual(['60']);
  });

  it('ignores counts that arrive after the page was left', async () => {
    const slow = deferred<CounterOrderSummary[]>();
    const slowCounts = deferred<CounterQueueCounts>();
    api.getCounterOrderQueueCounts.mockReturnValueOnce(slowCounts.promise);
    api.searchCounterOrders.mockReturnValueOnce(slow.promise);
    const { result, rerender, onError } = setup();
    rerender({ active: false });
    await settle();
    slowCounts.resolve(countsOf({ ready: 0 }));
    await settle();
    expect(result.current.counts).toBeNull();
    expect(result.current.segment).toBe('ready');
    expect(onError).not.toHaveBeenCalled();
  });

  it('ignores a counts failure that arrives after the page was left', async () => {
    const slowCounts = deferred<CounterQueueCounts>();
    api.getCounterOrderQueueCounts.mockReturnValueOnce(slowCounts.promise);
    const { rerender, onError } = setup();
    rerender({ active: false });
    await settle();
    slowCounts.reject(new Error('late counts failure'));
    await settle();
    expect(onError).not.toHaveBeenCalled();
  });
});
