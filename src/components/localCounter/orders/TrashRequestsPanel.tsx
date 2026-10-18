import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { dismissCounterTrashRequest, listCounterTrashRequests, trashCounterOrder, type CounterTrashRequest } from '@/lib/localFirst/counter';
import { money } from '../ui';

export interface TrashRequestsPanelProps {
  onError(error: unknown): void;
  onNotice(message: string): void;
  /** Called after a request was decided, so the order list can refresh. */
  onChanged(): void;
}

/**
 * Admin only. Bills that staff marked for the trash, with the reason. "Move to trash" removes the
 * bill from sales and lists (nothing is deleted); "Keep bill" clears the request.
 */
export const TrashRequestsPanel = ({ onError, onNotice, onChanged }: TrashRequestsPanelProps) => {
  const [requests, setRequests] = useState<CounterTrashRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => listCounterTrashRequests().then(setRequests).catch(onError), [onError]);
  useEffect(() => { void load(); }, [load]);
  const decide = async (request: CounterTrashRequest, trash: boolean) => {
    setBusy(true);
    try {
      if (trash) await trashCounterOrder(request.orderId); else await dismissCounterTrashRequest(request.orderId);
      onNotice(trash ? `Order ${request.orderNumber} moved to the trash.` : `Order ${request.orderNumber} kept.`);
      onChanged();
      await load();
    } catch (error) { onError(error); } finally { setBusy(false); }
  };
  if (requests.length === 0) return null;
  return (
    <section className="counter-trash-requests" aria-label="Trash requests">
      <h2>Trash requests ({requests.length})</h2>
      <ul>
        {requests.map(request => (
          <li key={request.orderId}>
            <div>
              <strong>Bill {request.orderNumber} · {request.customerName} · {money(request.totalMinor)}</strong>
              <span>{request.requestedBy ? `${request.requestedBy}: ` : ''}{request.reason}</span>
            </div>
            <Button variant="destructive" size="sm" disabled={busy} onClick={() => void decide(request, true)}>Move to trash</Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void decide(request, false)}>Keep bill</Button>
          </li>
        ))}
      </ul>
    </section>
  );
};
