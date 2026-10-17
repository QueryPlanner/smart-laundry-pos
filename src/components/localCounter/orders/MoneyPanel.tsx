import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CounterPaymentMethod, CounterSavedOrder } from '@/lib/localFirst/counter';
import { moneyState } from '@/lib/localFirst/orders/orderMoney';
import { parsePaymentAmountMinor } from '@/lib/localFirst/payment';
import { formatShopDateTime, methodText } from '@/lib/localFirst/salesRange';
import { money } from '../ui';
import type { MoneyForm } from './OrderDetailPage';

const METHODS: Array<{ value: CounterPaymentMethod; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'other', label: 'Other' },
];

export interface MoneyPanelProps { order: CounterSavedOrder; form: MoneyForm; compact?: boolean }

interface Banner { text: string; icon: ReactNode }

/** The one-line money status. Text always says the state; the icon only adds to it. */
const bannerFor = (order: CounterSavedOrder): Banner => {
  switch (moneyState(order)) {
    case 'cancelled':
      return order.refundDueMinor > 0
        ? { text: `Cancelled. Hand back ${money(order.refundDueMinor)}`, icon: null }
        : { text: 'Cancelled. Nothing to hand back.', icon: null };
    case 'balance_due':
      return { text: `Balance due ${money(order.balanceMinor)}`, icon: <AlertTriangle aria-hidden="true" /> };
    case 'paid':
      return { text: 'Paid in full', icon: <CheckCircle2 aria-hidden="true" /> };
    case 'no_charge':
      return { text: 'No payment due', icon: null };
  }
};

/**
 * Money for one order: the balance banner, totals, payment history, and (while a balance is open) the form
 * that records the next payment. Self-contained so the hand-over screen can show the same panel through a slot.
 */
export const MoneyPanel = ({ order, form, compact = false }: MoneyPanelProps) => {
  const banner = bannerFor(order);
  const canReceive = moneyState(order) === 'balance_due' && order.status !== 'collected';

  return (
    <section className={compact ? 'counter-money compact' : 'counter-money'} aria-label="Payment">
      <div className="counter-money-banner" role="status">{banner.icon}<strong>{banner.text}</strong></div>
      <div><span>Total</span><strong>{money(order.totalMinor)}</strong></div>
      <div><span>Paid</span><strong>{money(order.paidMinor)}</strong></div>
      <h3>Payments</h3>
      {order.payments.length === 0
        ? <p>No payments yet.</p>
        : <ul aria-label="Payment history">
          {order.payments.map(payment => (
            <li key={payment.id}>
              <span>{formatShopDateTime(payment.at)}</span>
              <span>{methodText(payment.method)}</span>
              <strong>{money(payment.amountMinor)}</strong>
              <span>{payment.kind === 'advance' ? 'Advance' : 'Balance'}</span>
              {payment.voided && <span>Cancelled</span>}
              {payment.reference && <small>{`Ref ${payment.reference}`}</small>}
            </li>
          ))}
        </ul>}
      {canReceive && <ReceiveForm order={order} form={form} />}
    </section>
  );
};

const ReceiveForm = ({ order, form }: { order: CounterSavedOrder; form: MoneyForm }) => {
  // A typed amount counts only when it is a positive amount no larger than the balance; otherwise the whole balance is shown.
  const typed = form.partial ? parsePaymentAmountMinor(form.amount) : null;
  const receiveMinor = typed !== null && typed > 0 && typed <= order.balanceMinor ? typed : order.balanceMinor;

  return (
    <div className="counter-money-form">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Payment method">
        {METHODS.map(method => (
          <button key={method.value} type="button" className="counter-touch" aria-pressed={form.method === method.value} onClick={() => form.onMethod(method.value)}>{method.label}</button>
        ))}
      </div>
      {form.method !== 'cash' && <>
        <Label htmlFor="money-reference">Reference (optional)</Label>
        <Input id="money-reference" value={form.reference} onChange={event => form.onReference(event.target.value)} />
      </>}
      <button type="button" className="counter-touch" aria-pressed={form.partial} onClick={() => form.onPartial(!form.partial)}>Part payment</button>
      {form.partial && <>
        <Label htmlFor="money-amount">Amount received</Label>
        <Input id="money-amount" inputMode="decimal" placeholder="0.00" value={form.amount} onChange={event => form.onAmount(event.target.value)} />
      </>}
      {form.error && <p role="alert" className="text-sm font-semibold text-red-700">{form.error}</p>}
      <Button variant="secondary" className="counter-touch" disabled={form.busy} onClick={() => form.onReceive()}>{`Receive ${money(receiveMinor)}`}</Button>
    </div>
  );
};
