import type {
  AttentionOrder, DashboardOverview, KindFigures, SalesOrderRow, SalesSummary, SalesTransaction, SeriesPoint,
} from '@/lib/localFirst/insights';

/**
 * Shared test data for the Dashboard and Sales screens. Totals are kept consistent with the per-kind
 * figures: collected = advance + balance, refunded = advance + balance, net collected = collected - refunded.
 */
export const summaryOf = (over: Partial<SalesSummary> = {}): SalesSummary => ({
  orders: 4, pieces: 9, grossMinor: 200000, discountMinor: 20000, netBilledMinor: 180000, averageOrderMinor: 45000,
  collectedMinor: 150000, refundedMinor: 5000, advanceCollectedMinor: 90000, balanceCollectedMinor: 60000,
  advanceRefundedMinor: 0, balanceRefundedMinor: 5000, netCollectedMinor: 145000, cancelledCount: 1, cancelledMinor: 5000,
  expensesMinor: 30000, profitMinor: 115000,
  byMethod: [
    { method: 'cash', collectedMinor: 100000, refundedMinor: 5000, payments: 3 },
    { method: 'upi', collectedMinor: 50000, refundedMinor: 0, payments: 1 },
  ],
  byStatus: [{ status: 'quality_check', orders: 1, netBilledMinor: 20000 }, { status: 'ready', orders: 3, netBilledMinor: 160000 }],
  byStaff: [
    { staffId: 's1', name: 'Asha Patil', orders: 3, netBilledMinor: 150000, collectedMinor: 120000, refundedMinor: 5000 },
    { staffId: 'old', name: null, orders: 1, netBilledMinor: 30000, collectedMinor: 30000, refundedMinor: 0 },
  ],
  byService: [{ service: 'Wash + Iron', pieces: 7, amountMinor: 150000 }, { service: 'Dry Clean', pieces: 2, amountMinor: 50000 }],
  ...over,
});

/** One graph bucket: the billed amount and any per-kind money; collected and refunded follow from them. */
export const pointOf = (bucket: string, billed: number, kinds: Partial<KindFigures> = {}): SeriesPoint => {
  const figures: KindFigures = {
    advanceCollectedMinor: 0, balanceCollectedMinor: 0, advanceRefundedMinor: 0, balanceRefundedMinor: 0, ...kinds,
  };
  return {
    bucket, orders: billed > 0 ? 1 : 0, pieces: billed > 0 ? 2 : 0, grossMinor: billed, discountMinor: 0, netBilledMinor: billed,
    collectedMinor: figures.advanceCollectedMinor + figures.balanceCollectedMinor,
    refundedMinor: figures.advanceRefundedMinor + figures.balanceRefundedMinor,
    ...figures,
  };
};

export const orderRowOf = (over: Partial<SalesOrderRow> = {}): SalesOrderRow => ({
  id: 'o1', orderNumber: 'LA-2026-00001', receivedAt: '2026-03-15T04:30:00.000Z', customerName: 'Rita Joshi', customerPhone: '9876543210',
  status: 'ready', pieceCount: 3, grossMinor: 30000, discountMinor: 0, totalMinor: 30000, paidMinor: 30000, balanceMinor: 0,
  methods: ['cash'], staffId: 's1', staffName: 'Asha Patil', cancelledAt: null, ...over,
});

export const transactionOf = (over: Partial<SalesTransaction> = {}): SalesTransaction => ({
  id: 'p1', kind: 'payment', at: '2026-03-15T04:31:00+00:00', amountMinor: 30000, method: 'cash', reference: null,
  orderId: 'o1', orderNumber: 'LA-2026-00001', customerName: 'Rita Joshi', customerPhone: '9876543210', orderStatus: 'ready',
  staffId: 's1', staffName: 'Asha Patil', voidedByName: null, voidReason: null, ...over,
});

export const attentionOf = (over: Partial<AttentionOrder> = {}): AttentionOrder => ({
  id: 'r1', orderNumber: 'LA-2026-00007', customerName: 'Om Patil', customerPhone: '9000000001', status: 'ready', pieceCount: 4,
  promisedAt: '2026-03-10T11:30:00.000Z', sinceAt: '2026-03-10T10:00:00+00:00', daysWaiting: 5, balanceMinor: 0, overdue: false, ...over,
});

export const overviewOf = (over: Partial<DashboardOverview> = {}): DashboardOverview => ({
  generatedAt: '2026-03-15T06:30:00.000Z', todayDate: '2026-03-15', monthStartDate: '2026-03-01',
  today: summaryOf({
    orders: 2, pieces: 5, netBilledMinor: 60000, discountMinor: 5000, collectedMinor: 55000, refundedMinor: 0,
    advanceCollectedMinor: 35000, balanceCollectedMinor: 20000, advanceRefundedMinor: 0, balanceRefundedMinor: 0, netCollectedMinor: 55000,
  }),
  monthToDate: summaryOf({
    orders: 20, pieces: 60, netBilledMinor: 900000, collectedMinor: 805000, refundedMinor: 5000,
    advanceCollectedMinor: 500000, balanceCollectedMinor: 305000, advanceRefundedMinor: 0, balanceRefundedMinor: 5000,
    netCollectedMinor: 800000, expensesMinor: 100000, profitMinor: 700000,
  }),
  queue: { received: 2, inProcess: 3, ready: 4 },
  receivable: { orders: 2, minor: 12500 },
  readyWaiting: { total: 1, orders: [attentionOf()] },
  inProcess: {
    total: 2,
    orders: [
      attentionOf({ id: 'w1', orderNumber: 'LA-2026-00008', status: 'washing', promisedAt: '2026-03-14T11:30:00.000Z', overdue: true, daysWaiting: 3 }),
      attentionOf({ id: 'w2', orderNumber: 'LA-2026-00009', status: 'received', promisedAt: null, overdue: false, daysWaiting: 0 }),
    ],
  },
  lowStockCount: 2,
  recentOrders: [orderRowOf(), orderRowOf({ id: 'o2', orderNumber: 'LA-2026-00002', status: 'cancelled', totalMinor: 12000 })],
  ...over,
});
