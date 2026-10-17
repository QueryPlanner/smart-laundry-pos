import { useRef, useState } from 'react';
import { getCounterOrder, recordCounterPayment } from '../counter';
import type { CounterPaymentMethod, CounterSavedOrder } from '../counter';
import { parsePaymentAmountMinor } from '../payment';
import { rupees } from './orderMoney';

const AMOUNT_NOT_VALID = 'Enter an amount greater than zero, with at most two decimals.';

/**
 * One idempotency key for one payment. A retry of the same payment keeps its key, because the native side
 * refuses a key reused for a different payload. A different payment gets a new key, and so does the next
 * payment after a success or after the balance changed.
 */
export class PaymentKey {
  private key: string | null = null;
  private payment = '';

  keyFor(payment: string): string {
    if (this.key === null || payment !== this.payment) {
      this.key = crypto.randomUUID();
      this.payment = payment;
    }
    return this.key;
  }

  rotate(): void {
    this.key = null;
  }
}

/** The reference sent with a payment. Cash never carries one, and a blank reference is not sent. */
export const paymentReference = (method: CounterPaymentMethod, reference: string): string | undefined =>
  method === 'cash' ? undefined : reference.trim() || undefined;

/** Identifies one payment for its idempotency key. The same fields always give the same text. */
export const paymentIdentity = (orderId: string, amountMinor: number, method: CounterPaymentMethod, reference: string | undefined): string =>
  JSON.stringify([orderId, amountMinor, method, reference ?? null]);

/** The message shown for a failed call, the same wording the counter screen uses. */
export const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error || 'Something went wrong.');

/**
 * After a failed call, fetch the order again so the screen shows the current balance. The payment key is
 * dropped when the balance has changed, because the failed call may have recorded the payment.
 */
export const refreshAfterFailure = async (
  before: CounterSavedOrder,
  payments: PaymentKey,
  o: { onOrder(order: CounterSavedOrder): void; onError(error: unknown): void },
): Promise<void> => {
  try {
    const fresh = await getCounterOrder(before.orderId);
    if (!fresh) return;
    if (fresh.balanceMinor !== before.balanceMinor) payments.rotate();
    o.onOrder(fresh);
  } catch (refetchError) {
    o.onError(refetchError);
  }
};

export interface MoneyFormState {
  amount: string; onAmount(value: string): void;
  partial: boolean; onPartial(on: boolean): void;
  method: CounterPaymentMethod; onMethod(method: CounterPaymentMethod): void;
  reference: string; onReference(value: string): void;
  error: string; onReceive(): void; busy: boolean;
}

/**
 * The payment form on the order page and the payment it records. The whole balance is the default; a part
 * payment must be a positive amount no more than the balance, and a bad amount never falls back to the balance.
 */
export const useOrderMoney = (o: {
  order: CounterSavedOrder | null;
  onOrder(order: CounterSavedOrder): void;
  onError(error: unknown): void;
  onNotice(message: string): void;
}) => {
  const [amount, setAmount] = useState('');
  const [partial, setPartial] = useState(false);
  const [method, setMethod] = useState<CounterPaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [payments] = useState(() => new PaymentKey());
  const running = useRef(false);

  /**
   * Records a payment from the form. With `whole`, the whole balance is received whatever the form says, so a
   * caller whose label names the whole balance (the hand-over button) always records that amount.
   */
  const receive = async (options?: { whole?: boolean }): Promise<boolean> => {
    if (running.current) return false;
    const order = o.order;
    if (!order || order.balanceMinor <= 0) return false;

    setError('');
    const amountMinor = partial && !options?.whole ? parsePaymentAmountMinor(amount) : order.balanceMinor;
    if (amountMinor === null || amountMinor <= 0) {
      setError(AMOUNT_NOT_VALID);
      return false;
    }
    if (amountMinor > order.balanceMinor) {
      setError(`The amount cannot be more than the balance of ${rupees(order.balanceMinor)}.`);
      return false;
    }

    const sentReference = paymentReference(method, reference);
    const idempotencyKey = payments.keyFor(paymentIdentity(order.orderId, amountMinor, method, sentReference));
    let saved: CounterSavedOrder;
    running.current = true;
    setBusy(true);
    try {
      saved = await recordCounterPayment(order.orderId, { amountMinor, method, reference: sentReference, idempotencyKey });
    } catch (e) {
      setError(errorText(e));
      o.onError(e);
      await refreshAfterFailure(order, payments, o);
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }

    payments.rotate();
    o.onOrder(saved);
    o.onNotice('Payment saved.');
    setAmount('');
    setPartial(false);
    setReference('');
    setError('');
    return true;
  };

  /** Clears the form for another order. The next payment gets a new key. */
  const reset = () => {
    setAmount('');
    setPartial(false);
    setMethod('cash');
    setReference('');
    setError('');
    payments.rotate();
  };

  const form: MoneyFormState = {
    amount, onAmount: setAmount,
    partial, onPartial: setPartial,
    method, onMethod: setMethod,
    reference, onReference: setReference,
    error, onReceive: () => { void receive(); },
    busy,
  };
  return { form, receive, reset };
};
