import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CounterPaymentMethod, CounterSavedOrder } from '@/lib/localFirst/counter';
import { pickupLabel, pickupState, remaining } from '@/lib/localFirst/orders/pickup';
import { useOrderPickup } from '@/lib/localFirst/orders/useOrderPickup';
import { formatShopDateTime, methodText } from '@/lib/localFirst/salesRange';
import { money } from '../ui';
import { TrashActions } from './TrashActions';

const METHODS: Array<{ value: CounterPaymentMethod; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
];

export interface OrderPageProps {
  order: CounterSavedOrder;
  isAdmin: boolean;
  busy: boolean;
  /** Where Back goes, as words: "Orders", "Dashboard" ... */
  backLabel: string;
  onBack(): void;
  /** Replace the open order with a fresher copy. */
  onOrder(order: CounterSavedOrder): void;
  onError(error: unknown): void;
  onNotice(message: string): void;
  /** Show every bill of this customer. */
  onCustomer(phone: string): void;
  onPreviewBill(): void;
  onReprintBill(): void;
  /** Print the tags again, for tags the shop misplaced. */
  onReprintTags(): void;
  /** The bill and tag print jobs of this order, to retry one or pick single tags. */
  onOpenPrints(): void;
  onTrash(): void;
  onRequestTrash(reason: string): void;
}

/**
 * One order: its lines, what has been paid, and the pickup box. A customer may take some lines now and
 * the rest later, paying any amount each time; the last lines need the whole bill paid.
 */
export const OrderPage = ({ order, isAdmin, busy, backLabel, onBack, onOrder, onError, onNotice, onCustomer, onPreviewBill, onReprintBill, onReprintTags, onOpenPrints, onTrash, onRequestTrash }: OrderPageProps) => {
  const pickup = useOrderPickup({ order, onOrder, onError, onNotice });
  const pieceCount = order.lines.reduce((sum, line) => sum + line.pieceCount, 0);
  const handedOverCount = order.lines.reduce((sum, line) => sum + line.handedOverCount, 0);
  const state = pickupState({ status: order.status, pieceCount, handedOverCount });
  const open = state === 'waiting' || state === 'part';
  const working = busy || pickup.busy;

  return (
    <section className="counter-page counter-order-detail" aria-label="Order detail">
      <header className="counter-detail-head">
        <Button variant="outline" className="counter-touch" onClick={onBack}>{`← ${backLabel}`}</Button>
        <div>
          <h1>{order.orderNumber}</h1>
          <p>
            <button type="button" className="counter-link counter-customer-link" onClick={() => onCustomer(order.customerPhone)}>{order.customerName}</button>
            {` · ${order.customerPhone}`}
          </p>
          <p>{`Received ${formatShopDateTime(order.receivedAt)}`}</p>
          <span className={`counter-pickup-chip ${state}`}>{pickupLabel(state)}</span>
        </div>
        <div className="counter-detail-actions">
          <Button variant="outline" className="counter-touch" disabled={working} onClick={onPreviewBill}>Preview bill</Button>
          <Button variant="outline" className="counter-touch" disabled={working} onClick={onReprintBill}>Reprint bill</Button>
          {order.pieces.some(piece => piece.tagged) && <Button variant="outline" className="counter-touch" disabled={working} onClick={onReprintTags}>Reprint tags</Button>}
          <Button variant="outline" className="counter-touch" disabled={working} onClick={onOpenPrints}>Print status</Button>
          <TrashActions isAdmin={isAdmin} busy={working} onTrash={onTrash} onRequestTrash={onRequestTrash} />
        </div>
      </header>

      {state === 'cancelled' && <p className="counter-cancelled-banner" role="status">This order was cancelled. Nothing can be paid or handed over.</p>}
      {state === 'collected' && <p role="status">{`Collected ${formatShopDateTime(order.collectedAt)}`}</p>}

      <ul className="counter-pickup-lines" aria-label="Items">
        {order.lines.map(line => {
          const left = remaining(line);
          const taken = line.handedOverCount;
          const label = `${line.quantity} × ${line.garment} · ${line.service}`;
          return (
            <li key={line.itemId}>
              <label>
                {open && left > 0
                  ? <input type="checkbox" aria-label={`Hand over ${label}`} checked={pickup.chosen.includes(line.itemId)} disabled={working} onChange={() => pickup.toggle(line.itemId)} />
                  : <span className="counter-pickup-spacer" aria-hidden="true" />}
                <span>{label}</span>
              </label>
              <strong>{money(line.lineTotalMinor)}</strong>
              {line.pieceCount > 0 && <small>{left === 0 ? 'Taken' : taken > 0 ? `${taken} of ${line.pieceCount} taken` : 'At the shop'}</small>}
            </li>
          );
        })}
      </ul>

      <section className="counter-money" aria-label="Payment">
        <div><span>Total</span><strong>{money(order.totalMinor)}</strong></div>
        <div><span>Paid</span><strong>{money(order.paidMinor)}</strong></div>
        <div><span>Balance</span><strong>{money(Math.max(0, order.balanceMinor))}</strong></div>
        {order.payments.length > 0 && <ul aria-label="Payment history">
          {order.payments.map(payment => (
            <li key={payment.id}>
              <span>{formatShopDateTime(payment.at)}</span>
              <span>{methodText(payment.method)}</span>
              {payment.voided && <span>Cancelled</span>}
              <strong>{money(payment.amountMinor)}</strong>
            </li>
          ))}
        </ul>}
        {open && (
          <div className="counter-money-form">
            <Label htmlFor="pickup-amount">Amount received now (₹)</Label>
            <Input id="pickup-amount" inputMode="decimal" placeholder="0" value={pickup.amount} disabled={working} onChange={event => pickup.setAmount(event.target.value)} />
            <div className="flex flex-wrap gap-2" role="group" aria-label="Payment method">
              {METHODS.map(method => (
                <button key={method.value} type="button" className="counter-touch" aria-pressed={pickup.method === method.value} onClick={() => pickup.setMethod(method.value)}>{method.label}</button>
              ))}
            </div>
            {pickup.problem && <p role="alert" className="text-sm font-semibold text-red-700">{pickup.problem}</p>}
            <Button className="counter-touch" disabled={working || pickup.problem !== ''} onClick={() => void pickup.submit()}>{pickup.busy ? 'Saving…' : pickup.action}</Button>
          </div>
        )}
      </section>
    </section>
  );
};
