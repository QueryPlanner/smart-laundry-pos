import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CLEAR_ORDERS_CONFIRMATION, clearCounterOrders } from '@/lib/localFirst/counter';

interface Props { onError: (error: unknown) => void; onNotice: (message: string) => void }

/**
 * Starting afresh, for example after trying the app with made-up orders. Every order and customer is
 * removed after a backup; the rate card, staff and settings stay. The owner must type the word first.
 */
export const ClearOrders = ({ onError, onNotice }: Props) => {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  const close = () => { setOpen(false); setTyped(''); };
  const clear = async () => {
    setBusy(true);
    try {
      const cleared = await clearCounterOrders(typed);
      close();
      onNotice(`Removed ${cleared.orders} orders and ${cleared.customers} customers. A backup from just before is saved at ${cleared.backupPath}.`);
    } catch (error) { onError(error); } finally { setBusy(false); }
  };

  return (
    <section className="counter-clear-orders" aria-label="Clear all orders">
      <h3>Start afresh</h3>
      <p>Removes every order, payment and customer, for example after trying the app with made-up orders. The rate card, staff, shop settings and expenses stay. A backup is saved first, so this can be undone with Restore.</p>
      {open ? (
        <div role="group" aria-label="Confirm clearing all orders">
          <Label htmlFor="clear-orders-word">{`Type ${CLEAR_ORDERS_CONFIRMATION} to confirm`}</Label>
          <Input id="clear-orders-word" autoComplete="off" value={typed} onChange={event => setTyped(event.target.value)} />
          <Button variant="destructive" disabled={busy || typed.trim() !== CLEAR_ORDERS_CONFIRMATION} onClick={() => void clear()}>{busy ? 'Clearing…' : 'Remove every order and customer'}</Button>
          <Button variant="outline" disabled={busy} onClick={close}>Keep everything</Button>
        </div>
      ) : (
        <Button variant="outline" onClick={() => setOpen(true)}>Clear all orders…</Button>
      )}
    </section>
  );
};
