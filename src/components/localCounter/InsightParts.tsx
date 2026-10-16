import { statusText } from '@/lib/localFirst/salesRange';

const STATUS_TONE: Record<string, string> = { ready: 'good', cancelled: 'bad', collected: '' };

/** An order status as a coloured pill: ready is green, cancelled red, work in hand amber. */
export const StatusBadge = ({ status }: { status: string }) => (
  <span className={`counter-badge ${STATUS_TONE[status] ?? 'warn'}`.trim()}>{statusText(status)}</span>
);

/** A bill number that opens the order in Orders / Pickup. */
export const OrderLink = ({ id, number, onOpen }: { id: string; number: string; onOpen: (orderId: string) => void }) => (
  <button type="button" className="counter-link-button counter-bill-link" onClick={() => onOpen(id)}>{number}</button>
);
