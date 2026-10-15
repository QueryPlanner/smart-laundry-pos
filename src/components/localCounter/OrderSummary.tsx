import { CalendarClock, Minus, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { CounterCatalogue, CounterPaymentMethod, CounterQuote } from '@/lib/localFirst/counter';
import { formatPercentBp } from '@/lib/localFirst/discount';

const money = (minor: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(minor / 100);
const promiseFormat = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

interface OrderSummaryProps {
  catalogue: CounterCatalogue | null;
  lines: Record<string, number>;
  quote: CounterQuote | null;
  /** The price request was rejected (as opposed to still being calculated). */
  quoteFailed: boolean;
  customer: { name: string; phone: string };
  paymentMethod: CounterPaymentMethod;
  onPaymentMethod: (method: CounterPaymentMethod) => void;
  onRemove: (garmentId: string, serviceId: string) => void;
  onQuantity: (garmentId: string, quantity: number, serviceId?: string) => void;
  onSave: () => void;
  busy: boolean;
}

/** Summary of the order being taken. Payment is always collected in full, so there is no amount field. */
export const OrderSummary = ({ catalogue, lines, quote, quoteFailed, customer, paymentMethod, onPaymentMethod, onRemove, onQuantity, onSave, busy }: OrderSummaryProps) => {
  const items = Object.entries(lines).filter(([, quantity]) => quantity > 0);
  const hasDiscount = (quote?.discountMinor ?? 0) > 0;
  const nothingToPay = quote !== null && quote.totalMinor === 0;
  // Never show 0.00 while there is no price: that reads as "free".
  const amount = (pick: (q: CounterQuote) => number) => (quote ? money(pick(quote)) : '—');
  const saveBlocker = (): string => {
    if (!customer.name.trim()) return 'Enter the customer name';
    if (items.length === 0) return 'Add at least one garment';
    if (!quote) return quoteFailed ? 'The price could not be worked out. See the message above.' : 'Working out the price…';
    return '';
  };
  const blocker = saveBlocker();
  return (
    <section className="counter-summary counter-panel" aria-label="Order summary">
      <div className="counter-summary-head">
        <div>
          <span className="counter-section-label">Current order</span>
          <h2>{customer.name.trim() || 'Customer name needed'}</h2>
          <p>{customer.phone.trim() || 'Mobile number needed'}</p>
        </div>
        <div className="counter-piece-count">{quote?.pieceCount || 0}<small>pieces</small></div>
      </div>
      {items.length === 0
        ? <p className="counter-empty">Tap garment pictures to add items.</p>
        : <div className="counter-summary-lines">{items.map(([key, quantity]) => {
          const [garmentId, serviceId] = key.split('|');
          const garment = catalogue?.garments.find(x => x.id === garmentId);
          const service = catalogue?.services.find(x => x.id === serviceId);
          const line = quote?.lines.find(x => x.garmentId === garmentId && x.serviceId === serviceId);
          return (
            <div className="counter-summary-line" key={key}>
              <div><strong>{garment?.nameEn}</strong><span>{service?.name} · {line ? money(line.lineTotalMinor) : 'Quote…'}</span></div>
              <div className="counter-summary-controls">
                <button aria-label={`Remove ${garment?.nameEn}`} onClick={() => onRemove(garmentId, serviceId)}><Trash2 /></button>
                <button aria-label={`Decrease ${garment?.nameEn}`} onClick={() => onQuantity(garmentId, quantity - 1, serviceId)}><Minus /></button>
                <input aria-label={`${garment?.nameEn} summary quantity`} value={quantity} type="number" min="0" onChange={event => onQuantity(garmentId, Math.max(0, Math.floor(Number(event.target.value) || 0)), serviceId)} />
                <button aria-label={`Increase ${garment?.nameEn}`} onClick={() => onQuantity(garmentId, quantity + 1, serviceId)}><Plus /></button>
              </div>
            </div>
          );
        })}</div>}
      <div className="counter-promise">
        <CalendarClock />
        <div>
          <strong>Ready by</strong>
          <span>{quote ? promiseFormat.format(new Date(quote.promisedAt)) : 'Saved date + 2 days, 5:00 PM IST'}</span>
        </div>
      </div>
      <div className="counter-totals">
        <div><span>Subtotal</span><strong>{amount(q => q.subtotalMinor)}</strong></div>
        {hasDiscount && quote && <div><span>Discount ({formatPercentBp(quote.discountPercentBp)}%)</span><strong>-{money(quote.discountMinor)}</strong></div>}
        <div className="balance"><span>Amount to collect</span><strong>{amount(q => q.totalMinor)}</strong></div>
      </div>
      <div className="counter-payment">
        {nothingToPay
          ? <p>Nothing to collect for this order.</p>
          : <>
            <p>Collect the full amount before saving.</p>
            <Label htmlFor="payment-method">Paid by</Label>
            <select id="payment-method" value={paymentMethod} onChange={event => onPaymentMethod(event.target.value as CounterPaymentMethod)}>
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="card">Card</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="other">Other</option>
            </select>
          </>}
      </div>
      <Button className="counter-save" disabled={busy || !quote || items.length === 0 || !customer.name.trim()} onClick={onSave}>{busy ? 'Saving and dispatching…' : 'Save & Print'}</Button>
      {blocker && <p className="counter-save-reason">{blocker}</p>}
      <p className="counter-summary-note">Saves the order and independently dispatches the customer bill and garment tags.</p>
    </section>
  );
};
