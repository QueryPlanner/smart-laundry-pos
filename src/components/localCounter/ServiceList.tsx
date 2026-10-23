import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { addCounterService, setCounterServiceActive, type CounterService } from '@/lib/localFirst/counter';

interface Props {
  services: CounterService[];
  /** Fetch the catalogue again after a change. */
  onChanged: () => Promise<void>;
  onError: (error: unknown) => void;
  onNotice: (message: string) => void;
}

/**
 * The services, which are the sections of the New order screen. The administrator adds one (it shows
 * on the counter once a garment has a price for it) or removes one; a removed service stays on past
 * bills and can be brought back with its prices.
 */
export const ServiceList = ({ services, onChanged, onError, onNotice }: Props) => {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>, notice: string) => {
    setBusy(true);
    try { await action(); await onChanged(); onNotice(notice); } catch (error) { onError(error); } finally { setBusy(false); }
  };
  const active = services.filter(service => service.active);
  return (
    <section className="counter-service-list" aria-label="Services">
      <h3>Services (sections on the New order screen)</h3>
      <ul>
        {services.map(service => (
          <li key={service.id}>
            <span>{service.name}{!service.active && <small> · removed</small>}</span>
            {service.active
              ? <Button variant="outline" size="sm" disabled={busy || active.length === 1} onClick={() => void run(() => setCounterServiceActive(service.id, false), `${service.name} removed. Past bills keep it.`)}>Remove</Button>
              : <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => setCounterServiceActive(service.id, true), `${service.name} is back.`)}>Bring back</Button>}
          </li>
        ))}
      </ul>
      <form className="counter-add-staff" onSubmit={event => { event.preventDefault(); void run(async () => { await addCounterService(name); setName(''); }, 'Service added. Give it a price on the garments it is for.'); }}>
        <Label>New service<Input value={name} maxLength={30} placeholder="For example, Steam press" onChange={event => setName(event.target.value)} /></Label>
        <Button type="submit" disabled={busy || !name.trim()}>Add service</Button>
      </form>
    </section>
  );
};
