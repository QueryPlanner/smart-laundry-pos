import { useRef, useState } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CounterCatalogue, CounterQuote } from '@/lib/localFirst/counter';
import { formatPercentBp } from '@/lib/localFirst/discount';
import { DISCOUNT_PERCENTS, discountProblem, percentOff } from '@/lib/localFirst/manualDiscount';
import { parsePaymentAmountMinor, rupeesText } from '@/lib/localFirst/payment';

const money = (minor: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(minor / 100);

interface OrderSummaryProps {
  catalogue: CounterCatalogue | null;
  lines: Record<string, number>;
  quote: CounterQuote | null;
  /** The price request was rejected (as opposed to still being calculated). */
  quoteFailed: boolean;
  customer: { name: string; phone: string };
  /** An extra discount for this bill, typed in rupees. An empty string means none. */
  discount: string;
  onDiscount: (text: string) => void;
  onRemove: (garmentId: string, serviceId: string) => void;
  onQuantity: (garmentId: string, quantity: number, serviceId?: string) => void;
  /** Change the price of one line for this bill only; `undefined` restores the rate-card price. */
  onPrice: (garmentId: string, serviceId: string, priceMinor: number | undefined) => void;
  onSave: () => void;
  /** Show the bill on screen before saving. Stores nothing. */
  onPreview: () => void;
  /** Throw the order being taken away, after the operator confirms. */
  onClear: () => void;
  busy: boolean;
}

/**
 * Price of one piece for this bill. Anyone at the counter can change it; typing the rate-card price (or
 * clearing the box) puts the line back on the rate card. It keeps its own text so "12." can be typed.
 * The box stays closed until asked for, so a long order fits without scrolling.
 */
const PriceField = ({ label, chargedMinor, listMinor, onChange }: { label: string; chargedMinor: number; listMinor: number; onChange: (priceMinor: number | undefined) => void }) => {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(rupeesText(chargedMinor));
  const commit = (value: string) => {
    setText(value);
    const minor = parsePaymentAmountMinor(value);
    if (value.trim() === '' || minor === null) return;
    onChange(minor === listMinor ? undefined : minor);
  };
  if (!open) return <button type="button" className="counter-link counter-line-price-toggle" onClick={() => { setText(rupeesText(chargedMinor)); setOpen(true); }}>{chargedMinor !== listMinor ? `Rate card ₹${rupeesText(listMinor)} · change` : 'Change price'}</button>;
  return (
    <label className="counter-line-price">
      <span>₹ each</span>
      <input aria-label={label} inputMode="decimal" autoFocus value={text} onChange={event => commit(event.target.value)} onBlur={() => { setText(rupeesText(chargedMinor)); setOpen(false); }} />
      {chargedMinor !== listMinor && <small>Rate card ₹{rupeesText(listMinor)}</small>}
    </label>
  );
};

/** Summary of the order being taken. Nothing is paid now: the customer pays when collecting. */
export const OrderSummary = ({ catalogue, lines, quote, quoteFailed, customer, discount, onDiscount, onRemove, onQuantity, onPrice, onSave, onPreview, onClear, busy }: OrderSummaryProps) => {
  const items = Object.entries(lines).filter(([, quantity]) => quantity > 0);
  // The quote is worked out again after every change. The price box keeps to the last one meanwhile, so
  // it stays open (and keeps the typing) instead of vanishing until the new price arrives.
  const lastQuote = useRef(quote);
  if (quote) lastQuote.current = quote;
  // The automatic discount (a percentage rule) and the extra one given by hand are shown on separate lines.
  const manualMinor = quote?.manualDiscountMinor ?? 0;
  const automaticMinor = quote ? quote.discountMinor - manualMinor : 0;
  const owedBeforeExtra = quote ? quote.subtotalMinor - automaticMinor : 0;
  const [discountOpen, setDiscountOpen] = useState(false);
  const showDiscount = discountOpen || discount.trim() !== '';
  const extraProblem = discountProblem(discount);
  const [confirmClear, setConfirmClear] = useState(false);
  // Never show 0.00 while there is no price: that reads as "free".
  const amount = (pick: (q: CounterQuote) => number) => (quote ? money(pick(quote)) : '—');
  const saveBlocker = (): string => {
    if (!customer.name.trim()) return 'Enter the customer name';
    if (items.length === 0) return 'Add at least one garment';
    if (!quote) return quoteFailed ? 'The price could not be worked out. See the message above.' : 'Working out the price…';
    return '';
  };
  const blocker = saveBlocker();
  const cannotSave = busy || !quote || items.length === 0 || !customer.name.trim() || extraProblem !== null;
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
        ? <p className="counter-empty">Tap a service on a garment to add it.</p>
        : <div className="counter-summary-lines">{items.map(([key, quantity]) => {
          const [garmentId, serviceId] = key.split('|');
          const garment = catalogue?.garments.find(x => x.id === garmentId);
          const service = catalogue?.services.find(x => x.id === serviceId);
          const line = quote?.lines.find(x => x.garmentId === garmentId && x.serviceId === serviceId);
          const priced = lastQuote.current?.lines.find(x => x.garmentId === garmentId && x.serviceId === serviceId);
          return (
            <div className="counter-summary-line" key={key}>
              <div><strong>{garment?.nameEn}</strong><span>{service?.name} · {line ? `${quantity} × ${money(line.unitPriceMinor)} = ${money(line.lineTotalMinor)}` : 'Quote…'}</span></div>
              <div className="counter-summary-controls">
                <button aria-label={`Remove ${garment?.nameEn}`} onClick={() => onRemove(garmentId, serviceId)}><Trash2 /></button>
                <button aria-label={`Decrease ${garment?.nameEn}`} onClick={() => onQuantity(garmentId, quantity - 1, serviceId)}><Minus /></button>
                <input aria-label={`${garment?.nameEn} summary quantity`} value={quantity} type="number" min="0" onChange={event => onQuantity(garmentId, Math.max(0, Math.floor(Number(event.target.value) || 0)), serviceId)} />
                <button aria-label={`Increase ${garment?.nameEn}`} onClick={() => onQuantity(garmentId, quantity + 1, serviceId)}><Plus /></button>
              </div>
              {priced && <PriceField key={`${key}|${priced.listPriceMinor}`} label={`${garment?.nameEn} price for this bill`} chargedMinor={priced.unitPriceMinor} listMinor={priced.listPriceMinor} onChange={price => onPrice(garmentId, serviceId, price)} />}
            </div>
          );
        })}</div>}
      <div className="counter-discount">
        {showDiscount ? (
          <>
            <Label htmlFor="bill-discount">Discount on this bill (₹)</Label>
            <Input id="bill-discount" inputMode="decimal" placeholder="0" value={discount} onChange={event => onDiscount(event.target.value)} />
            <div className="flex flex-wrap gap-2" role="group" aria-label="Quick discounts">
              {DISCOUNT_PERCENTS.map(percent => (
                <button key={percent} type="button" className="counter-touch" disabled={!quote} onClick={() => quote && onDiscount(rupeesText(percentOff(quote.subtotalMinor, percent, owedBeforeExtra)))}>{`${percent}%`}</button>
              ))}
              <button type="button" className="counter-touch" onClick={() => { onDiscount(''); setDiscountOpen(false); }}>No discount</button>
            </div>
            {extraProblem && <p role="alert" className="text-sm font-semibold text-red-700">{extraProblem}</p>}
          </>
        ) : (
          <Button variant="outline" className="counter-touch" onClick={() => setDiscountOpen(true)}>Give a discount</Button>
        )}
      </div>
      <div className="counter-totals">
        <div><span>Subtotal</span><strong>{amount(q => q.subtotalMinor)}</strong></div>
        {automaticMinor > 0 && quote && <div><span>Discount ({formatPercentBp(quote.discountPercentBp)}%)</span><strong>-{money(automaticMinor)}</strong></div>}
        {manualMinor > 0 && <div><span>Extra discount</span><strong>-{money(manualMinor)}</strong></div>}
        <div className="balance"><span>Total</span><strong>{amount(q => q.totalMinor)}</strong></div>
      </div>
      <Button className="counter-save" disabled={cannotSave} onClick={onSave}>{busy ? 'Saving and dispatching…' : 'Save & Print'}</Button>
      <Button variant="outline" className="counter-touch counter-preview-button" disabled={cannotSave} onClick={onPreview}>Preview bill</Button>
      {blocker && <p className="counter-save-reason">{blocker}</p>}
      {(items.length > 0 || customer.name.trim() !== '' || customer.phone.trim() !== '') && (confirmClear
        ? <div className="counter-clear-draft" role="group" aria-label="Clear this order">
          <span>Throw this order away?</span>
          <Button variant="destructive" size="sm" onClick={() => { setConfirmClear(false); setDiscountOpen(false); onClear(); }}>Yes, clear it</Button>
          <Button variant="outline" size="sm" onClick={() => setConfirmClear(false)}>No</Button>
        </div>
        : <button type="button" className="counter-link" onClick={() => setConfirmClear(true)}>Clear order</button>)}
    </section>
  );
};
