// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CounterPaymentMethod, CounterPiece, CounterSavedOrder } from '../counter';
import { useOrderHandover, type HandoverAction } from './useOrderHandover';

const api = vi.hoisted(() => ({
  collectCounterOrder: vi.fn(),
  getCounterOrder: vi.fn(),
  recordCounterPayment: vi.fn(),
  updateCounterOrderStatus: vi.fn(),
}));
vi.mock('../counter', () => api);

const tagged = (id: string, position: number): CounterPiece => ({
  id, shortId: `2610170001-${position}`, garmentId: 'shirt', garment: 'Shirt', service: 'Wash + Iron',
  position, total: 2, matched: false, packingMatched: false, collectionMatched: false, tagged: true,
});
const untagged = (id: string): CounterPiece => ({
  id, shortId: `2610170001-${id}`, garmentId: 'shirt', garment: 'Shirt', service: 'Iron',
  position: 3, total: 4, matched: false, packingMatched: false, collectionMatched: false, tagged: false,
});
const pieces = [tagged('t-1', 1), tagged('t-2', 2), untagged('u-1'), untagged('u-2')];

const order = (over: Partial<CounterSavedOrder> = {}): CounterSavedOrder => ({
  orderId: 'o-1', orderNumber: 'SL-1', receivedAt: '2026-10-15T06:00:00Z', promisedAt: '2026-10-17T11:30:00Z',
  status: 'ready', totalMinor: 4000, paidMinor: 0, balanceMinor: 4000, paymentStatus: 'unpaid', collectedAt: null,
  refundDueMinor: 0, payments: [], pieces, printJobs: [], ...over,
});

const deferred = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

type Props = { current: CounterSavedOrder | null; paymentMethod?: CounterPaymentMethod; reference?: string };

const setup = (initial: Props = { current: order() }) => {
  const money = { receive: vi.fn(async () => true) };
  const onOrder = vi.fn();
  const onError = vi.fn();
  const onNotice = vi.fn();
  const hook = renderHook(
    (p: Props) => useOrderHandover({
      order: p.current, money, onOrder, onError, onNotice,
      paymentMethod: p.paymentMethod, reference: p.reference,
    }),
    { initialProps: initial },
  );
  return { ...hook, money, onOrder, onError, onNotice };
};
type Hook = ReturnType<typeof setup>['result'];

const perform = async (result: Hook, kind: HandoverAction) => {
  await act(async () => { await result.current.perform(kind); });
};

/** The Nth call to the collect API: its order, piece ids, request key and optional payment. */
const collectCall = (index: number) => {
  const [orderId, pieceIds, requestId, payment] = api.collectCounterOrder.mock.calls[index];
  return { orderId, pieceIds, requestId, payment };
};

beforeEach(() => {
  api.collectCounterOrder.mockReset();
  api.getCounterOrder.mockReset();
  api.recordCounterPayment.mockReset();
  api.updateCounterOrderStatus.mockReset();
});

describe('useOrderHandover receive', () => {
  it('delegates to the money form and reports the amount once the order shows the new balance', async () => {
    const { result, rerender, money, onOrder } = setup({ current: order() });

    await perform(result, 'receive');

    expect(money.receive).toHaveBeenCalledTimes(1);
    expect(api.collectCounterOrder).not.toHaveBeenCalled();
    expect(onOrder).not.toHaveBeenCalled();

    rerender({ current: order({ balanceMinor: 1000, paidMinor: 3000, paymentStatus: 'partially_paid' }) });

    expect(result.current.receivedNote).toBe('₹30.00 received');
    expect(result.current.done).toBe(false);
  });

  it('shows no note when the money form did not save a payment', async () => {
    const { result, rerender, money } = setup({ current: order() });
    money.receive.mockResolvedValueOnce(false);

    await perform(result, 'receive');
    rerender({ current: order({ balanceMinor: 1000 }) });

    expect(result.current.receivedNote).toBe('');
  });

  it('shows no note from an order that comes back with the same balance', async () => {
    const { result, rerender } = setup({ current: order() });

    await perform(result, 'receive');
    rerender({ current: order() });

    expect(result.current.receivedNote).toBe('');
  });

  it('waits for an order before showing the note', async () => {
    const { result, rerender } = setup({ current: order() });

    await perform(result, 'receive');
    rerender({ current: null });
    expect(result.current.receivedNote).toBe('');

    rerender({ current: order({ balanceMinor: 0 }) });
    expect(result.current.receivedNote).toBe('₹40.00 received');
  });

  it('keeps the note after another action until reset', async () => {
    api.updateCounterOrderStatus.mockResolvedValue(order({ status: 'ready' }));
    const { result, rerender } = setup({ current: order() });

    await perform(result, 'receive');
    rerender({ current: order({ balanceMinor: 0 }) });
    await perform(result, 'mark_ready');
    expect(result.current.receivedNote).toBe('₹40.00 received');

    act(() => { result.current.reset(); });
    expect(result.current.receivedNote).toBe('');
  });

  it('does nothing without an order', async () => {
    const { result, money } = setup({ current: null });

    await perform(result, 'receive');

    expect(money.receive).not.toHaveBeenCalled();
  });
});

describe('useOrderHandover receive and hand over', () => {
  it('sends one collect call with the balance, the ticked pieces and the request key', async () => {
    const handedOver = order({ status: 'collected', balanceMinor: 0, paidMinor: 4000, collectedAt: '2026-10-17T10:00:00Z' });
    api.collectCounterOrder.mockResolvedValue(handedOver);
    const { result, onOrder, onNotice, money } = setup();
    act(() => {
      result.current.setCheckedTaggedIds(['t-1']);
      result.current.setUntaggedCounts({ 'shirt|Iron': 1 });
    });

    await perform(result, 'receive_and_handover');

    expect(api.collectCounterOrder).toHaveBeenCalledTimes(1);
    expect(collectCall(0)).toEqual({
      orderId: 'o-1',
      pieceIds: ['t-1', 'u-1'],
      requestId: expect.any(String),
      payment: { amountMinor: 4000, method: 'cash', idempotencyKey: expect.any(String) },
    });
    expect(money.receive).not.toHaveBeenCalled();
    expect(onOrder).toHaveBeenCalledWith(handedOver);
    expect(onNotice).toHaveBeenCalledWith('Order handed over.');
    expect(result.current.done).toBe(true);
  });

  it('sends the chosen method and the trimmed reference', async () => {
    api.collectCounterOrder.mockResolvedValue(order({ status: 'collected', balanceMinor: 0 }));
    const { result } = setup({ current: order(), paymentMethod: 'upi', reference: '  UTR9 ' });

    await perform(result, 'receive_and_handover');

    expect(collectCall(0).payment).toEqual({ amountMinor: 4000, method: 'upi', reference: 'UTR9', idempotencyKey: expect.any(String) });
  });

  it('never sends a reference for cash', async () => {
    api.collectCounterOrder.mockResolvedValue(order({ status: 'collected', balanceMinor: 0 }));
    const { result } = setup({ current: order(), reference: 'Counter note' });

    await perform(result, 'receive_and_handover');

    expect(collectCall(0).payment.reference).toBeUndefined();
  });

  it('collects without a payment when nothing is owed', async () => {
    api.collectCounterOrder.mockResolvedValue(order({ status: 'collected', balanceMinor: 0 }));
    const { result } = setup({ current: order({ balanceMinor: 0, paidMinor: 4000 }) });

    await perform(result, 'receive_and_handover');

    expect(api.collectCounterOrder).toHaveBeenCalledWith('o-1', expect.any(Array), expect.any(String));
    expect(api.collectCounterOrder.mock.calls[0]).toHaveLength(3);
    expect(result.current.done).toBe(true);
  });
});

describe('useOrderHandover hand over', () => {
  it('collects without a payment and never touches the money form', async () => {
    api.collectCounterOrder.mockResolvedValue(order({ status: 'collected', balanceMinor: 0 }));
    const { result, money } = setup({ current: order({ balanceMinor: 0, paidMinor: 4000 }) });
    act(() => { result.current.setCheckedTaggedIds(['t-2']); });

    await perform(result, 'handover');

    expect(api.collectCounterOrder.mock.calls[0]).toEqual(['o-1', ['t-2'], expect.any(String)]);
    expect(money.receive).not.toHaveBeenCalled();
    expect(result.current.done).toBe(true);
  });

  it('keeps the request key on retry after a failure, and rotates it after success', async () => {
    api.collectCounterOrder.mockRejectedValueOnce(new Error('Network down')).mockResolvedValue(order({ status: 'collected', balanceMinor: 0 }));
    api.getCounterOrder.mockResolvedValue(order({ balanceMinor: 0 }));
    const { result, onError } = setup({ current: order({ balanceMinor: 0 }) });

    await perform(result, 'handover');
    expect(result.current.error).toBe('Network down');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Network down' }));

    await perform(result, 'handover');
    expect(result.current.done).toBe(true);
    expect(collectCall(1).requestId).toBe(collectCall(0).requestId);

    act(() => { result.current.reset(); });
    await perform(result, 'handover');
    expect(collectCall(2).requestId).not.toBe(collectCall(0).requestId);
  });

  it('keeps the payment key on retry when the balance is unchanged, and rotates it when it changed', async () => {
    api.collectCounterOrder.mockRejectedValue(new Error('Offline'));
    api.getCounterOrder.mockResolvedValueOnce(order()).mockResolvedValueOnce(order({ balanceMinor: 1000, paidMinor: 3000 }));
    const { result } = setup({ current: order() });

    await perform(result, 'receive_and_handover');
    await perform(result, 'receive_and_handover');
    await perform(result, 'receive_and_handover');

    expect(collectCall(1).payment.idempotencyKey).toBe(collectCall(0).payment.idempotencyKey);
    expect(collectCall(2).payment.idempotencyKey).not.toBe(collectCall(1).payment.idempotencyKey);
    expect(collectCall(2).requestId).toBe(collectCall(0).requestId);
  });

  it('shows the order again after a failed collect and does not mark it done', async () => {
    const fresh = order({ balanceMinor: 0, paidMinor: 4000 });
    api.collectCounterOrder.mockRejectedValueOnce('Gate closed');
    api.getCounterOrder.mockResolvedValue(fresh);
    const { result, onOrder, onError } = setup({ current: order() });

    await perform(result, 'handover');

    expect(result.current.error).toBe('Gate closed');
    expect(onError).toHaveBeenCalledWith('Gate closed');
    expect(api.getCounterOrder).toHaveBeenCalledWith('o-1');
    expect(onOrder).toHaveBeenCalledWith(fresh);
    expect(result.current.done).toBe(false);
    expect(result.current.busy).toBe(false);
  });

  it('reports a failed refetch as well as the collect failure', async () => {
    const collectError = new Error('Offline');
    const refetchError = new Error('Still offline');
    api.collectCounterOrder.mockRejectedValueOnce(collectError);
    api.getCounterOrder.mockRejectedValueOnce(refetchError);
    const { result, onError, onOrder } = setup({ current: order() });

    await perform(result, 'handover');

    expect(onError).toHaveBeenNthCalledWith(1, collectError);
    expect(onError).toHaveBeenNthCalledWith(2, refetchError);
    expect(onOrder).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Offline');
  });

  it('shows no fresh order when the refetch finds none', async () => {
    api.collectCounterOrder.mockRejectedValueOnce(new Error('Offline'));
    api.getCounterOrder.mockResolvedValueOnce(null);
    const { result, onOrder } = setup({ current: order() });

    await perform(result, 'handover');

    expect(onOrder).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Offline');
  });

  it('does nothing once the order is handed over, until reset', async () => {
    api.collectCounterOrder.mockResolvedValue(order({ status: 'collected', balanceMinor: 0 }));
    const { result } = setup({ current: order({ balanceMinor: 0 }) });

    await perform(result, 'handover');
    await perform(result, 'handover');
    await perform(result, 'receive_and_handover');

    expect(api.collectCounterOrder).toHaveBeenCalledTimes(1);
  });
});

describe('useOrderHandover mark ready', () => {
  it('moves the order to ready and stays on the screen', async () => {
    const ready = order({ status: 'ready' });
    api.updateCounterOrderStatus.mockResolvedValue(ready);
    const { result, onOrder, onNotice } = setup({ current: order({ status: 'packing' }) });

    await perform(result, 'mark_ready');

    expect(api.updateCounterOrderStatus).toHaveBeenCalledWith('o-1', 'ready');
    expect(onOrder).toHaveBeenCalledWith(ready);
    expect(onNotice).not.toHaveBeenCalled();
    expect(result.current.done).toBe(false);
  });

  it('shows and reports a failure', async () => {
    const failure = new Error('Order is locked');
    api.updateCounterOrderStatus.mockRejectedValueOnce(failure);
    const { result, onOrder, onError } = setup({ current: order({ status: 'packing' }) });

    await perform(result, 'mark_ready');

    expect(result.current.error).toBe('Order is locked');
    expect(onError).toHaveBeenCalledWith(failure);
    expect(onOrder).not.toHaveBeenCalled();
  });
});

describe('useOrderHandover single-flight and state', () => {
  it.each<HandoverAction>(['receive', 'receive_and_handover', 'handover', 'mark_ready'])('%s does nothing without an order', async kind => {
    const { result, money, onOrder } = setup({ current: null });

    await perform(result, kind);

    expect(money.receive).not.toHaveBeenCalled();
    expect(api.collectCounterOrder).not.toHaveBeenCalled();
    expect(api.updateCounterOrderStatus).not.toHaveBeenCalled();
    expect(onOrder).not.toHaveBeenCalled();
  });

  it('ignores a second action while the first is running', async () => {
    const pending = deferred<CounterSavedOrder>();
    api.collectCounterOrder.mockReturnValueOnce(pending.promise);
    const { result } = setup({ current: order({ balanceMinor: 0 }) });

    let first!: Promise<void>;
    act(() => { first = result.current.perform('handover'); });
    expect(result.current.busy).toBe(true);

    await perform(result, 'mark_ready');
    expect(api.updateCounterOrderStatus).not.toHaveBeenCalled();

    await act(async () => { pending.resolve(order({ status: 'collected', balanceMinor: 0 })); });
    await first;
    expect(result.current.busy).toBe(false);
    expect(result.current.done).toBe(true);
    expect(api.collectCounterOrder).toHaveBeenCalledTimes(1);
  });

  it('clears the ticks, note, message and done state on reset', async () => {
    api.collectCounterOrder.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(order({ status: 'collected', balanceMinor: 0 }));
    api.getCounterOrder.mockResolvedValue(order({ balanceMinor: 0 }));
    const { result, rerender, money } = setup({ current: order() });
    act(() => {
      result.current.setCheckedTaggedIds(['t-1']);
      result.current.setUntaggedCounts({ 'shirt|Iron': 2 });
    });
    await perform(result, 'receive');
    rerender({ current: order({ balanceMinor: 0 }) });
    await perform(result, 'handover');
    expect(result.current.error).toBe('Offline');
    expect(money.receive).toHaveBeenCalledTimes(1);

    await perform(result, 'handover');
    expect(result.current.done).toBe(true);

    act(() => { result.current.reset(); });

    expect(result.current).toMatchObject({ checkedTaggedIds: [], untaggedCounts: {}, receivedNote: '', error: '', done: false });
  });

  it('sends the ids of the ticked tagged pieces and the first untagged pieces of each line', async () => {
    api.collectCounterOrder.mockResolvedValue(order({ status: 'collected', balanceMinor: 0 }));
    const { result } = setup({ current: order({ balanceMinor: 0 }) });
    act(() => {
      result.current.setCheckedTaggedIds(['t-2', 'unknown', 't-2']);
      result.current.setUntaggedCounts({ 'shirt|Iron': 1 });
    });

    await perform(result, 'handover');

    expect(collectCall(0).pieceIds).toEqual(['t-2', 'u-1']);
  });
});
