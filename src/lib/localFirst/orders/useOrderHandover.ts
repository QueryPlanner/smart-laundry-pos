import { useEffect, useRef, useState } from 'react';
import { collectCounterOrder, updateCounterOrderStatus } from '../counter';
import type { CounterPaymentMethod, CounterRecordPaymentInput, CounterSavedOrder } from '../counter';
import { rupees } from './orderMoney';
import { pickupPieceIds } from './pieceGroups';
import { PaymentKey, errorText, paymentIdentity, paymentReference, refreshAfterFailure } from './useOrderMoney';

export type HandoverAction = 'receive' | 'receive_and_handover' | 'handover' | 'mark_ready';

/**
 * The pickup panel's state and actions: which garments are ticked, the hand-over and the payment that goes
 * with it. Ticks are session-local and never saved.
 */
export const useOrderHandover = (o: {
  order: CounterSavedOrder | null;
  money: { receive(): Promise<boolean> };
  onOrder(order: CounterSavedOrder): void;
  onError(error: unknown): void;
  onNotice(message: string): void;
  /** The method and reference from the payment form, sent with "Receive and hand over". Cash by default. */
  paymentMethod?: CounterPaymentMethod;
  reference?: string;
}) => {
  const { order, money, onOrder, onError, onNotice, paymentMethod = 'cash', reference = '' } = o;
  const [checkedTaggedIds, setCheckedTaggedIds] = useState<string[]>([]);
  const [untaggedCounts, setUntaggedCounts] = useState<Record<string, number>>({});
  const [receivedNote, setReceivedNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [payments] = useState(() => new PaymentKey());
  const collectRequestId = useRef(crypto.randomUUID());
  /** The balance before a "Receive" payment, until the order that comes back shows the new balance. */
  const balanceBeforeReceive = useRef<number | null>(null);
  const running = useRef(false);

  // The payment is saved by the money form, so the amount is only known once the order that comes back is
  // on screen. This runs after that render, so the note is shown from the new balance.
  useEffect(() => {
    const before = balanceBeforeReceive.current;
    if (before === null || !order) return;
    balanceBeforeReceive.current = null;
    if (order.balanceMinor < before) setReceivedNote(`${rupees(before - order.balanceMinor)} received`);
  }, [order]);

  const receiveMoney = async (current: CounterSavedOrder): Promise<void> => {
    balanceBeforeReceive.current = current.balanceMinor;
    const ok = await money.receive();
    if (!ok) balanceBeforeReceive.current = null;
  };

  const markReady = async (current: CounterSavedOrder): Promise<void> => {
    let saved: CounterSavedOrder;
    try {
      saved = await updateCounterOrderStatus(current.orderId, 'ready');
    } catch (e) {
      setError(errorText(e));
      onError(e);
      return;
    }
    onOrder(saved);
  };

  const collect = async (current: CounterSavedOrder, kind: 'receive_and_handover' | 'handover'): Promise<void> => {
    const pieceIds = pickupPieceIds(current.pieces, checkedTaggedIds, untaggedCounts);
    const withPayment = kind === 'receive_and_handover' && current.balanceMinor > 0;
    const sentReference = paymentReference(paymentMethod, reference);
    const payment: CounterRecordPaymentInput | undefined = withPayment ? {
      amountMinor: current.balanceMinor,
      method: paymentMethod,
      reference: sentReference,
      idempotencyKey: payments.keyFor(paymentIdentity(current.orderId, current.balanceMinor, paymentMethod, sentReference)),
    } : undefined;

    let saved: CounterSavedOrder;
    try {
      saved = payment
        ? await collectCounterOrder(current.orderId, pieceIds, collectRequestId.current, payment)
        : await collectCounterOrder(current.orderId, pieceIds, collectRequestId.current);
    } catch (e) {
      setError(errorText(e));
      onError(e);
      await refreshAfterFailure(current, payments, { onOrder, onError });
      return;
    }

    collectRequestId.current = crypto.randomUUID();
    payments.rotate();
    setDone(true);
    onOrder(saved);
    onNotice('Order handed over.');
  };

  const perform = async (kind: HandoverAction): Promise<void> => {
    if (running.current || !order || done) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      if (kind === 'receive') await receiveMoney(order);
      else if (kind === 'mark_ready') await markReady(order);
      else await collect(order, kind);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  /** A new order is open: clear the ticks, the note, the message and the done state, and start new keys. */
  const reset = () => {
    setCheckedTaggedIds([]);
    setUntaggedCounts({});
    setReceivedNote('');
    setError('');
    setDone(false);
    balanceBeforeReceive.current = null;
    collectRequestId.current = crypto.randomUUID();
    payments.rotate();
  };

  return {
    checkedTaggedIds, setCheckedTaggedIds,
    untaggedCounts, setUntaggedCounts,
    receivedNote, error, busy, done,
    perform, reset,
  };
};
