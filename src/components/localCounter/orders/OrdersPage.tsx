import type { KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CounterOrderSummary, CounterQueueCounts } from '@/lib/localFirst/counter';
import { groupByDay } from '@/lib/localFirst/orders/orderDays';
import type { OrderSegment } from '@/lib/localFirst/orders/useOrderList';
import { EmptyState, FormField, PageHeader } from '../ui';
import { OrderRow } from './OrderRow';

export interface OrdersPageProps {
  query: string; onQuery(query: string): void;
  segment: OrderSegment; onSegment(segment: OrderSegment): void;
  /** Today, shop-local `YYYY-MM-DD`, for the day headings. */
  today: string;
  counts: CounterQueueCounts | null;
  results: CounterOrderSummary[]; loading: boolean; hasMore: boolean; onLoadMore(): void;
  isAdmin: boolean;
  onOpen(orderId: string): void;
  onCustomer(phone: string): void;
  onPreviewBill(orderId: string, orderNumber: string): void;
  onTrash(orderId: string, orderNumber: string): void;
  onRequestTrash(orderId: string, orderNumber: string, reason: string): void;
  busy: boolean;
}

const TABS: Array<{ segment: OrderSegment; label: string; countOf(counts: CounterQueueCounts): number }> = [
  { segment: 'open', label: 'Not collected', countOf: counts => counts.open },
  { segment: 'collected', label: 'Collected', countOf: counts => counts.collected },
  { segment: 'all', label: 'All', countOf: counts => counts.all },
];

const EMPTY_MESSAGE: Record<OrderSegment, string> = {
  open: 'Every order has been collected.',
  collected: 'No order has been collected yet.',
  all: 'No orders yet.',
};

/**
 * The Orders / Pickup list, newest first under a heading for each day. A search looks through every
 * order; a single character is too vague to search, so it only shows a hint.
 */
export const OrdersPage = ({ query, onQuery, segment, onSegment, today, counts, results, loading, hasMore, onLoadMore, isAdmin, onOpen, onCustomer, onPreviewBill, onTrash, onRequestTrash, busy }: OrdersPageProps) => {
  const searching = query !== '';
  const shortQuery = query.trim().length === 1;
  const shown = shortQuery ? [] : results;

  // Enter opens the one order the search found, so a scanned or typed bill number goes straight to it.
  const openSingleResult = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !busy && shown.length === 1) onOpen(shown[0].id);
  };

  return (
    <section className="counter-page">
      <PageHeader title="Orders / Pickup" />
      <div className="counter-filters">
        <FormField label="Search bill number, phone, name or tag ID">
          <Input type="search" autoFocus value={query} placeholder="Bill no., last 4 digits, phone or name" onChange={event => onQuery(event.target.value)} onKeyDown={openSingleResult} />
        </FormField>
      </div>
      {searching ? (
        <div className="counter-search-mode">
          <span>Searching all orders</span>
          <Button variant="outline" size="sm" onClick={() => onQuery('')}>Clear</Button>
        </div>
      ) : (
        <div className="counter-segments" role="group" aria-label="Which orders">
          {TABS.map(tab => (
            <button key={tab.segment} type="button" className="counter-touch" aria-pressed={segment === tab.segment} onClick={() => onSegment(tab.segment)}>
              {tab.label}{counts && <span className="counter-segment-count">{tab.countOf(counts)}</span>}
            </button>
          ))}
        </div>
      )}
      {loading && <p role="status">Loading orders…</p>}
      {shortQuery && <p className="counter-search-hint">Type at least 2 characters.</p>}
      {shown.length > 0 && (
        <ul className="counter-order-list" aria-label="Orders">
          {groupByDay(shown, today).map(group => [
            <li key={`day-${group.date}`} className="counter-day-heading" role="presentation"><h2>{group.heading}</h2></li>,
            ...group.orders.map(order => (
              <OrderRow key={order.id} order={order} isAdmin={isAdmin} busy={busy} onOpen={onOpen} onCustomer={onCustomer} onPreviewBill={onPreviewBill} onTrash={onTrash} onRequestTrash={onRequestTrash} />
            )),
          ])}
        </ul>
      )}
      {!loading && !shortQuery && shown.length === 0 && (
        <EmptyState>{searching ? 'No order matches. Check the number or search by phone.' : EMPTY_MESSAGE[segment]}</EmptyState>
      )}
      {hasMore && !shortQuery && (
        <div className="counter-load-more">
          <Button variant="outline" disabled={busy || loading} onClick={onLoadMore}>Load more</Button>
        </div>
      )}
    </section>
  );
};
