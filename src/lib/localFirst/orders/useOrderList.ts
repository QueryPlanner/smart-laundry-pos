import { useEffect, useRef, useState } from 'react';
import { getCounterOrderQueueCounts, searchCounterOrders } from '../counter';
import type { CounterOrderSummary, CounterQueueCounts } from '../counter';
import { shopDateOf } from '../salesRange';

/**
 * The Orders / Pickup list: the search text, the chosen segment, the page of orders and the segment counts.
 * It fetches only while `active` (the Orders page is showing) and ignores any answer that a newer question
 * has replaced.
 */

const PAGE_SIZE = 50;

/** The tabs above the list: orders still to be handed over (the default), finished ones, or every order. */
export type OrderSegment = 'open' | 'collected' | 'all';

export interface OrderListOptions {
  active: boolean;
  onError(error: unknown): void;
  /** How long typing must pause before the text is searched. Segment changes are not delayed. */
  debounceMs?: number;
}

export interface OrderList {
  query: string;
  setQuery(query: string): void;
  segment: OrderSegment;
  setSegment(segment: OrderSegment): void;
  /** Today in shop time, for the day headings. */
  today: string;
  counts: CounterQueueCounts | null;
  results: CounterOrderSummary[];
  loading: boolean;
  hasMore: boolean;
  loadMore(): void;
  /** Fetch the counts and the first page again, for example after an order changed. */
  reload(): void;
  /** Forget everything shown, for example when another person signs in. */
  reset(): void;
}

export const useOrderList = ({ active, onError, debounceMs = 180 }: OrderListOptions): OrderList => {
  const [query, setQuery] = useState('');
  const [segment, setSegment] = useState<OrderSegment>('open');
  const [counts, setCounts] = useState<CounterQueueCounts | null>(null);
  const [results, setResults] = useState<CounterOrderSummary[]>([]);
  // Already loading on the first render when the page is showing, so "nothing here" never flashes before the list.
  const [loading, setLoading] = useState(active);
  const [hasMore, setHasMore] = useState(false);
  const [reloads, setReloads] = useState(0);
  // The latest error handler, so a new function from the parent never restarts a fetch.
  const report = useRef(onError);
  report.current = onError;
  // Counts every list fetch. A page that arrives for an older number is ignored.
  const generation = useRef(0);
  const loadingMore = useRef(false);

  const text = query.trim();
  // Searching looks through every order, whatever tab is selected.
  const filter = text ? 'all' : segment;

  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    void getCounterOrderQueueCounts().then(next => {
      if (!live) return;
      setCounts(next);
    }).catch(error => { if (live) report.current(error); });
    return () => { live = false; };
  }, [active, reloads]);

  useEffect(() => {
    if (!active) {
      setLoading(false);
      return undefined;
    }
    let live = true;
    generation.current += 1;
    loadingMore.current = false;
    setLoading(true);
    const timer = setTimeout(() => {
      void searchCounterOrders(text, 0, PAGE_SIZE, filter).then(page => {
        if (!live) return;
        setResults(page);
        setHasMore(page.length === PAGE_SIZE);
      }).catch(error => { if (live) report.current(error); })
        .finally(() => { if (live) setLoading(false); });
    }, text ? debounceMs : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [active, text, filter, reloads, debounceMs]);

  const loadMore = () => {
    if (!active || !hasMore || loading || loadingMore.current) return;
    loadingMore.current = true;
    const mine = generation.current;
    setLoading(true);
    void searchCounterOrders(text, results.length, PAGE_SIZE, filter).then(page => {
      if (mine !== generation.current) return;
      setResults(current => [...current, ...page]);
      setHasMore(page.length === PAGE_SIZE);
    }).catch(error => { if (mine === generation.current) report.current(error); })
      .finally(() => {
        if (mine !== generation.current) return;
        loadingMore.current = false;
        setLoading(false);
      });
  };

  return {
    query,
    setQuery,
    segment,
    setSegment,
    today: shopDateOf(new Date()),
    counts,
    results,
    loading,
    hasMore,
    loadMore,
    reload: () => setReloads(current => current + 1),
    reset: () => {
      setQuery('');
      setSegment('open');
      setCounts(null);
      setResults([]);
      setHasMore(false);
      // While the page is showing, fetch the counts and the list again for the fresh state.
      setReloads(current => current + 1);
    },
  };
};
