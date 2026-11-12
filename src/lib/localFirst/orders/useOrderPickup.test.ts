// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CounterOrderLine, CounterSavedOrder } from '../counter';
import { errorText, PaymentKey, useOrderPickup } from './useOrderPickup';

const api = vi.hoisted(() => ({ getCounterOrder: vi.fn(), handOverCounterItems: vi.fn(), recordCounterPayment: vi.fn(), recordCounterSplitPayment: vi.fn() }));
vi.mock('../counter', () => api);

const line = (itemId: string, pieceCount: number, lineTotalMinor: number, handedOverCount = 0): CounterOrderLine => ({
  itemId, garment: 'Shirt', service: 'Iron', quantity: pieceCount, unitPriceMinor: lineTotalMinor / pieceCount, lineTotalMinor, pieceCount, handedOverCount,
});
// 3 shirts ironed (₹30) and 2 dry cleaned (₹200).
const order = (over: Partial<CounterSavedOrder> = {}): CounterSavedOrder => ({
  orderId: 'o-1', orderNumber: 'SL-1', customerName: 'Rita', customerPhone: '9876543210', receivedAt: '2026-10-15T06:00:00Z', promisedAt: '2026-10-17T11:30:00Z',
  status: 'received', totalMinor: 23000, paidMinor: 0, balanceMinor: 23000, paymentStatus: 'unpaid', collectedAt: null,
  refundDueMinor: 0, payments: [], lines: [line('iron', 3, 3000), line('dry', 2, 20000)], pieces: [], printJobs: [], ...over,
});

const setup = (current = order()) => {
  const onOrder = vi.fn();
  const onError = vi.fn();
  const onNotice = vi.fn();
  const hook = renderHook(({ value }: { value: CounterSavedOrder }) => useOrderPickup({ order: value, onOrder, onError, onNotice }), { initialProps: { value: current } });
  return { ...hook, onOrder, onError, onNotice };
};
const submit = async (result: { current: ReturnType<typeof useOrderPickup> }) => { await act(async () => { await result.current.submit(); }); };

beforeEach(() => {
  vi.clearAllMocks();
  let n = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => `key-${++n}` as ReturnType<typeof crypto.randomUUID>);
});

describe('useOrderPickup choosing', () => {
  it('starts with every waiting line ticked and the whole balance asked for', () => {
    const { result } = setup(order({ lines: [line('gone', 1, 0, 1), line('iron', 3, 3000), line('dry', 2, 20000)], totalMinor: 23000 }));
    expect(result.current.chosen).toEqual(['iron', 'dry']);
    expect(result.current.amount).toBe('230.00');
    expect(result.current.action).toBe('Receive ₹230.00 and hand over 5 pieces');
    expect(result.current.problem).toBe('');
  });

  it('follows the ticks with the share of the chosen lines until an amount is typed', () => {
    const { result } = setup();
    act(() => result.current.toggle('dry'));
    expect(result.current.chosen).toEqual(['iron']);
    expect(result.current.amount).toBe('30.00');
    act(() => result.current.setAmount('0'));
    expect(result.current.action).toBe('Hand over 3 pieces');
    act(() => result.current.toggle('dry'));
    expect(result.current.amount).toBe('0');
    expect(result.current.problem).toContain('take the whole balance first (₹230.00 more)');
  });

  it('can take money without handing anything over, and asks for something to do', () => {
    const { result } = setup();
    act(() => { result.current.toggle('iron'); result.current.toggle('dry'); });
    expect(result.current.amount).toBe('');
    expect(result.current.action).toBe('Hand over');
    expect(result.current.problem).toBe('Tick what the customer is taking, or enter an amount.');
    act(() => result.current.setAmount('50'));
    expect(result.current.action).toBe('Receive ₹50.00');
    expect(result.current.problem).toBe('');
  });

  it('refuses an amount that is not a number or is more than the balance', () => {
    const { result } = setup();
    act(() => result.current.setAmount('12.345'));
    expect(result.current.problem).toBe('Enter the amount as a number such as 240 or 240.50.');
    act(() => result.current.setAmount('231'));
    expect(result.current.problem).toBe('The amount cannot be more than the balance of ₹230.00.');
  });

  it('says 1 piece for a single garment', () => {
    const { result } = setup(order({ lines: [line('one', 1, 1000)], totalMinor: 1000, balanceMinor: 0 }));
    expect(result.current.action).toBe('Hand over 1 piece');
  });
});

describe('useOrderPickup submit', () => {
  it('records the payment first, then hands the chosen lines over, and starts afresh', async () => {
    const paid = order({ paidMinor: 3000, balanceMinor: 20000 });
    const after = order({ paidMinor: 3000, balanceMinor: 20000, lines: [line('iron', 3, 3000, 3), line('dry', 2, 20000)] });
    api.recordCounterPayment.mockResolvedValue(paid);
    api.handOverCounterItems.mockResolvedValue(after);
    const { result, onOrder, onNotice, rerender } = setup();
    act(() => { result.current.toggle('dry'); result.current.setMethod('upi'); });
    await submit(result);
    expect(api.recordCounterPayment).toHaveBeenCalledWith('o-1', { amountMinor: 3000, method: 'upi', idempotencyKey: 'key-1' });
    expect(api.handOverCounterItems).toHaveBeenCalledWith('o-1', ['iron']);
    expect(onOrder.mock.calls.map(call => call[0])).toEqual([paid, after]);
    expect(onNotice).toHaveBeenCalledWith('Received ₹30.00. 3 pieces handed over.');
    rerender({ value: after });
    expect(result.current.chosen).toEqual(['dry']);
    expect(result.current.amount).toBe('200.00');
  });

  it('hands over without a payment when nothing is typed, and says when the order is collected', async () => {
    const done = order({ status: 'collected', paidMinor: 23000, balanceMinor: 0, lines: [line('iron', 3, 3000, 3), line('dry', 2, 20000, 2)] });
    api.handOverCounterItems.mockResolvedValue(done);
    const { result, onNotice } = setup(order({ paidMinor: 23000, balanceMinor: 0 }));
    await submit(result);
    expect(api.recordCounterPayment).not.toHaveBeenCalled();
    expect(onNotice).toHaveBeenCalledWith('5 pieces handed over. Order collected.');
  });

  it('takes a payment alone, without handing anything over', async () => {
    api.recordCounterPayment.mockResolvedValue(order({ paidMinor: 5000, balanceMinor: 18000 }));
    const { result, onNotice } = setup();
    act(() => { result.current.toggle('iron'); result.current.toggle('dry'); result.current.setAmount('50'); });
    await submit(result);
    expect(api.handOverCounterItems).not.toHaveBeenCalled();
    expect(onNotice).toHaveBeenCalledWith('Received ₹50.00.');
  });

  it('leaves out a ticked line that has already gone in the meantime', async () => {
    api.handOverCounterItems.mockResolvedValue(order());
    const { result, rerender } = setup(order({ balanceMinor: 0, paidMinor: 23000 }));
    rerender({ value: order({ balanceMinor: 0, paidMinor: 23000, lines: [line('iron', 3, 3000, 3), line('dry', 2, 20000)] }) });
    await submit(result);
    expect(api.handOverCounterItems).toHaveBeenCalledWith('o-1', ['dry']);
  });

  it('does nothing while there is a problem, or while the first tap is still running', async () => {
    const { result } = setup();
    act(() => result.current.setAmount('abc'));
    await submit(result);
    expect(api.recordCounterPayment).not.toHaveBeenCalled();
    act(() => { result.current.toggle('dry'); result.current.setAmount('10'); });
    let finish: (value: CounterSavedOrder) => void = () => undefined;
    api.recordCounterPayment.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    api.handOverCounterItems.mockResolvedValue(order());
    let first: Promise<void> = Promise.resolve();
    act(() => { first = result.current.submit(); });
    expect(result.current.busy).toBe(true);
    await act(async () => { await result.current.submit(); });
    expect(api.recordCounterPayment).toHaveBeenCalledTimes(1);
    await act(async () => { finish(order()); await first; });
    expect(result.current.busy).toBe(false);
  });

  it('reports a failure, shows the order as it now is and keeps the key for a retry of the same payment', async () => {
    api.recordCounterPayment.mockRejectedValueOnce(new Error('disk busy'));
    api.getCounterOrder.mockResolvedValue(order());
    const { result, onError, onOrder } = setup();
    await submit(result);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'disk busy' }));
    expect(onOrder).toHaveBeenCalledWith(order());
    api.recordCounterPayment.mockResolvedValue(order({ balanceMinor: 0, paidMinor: 23000 }));
    api.handOverCounterItems.mockResolvedValue(order());
    await submit(result);
    expect(api.recordCounterPayment.mock.calls[1][1].idempotencyKey).toBe(api.recordCounterPayment.mock.calls[0][1].idempotencyKey);
  });

  it('uses a new key after a failure that did save the payment', async () => {
    api.recordCounterPayment.mockResolvedValue(order({ paidMinor: 3000, balanceMinor: 20000 }));
    api.handOverCounterItems.mockRejectedValueOnce(new Error('changed'));
    api.getCounterOrder.mockResolvedValue(order({ paidMinor: 3000, balanceMinor: 20000 }));
    const { result } = setup();
    act(() => result.current.toggle('dry'));
    await submit(result);
    api.handOverCounterItems.mockResolvedValue(order());
    await submit(result);
    expect(api.recordCounterPayment.mock.calls[1][1].idempotencyKey).not.toBe(api.recordCounterPayment.mock.calls[0][1].idempotencyKey);
  });

  it('keeps going when the order cannot be read back, or is gone', async () => {
    api.handOverCounterItems.mockRejectedValue(new Error('changed'));
    api.getCounterOrder.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('offline'));
    const { result, onError, onOrder } = setup(order({ balanceMinor: 0, paidMinor: 23000 }));
    await submit(result);
    expect(onOrder).not.toHaveBeenCalled();
    await submit(result);
    expect(onError).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'offline' }));
  });
});

describe('payment keys and errors', () => {
  it('keeps one key for the same payment and makes a new one for a different payment or after rotating', () => {
    const keys = new PaymentKey();
    const first = keys.keyFor('a');
    expect(keys.keyFor('a')).toBe(first);
    expect(keys.keyFor('b')).not.toBe(first);
    const second = keys.keyFor('b');
    keys.rotate();
    expect(keys.keyFor('b')).not.toBe(second);
  });

  it('words any failure', () => {
    expect(errorText(new Error('x'))).toBe('x');
    expect(errorText('plain')).toBe('plain');
    expect(errorText(undefined)).toBe('Something went wrong.');
  });
});

describe('useOrderPickup Cash + UPI split', () => {
  const collected = (over: Partial<CounterSavedOrder> = {}) => order({
    status: 'collected', totalMinor: 50000, paidMinor: 50000, balanceMinor: 0,
    lines: [line('iron', 3, 3000, 3), line('dry', 2, 20000, 2)], ...over,
  });
  const bigOrder = () => order({ totalMinor: 50000, balanceMinor: 50000 });
  const fillSplit = (result: { current: ReturnType<typeof useOrderPickup> }, cash: string, upi: string) =>
    act(() => { result.current.setMethod('split'); result.current.setSplitCash(cash); result.current.setSplitUpi(upi); });

  it('shows two amount boxes, their total and the balance that would remain', () => {
    const { result } = setup(bigOrder());
    fillSplit(result, '', '');
    expect(result.current.method).toBe('split');
    expect(result.current.splitCash).toBe('');
    expect(result.current.splitUpi).toBe('');
    expect(result.current.splitTotalMinor).toBe(0);
    expect(result.current.splitRemainingMinor).toBe(50000);
    expect(result.current.problem).toBe('Enter a positive Cash amount and a positive UPI amount.');
    act(() => { result.current.setSplitCash('200'); result.current.setSplitUpi('300'); });
    expect(result.current.splitTotalMinor).toBe(50000);
    expect(result.current.splitRemainingMinor).toBe(0);
    expect(result.current.problem).toBe('');
    expect(result.current.action).toBe('Receive ₹200.00 Cash + ₹300.00 UPI and hand over 5 pieces');
    act(() => result.current.setSplitUpi('400'));
    expect(result.current.splitTotalMinor).toBe(60000);
    expect(result.current.splitRemainingMinor).toBe(0);
  });

  it('rejects blank, zero, malformed, over-precision and over-balance split amounts', () => {
    const { result } = setup(bigOrder());
    for (const [cash, upi, expected] of [
      ['', '', 'Enter a positive Cash amount and a positive UPI amount.'],
      ['0', '100', 'Enter a positive Cash amount and a positive UPI amount.'],
      ['100', '0', 'Enter a positive Cash amount and a positive UPI amount.'],
      ['-1', '100', 'Enter the amount as a number such as 240 or 240.50.'],
      ['1.001', '100', 'Enter the amount as a number such as 240 or 240.50.'],
      ['abc', '100', 'Enter the amount as a number such as 240 or 240.50.'],
      ['100', 'abc', 'Enter the amount as a number such as 240 or 240.50.'],
      ['400', '200', 'The combined amount cannot be more than the balance of ₹500.00.'],
    ] as const) {
      fillSplit(result, cash, upi);
      expect(result.current.problem, `${cash}/${upi}`).toBe(expected);
    }
  });

  it('will not hand over the last items until the split clears the whole balance', () => {
    const { result } = setup(bigOrder());
    fillSplit(result, '200', '100');
    expect(result.current.problem).toBe('These are the last items: take the whole balance first (₹200.00 more).');
    expect(result.current.action).toBe('Receive ₹200.00 Cash + ₹100.00 UPI and hand over 5 pieces');
    expect(result.current.busy).toBe(false);
  });

  it('records the split first, then hands over, and starts afresh', async () => {
    const paid = order({ totalMinor: 50000, paidMinor: 50000, balanceMinor: 0 });
    const after = collected();
    api.recordCounterSplitPayment.mockResolvedValue(paid);
    api.handOverCounterItems.mockResolvedValue(after);
    const { result, onOrder, onNotice } = setup(bigOrder());
    fillSplit(result, '200', '300');
    await submit(result);
    expect(api.recordCounterSplitPayment).toHaveBeenCalledWith('o-1', { cashMinor: 20000, upiMinor: 30000, idempotencyKey: 'key-1' });
    expect(api.recordCounterPayment).not.toHaveBeenCalled();
    expect(api.handOverCounterItems).toHaveBeenCalledWith('o-1', ['iron', 'dry']);
    expect(onOrder.mock.calls.map(call => call[0])).toEqual([paid, after]);
    expect(onNotice).toHaveBeenCalledWith('Received ₹500.00 (₹200.00 Cash + ₹300.00 UPI). 5 pieces handed over. Order collected.');
    expect(result.current.splitCash).toBe('');
    expect(result.current.splitUpi).toBe('');
    expect(result.current.splitSaved).toBe(false);
  });

  it('takes a split payment alone, without handing anything over', async () => {
    const paid = order({ totalMinor: 50000, paidMinor: 30000, balanceMinor: 20000 });
    api.recordCounterSplitPayment.mockResolvedValue(paid);
    const { result, onNotice } = setup(bigOrder());
    fillSplit(result, '200', '100');
    act(() => { result.current.toggle('iron'); result.current.toggle('dry'); });
    await submit(result);
    expect(api.handOverCounterItems).not.toHaveBeenCalled();
    expect(onNotice).toHaveBeenCalledWith('Received ₹300.00 (₹200.00 Cash + ₹100.00 UPI).');
  });

  it('keeps one key for a retry of the same split after an uncertain response', async () => {
    api.recordCounterSplitPayment.mockRejectedValueOnce(new Error('disk busy'));
    api.getCounterOrder.mockResolvedValue(bigOrder());
    const { result, onError } = setup(bigOrder());
    fillSplit(result, '200', '300');
    await submit(result);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'disk busy' }));
    expect(result.current.splitSaved).toBe(false);
    api.recordCounterSplitPayment.mockResolvedValue(order({ totalMinor: 50000, paidMinor: 50000, balanceMinor: 0 }));
    await submit(result);
    expect(api.recordCounterSplitPayment.mock.calls[1][1].idempotencyKey).toBe(api.recordCounterSplitPayment.mock.calls[0][1].idempotencyKey);
  });

  it('hands over only after a split was saved, and never sends the amounts twice', async () => {
    const paid = order({ totalMinor: 50000, paidMinor: 50000, balanceMinor: 0 });
    api.recordCounterSplitPayment.mockResolvedValue(paid);
    api.handOverCounterItems.mockRejectedValueOnce(new Error('changed'));
    api.getCounterOrder.mockResolvedValue(paid);
    const { result, onError } = setup(bigOrder());
    fillSplit(result, '200', '300');
    await submit(result);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'changed' }));
    expect(result.current.splitSaved).toBe(true);
    expect(result.current.splitCash).toBe('');
    expect(result.current.splitUpi).toBe('');
    expect(result.current.action).toBe('Hand over 5 pieces');
    act(() => { result.current.toggle('iron'); result.current.toggle('dry'); });
    expect(result.current.problem).toBe('Tick what the customer is taking, or enter an amount.');
    act(() => { result.current.toggle('iron'); result.current.toggle('dry'); });
    api.handOverCounterItems.mockResolvedValue(collected());
    await submit(result);
    expect(api.recordCounterSplitPayment).toHaveBeenCalledTimes(1);
    expect(api.handOverCounterItems).toHaveBeenCalledTimes(2);
    expect(result.current.splitSaved).toBe(false);
  });

  it('lets the operator type a new split after a saved one, and clears the saved flag', async () => {
    const paid = order({ totalMinor: 50000, paidMinor: 50000, balanceMinor: 0 });
    api.recordCounterSplitPayment.mockResolvedValue(paid);
    api.handOverCounterItems.mockRejectedValueOnce(new Error('changed'));
    api.getCounterOrder.mockResolvedValue(paid);
    const { result } = setup(bigOrder());
    fillSplit(result, '200', '300');
    await submit(result);
    expect(result.current.splitSaved).toBe(true);
    act(() => result.current.setSplitCash('10'));
    expect(result.current.splitSaved).toBe(false);
    act(() => result.current.setSplitUpi('20'));
    expect(result.current.splitSaved).toBe(false);
  });

  it('keeps the split fields for a retry when the bill cannot be read back', async () => {
    api.recordCounterSplitPayment.mockRejectedValue(new Error('offline'));
    api.getCounterOrder.mockRejectedValue(new Error('still offline'));
    const { result, onError } = setup(bigOrder());
    fillSplit(result, '200', '300');
    await submit(result);
    expect(onError).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'still offline' }));
    expect(result.current.splitCash).toBe('200');
    expect(result.current.splitUpi).toBe('300');
    expect(result.current.splitSaved).toBe(false);
  });
});
