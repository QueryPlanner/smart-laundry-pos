import { useState } from 'react';
import { CalendarClock, Minus, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CounterCatalogue, CounterPaymentMethod, CounterQuote } from '@/lib/localFirst/counter';
import { formatPercentBp } from '@/lib/localFirst/discount';
import { advanceProblem, halfOf, parsePaymentAmountMinor, rupeesText } from '@/lib/localFirst/payment';

const money = (minor: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(minor / 100);
const promiseFormat = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
const METHODS: Array<{ value: CounterPaymentMethod; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'other', label: 'Other' },
];

interface OrderSummaryProps {
  catalogue: CounterCatalogue | null;
  lines: Record<string, number>;
  quote: CounterQuote | null;
  /** The price request was rejected (as opposed to still being calculated). */
  quoteFailed: boolean;
  customer: { name: string; phone: string };
  /** The advance the customer pays now, typed in rupees. An empty string means nothing is paid now. */
  advance: string;
  onAdvance: (text: string) => void;
  paymentMethod: CounterPaymentMethod;
  onPaymentMethod: (method: CounterPaymentMethod) => void;
  onRemove: (garmentId: string, serviceId: string) => void;
  onQuantity: (garmentId: string, quantity: number, serviceId?: string) => void;
  /** Change the price of one line for this bill only; `undefined` restores the rate-card price. */
  onPrice: (garmentId: string, serviceId: string, priceMinor: number | undefined) => void;
  onSave: () => void;
  busy: boolean;
}

/**
 * Price of one piece for this bill. Anyone at the counter can change it; typing the rate-card price (or
 * clearing the box) puts the line back on the rate card. It keeps its own text so "12." can be typed.
 */
const PriceField = ({ label, chargedMinor, listMinor, onChange }: { label: string; chargedMinor: number; listMinor: number; onChange: (priceMinor: number | undefined) => void }) => {
  const [text, setText] = useState(rupeesText(chargedMinor));
  const commit = (value: string) => {
    setText(value);
    const minor = parsePaymentAmountMinor(value);
    if (value.trim() === '' || minor === null) return;
    onChange(minor === listMinor ? undefined : minor);
  };
  return (
    <label className="counter-line-price">
      <span>₹ each</span>
      <input aria-label={label} inputMode="decimal" value={text} onChange={event => commit(event.target.value)} onBlur={() => setText(rupeesText(chargedMinor))} />
      {chargedMinor !== listMinor && <small>Rate card ₹{rupeesText(listMinor)}</small>}
    </label>
  );
};

/** Summary of the order being taken. The customer may pay any advance now, including nothing; the rest is due at pickup. */
export const OrderSummary = ({ catalogue, lines, quote, quoteFailed, customer, advance, onAdvance, paymentMethod, onPaymentMethod, onRemove, onQuantity, onPrice, onSave, busy }: OrderSummaryProps) => {
  const items = Object.entries(lines).filter(([, quantity]) => quantity > 0);
  const hasDiscount = (quote?.discountMinor ?? 0) > 0;
  const nothingToPay = quote !== null && quote.totalMinor === 0;
  // Never show 0.00 while there is no price: that reads as "free".
  const amount = (pick: (q: CounterQuote) => number) => (quote ? money(pick(quote)) : '—');
  const advanceError = quote && !nothingToPay ? advanceProblem(advance, quote.totalMinor) : null;
  const advanceMinor = parsePaymentAmountMinor(advance);
  const balanceText = quote && !nothingToPay && advanceError === null ? `Balance to pay at pickup ${money(quote.totalMinor - advanceMinor)}` : null;
  const methodsShown = !nothingToPay && advanceMinor !== null && advanceMinor > 0;
  const fillAdvance = (amountOf: (totalMinor: number) => number) => {
    if (quote) onAdvance(rupeesText(amountOf(quote.totalMinor)));
  };
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
              {line && <PriceField key={`${key}|${line.listPriceMinor}`} label={`${garment?.nameEn} price for this bill`} chargedMinor={line.unitPriceMinor} listMinor={line.listPriceMinor} onChange={price => onPrice(garmentId, serviceId, price)} />}
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
          ? <p>No payment due</p>
          : <>
            <p>Any amount can be paid now. The rest is due at pickup.</p>
            <Label htmlFor="advance-received">Advance received now</Label>
            <Input id="advance-received" inputMode="decimal" placeholder="0.00" value={advance} onChange={event => onAdvance(event.target.value)} />
            <div className="flex flex-wrap gap-2" role="group" aria-label="Quick amounts">
              <button type="button" className="counter-touch" onClick={() => onAdvance('')}>Nothing now</button>
              <button type="button" className="counter-touch" disabled={!quote} onClick={() => fillAdvance(halfOf)}>Half</button>
              <button type="button" className="counter-touch" disabled={!quote} onClick={() => fillAdvance(total => total)}>Full</button>
            </div>
            {advanceError && <p role="alert" className="text-sm font-semibold text-red-700">{advanceError}</p>}
            {balanceText && <p>{balanceText}</p>}
            {methodsShown && <div className="flex flex-wrap gap-2" role="group" aria-label="Payment method">
              {METHODS.map(method => <button key={method.value} type="button" className="counter-touch" aria-pressed={paymentMethod === method.value} onClick={() => onPaymentMethod(method.value)}>{method.label}</button>)}
            </div>}
          </>}
      </div>
      <Button className="counter-save" disabled={busy || !quote || items.length === 0 || !customer.name.trim() || advanceError !== null} onClick={onSave}>{busy ? 'Saving and dispatching…' : 'Save & Print'}</Button>
      {blocker && <p className="counter-save-reason">{blocker}</p>}
      <p className="counter-summary-note">Saves the order and independently dispatches the customer bill and garment tags.</p>
    </section>
  );
};
