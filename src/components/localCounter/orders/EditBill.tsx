import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  editCounterOrder, quoteCounterOrder, voidCounterPayment,
  type CounterCatalogue, type CounterOrderInput, type CounterQuote, type CounterSavedOrder,
} from '@/lib/localFirst/counter';
import { parsePaymentAmountMinor, rupeesText } from '@/lib/localFirst/payment';
import { formatShopDateTime, methodText } from '@/lib/localFirst/salesRange';
import { money } from '../ui';

interface Props {
  order: CounterSavedOrder;
  catalogue: CounterCatalogue;
  onSaved: (order: CounterSavedOrder) => void;
  onCancel: () => void;
  onError: (error: unknown) => void;
  onNotice: (message: string) => void;
}

interface DraftLine { garmentId: string; serviceId: string; label: string; quantity: string; price: string }

/** A whole number of pieces from 1 to 200, or null. */
const parseQuantity = (text: string): number | null => (/^\d{1,3}$/.test(text.trim()) && Number(text) >= 1 && Number(text) <= 200 ? Number(text) : null);

/**
 * Admin only: correct a saved bill. The customer, the lines (garment, service, quantity, price) and
 * the extra discount can all change; payments stay as recorded and the balance follows the new
 * total. Individual payments can be voided here too. Everything is one page that scrolls with the
 * app, and nothing is saved until Save.
 */
export const EditBill = ({ order, catalogue, onSaved, onCancel, onError, onNotice }: Props) => {
  const [name, setName] = useState(order.customerName);
  const [phone, setPhone] = useState(order.customerPhone);
  const [lines, setLines] = useState<DraftLine[]>(() => order.lines.map(line => ({
    garmentId: line.garmentId, serviceId: line.serviceId, label: `${line.garment} · ${line.service}`,
    quantity: String(line.quantity), price: rupeesText(line.unitPriceMinor),
  })));
  const [discount, setDiscount] = useState(order.manualDiscountMinor > 0 ? rupeesText(order.manualDiscountMinor) : '');
  const [reason, setReason] = useState('');
  const [addGarment, setAddGarment] = useState('');
  const [addService, setAddService] = useState('');
  const [quote, setQuote] = useState<CounterQuote | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [busy, setBusy] = useState(false);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');

  // Once a piece has been packed or handed over, only prices, the customer and payments can change.
  const itemsLocked = order.pieces.some(piece => piece.matched || piece.packingMatched || piece.collectionMatched);

  const input = useMemo((): CounterOrderInput | string => {
    if (!name.trim()) return 'Enter the customer name.';
    const discountMinor = parsePaymentAmountMinor(discount);
    if (discountMinor === null) return 'Enter the extra discount in rupees, for example 50 or 50.50.';
    const items = [];
    for (const line of lines) {
      const quantity = parseQuantity(line.quantity);
      const price = parsePaymentAmountMinor(line.price);
      if (quantity === null) return `Quantity for ${line.label} must be a whole number from 1 to 200.`;
      if (price === null || line.price.trim() === '') return `Enter a price for ${line.label}.`;
      items.push({ garmentId: line.garmentId, serviceId: line.serviceId, quantity, unitPriceOverrideMinor: price });
    }
    return { customer: { name: name.trim(), phone: phone.trim() }, items, manualDiscountMinor: discountMinor };
  }, [name, phone, lines, discount]);
  const problem = typeof input === 'string' ? input : quoteError;

  useEffect(() => {
    if (typeof input === 'string') { setQuote(null); return undefined; }
    let live = true;
    const timer = setTimeout(() => {
      quoteCounterOrder(input).then(result => { if (live) { setQuote(result); setQuoteError(''); } })
        .catch(error => { if (live) { setQuote(null); setQuoteError(error instanceof Error ? error.message : String(error)); } });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [input]);

  const setLine = (index: number, change: Partial<DraftLine>) => setLines(current => current.map((line, i) => (i === index ? { ...line, ...change } : line)));
  // Every garment and service pair the rate card sells, with its price.
  const sellable = catalogue.rates.flatMap(rate => (rate.configured && rate.available && rate.priceMinor !== null ? [{ garmentId: rate.garmentId, serviceId: rate.serviceId, priceMinor: rate.priceMinor }] : []));
  const garmentsToAdd = catalogue.garments.filter(garment => garment.active && sellable.some(rate => rate.garmentId === garment.id));
  const servicesToAdd = catalogue.services.filter(service => service.active && sellable.some(rate => rate.garmentId === addGarment && rate.serviceId === service.id));
  const choice = (() => {
    const garment = catalogue.garments.find(g => g.id === addGarment);
    const service = servicesToAdd.find(s => s.id === addService);
    const rate = sellable.find(r => r.garmentId === addGarment && r.serviceId === addService);
    return garment && service && rate ? { garmentId: garment.id, serviceId: service.id, label: `${garment.nameEn} · ${service.name}`, priceMinor: rate.priceMinor } : null;
  })();
  const addChosen = (item: NonNullable<typeof choice>) => {
    const existing = lines.findIndex(line => line.garmentId === item.garmentId && line.serviceId === item.serviceId);
    if (existing >= 0) setLine(existing, { quantity: String((parseQuantity(lines[existing].quantity) ?? 0) + 1) });
    else setLines(current => [...current, { garmentId: item.garmentId, serviceId: item.serviceId, label: item.label, quantity: '1', price: rupeesText(item.priceMinor) }]);
    setAddGarment(''); setAddService('');
  };

  const reasonOk = reason.trim().length >= 3 && reason.trim().length <= 200;
  const ready = typeof input !== 'string' && quote ? { input, quote } : null;
  const save = async (checked: { input: CounterOrderInput; quote: CounterQuote }) => {
    setBusy(true);
    try {
      const saved = await editCounterOrder(order.orderId, { ...checked.input, reason: reason.trim(), reviewedTotalMinor: checked.quote.totalMinor });
      onSaved(saved);
      onNotice('Bill updated. Reprint the bill or tags if the customer needs new copies.');
    } catch (error) { onError(error); } finally { setBusy(false); }
  };
  const voidPayment = async (paymentId: string) => {
    setBusy(true);
    try {
      const saved = await voidCounterPayment(order.orderId, paymentId, voidReason.trim());
      setVoiding(null); setVoidReason('');
      onSaved(saved);
      onNotice('Payment voided. Give the money back to the customer if it was already taken.');
    } catch (error) { onError(error); } finally { setBusy(false); }
  };

  const newBalance = quote ? quote.totalMinor - order.paidMinor : null;
  const live = order.payments.filter(payment => !payment.voided);

  return (
    <section className="counter-page counter-edit-bill" aria-label="Edit bill">
      <header className="counter-detail-head">
        <Button variant="outline" className="counter-touch" disabled={busy} onClick={onCancel}>← Back to bill</Button>
        <div><h1>{`Edit bill ${order.orderNumber}`}</h1><p>Change what is wrong, give a reason, then Save. Nothing changes until you save.</p></div>
      </header>

      <section className="counter-panel counter-edit-customer" aria-label="Customer">
        <Label>Customer name<Input value={name} maxLength={80} onChange={event => setName(event.target.value)} /></Label>
        <Label>Mobile number<Input value={phone} inputMode="tel" onChange={event => setPhone(event.target.value)} /></Label>
      </section>

      <section className="counter-panel" aria-label="Items">
        <h2>Items</h2>
        {itemsLocked && <p role="status" className="counter-summary-note">Some items were already packed or handed over, so items and quantities are locked. Prices, the customer and payments can still change.</p>}
        <ul className="counter-edit-lines">
          {lines.map((line, index) => (
            <li key={`${line.garmentId}|${line.serviceId}`}>
              <strong>{line.label}</strong>
              <Label>Quantity<Input aria-label={`Quantity of ${line.label}`} inputMode="numeric" value={line.quantity} disabled={itemsLocked} onChange={event => setLine(index, { quantity: event.target.value })} /></Label>
              <Label>Price each (₹)<Input aria-label={`Price of ${line.label}`} inputMode="decimal" value={line.price} onChange={event => setLine(index, { price: event.target.value })} /></Label>
              <Button type="button" variant="outline" size="sm" disabled={itemsLocked || lines.length === 1} onClick={() => setLines(current => current.filter((_, i) => i !== index))}>{`Remove ${line.label}`}</Button>
            </li>
          ))}
        </ul>
        {!itemsLocked && <div className="counter-edit-add">
          <Label>Add garment
            <select value={addGarment} onChange={event => { setAddGarment(event.target.value); setAddService(''); }}>
              <option value="">Choose a garment</option>
              {garmentsToAdd.map(garment => <option key={garment.id} value={garment.id}>{garment.nameEn}</option>)}
            </select>
          </Label>
          <Label>Service
            <select value={addService} disabled={!addGarment} onChange={event => setAddService(event.target.value)}>
              <option value="">Choose a service</option>
              {servicesToAdd.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}
            </select>
          </Label>
          {choice && <Button type="button" variant="outline" onClick={() => addChosen(choice)}>Add item</Button>}
        </div>}
        <Label>Extra discount (₹)<Input inputMode="decimal" placeholder="0" value={discount} onChange={event => setDiscount(event.target.value)} /></Label>
      </section>

      <section className="counter-panel" aria-label="Payments">
        <h2>Payments</h2>
        {order.payments.length === 0 && <p>No payments were taken.</p>}
        <ul className="counter-edit-payments">
          {order.payments.map(payment => (
            <li key={payment.id}>
              <span>{formatShopDateTime(payment.at)}</span>
              <span>{methodText(payment.method)}</span>
              <strong>{money(payment.amountMinor)}</strong>
              {payment.voided
                ? <span>Voided</span>
                : voiding === payment.id
                  ? <span className="counter-edit-void">
                    <Input aria-label="Reason for voiding" placeholder="Reason" maxLength={200} value={voidReason} onChange={event => setVoidReason(event.target.value)} />
                    <Button type="button" size="sm" disabled={busy || voidReason.trim().length < 3} onClick={() => void voidPayment(payment.id)}>Confirm void</Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => { setVoiding(null); setVoidReason(''); }}>Keep payment</Button>
                  </span>
                  : <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setVoiding(payment.id); setVoidReason(''); }}>{`Void ${money(payment.amountMinor)} payment`}</Button>}
            </li>
          ))}
        </ul>
        {live.length > 0 && <p className="counter-summary-note">A voided payment stays in the history. Hand the money back to the customer yourself.</p>}
      </section>

      <section className="counter-panel counter-edit-save" aria-label="Save">
        <div><span>Was</span><strong>{money(order.totalMinor)}</strong></div>
        <div><span>Now</span><strong>{quote ? money(quote.totalMinor) : '…'}</strong></div>
        <div><span>Paid</span><strong>{money(order.paidMinor)}</strong></div>
        <div><span>{newBalance !== null && newBalance < 0 ? 'To give back' : 'Balance'}</span><strong>{newBalance === null ? '…' : money(Math.abs(newBalance))}</strong></div>
        <Label>Reason for the change<Input value={reason} maxLength={200} placeholder="For example, customer added a shirt" onChange={event => setReason(event.target.value)} /></Label>
        {problem && <p role="alert" className="text-sm font-semibold text-red-700">{problem}</p>}
        <div className="counter-edit-actions">
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>
          {ready
            ? <Button type="button" disabled={busy || !reasonOk} onClick={() => void save(ready)}>{busy ? 'Saving…' : 'Save changes'}</Button>
            : <Button type="button" disabled>Save changes</Button>}
        </div>
      </section>
    </section>
  );
};
