import { Button } from '@/components/ui/button';
import type { CounterOrderSummary } from '@/lib/localFirst/counter';
import { pickupLabel, pickupState } from '@/lib/localFirst/orders/pickup';
import { money } from '../ui';
import { TrashActions } from './TrashActions';

export interface OrderRowProps {
  order: CounterOrderSummary;
  isAdmin: boolean;
  busy: boolean;
  onOpen(orderId: string): void;
  /** Show every bill of this customer. */
  onCustomer(phone: string): void;
  onPreviewBill(orderId: string, orderNumber: string): void;
  onTrash(orderId: string, orderNumber: string): void;
  onRequestTrash(orderId: string, orderNumber: string, reason: string): void;
}

/** Bill numbers issued since the daily-sequence format: `YYYYMMDD` plus a four-digit sequence. */
const DAILY_BILL = /^\d{12}$/;

/**
 * A daily bill number is read out by its last four digits, so those are drawn large and the date
 * part small. Any other format is shown whole.
 */
const BillNumber = ({ number }: { number: string }) => {
  if (!DAILY_BILL.test(number)) return <span className="counter-bill-number">{number}</span>;
  return (
    <span className="counter-bill-number">
      <span className="counter-bill-small">{number.slice(0, 8)}</span>
      <span className="counter-bill-large">{number.slice(8)}</span>
    </span>
  );
};

/** One order in the list: tap it to open, the name for the customer's bills, and preview or trash in place. */
export const OrderRow = ({ order, isAdmin, busy, onOpen, onCustomer, onPreviewBill, onTrash, onRequestTrash }: OrderRowProps) => {
  const state = pickupState(order);
  const owed = state !== 'cancelled' && order.balanceMinor > 0;
  return (
    <li className="counter-order-row">
      <button type="button" className="counter-order-open" aria-label={`Open bill ${order.orderNumber}`} disabled={busy} onClick={() => onOpen(order.id)}>
        <BillNumber number={order.orderNumber} />
        <span className="counter-order-items">{order.itemsText || '—'}</span>
        <span className={`counter-pickup-chip ${state}`}>{pickupLabel(state)}</span>
        <span className="counter-order-amount">{money(order.totalMinor)}{owed && <small>{`Due ${money(order.balanceMinor)}`}</small>}</span>
      </button>
      <div className="counter-order-customer">
        <button type="button" className="counter-link counter-customer-link" onClick={() => onCustomer(order.customerPhone)}>{order.customerName}</button>
        <span>{order.customerPhone}</span>
      </div>
      {order.matchReason && <small className="counter-match-reason">{order.matchReason}</small>}
      <div className="counter-order-actions">
        <Button variant="outline" className="counter-touch" disabled={busy} onClick={() => onPreviewBill(order.id, order.orderNumber)}>Preview</Button>
        <TrashActions isAdmin={isAdmin} busy={busy} onTrash={() => onTrash(order.id, order.orderNumber)} onRequestTrash={reason => onRequestTrash(order.id, order.orderNumber, reason)} />
      </div>
    </li>
  );
};
