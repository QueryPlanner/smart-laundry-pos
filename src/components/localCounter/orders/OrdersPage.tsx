import { Fragment, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CounterOrderSummary, CounterQueueCounts } from '@/lib/localFirst/counter';
import { groupByDay } from '@/lib/localFirst/orders/orderDays';
import type { OrderSegment } from '@/lib/localFirst/orders/useOrderList';
import { addDays, formatDay } from '@/lib/localFirst/salesRange';
import { count, EmptyState, FormField, money, PageHeader, StatCard, type StatTone } from '../ui';
import { OrderRow } from './OrderRow';
import { SegmentBar } from './SegmentBar';

export interface OrdersPageProps {
  query: string; onQuery(query: string): void;
  segment: OrderSegment; onSegment(segment: OrderSegment): void;
  /** The day shown by the "Pick a day" segment, and today, both shop-local `YYYY-MM-DD`. */
  day: string; today: string; onDay(day: string): void;
  counts: CounterQueueCounts | null;
  results: CounterOrderSummary[]; loading: boolean; hasMore: boolean; onLoadMore(): void;
  onOpen(orderId: string): void;       // open the order detail
  onHandover(orderId: string): void;   // open the handover screen
  onReprintBill(orderId: string): void; // print the bill again, without opening the order
  busy: boolean;
}

const EMPTY_MESSAGE: Record<OrderSegment, string> = {
  all: 'No orders yet.',
  ready: 'Nothing is ready for pickup.',
  balance_due: 'No balances to collect.',
  overdue: 'No overdue orders.',
  in_process: 'Nothing is in process.',
  today: 'No orders received today.',
  day: 'No orders were received on this day.',
};

/** The lists that run newest first, which read best with a heading for each day. */
const HEADED_SEGMENTS: OrderSegment[] = ['all'];

/**
 * The Orders / Pickup list. A search replaces the segment filters and searches every order; a single
 * character is too vague to search, so it only shows a hint.
 */
export const OrdersPage = ({ query, onQuery, segment, onSegment, day, today, onDay, counts, results, loading, hasMore, onLoadMore, onOpen, onHandover, onReprintBill, busy }: OrdersPageProps) => {
  const searching = query !== '';
  const shortQuery = query.trim().length === 1;
  const shown = shortQuery ? [] : results;
  // A search and the All list are newest first, so each day gets a heading; the other lists run by promise time.
  const groups = searching || HEADED_SEGMENTS.includes(segment) ? groupByDay(shown, today) : null;
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
      {!searching && segment === 'day' && (
        <div className="counter-day-picker" role="group" aria-label="Pick a day">
          <Button variant="outline" className="counter-touch" onClick={() => onDay(addDays(day, -1))}>← Previous day</Button>
          <Input type="date" aria-label="Day" value={day} max={today} onChange={event => event.target.value && onDay(event.target.value)} />
          <Button variant="outline" className="counter-touch" disabled={day >= today} onClick={() => onDay(addDays(day, 1))}>Next day →</Button>
          <p>{`Orders received on ${formatDay(day)}`}</p>
        </div>
      )}
      {loading && <p role="status">Loading orders…</p>}
      {shortQuery && <p className="counter-search-hint">Type at least 2 characters.</p>}
      {shown.length > 0 && (
        <ul className="counter-order-list" aria-label="Orders">
          {(groups ?? [{ date: '', heading: '', orders: shown }]).map((group, index) => (
            <Fragment key={`${group.date}:${index}`}>
              {groups && <li className="counter-day-heading" role="presentation"><h2>{group.heading}</h2></li>}
              {group.orders.map(order => <OrderRow key={order.id} order={order} busy={busy} onOpen={onOpen} onHandover={onHandover} onReprintBill={onReprintBill} />)}
            </Fragment>
          ))}
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
