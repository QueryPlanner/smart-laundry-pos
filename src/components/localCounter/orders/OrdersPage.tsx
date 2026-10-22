import type { KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CounterOrderFilter, CounterOrderSummary, CounterQueueCounts } from '@/lib/localFirst/counter';
import { count, EmptyState, FormField, money, PageHeader, StatCard, type StatTone } from '../ui';
import { OrderRow } from './OrderRow';
import { SegmentBar } from './SegmentBar';

export interface OrdersPageProps {
  query: string; onQuery(query: string): void;
  segment: CounterOrderFilter; onSegment(segment: CounterOrderFilter): void;
  counts: CounterQueueCounts | null;
  results: CounterOrderSummary[]; loading: boolean; hasMore: boolean; onLoadMore(): void;
  onOpen(orderId: string): void;       // open the order detail
  onHandover(orderId: string): void;   // open the handover screen
  onReprintBill(orderId: string): void; // print the bill again, without opening the order
  busy: boolean;
}

const EMPTY_MESSAGE: Record<CounterOrderFilter, string> = {
  all: 'No orders yet.',
  ready: 'Nothing is ready for pickup.',
  balance_due: 'No balances to collect.',
  overdue: 'No overdue orders.',
  in_process: 'Nothing is in process.',
  today: 'No orders received today.',
};

/**
 * The Orders / Pickup list. A search replaces the segment filters and searches every order; a single
 * character is too vague to search, so it only shows a hint.
 */
export const OrdersPage = ({ query, onQuery, segment, onSegment, counts, results, loading, hasMore, onLoadMore, onOpen, onHandover, onReprintBill, busy }: OrdersPageProps) => {
  const searching = query !== '';
  const shortQuery = query.trim().length === 1;
  const shown = shortQuery ? [] : results;
  const collectTone: StatTone = counts && counts.balanceDue > 0 ? 'warn' : 'neutral';

  // Enter opens the one order the search found, so a scanned or typed bill number goes straight to it.
  const openSingleResult = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || busy || shown.length !== 1) return;
    const only = shown[0];
    if (only.status === 'ready') onHandover(only.id);
    else onOpen(only.id);
  };

  return (
    <section className="counter-page">
      <PageHeader title="Orders / Pickup" />
      <StatCard
        label="To collect"
        value={counts ? money(counts.balanceDueMinor) : '—'}
        hint={counts ? count(counts.balanceDue, 'order') : undefined}
        tone={collectTone}
      />
      <div className="counter-filters">
        <FormField label="Search bill number, phone, name or tag ID">
          <Input
            type="search"
            autoFocus
            value={query}
            placeholder="Bill no., last 4 digits, phone or name"
            onChange={event => onQuery(event.target.value)}
            onKeyDown={openSingleResult}
          />
        </FormField>
      </div>
      {searching ? (
        <div className="counter-search-mode">
          <span>Searching all orders</span>
          <Button variant="outline" size="sm" onClick={() => onQuery('')}>Clear</Button>
        </div>
      ) : (
        <SegmentBar segment={segment} counts={counts} onSegment={onSegment} />
      )}
      {loading && <p role="status">Loading orders…</p>}
      {shortQuery && <p className="counter-search-hint">Type at least 2 characters.</p>}
      {shown.length > 0 && (
        <ul className="counter-order-list" aria-label="Orders">
          {shown.map(order => <OrderRow key={order.id} order={order} busy={busy} onOpen={onOpen} onHandover={onHandover} onReprintBill={onReprintBill} />)}
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
