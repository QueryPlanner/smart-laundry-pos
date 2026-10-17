// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CounterSavedOrder } from '../counter';
import { useOrderMoney } from './useOrderMoney';

const api = vi.hoisted(() => ({
  getCounterOrder: vi.fn(),
  recordCounterPayment: vi.fn(),
}));
vi.mock('../counter', () => api);

const order = (over: Partial<CounterSavedOrder> = {}): CounterSavedOrder => ({
  orderId: 'o-1', orderNumber: 'SL-1', receivedAt: '2026-10-15T06:00:00Z', promisedAt: '2026-10-17T11:30:00Z',
  status: 'ready', totalMinor: 4000, paidMinor: 0, balanceMinor: 4000, paymentStatus: 'unpaid', collectedAt: null,
  refundDueMinor: 0, payments: [], pieces: [], printJobs: [], ...over,
});

const deferred = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const setup = (current: CounterSavedOrder | null = order()) => {
  const onOrder = vi.fn();
  const onError = vi.fn();
  const onNotice = vi.fn();
  const hook = renderHook(
    ({ value }: { value: CounterSavedOrder | null }) => useOrderMoney({ order: value, onOrder, onError, onNotice }),
    { initialProps: { value: current } },
  );
  return { ...hook, onOrder, onError, onNotice };
};

/** Runs `receive` inside `act` and returns what it resolved to. */
const receive = async (result: { current: ReturnType<typeof useOrderMoney> }, options?: { whole?: boolean }): Promise<boolean> => {
  let ok = false;
  await act(async () => { ok = await result.current.receive(options); });
  return ok;
};

/** The idempotency key sent with the Nth call to the payment API. */
const keyOfCall = (index: number): string => api.recordCounterPayment.mock.calls[index][1].idempotencyKey;

beforeEach(() => {
  api.getCounterOrder.mockReset();
  api.recordCounterPayment.mockReset();
});

describe('useOrderMoney receive', () => {
  it('records the whole balance when no part payment is chosen', async () => {
    const saved = order({ balanceMinor: 0, paidMinor: 4000, paymentStatus: 'paid' });
    api.recordCounterPayment.mockResolvedValue(saved);
    const { result, onOrder, onNotice } = setup();

    await expect(receive(result)).resolves.toBe(true);

    expect(api.recordCounterPayment).toHaveBeenCalledTimes(1);
    expect(api.recordCounterPayment).toHaveBeenCalledWith('o-1', { amountMinor: 4000, method: 'cash', idempotencyKey: expect.any(String) });
    expect(onOrder).toHaveBeenCalledWith(saved);
    expect(onNotice).toHaveBeenCalledWith('Payment saved.');
  });

  it('ignores the typed amount while part payment is off', async () => {
    api.recordCounterPayment.mockResolvedValue(order({ balanceMinor: 0 }));
    const { result } = setup();
    act(() => { result.current.form.onAmount('5'); });

    await receive(result);

    expect(api.recordCounterPayment).toHaveBeenCalledWith('o-1', expect.objectContaining({ amountMinor: 4000 }));
  });

  it('records the typed part payment in paise and clears the form after success', async () => {
    const saved = order({ balanceMinor: 2950, paidMinor: 1050 });
    api.recordCounterPayment.mockResolvedValue(saved);
    const { result, onOrder, onNotice } = setup();
    act(() => {
      result.current.form.onPartial(true);
      result.current.form.onAmount('10.50');
      result.current.form.onMethod('upi');
      result.current.form.onReference('  UTR123  ');
    });

    await expect(receive(result)).resolves.toBe(true);

    expect(api.recordCounterPayment).toHaveBeenCalledWith('o-1', { amountMinor: 1050, method: 'upi', reference: 'UTR123', idempotencyKey: expect.any(String) });
    expect(onOrder).toHaveBeenCalledWith(saved);
    expect(onNotice).toHaveBeenCalledWith('Payment saved.');
    expect(result.current.form).toMatchObject({ partial: false, amount: '', reference: '', error: '', method: 'upi' });
  });

  it('never sends a reference for cash', async () => {
    api.recordCounterPayment.mockResolvedValue(order({ balanceMinor: 0 }));
    const { result } = setup();
    act(() => { result.current.form.onReference('Shop note'); });

    await receive(result);

    expect(api.recordCounterPayment.mock.calls[0][1].reference).toBeUndefined();
  });

  it('sends no reference when a non-cash payment has only spaces in it', async () => {
    api.recordCounterPayment.mockResolvedValue(order({ balanceMinor: 0 }));
    const { result } = setup();
    act(() => {
      result.current.form.onMethod('card');
      result.current.form.onReference('   ');
    });

    await receive(result);

    expect(api.recordCounterPayment.mock.calls[0][1].reference).toBeUndefined();
  });

  it.each([
    ['', 'Enter an amount greater than zero, with at most two decimals.'],
    ['0', 'Enter an amount greater than zero, with at most two decimals.'],
    ['0.00', 'Enter an amount greater than zero, with at most two decimals.'],
    ['-5', 'Enter an amount greater than zero, with at most two decimals.'],
    ['10.005', 'Enter an amount greater than zero, with at most two decimals.'],
    ['abc', 'Enter an amount greater than zero, with at most two decimals.'],
    ['40.01', 'The amount cannot be more than the balance of ₹40.00.'],
  ])('refuses the part payment %j without calling the API or taking the whole balance', async (amount, message) => {
    const { result, onOrder, onError } = setup();
    act(() => {
      result.current.form.onPartial(true);
      result.current.form.onAmount(amount);
    });

    await expect(receive(result)).resolves.toBe(false);

    expect(result.current.form.error).toBe(message);
    expect(api.recordCounterPayment).not.toHaveBeenCalled();
    expect(onOrder).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('accepts a part payment equal to the balance', async () => {
    api.recordCounterPayment.mockResolvedValue(order({ balanceMinor: 0 }));
    const { result } = setup();
    act(() => {
      result.current.form.onPartial(true);
      result.current.form.onAmount('40');
    });

    await receive(result);

    expect(api.recordCounterPayment).toHaveBeenCalledWith('o-1', expect.objectContaining({ amountMinor: 4000 }));
  });

  it('clears an earlier refusal once the amount is valid', async () => {
    api.recordCounterPayment.mockResolvedValue(order({ balanceMinor: 0 }));
    const { result } = setup();
    act(() => {
      result.current.form.onPartial(true);
      result.current.form.onAmount('0');
    });
    await receive(result);
    expect(result.current.form.error).not.toBe('');

    act(() => { result.current.form.onAmount('20'); });
    await receive(result);

    expect(result.current.form.error).toBe('');
    expect(api.recordCounterPayment).toHaveBeenCalledTimes(1);
  });

  it('does nothing without an order or when the balance is zero', async () => {
    const none = setup(null);
    await expect(receive(none.result)).resolves.toBe(false);
    act(() => { none.result.current.form.onReceive(); });

    const paid = setup(order({ balanceMinor: 0, paidMinor: 4000 }));
    await expect(receive(paid.result)).resolves.toBe(false);

    expect(api.recordCounterPayment).not.toHaveBeenCalled();
    expect(none.onError).not.toHaveBeenCalled();
    expect(paid.result.current.form.error).toBe('');
  });

  it('runs from the form button', async () => {
    api.recordCounterPayment.mockResolvedValue(order({ balanceMinor: 0 }));
    const { result, onNotice } = setup();

    act(() => { result.current.form.onReceive(); });

    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('Payment saved.'));
    expect(api.recordCounterPayment).toHaveBeenCalledTimes(1);
  });
});

describe('useOrderMoney receive whole balance', () => {
  it.each([
    ['a valid part amount', '5'],
    ['an amount above the balance', '50'],
    ['an invalid amount', 'abc'],
  ])('records the whole balance and ignores %s when whole is asked for', async (_label, typed) => {
    api.recordCounterPayment.mockResolvedValue(order({ balanceMinor: 0, paidMinor: 4000, paymentStatus: 'paid' }));
    const { result, onNotice } = setup();
    act(() => {
      result.current.form.onPartial(true);
      result.current.form.onAmount(typed);
    });

    await expect(receive(result, { whole: true })).resolves.toBe(true);

    expect(api.recordCounterPayment).toHaveBeenCalledTimes(1);
    expect(api.recordCounterPayment).toHaveBeenCalledWith('o-1', expect.objectContaining({ amountMinor: 4000 }));
    expect(onNotice).toHaveBeenCalledWith('Payment saved.');
  });

  it('clears the typed part payment from the form once the whole balance is saved', async () => {
    api.recordCounterPayment.mockResolvedValue(order({ balanceMinor: 0 }));
    const { result } = setup();
    act(() => {
      result.current.form.onPartial(true);
      result.current.form.onAmount('5');
    });

    await receive(result, { whole: true });

    expect(result.current.form).toMatchObject({ partial: false, amount: '', error: '' });
  });

  it('refuses without calling the API when the order has no balance left', async () => {
    const { result, onOrder } = setup(order({ balanceMinor: 0, paidMinor: 4000 }));

    await expect(receive(result, { whole: true })).resolves.toBe(false);

    expect(api.recordCounterPayment).not.toHaveBeenCalled();
    expect(onOrder).not.toHaveBeenCalled();
  });
});

describe('useOrderMoney failures', () => {
  it('shows the error, reports it, refetches the order and keeps the key for a retry of the same payment', async () => {
    const fresh = order();
    api.recordCounterPayment.mockRejectedValueOnce(new Error('Network down')).mockResolvedValueOnce(order({ balanceMinor: 0 }));
    api.getCounterOrder.mockResolvedValue(fresh);
    const { result, onOrder, onError, onNotice } = setup();

    await expect(receive(result)).resolves.toBe(false);

    expect(result.current.form.error).toBe('Network down');
    expect(result.current.form.busy).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Network down' }));
    expect(api.getCounterOrder).toHaveBeenCalledWith('o-1');
    expect(onOrder).toHaveBeenCalledWith(fresh);
    expect(onNotice).not.toHaveBeenCalled();

    await expect(receive(result)).resolves.toBe(true);

    expect(keyOfCall(1)).toBe(keyOfCall(0));
  });

  it.each([
    ['a text message', 'Payment rejected', 'Payment rejected'],
    ['no reason', undefined, 'Something went wrong.'],
  ])('shows %s from a failure that is not an Error', async (_label, reason, message) => {
    api.recordCounterPayment.mockRejectedValueOnce(reason);
    api.getCounterOrder.mockResolvedValue(order());
    const { result, onError } = setup();

    await receive(result);

    expect(result.current.form.error).toBe(message);
    expect(onError).toHaveBeenCalledWith(reason);
  });

  it('rotates the key on retry when the refetched balance has changed', async () => {
    const first = new Error('Timed out');
    api.recordCounterPayment.mockRejectedValueOnce(first).mockResolvedValueOnce(order({ balanceMinor: 0 }));
    api.getCounterOrder.mockResolvedValue(order({ balanceMinor: 1000, paidMinor: 3000, paymentStatus: 'partially_paid' }));
    const { result, onOrder } = setup();

    await receive(result);
    expect(onOrder).toHaveBeenCalledWith(order({ balanceMinor: 1000, paidMinor: 3000, paymentStatus: 'partially_paid' }));
    await receive(result);

    expect(keyOfCall(1)).not.toBe(keyOfCall(0));
  });

  it('keeps the key when the refetch finds no order', async () => {
    api.recordCounterPayment.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(order({ balanceMinor: 0 }));
    api.getCounterOrder.mockResolvedValue(null);
    const { result, onOrder } = setup();

    await receive(result);
    expect(onOrder).not.toHaveBeenCalled();
    await receive(result);

    expect(keyOfCall(1)).toBe(keyOfCall(0));
  });

  it('reports a failed refetch as well as the payment failure', async () => {
    const paymentError = new Error('Offline');
    const refetchError = new Error('Still offline');
    api.recordCounterPayment.mockRejectedValueOnce(paymentError);
    api.getCounterOrder.mockRejectedValueOnce(refetchError);
    const { result, onError, onOrder } = setup();

    await receive(result);

    expect(onError).toHaveBeenNthCalledWith(1, paymentError);
    expect(onError).toHaveBeenNthCalledWith(2, refetchError);
    expect(onOrder).not.toHaveBeenCalled();
    expect(result.current.form.error).toBe('Offline');
  });
});

describe('useOrderMoney payment keys', () => {
  it('uses a new key when the amount, method or reference changes', async () => {
    api.recordCounterPayment.mockRejectedValue(new Error('Offline'));
    api.getCounterOrder.mockResolvedValue(order());
    const { result } = setup();

    await receive(result);
    act(() => { result.current.form.onPartial(true); result.current.form.onAmount('10'); });
    await receive(result);
    act(() => { result.current.form.onMethod('upi'); result.current.form.onReference('A1'); });
    await receive(result);
    act(() => { result.current.form.onReference('B2'); });
    await receive(result);

    const keys = [0, 1, 2, 3].map(keyOfCall);
    expect(new Set(keys).size).toBe(4);
  });

  it('uses a new key for the next payment after a success', async () => {
    api.recordCounterPayment.mockResolvedValue(order({ balanceMinor: 0 }));
    const { result } = setup();

    await receive(result);
    await receive(result);

    expect(keyOfCall(1)).not.toBe(keyOfCall(0));
  });

  it('uses a new key after reset even for the same payment', async () => {
    api.recordCounterPayment.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(order({ balanceMinor: 0 }));
    api.getCounterOrder.mockResolvedValue(order());
    const { result } = setup();

    await receive(result);
    act(() => { result.current.reset(); });
    await receive(result);

    expect(keyOfCall(1)).not.toBe(keyOfCall(0));
  });
});

describe('useOrderMoney single-flight and state', () => {
  it('ignores a second receive while the first is running', async () => {
    const pending = deferred<CounterSavedOrder>();
    api.recordCounterPayment.mockReturnValueOnce(pending.promise);
    const { result, onNotice } = setup();

    let first!: Promise<boolean>;
    act(() => { first = result.current.receive(); });
    expect(result.current.form.busy).toBe(true);

    await expect(receive(result)).resolves.toBe(false);
    expect(api.recordCounterPayment).toHaveBeenCalledTimes(1);

    await act(async () => { pending.resolve(order({ balanceMinor: 0 })); });
    await expect(first).resolves.toBe(true);
    expect(result.current.form.busy).toBe(false);
    expect(onNotice).toHaveBeenCalledTimes(1);
  });

  it('clears the form for another order without touching the balance', async () => {
    api.recordCounterPayment.mockRejectedValue(new Error('Offline'));
    api.getCounterOrder.mockResolvedValue(order());
    const { result } = setup();
    act(() => {
      result.current.form.onPartial(true);
      result.current.form.onAmount('10');
      result.current.form.onMethod('card');
      result.current.form.onReference('X9');
    });
    await receive(result);
    expect(result.current.form.error).toBe('Offline');

    act(() => { result.current.reset(); });

    expect(result.current.form).toMatchObject({ amount: '', partial: false, method: 'cash', reference: '', error: '' });
  });
});
