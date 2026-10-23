import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { listCounterTrashedOrders, restoreCounterOrder, type CounterTrashedOrder } from '@/lib/localFirst/counter';
import { formatShopDateTime } from '@/lib/localFirst/salesRange';
import { EmptyState, PageHeader, money } from './ui';
import type { SectionProps } from './sections';

/**
 * Admin only. Every order that was moved to the trash, newest first, with a one-tap Restore. A trashed
 * order is not counted in the order lists, sales, the dashboard or customer totals; nothing is deleted.
 */
export const TrashPage = ({ onError, onNotice }: SectionProps) => {
  const [orders, setOrders] = useState<CounterTrashedOrder[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => listCounterTrashedOrders().then(setOrders).catch(onError), [onError]);
  useEffect(() => { void load(); }, [load]);

  const restore = async (order: CounterTrashedOrder) => {
    setBusy(true);
    try {
      await restoreCounterOrder(order.orderId);
      onNotice(`Order ${order.orderNumber} restored. It counts in sales and the order list again.`);
      await load();
    } catch (error) { onError(error); } finally { setBusy(false); }
  };

  return (
    <section className="counter-page">
      <PageHeader title="Trash" subtitle="Orders moved to the trash are not counted in sales, the dashboard or the order list. Restore one to bring it back." />
      {orders === null ? null : orders.length === 0 ? <EmptyState>The trash is empty.</EmptyState> : (
        <ul className="counter-trash-list" aria-label="Orders in the trash">
          {orders.map(order => (
            <li key={order.orderId} className="counter-panel">
              <div>
                <strong>{`Bill ${order.orderNumber} · ${order.customerName} · ${money(order.totalMinor)}`}</strong>
                <span>{`${order.customerPhone} · received ${formatShopDateTime(order.receivedAt)}`}</span>
                <span>{`Moved to the trash ${formatShopDateTime(order.trashedAt)}${order.trashedBy ? ` by ${order.trashedBy}` : ''}`}</span>
                {order.reason && <span>{`Reason: ${order.reason}`}</span>}
              </div>
              <Button className="counter-touch" disabled={busy} onClick={() => void restore(order)}>Restore</Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
