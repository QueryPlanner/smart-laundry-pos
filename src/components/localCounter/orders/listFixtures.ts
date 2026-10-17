import type { CounterOrderSummary, CounterQueueCounts } from '@/lib/localFirst/counter';

/**
 * Shared test data for the Orders / Pickup list screen. Money is paise; times are ISO UTC, so the
 * default promise (11:30 UTC) reads as "17 Oct 2026, 5:00 pm" in shop time.
 */
export const orderOf = (over: Partial<CounterOrderSummary> = {}): CounterOrderSummary => ({
  id: 'o1', orderNumber: '202610170001', customerName: 'Rahul Patil', customerPhone: '9876543210', status: 'washing',
  receivedAt: '2026-10-17T04:30:00Z', promisedAt: '2026-10-17T11:30:00Z', totalMinor: 25000, paidMinor: 10000,
  balanceMinor: 15000, pieceCount: 3, paymentStatus: 'partially_paid', overdue: false, untaggedCount: 0, matchReason: null,
  ...over,
});

export const countsOf = (over: Partial<CounterQueueCounts> = {}): CounterQueueCounts => ({
  ready: 2, balanceDue: 4, overdue: 1, inProcess: 3, today: 5, all: 12, balanceDueMinor: 45000, ...over,
});
