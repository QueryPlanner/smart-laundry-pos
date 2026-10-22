import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CounterOrderSummary } from '@/lib/localFirst/counter';
import { moneyState, rowAction, rupees, type MoneyState } from '@/lib/localFirst/orders/orderMoney';
import { formatShopDateTime } from '@/lib/localFirst/salesRange';
import { StatusBadge } from '../InsightParts';
import { count } from '../ui';

export interface OrderRowProps {
  order: CounterOrderSummary;
  busy: boolean;
  onOpen(orderId: string): void;
  onHandover(orderId: string): void;
  onReprintBill(orderId: string): void;
}

/** Bill numbers issued since the daily-sequence format: `YYYYMMDD` plus a four-digit sequence. */
const DAILY_BILL = /^\d{12}$/;

/**
 * A daily bill number is read out by its last four digits, so those are drawn large and the date
 * part small. The full number stays the accessible name. Any other format is shown whole.
 */
const BillNumber = ({ number }: { number: string }) => {
  if (!DAILY_BILL.test(number)) return <span className="counter-bill-number">{number}</span>;
  return (
    <span className="counter-bill-number" role="img" aria-label={number}>
      <span className="counter-bill-small">{number.slice(0, 8)}</span>
      <span className="counter-bill-large">{number.slice(8)}</span>
    </span>
  );
};

const MoneyChip = ({ state, balanceMinor }: { state: MoneyState; balanceMinor: number }) => {
  if (state === 'balance_due') {
    return <span className="counter-money-chip warn"><AlertTriangle aria-hidden="true" />{`Balance ${rupees(balanceMinor)}`}</span>;
  }
  if (state === 'paid') return <span className="counter-money-chip good"><CheckCircle2 aria-hidden="true" />Paid</span>;
  if (state === 'cancelled') return <span className="counter-money-chip bad"><XCircle aria-hidden="true" />Cancelled</span>;
  return <span className="counter-money-chip">No charge</span>;
};

/** One order in the Orders / Pickup list. The single primary button does what the order needs next. */
export const OrderRow = ({ order, busy, onOpen, onHandover, onReprintBill }: OrderRowProps) => {
  const action = rowAction(order);
  const handsOver = action.kind === 'receive_and_handover' || action.kind === 'handover';
  return (
    <li className="counter-order-row">
      <div className="counter-order-head">
        <BillNumber number={order.orderNumber} />
        <StatusBadge status={order.status} />
        {order.overdue && <span className="counter-badge bad"><AlertTriangle aria-hidden="true" />Overdue</span>}
      </div>
      <div className="counter-order-customer">
        <strong>{order.customerName}</strong>
        <span>{order.customerPhone}</span>
        <span>{count(order.pieceCount, 'piece')}</span>
      </div>
      <div className="counter-order-money">
        <span>{`Due ${formatShopDateTime(order.promisedAt)}`}</span>
        <MoneyChip state={moneyState(order)} balanceMinor={order.balanceMinor} />
      </div>
      {order.matchReason && <small className="counter-match-reason">{order.matchReason}</small>}
      <div className="counter-order-actions">
        <Button className="counter-touch" disabled={busy} onClick={() => (handsOver ? onHandover(order.id) : onOpen(order.id))}>
          {action.label}
        </Button>
        <Button variant="outline" className="counter-touch" disabled={busy} onClick={() => onReprintBill(order.id)}>Reprint bill</Button>
      </div>
    </li>
  );
};
