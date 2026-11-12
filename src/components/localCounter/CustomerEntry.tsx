import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CounterCustomerMatch } from '@/lib/localFirst/counter';
import type { CustomerDraft } from './customerDraft';

const problem = (error: unknown) => (error instanceof Error ? error.message : String(error || 'Something went wrong.'));

interface Props {
  customer: CustomerDraft;
  onChange: (customer: CustomerDraft) => void;
  search: (query: string) => Promise<CounterCustomerMatch[]>;
}

/**
 * Name, mobile number and an optional address. Typing looks customers up by mobile or name; the
 * operator must pick a result before its saved details fill the form. Editing the name or mobile
 * afterwards clears that selection so the quote and bill use the identity that is really typed.
 */
export const CustomerEntry = ({ customer, onChange, search }: Props) => {
  const [hits, setHits] = useState<CounterCustomerMatch[]>([]);
  const [searchError, setSearchError] = useState('');
  // A selected customer needs no lookup; otherwise the mobile number wins over the name.
  const query = customer.customerId ? '' : customer.phone.trim().length >= 3 ? customer.phone.trim() : customer.name.trim().length >= 2 ? customer.name.trim() : '';

  useEffect(() => {
    if (!query) { setHits([]); return undefined; }
    let live = true;
    const timer = setTimeout(() => void search(query).then(found => {
      if (!live) return;
      setHits(found);
      setSearchError('');
    }).catch(error => { if (live) setSearchError(problem(error)); }), 250);
    return () => { live = false; clearTimeout(timer); };
  }, [query, search]);

  const edit = (patch: Partial<CustomerDraft>) => onChange({ ...customer, ...patch, customerId: undefined, addressLocked: false });
  const select = (match: CounterCustomerMatch) => {
    const address = match.address ?? '';
    onChange({ name: match.name, phone: match.phone, address, customerId: match.id, addressLocked: address.trim() !== '' });
    setHits([]);
  };

  return <section className="counter-customer counter-panel">
    <div><span className="counter-section-label">Customer</span><p>Look up by mobile or name, or add a new customer</p></div>
    <Label>Name<Input value={customer.name} maxLength={100} autoComplete="name" placeholder="Customer name" onChange={event => edit({ name: event.target.value })} /></Label>
    <Label>Mobile number<Input value={customer.phone} maxLength={20} inputMode="tel" autoComplete="tel" placeholder="10-digit mobile" onChange={event => edit({ phone: event.target.value })} /></Label>
    <Label className="counter-customer-address">Address (optional)<Input value={customer.address} maxLength={300} autoComplete="street-address" readOnly={customer.addressLocked} onChange={event => onChange({ ...customer, address: event.target.value })} /></Label>
    {customer.addressLocked && <p className="counter-customer-note">This is the saved address. Correct it on the Customers screen.</p>}
    {hits.length > 0 && <div className="counter-customer-matches" role="listbox" aria-label="Matching customers">
      {hits.map(match => <button type="button" role="option" aria-selected={customer.customerId === match.id} key={match.id} onClick={() => select(match)}><strong>{match.name}</strong><span>{match.phone}</span></button>)}
    </div>}
    {searchError && <p role="status">Customer lookup unavailable; enter details manually.</p>}
  </section>;
};
