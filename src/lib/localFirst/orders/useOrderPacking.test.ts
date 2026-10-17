// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CounterPiece, CounterSavedOrder, PieceMatchResult } from '../counter';
import { useOrderPacking } from './useOrderPacking';

const api = vi.hoisted(() => ({
  getCounterOrder: vi.fn(), matchOrderPieces: vi.fn(), updateCounterOrderStatus: vi.fn(),
}));
vi.mock('@/lib/localFirst/counter', () => api);

const piece = (id: string, over: Partial<CounterPiece> = {}): CounterPiece => ({
  id, shortId: `2600001-${id}`, garmentId: 'shirt', garment: 'Shirt', service: 'Wash + Iron',
  position: 1, total: 5, matched: false, packingMatched: false, collectionMatched: false, tagged: true, ...over,
});

/** Two tagged pieces (t1 already packing-matched) and three untagged ironed shirts (u1 and u2 matched). */
const pieces = (): CounterPiece[] => [
  piece('t1', { packingMatched: true, position: 1 }),
  piece('t2', { position: 2 }),
  piece('u1', { tagged: false, service: 'Iron', packingMatched: true }),
  piece('u2', { tagged: false, service: 'Iron', packingMatched: true }),
  piece('u3', { tagged: false, service: 'Iron' }),
];

const orderWith = (over: Partial<CounterSavedOrder> = {}): CounterSavedOrder => ({
  orderId: 'o-1', orderNumber: 'SL-1', receivedAt: '2026-10-15T06:00:00Z', promisedAt: '2026-10-17T11:30:00Z',
  status: 'packing', totalMinor: 4000, paidMinor: 0, balanceMinor: 4000, paymentStatus: 'unpaid', collectedAt: null,
  refundDueMinor: 0, payments: [], pieces: pieces(), printJobs: [], ...over,
});

const matchResult = (over: Partial<PieceMatchResult> = {}): PieceMatchResult => ({
  matchedCount: 5, expectedCount: 5, missingIds: [], duplicateIds: [], wrongOrderIds: [], complete: true, ...over,
});

interface Deferred<T> { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void }
const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

type Props = Parameters<typeof useOrderPacking>[0];
const setup = (initial: Partial<Props> = {}) => {
  const onOrder = vi.fn();
  const onError = vi.fn();
  const onNotice = vi.fn();
  const base: Props = { order: orderWith(), onOrder, onError, onNotice, ...initial };
  const hook = renderHook((props: Props) => useOrderPacking(props), { initialProps: base });
  return { ...hook, onOrder, onError, onNotice };
};

const checkAll = (result: { current: ReturnType<typeof useOrderPacking> }) => {
  act(() => {
    result.current.setCheckedTaggedIds(['t1', 't2']);
    result.current.setUntaggedCounts({ 'shirt|Iron': 3 });
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  api.matchOrderPieces.mockResolvedValue(matchResult());
  api.updateCounterOrderStatus.mockResolvedValue(orderWith({ status: 'ready' }));
  api.getCounterOrder.mockResolvedValue(orderWith({ status: 'ready' }));
});

describe('initial ticks', () => {
  it('ticks tagged pieces that are packing-matched and counts untagged pieces per line', () => {
    const { result } = setup();
    expect(result.current.checkedTaggedIds).toEqual(['t1']);
    expect(result.current.untaggedCounts).toEqual({ 'shirt|Iron': 2 });
    expect(result.current.canSave).toBe(false);
  });

  it('starts with no ticks when no pieces are matched and when there is no order', () => {
    const { result: fresh } = setup({ order: orderWith({ pieces: pieces().map(p => ({ ...p, packingMatched: false })) }) });
    expect(fresh.current.checkedTaggedIds).toEqual([]);
    expect(fresh.current.untaggedCounts).toEqual({ 'shirt|Iron': 0 });

    const { result: none } = setup({ order: null });
    expect(none.current.checkedTaggedIds).toEqual([]);
    expect(none.current.untaggedCounts).toEqual({});
    expect(none.current.canSave).toBe(false);
  });

  it('re-derives the ticks when the order id changes', () => {
    const { result, rerender, onOrder, onError, onNotice } = setup();
    const other = orderWith({
      orderId: 'o-2',
      pieces: pieces().map(p => ({ ...p, packingMatched: p.id === 't2' })),
    });
    rerender({ order: other, onOrder, onError, onNotice });
    expect(result.current.checkedTaggedIds).toEqual(['t2']);
    expect(result.current.untaggedCounts).toEqual({ 'shirt|Iron': 0 });
  });

  it('re-derives the ticks when the order is cleared and then reopened', () => {
    const { result, rerender, onOrder, onError, onNotice } = setup();
    checkAll(result);
    rerender({ order: null, onOrder, onError, onNotice });
    expect(result.current.checkedTaggedIds).toEqual([]);
    rerender({ order: orderWith(), onOrder, onError, onNotice });
    expect(result.current.checkedTaggedIds).toEqual(['t1']);
    expect(result.current.untaggedCounts).toEqual({ 'shirt|Iron': 2 });
  });

  it('keeps the ticks of the same order when it is refreshed with the same pieces', () => {
    const { result, rerender, onOrder, onError, onNotice } = setup();
    checkAll(result);
    // The refreshed copy reports no packing match, so re-deriving would clear the ticks.
    const refreshed = orderWith({ status: 'ready', pieces: pieces().map(p => ({ ...p, packingMatched: false })) });
    rerender({ order: refreshed, onOrder, onError, onNotice });
    expect(result.current.checkedTaggedIds).toEqual(['t1', 't2']);
    expect(result.current.untaggedCounts).toEqual({ 'shirt|Iron': 3 });
    expect(result.current.canSave).toBe(true);
  });
});

describe('ticks and canSave', () => {
  it('lets the setters change the ticks', () => {
    const { result } = setup();
    act(() => result.current.setCheckedTaggedIds(['t2']));
    act(() => result.current.setUntaggedCounts({ 'shirt|Iron': 1 }));
    expect(result.current.checkedTaggedIds).toEqual(['t2']);
    expect(result.current.untaggedCounts).toEqual({ 'shirt|Iron': 1 });
  });

  it('is true only when every piece is checked', () => {
    const { result } = setup();
    act(() => result.current.setCheckedTaggedIds(['t1', 't2']));
    act(() => result.current.setUntaggedCounts({ 'shirt|Iron': 2 }));
    expect(result.current.canSave).toBe(false);
    act(() => result.current.setUntaggedCounts({ 'shirt|Iron': 3 }));
    expect(result.current.canSave).toBe(true);
  });

  it('is false for a cancelled or collected order even when every piece is checked', () => {
    const { result: cancelled } = setup({ order: orderWith({ status: 'cancelled' }) });
    checkAll(cancelled);
    expect(cancelled.current.canSave).toBe(false);

    const { result: collected } = setup({ order: orderWith({ status: 'collected' }) });
    checkAll(collected);
    expect(collected.current.canSave).toBe(false);
  });

  it('is false when there is no order', () => {
    const { result } = setup({ order: null });
    expect(result.current.canSave).toBe(false);
  });
});

describe('save', () => {
  it('matches the pieces, marks the order ready, reloads it and reports success', async () => {
    const { result, onOrder, onError, onNotice } = setup();
    checkAll(result);
    const ready = orderWith({ status: 'ready' });
    api.getCounterOrder.mockResolvedValue(ready);

    await act(() => result.current.save());

    expect(api.matchOrderPieces).toHaveBeenCalledWith('o-1', 'packing', ['t1', 't2', 'u1', 'u2', 'u3']);
    expect(api.updateCounterOrderStatus).toHaveBeenCalledWith('o-1', 'ready');
    expect(api.getCounterOrder).toHaveBeenCalledWith('o-1');
    const match = api.matchOrderPieces.mock.invocationCallOrder[0];
    const status = api.updateCounterOrderStatus.mock.invocationCallOrder[0];
    const reload = api.getCounterOrder.mock.invocationCallOrder[0];
    expect(match).toBeLessThan(status);
    expect(status).toBeLessThan(reload);
    expect(onOrder).toHaveBeenCalledWith(ready);
    expect(onNotice).toHaveBeenCalledWith('Packing checked. Order is ready for pickup.');
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.saving).toBe(false);
  });

  it('does not change the status again when the order is already ready', async () => {
    const { result, onOrder, onNotice } = setup({ order: orderWith({ status: 'ready' }) });
    checkAll(result);

    await act(() => result.current.save());

    expect(api.matchOrderPieces).toHaveBeenCalledTimes(1);
    expect(api.updateCounterOrderStatus).not.toHaveBeenCalled();
    expect(onOrder).toHaveBeenCalledTimes(1);
    expect(onNotice).toHaveBeenCalledWith('Packing checked. Order is ready for pickup.');
  });

  it('does nothing when some pieces are not checked', async () => {
    const { result, onOrder, onError, onNotice } = setup();

    await act(() => result.current.save());

    expect(api.matchOrderPieces).not.toHaveBeenCalled();
    expect(api.updateCounterOrderStatus).not.toHaveBeenCalled();
    expect(onOrder).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onNotice).not.toHaveBeenCalled();
  });

  it('does nothing when there is no order', async () => {
    const { result, onError } = setup({ order: null });

    await act(() => result.current.save());

    expect(api.matchOrderPieces).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not mark the order ready when the match is not complete', async () => {
    const { result, onOrder, onError, onNotice } = setup();
    checkAll(result);
    const incomplete = matchResult({ matchedCount: 4, complete: false, missingIds: ['t2'] });
    api.matchOrderPieces.mockResolvedValue(incomplete);

    await act(() => result.current.save());

    expect(api.updateCounterOrderStatus).not.toHaveBeenCalled();
    expect(api.getCounterOrder).not.toHaveBeenCalled();
    expect(onOrder).not.toHaveBeenCalled();
    expect(onNotice).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Not every piece matched. Check the pieces and save again.' }));
    expect(result.current.saving).toBe(false);
  });

  it('reports a failed match with no status change and no notice', async () => {
    const { result, onOrder, onError, onNotice } = setup();
    checkAll(result);
    const failure = new Error('Match failed');
    api.matchOrderPieces.mockRejectedValue(failure);

    await act(() => result.current.save());

    expect(onError).toHaveBeenCalledWith(failure);
    expect(api.updateCounterOrderStatus).not.toHaveBeenCalled();
    expect(api.getCounterOrder).not.toHaveBeenCalled();
    expect(onOrder).not.toHaveBeenCalled();
    expect(onNotice).not.toHaveBeenCalled();
    expect(result.current.saving).toBe(false);
  });

  it('reports a failed status change with no reload and no notice', async () => {
    const { result, onOrder, onError, onNotice } = setup();
    checkAll(result);
    const failure = new Error('Status failed');
    api.updateCounterOrderStatus.mockRejectedValue(failure);

    await act(() => result.current.save());

    expect(onError).toHaveBeenCalledWith(failure);
    expect(api.getCounterOrder).not.toHaveBeenCalled();
    expect(onOrder).not.toHaveBeenCalled();
    expect(onNotice).not.toHaveBeenCalled();
    expect(result.current.saving).toBe(false);
  });

  it('reports a failed reload with no notice', async () => {
    const { result, onOrder, onError, onNotice } = setup();
    checkAll(result);
    const failure = new Error('Reload failed');
    api.getCounterOrder.mockRejectedValue(failure);

    await act(() => result.current.save());

    expect(onError).toHaveBeenCalledWith(failure);
    expect(onOrder).not.toHaveBeenCalled();
    expect(onNotice).not.toHaveBeenCalled();
    expect(result.current.saving).toBe(false);
  });

  it('reports an order that cannot be reloaded and gives no notice', async () => {
    const { result, onOrder, onError, onNotice } = setup();
    checkAll(result);
    api.getCounterOrder.mockResolvedValue(null);

    await act(() => result.current.save());

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'The order could not be reloaded. Open it again to check its status.' }));
    expect(onOrder).not.toHaveBeenCalled();
    expect(onNotice).not.toHaveBeenCalled();
  });

  it('can save again after a failed attempt', async () => {
    const { result, onOrder } = setup();
    checkAll(result);
    api.matchOrderPieces.mockRejectedValueOnce(new Error('Match failed'));

    await act(() => result.current.save());
    await act(() => result.current.save());

    expect(api.matchOrderPieces).toHaveBeenCalledTimes(2);
    expect(onOrder).toHaveBeenCalledTimes(1);
  });

  it('is single-flight and reports saving while the first call runs', async () => {
    const { result } = setup();
    checkAll(result);
    const match = deferred<PieceMatchResult>();
    api.matchOrderPieces.mockReturnValueOnce(match.promise);

    let first!: Promise<void>;
    act(() => { first = result.current.save(); });
    expect(result.current.saving).toBe(true);

    act(() => { void result.current.save(); });
    expect(api.matchOrderPieces).toHaveBeenCalledTimes(1);

    await act(async () => {
      match.resolve(matchResult());
      await first;
    });
    expect(result.current.saving).toBe(false);
    expect(api.matchOrderPieces).toHaveBeenCalledTimes(1);
  });
});
