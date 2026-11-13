import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from './runtime';

const call = <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  if (!isTauriRuntime()) throw new Error('The local counter is available only in the Tauri runtime.');
  return invoke<T>(command, args);
};

/** The most bill rows the report renders at once. Export always writes every row. */
export const SCREEN_ROW_LIMIT = 200;

export interface DailyReportTotals {
  billedMinor: number;
  cashMinor: number;
  upiMinor: number;
  otherMinor: number;
  refundedMinor: number;
  netMinor: number;
}

export interface DailyReportRow extends DailyReportTotals {
  billNumber: string;
}

export interface DailyReport {
  /** The shop date in IST, `YYYY-MM-DD`. */
  shopDate: string;
  rows: DailyReportRow[];
  totals: DailyReportTotals;
}

/** The whole-shop report for the current IST day; the native side chooses the date. */
export const getDailyReport = (): Promise<DailyReport> => call('counter_daily_report');

/** Opens the native save dialog and returns the saved snapshot, or null on cancellation. */
export const exportDailyReportCsv = (): Promise<{ path: string; report: DailyReport } | null> =>
  call('counter_export_daily_report_csv');
