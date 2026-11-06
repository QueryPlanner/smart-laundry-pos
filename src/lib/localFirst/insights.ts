import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from './runtime';

const call = <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  if (!isTauriRuntime()) throw new Error('The local counter is available only in the Tauri runtime.');
  return invoke<T>(command, args);
};

/**
 * Read-only insight queries: the dashboard overview and the sales query. Any signed-in account
 * (staff or administrator) gets identical figures. Every amount is whole paise. Filters use
 * shop time (IST) as `YYYY-MM-DDTHH:MM`, meaning from (inclusive) to to (exclusive).
 */

export type SalesBucket = 'hour' | 'day' | 'month';
/** `credit` only appears on orders from before the counter. */
export type SalesPaymentMethod = 'cash' | 'upi' | 'card' | 'bank_transfer' | 'credit' | 'other';
export type SalesOrderStatus =
  | 'received' | 'washing' | 'drying' | 'ironing' | 'quality_check' | 'packing' | 'ready' | 'collected' | 'cancelled';

export interface SalesFilter {
  from: string;
  to: string;
  paymentMethods?: SalesPaymentMethod[];
  statuses?: SalesOrderStatus[];
  /** Orders by who created them; money by who took the payment. */
  staffId?: string;
  /** Bill number, customer name or phone number. */
  search?: string;
  discountedOnly?: boolean;
  /** Add cancelled orders to the billed figures and the order list. Cash flow is unaffected. */
  includeCancelled?: boolean;
}

export interface MethodBreakdown { method: string; collectedMinor: number; refundedMinor: number; payments: number }
export interface StatusBreakdown { status: string; orders: number; netBilledMinor: number }
export interface StaffBreakdown {
  staffId: string; name: string | null; orders: number; netBilledMinor: number; collectedMinor: number; refundedMinor: number;
}
export interface ServiceBreakdown { service: string; pieces: number; amountMinor: number }

export interface SalesSummary {
  orders: number;
  pieces: number;
  grossMinor: number;
  discountMinor: number;
  netBilledMinor: number;
  averageOrderMinor: number;
  collectedMinor: number;
  refundedMinor: number;
  /** Advance paid when an order was booked, before any refund. */
  advanceCollectedMinor: number;
  /** Paid at or after pickup, before any refund. */
  balanceCollectedMinor: number;
  advanceRefundedMinor: number;
  balanceRefundedMinor: number;
  netCollectedMinor: number;
  /** Orders cancelled inside the window (by cancellation time). */
  cancelledCount: number;
  cancelledMinor: number;
  /** Dated by day: any expense on a day the window touches. */
  expensesMinor: number;
  /** Net collected minus expenses; null while a narrowing filter is active. */
  profitMinor: number | null;
  byMethod: MethodBreakdown[];
  byStatus: StatusBreakdown[];
  byStaff: StaffBreakdown[];
  byService: ServiceBreakdown[];
}

export interface SeriesPoint {
  /** Shop-local bucket key: `YYYY-MM-DDTHH:00`, `YYYY-MM-DD` or `YYYY-MM`. */
  bucket: string;
  orders: number;
  pieces: number;
  grossMinor: number;
  discountMinor: number;
  netBilledMinor: number;
  collectedMinor: number;
  refundedMinor: number;
  advanceCollectedMinor: number;
  balanceCollectedMinor: number;
  advanceRefundedMinor: number;
  balanceRefundedMinor: number;
}
export interface SalesSeries { bucket: SalesBucket; points: SeriesPoint[] }

export interface SalesOrderRow {
  id: string;
  orderNumber: string;
  receivedAt: string;
  customerName: string;
  customerPhone: string;
  status: string;
  pieceCount: number;
  grossMinor: number;
  discountMinor: number;
  totalMinor: number;
  paidMinor: number;
  balanceMinor: number;
  methods: string[];
  staffId: string | null;
  staffName: string | null;
  cancelledAt: string | null;
}

export interface SalesTransaction {
  /** The payment id: a payment voided later appears twice, as `payment` and then as `refund`. */
  id: string;
  kind: 'payment' | 'refund';
  at: string;
  amountMinor: number;
  method: string;
  reference: string | null;
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  orderStatus: string;
  staffId: string;
  staffName: string | null;
  voidedByName: string | null;
  voidReason: string | null;
  /** When the order was taken. */
  orderReceivedAt: string;
  /** The customer's address from their record, if any. */
  customerAddress: string | null;
}

export interface SalesPage<T> { items: T[]; total: number }
export interface SalesStaffOption { id: string; fullName: string }

export interface AttentionOrder {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  status: string;
  pieceCount: number;
  promisedAt: string | null;
  /** When the order became ready (ready list) or was received (in-process list). */
  sinceAt: string;
  daysWaiting: number;
  balanceMinor: number;
  overdue: boolean;
}
export interface AttentionList { total: number; orders: AttentionOrder[] }

export interface DashboardOverview {
  generatedAt: string;
  /** Today in shop time, `YYYY-MM-DD`. */
  todayDate: string;
  monthStartDate: string;
  today: SalesSummary;
  monthToDate: SalesSummary;
  queue: { received: number; inProcess: number; ready: number };
  /** Orders still owing money (not cancelled or collected) and the balance they owe, as of now. */
  receivable: { orders: number; minor: number };
  readyWaiting: AttentionList;
  inProcess: AttentionList;
  lowStockCount: number;
  recentOrders: SalesOrderRow[];
}

/** The four per-kind money figures a summary or a series point carries. */
export type KindFigures = Pick<SalesSummary,
  'advanceCollectedMinor' | 'balanceCollectedMinor' | 'advanceRefundedMinor' | 'balanceRefundedMinor'>;

export const getDashboardOverview = (): Promise<DashboardOverview> => call('counter_dashboard_overview');
export const getSalesSummary = (filter: SalesFilter): Promise<SalesSummary> => call('counter_sales_summary', { filter });
export const getSalesSeries = (filter: SalesFilter, bucket: SalesBucket): Promise<SalesSeries> =>
  call('counter_sales_series', { filter, bucket });
export const listSalesOrders = (filter: SalesFilter, offset = 0, limit = 25): Promise<SalesPage<SalesOrderRow>> =>
  call('counter_sales_orders', { filter, offset, limit });
export const listSalesTransactions = (filter: SalesFilter, offset = 0, limit = 25): Promise<SalesPage<SalesTransaction>> =>
  call('counter_sales_transactions', { filter, offset, limit });
/**
 * Writes every payment and refund the filter matches to a CSV file at `path` (chosen by the user,
 * ending in .csv) and returns how many rows it wrote.
 */
export const exportSalesCsv = (filter: SalesFilter, path: string): Promise<number> =>
  call('counter_export_sales_csv', { filter, path });
export const listSalesStaff = (): Promise<SalesStaffOption[]> => call('counter_sales_staff_options');
