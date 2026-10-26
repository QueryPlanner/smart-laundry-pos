import type { SalesTransaction } from './insights';
import { addDays } from './salesRange';

/** Rows the report shows on screen; Export writes every row. */
export const REPORT_SCREEN_ROWS = 2000;

/**
 * The period of the report: whole shop days from `fromDate` to `toDate`, both included, as the
 * sales filter's from (inclusive) and to (exclusive). Null when the days are missing or backwards.
 */
export const reportRange = (fromDate: string, toDate: string): { from: string; to: string } | null => {
  if (!fromDate || !toDate || toDate < fromDate) return null;
  return { from: `${fromDate}T00:00`, to: `${addDays(toDate, 1)}T00:00` };
};

export interface ReportTotals {
  receivedMinor: number;
  refundedMinor: number;
  /** Received minus refunded: the money kept. */
  netMinor: number;
  payments: number;
  /** Money kept by payment method, largest first. */
  byMethod: Array<{ method: string; netMinor: number }>;
}

/** Totals of the rows the report shows. A refund counts against its method. */
export const reportTotals = (rows: SalesTransaction[]): ReportTotals => {
  const byMethod = new Map<string, number>();
  let receivedMinor = 0;
  let refundedMinor = 0;
  for (const row of rows) {
    const signed = row.kind === 'refund' ? -row.amountMinor : row.amountMinor;
    if (row.kind === 'refund') refundedMinor += row.amountMinor;
    else receivedMinor += row.amountMinor;
    byMethod.set(row.method, (byMethod.get(row.method) ?? 0) + signed);
  }
  return {
    receivedMinor,
    refundedMinor,
    netMinor: receivedMinor - refundedMinor,
    payments: rows.filter(row => row.kind === 'payment').length,
    byMethod: [...byMethod].map(([method, netMinor]) => ({ method, netMinor })).sort((a, b) => b.netMinor - a.netMinor || a.method.localeCompare(b.method)),
  };
};

/** The file name Export suggests, for example `sales-2026-10-26.csv` or `sales-2026-10-01-to-2026-10-26.csv`. */
export const reportFileName = (fromDate: string, toDate: string): string =>
  fromDate === toDate ? `sales-${fromDate}.csv` : `sales-${fromDate}-to-${toDate}.csv`;
