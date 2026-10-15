import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { listCounterDiscounts, searchCounterCustomers, setCounterDiscount, type CounterDiscountRule } from '@/lib/localFirst/counter';
import { formatPercentBp, parsePercentBp } from '@/lib/localFirst/discount';

interface FoundCustomer { id: string; name: string; phone: string }
interface Props { onError: (error: unknown) => void; onNotice: (message: string) => void }

const PERCENT_HELP = 'Enter a percentage from 0 to 100 with at most two decimals.';
/** A shop-wide discount above this (50%) needs an extra tick, a guard against typing 100 instead of 10. */
const BROAD_DISCOUNT_BP = 5000;

/** Admin-only discounts: one shop-wide percentage and optional per-customer percentages, applied automatically. */
export const CounterDiscounts = ({ onError, onNotice }: Props) => {
  const [rules, setRules] = useState<CounterDiscountRule[]>([]);
  const [shopPercent, setShopPercent] = useState('');
  const [shopLabel, setShopLabel] = useState('');
  const [shopActive, setShopActive] = useState(true);
  const [shopConfirmed, setShopConfirmed] = useState(false);
  const [phone, setPhone] = useState('');
  const [matches, setMatches] = useState<FoundCustomer[]>([]);
  const [customer, setCustomer] = useState<FoundCustomer | null>(null);
  const [customerPercent, setCustomerPercent] = useState('');
  const [customerLabel, setCustomerLabel] = useState('');

  const load = useCallback(async () => {
    const loaded = await listCounterDiscounts();
    setRules(loaded);
    const shop = loaded.find(rule => rule.scope === 'all');
    setShopPercent(shop ? formatPercentBp(shop.percentBp) : '');
    setShopLabel(shop?.label ?? '');
    setShopActive(shop ? shop.active : true);
    setShopConfirmed(false);
  }, []);
  useEffect(() => { void load().catch(onError); }, [load, onError]);
  useEffect(() => {
    if (customer || phone.trim().length < 3) { setMatches([]); return; }
    let live = true;
    const timer = setTimeout(() => { void searchCounterCustomers(phone.trim()).then(found => { if (live) setMatches(found); }).catch(onError); }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [phone, customer, onError]);

  const shopBasisPoints = parsePercentBp(shopPercent);
  const shopNeedsConfirmation = shopActive && shopBasisPoints !== null && shopBasisPoints > BROAD_DISCOUNT_BP;

  const save = async (customerId: string | null, percentText: string, active: boolean, label: string) => {
    const basisPoints = parsePercentBp(percentText);
    if (basisPoints === null) { onError(new Error(PERCENT_HELP)); return false; }
    try {
      await setCounterDiscount(customerId, basisPoints, active, label);
      await load();
      onNotice('Discount saved. It applies automatically to new orders.');
      return true;
    } catch (error) { onError(error); return false; }
  };

  return (
    <div className="counter-discounts">
      <p>Discounts are applied automatically when an order is quoted; staff cannot change them. A customer's own percentage replaces the shop-wide one (use 0 for no discount).</p>
      <section className="counter-discount-block">
        <h2>All customers</h2>
        <Label htmlFor="shop-discount">Shop-wide discount %<Input id="shop-discount" inputMode="decimal" value={shopPercent} onChange={event => { setShopPercent(event.target.value); setShopConfirmed(false); }} placeholder="0" /></Label>
        <Label htmlFor="shop-discount-label">Label (optional)<Input id="shop-discount-label" value={shopLabel} onChange={event => setShopLabel(event.target.value)} /></Label>
        <label><input type="checkbox" aria-label="Shop-wide discount active" checked={shopActive} onChange={event => setShopActive(event.target.checked)} /> Active</label>
        {shopNeedsConfirmation && <label><input type="checkbox" checked={shopConfirmed} onChange={event => setShopConfirmed(event.target.checked)} /> I understand this applies to every customer</label>}
        <Button disabled={shopNeedsConfirmation && !shopConfirmed} onClick={() => void save(null, shopPercent, shopActive, shopLabel)}>Save shop-wide discount</Button>
      </section>
      <section className="counter-discount-block">
        <h2>Specific customer</h2>
        <Label htmlFor="discount-customer-phone">Customer mobile<Input id="discount-customer-phone" value={phone} inputMode="tel" onChange={event => { setPhone(event.target.value); setCustomer(null); }} placeholder="Search by mobile number" /></Label>
        {matches.length > 0 && <div role="listbox" aria-label="Matching customers">{matches.map(found => <button key={found.id} type="button" role="option" aria-selected={false} onClick={() => { setCustomer(found); setPhone(found.phone); setMatches([]); }}><strong>{found.name}</strong> <span>{found.phone}</span></button>)}</div>}
        {customer && <p>Selected: <strong>{customer.name}</strong> ({customer.phone})</p>}
        <Label htmlFor="customer-discount">Discount %<Input id="customer-discount" inputMode="decimal" value={customerPercent} onChange={event => setCustomerPercent(event.target.value)} placeholder="0" /></Label>
        <Label htmlFor="customer-discount-label">Label (optional)<Input id="customer-discount-label" value={customerLabel} onChange={event => setCustomerLabel(event.target.value)} /></Label>
        <Button disabled={!customer} onClick={() => { if (customer) void save(customer.id, customerPercent, true, customerLabel).then(saved => { if (saved) { setCustomer(null); setPhone(''); setCustomerPercent(''); setCustomerLabel(''); } }); }}>Save customer discount</Button>
      </section>
      <section className="counter-discount-block">
        <h2>Customer discounts</h2>
        {rules.filter(rule => rule.scope === 'customer').length === 0
          ? <p>No customer-specific discounts.</p>
          : <ul>{rules.filter(rule => rule.scope === 'customer').map(rule => (
            <li key={rule.id}>
              <strong>{rule.customerName}</strong> · {rule.customerPhone} · {formatPercentBp(rule.percentBp)}%{rule.label ? ` · ${rule.label}` : ''} · {rule.active ? 'Active' : 'Off'}
              <Button size="sm" variant="outline" onClick={() => void save(rule.customerId, formatPercentBp(rule.percentBp), !rule.active, rule.label)}>{rule.active ? 'Turn off' : 'Turn on'}</Button>
            </li>
          ))}</ul>}
      </section>
    </div>
  );
};
