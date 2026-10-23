import { useRef, useState } from 'react';
import { getCounterOrder, handOverCounterItems, recordCounterPayment } from '../counter';
import type { CounterPaymentMethod, CounterSavedOrder } from '../counter';
import { parsePaymentAmountMinor, rupeesText } from '../payment';
import { finishesOrder, piecesGoing, rupees, suggestedPaymentMinor, waitingLineIds } from './pickup';

const AMOUNT_NOT_VALID = 'Enter the amount as a number such as 240 or 240.50.';
const NOTHING_CHOSEN = 'Tick what the customer is taking, or enter an amount.';

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

/** The message shown for a failed call, the same wording the counter screen uses. */
export const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error || 'Something went wrong.');

const pieces = (n: number) => `${n} ${n === 1 ? 'piece' : 'pieces'}`;

export interface OrderPickup {
  /** The bill lines ticked to go now. */
  chosen: string[];
  toggle(itemId: string): void;
  /** The amount box: the suggested share until the cashier types something else. */
  amount: string;
  setAmount(text: string): void;
  method: CounterPaymentMethod;
  setMethod(method: CounterPaymentMethod): void;
  /** Why the button cannot do what it says, or empty. */
  problem: string;
  /** The words on the one button, for example "Receive ₹30.00 and hand over 3 pieces". */
  action: string;
  busy: boolean;
  submit(): Promise<void>;
}

/**
 * The pickup box on the order page: tick the lines the customer takes, take what they pay now, and do
 * both with one button. The payment is saved first, so lines that need it can go. Any part may go unpaid
 * except the last, which needs the whole bill paid.
 */
export const useOrderPickup = (o: {
  order: CounterSavedOrder;
  onOrder(order: CounterSavedOrder): void;
  onError(error: unknown): void;
  onNotice(message: string): void;
}): OrderPickup => {
  const { order } = o;
  const [chosen, setChosen] = useState<string[]>(() => waitingLineIds(order.lines));
  // Null means "follow the suggestion", so ticking a line updates the amount until the cashier types one.
  const [typed, setTyped] = useState<string | null>(null);
  const [method, setMethod] = useState<CounterPaymentMethod>('cash');
  const [busy, setBusy] = useState(false);
  const [payments] = useState(() => new PaymentKey());
  const running = useRef(false);

  const suggested = suggestedPaymentMinor(order, chosen);
  const amount = typed ?? (suggested > 0 ? rupeesText(suggested) : '');
  const amountMinor = parsePaymentAmountMinor(amount);
  const going = piecesGoing(order.lines, chosen);
  const finishing = finishesOrder(order.lines, chosen);

  const problemOf = (): string => {
    if (amountMinor === null) return AMOUNT_NOT_VALID;
    if (amountMinor > order.balanceMinor) return `The amount cannot be more than the balance of ${rupees(order.balanceMinor)}.`;
    if (amountMinor === 0 && going === 0) return NOTHING_CHOSEN;
    if (finishing && order.balanceMinor - amountMinor > 0) {
      return `These are the last items: take the whole balance first (${rupees(order.balanceMinor - amountMinor)} more).`;
    }
    return '';
  };
  const problem = problemOf();
  const paying = amountMinor !== null && amountMinor > 0 ? `Receive ${rupees(amountMinor)}` : '';
  const handing = going > 0 ? `hand over ${pieces(going)}` : '';
  const action = paying && handing ? `${paying} and ${handing}` : paying || (handing && `Hand over ${pieces(going)}`) || 'Hand over';

  const submit = async () => {
    if (running.current || problem) return;
    running.current = true;
    setBusy(true);
    const paid = amountMinor as number;
    const lines = chosen.filter(id => order.lines.some(line => line.itemId === id && line.pieceCount > line.handedOverCount));
    let current = order;
    try {
      if (paid > 0) {
        const idempotencyKey = payments.keyFor(JSON.stringify([order.orderId, paid, method]));
        current = await recordCounterPayment(order.orderId, { amountMinor: paid, method, idempotencyKey });
        payments.rotate();
        o.onOrder(current);
      }
      if (lines.length > 0) {
        current = await handOverCounterItems(order.orderId, lines);
        o.onOrder(current);
      }
      const said = [paid > 0 ? `Received ${rupees(paid)}.` : '', going > 0 ? `${pieces(going)} handed over.` : '', current.status === 'collected' ? 'Order collected.' : ''];
      o.onNotice(said.filter(Boolean).join(' '));
      setChosen(waitingLineIds(current.lines));
      setTyped(null);
    } catch (error) {
      o.onError(error);
      // The payment may have gone through before the hand-over failed: show the order as it is now.
      try {
        const fresh = await getCounterOrder(order.orderId);
        if (fresh) {
          // A changed balance means the payment was saved, so the next one is a new payment with a new key.
          if (fresh.balanceMinor !== order.balanceMinor) payments.rotate();
          o.onOrder(fresh);
        }
      } catch (refetchError) { o.onError(refetchError); }
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return {
    chosen,
    toggle: itemId => setChosen(current => (current.includes(itemId) ? current.filter(id => id !== itemId) : [...current, itemId])),
    amount,
    setAmount: setTyped,
    method,
    setMethod,
    problem,
    action,
    busy,
    submit,
  };
};
