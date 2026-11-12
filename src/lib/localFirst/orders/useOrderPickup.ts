import { useRef, useState } from 'react';
import { getCounterOrder, handOverCounterItems, recordCounterPayment, recordCounterSplitPayment } from '../counter';
import type { CounterPaymentMethod, CounterSavedOrder } from '../counter';
import { parsePaymentAmountMinor, rupeesText } from '../payment';
import { finishesOrder, piecesGoing, rupees, suggestedPaymentMinor, waitingLineIds } from './pickup';

const AMOUNT_NOT_VALID = 'Enter the amount as a number such as 240 or 240.50.';
const SPLIT_NOT_POSITIVE = 'Enter a positive Cash amount and a positive UPI amount.';
const NOTHING_CHOSEN = 'Tick what the customer is taking, or enter an amount.';

/** The existing single methods, plus the one screen-only option that writes a Cash and a UPI row. */
export type PickupMethod = CounterPaymentMethod | 'split';
export const SPLIT_METHOD: PickupMethod = 'split';

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
  method: PickupMethod;
  setMethod(method: PickupMethod): void;
  /** The two amount boxes shown when `method` is `split`. */
  splitCash: string;
  setSplitCash(text: string): void;
  splitUpi: string;
  setSplitUpi(text: string): void;
  /** What the two split boxes add up to, and the balance that would remain. */
  splitTotalMinor: number;
  splitRemainingMinor: number;
  /** The split was saved and only the hand-over is left; the amounts are not sent again. */
  splitSaved: boolean;
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
 * except the last, which needs the whole bill paid. A split is one native request that writes a Cash and
 * a UPI settlement together.
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
  const [method, setMethod] = useState<PickupMethod>('cash');
  const [splitCash, setSplitCashText] = useState('');
  const [splitUpi, setSplitUpiText] = useState('');
  const [splitSaved, setSplitSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [payments] = useState(() => new PaymentKey());
  const running = useRef(false);

  const suggested = suggestedPaymentMinor(order, chosen);
  const amount = typed ?? (suggested > 0 ? rupeesText(suggested) : '');
  const amountMinor = parsePaymentAmountMinor(amount);
  const going = piecesGoing(order.lines, chosen);
  const finishing = finishesOrder(order.lines, chosen);
  const split = method === SPLIT_METHOD;
  const splitMode = split && !splitSaved;
  const cashMinor = parsePaymentAmountMinor(splitCash);
  const upiMinor = parsePaymentAmountMinor(splitUpi);
  const splitTotalMinor = cashMinor !== null && upiMinor !== null ? cashMinor + upiMinor : 0;
  const splitRemainingMinor = Math.max(0, order.balanceMinor - splitTotalMinor);
  const payingMinor = splitMode ? splitTotalMinor : split ? 0 : (amountMinor ?? 0);
  const cashPayingMinor = splitMode ? (cashMinor ?? 0) : 0;
  const upiPayingMinor = splitMode ? (upiMinor ?? 0) : 0;

  const problemOf = (): string => {
    if (splitSaved) return going === 0 ? NOTHING_CHOSEN : '';
    if (split) {
      if (cashMinor === null || upiMinor === null) return AMOUNT_NOT_VALID;
      if (cashMinor <= 0 || upiMinor <= 0) return SPLIT_NOT_POSITIVE;
      if (splitTotalMinor > order.balanceMinor) return `The combined amount cannot be more than the balance of ${rupees(order.balanceMinor)}.`;
      if (finishing && order.balanceMinor - splitTotalMinor > 0) {
        return `These are the last items: take the whole balance first (${rupees(order.balanceMinor - splitTotalMinor)} more).`;
      }
      return '';
    }
    if (amountMinor === null) return AMOUNT_NOT_VALID;
    if (amountMinor > order.balanceMinor) return `The amount cannot be more than the balance of ${rupees(order.balanceMinor)}.`;
    if (amountMinor === 0 && going === 0) return NOTHING_CHOSEN;
    if (finishing && order.balanceMinor - amountMinor > 0) {
      return `These are the last items: take the whole balance first (${rupees(order.balanceMinor - amountMinor)} more).`;
    }
    return '';
  };
  const problem = problemOf();
  const paying = splitMode && cashMinor !== null && upiMinor !== null && cashMinor > 0 && upiMinor > 0
    ? `Receive ${rupees(cashMinor)} Cash + ${rupees(upiMinor)} UPI`
    : !split && payingMinor > 0 ? `Receive ${rupees(payingMinor)}` : '';
  const handing = going > 0 ? `hand over ${pieces(going)}` : '';
  const action = paying && handing ? `${paying} and ${handing}` : paying || (handing && `Hand over ${pieces(going)}`) || 'Hand over';

  const setSplitCash = (text: string) => {
    setSplitCashText(text);
    setSplitSaved(false);
  };
  const setSplitUpi = (text: string) => {
    setSplitUpiText(text);
    setSplitSaved(false);
  };

  const submit = async () => {
    if (running.current || problem) return;
    running.current = true;
    setBusy(true);
    const splitNow = method === SPLIT_METHOD && !splitSaved;
    // The guard above rejects any state without whole amounts, so the button only submits valid ones.
    const paid = payingMinor;
    const cash = cashPayingMinor;
    const upi = upiPayingMinor;
    const lines = chosen.filter(id => order.lines.some(line => line.itemId === id && line.pieceCount > line.handedOverCount));
    let current = order;
    try {
      if (splitNow) {
        const idempotencyKey = payments.keyFor(JSON.stringify([order.orderId, 'split', cash, upi]));
        current = await recordCounterSplitPayment(order.orderId, { cashMinor: cash, upiMinor: upi, idempotencyKey });
        payments.rotate();
        o.onOrder(current);
      } else if (paid > 0) {
        const idempotencyKey = payments.keyFor(JSON.stringify([order.orderId, paid, method]));
        current = await recordCounterPayment(order.orderId, { amountMinor: paid, method: method as CounterPaymentMethod, idempotencyKey });
        payments.rotate();
        o.onOrder(current);
      }
      if (lines.length > 0) {
        current = await handOverCounterItems(order.orderId, lines);
        o.onOrder(current);
      }
      const said = [
        splitNow ? `Received ${rupees(paid)} (${rupees(cash)} Cash + ${rupees(upi)} UPI).` : paid > 0 ? `Received ${rupees(paid)}.` : '',
        going > 0 ? `${pieces(going)} handed over.` : '',
        current.status === 'collected' ? 'Order collected.' : '',
      ];
      o.onNotice(said.filter(Boolean).join(' '));
      setChosen(waitingLineIds(current.lines));
      setTyped(null);
      setSplitCashText('');
      setSplitUpiText('');
      setSplitSaved(false);
    } catch (error) {
      o.onError(error);
      // The payment may have gone through before the hand-over failed: show the order as it is now.
      try {
        const fresh = await getCounterOrder(order.orderId);
        if (fresh) {
          if (splitNow) {
            // The split saved but the hand-over did not: keep both payments and let the next tap
            // hand over only, without sending the amounts again.
            if (fresh.paidMinor - order.paidMinor === paid && fresh.balanceMinor === order.balanceMinor - paid) {
              payments.rotate();
              setSplitCashText('');
              setSplitUpiText('');
              setSplitSaved(true);
            }
          } else if (fresh.balanceMinor !== order.balanceMinor) {
            // A changed balance means the payment was saved, so the next one is a new payment with a new key.
            payments.rotate();
          }
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
    splitCash,
    setSplitCash,
    splitUpi,
    setSplitUpi,
    splitTotalMinor,
    splitRemainingMinor,
    splitSaved,
    problem,
    action,
    busy,
    submit,
  };
};
