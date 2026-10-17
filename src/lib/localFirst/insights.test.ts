import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async (_command: string, _args?: Record<string, unknown>): Promise<unknown> => 'native-result'),
  isTauriRuntime: vi.fn(() => true),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('./runtime', () => ({ isTauriRuntime: mocks.isTauriRuntime }));

import * as insights from './insights';

const filter = { from: '2026-03-05T00:00', to: '2026-03-06T00:00', staffId: 's1', includeCancelled: true };

/** [wrapper, call, native command, exact arguments]. Every exported wrapper appears once. */
const table: Array<[string, () => Promise<unknown>, string, Record<string, unknown> | undefined]> = [
  ['getDashboardOverview', () => insights.getDashboardOverview(), 'counter_dashboard_overview', undefined],
  ['getSalesSummary', () => insights.getSalesSummary(filter), 'counter_sales_summary', { filter }],
  ['getSalesSeries', () => insights.getSalesSeries(filter, 'hour'), 'counter_sales_series', { filter, bucket: 'hour' }],
  ['listSalesOrders', () => insights.listSalesOrders(filter, 50, 10), 'counter_sales_orders', { filter, offset: 50, limit: 10 }],
  ['listSalesOrders defaults', () => insights.listSalesOrders(filter), 'counter_sales_orders', { filter, offset: 0, limit: 25 }],
  ['listSalesTransactions', () => insights.listSalesTransactions(filter, 5, 20), 'counter_sales_transactions', { filter, offset: 5, limit: 20 }],
  ['listSalesTransactions defaults', () => insights.listSalesTransactions(filter), 'counter_sales_transactions', { filter, offset: 0, limit: 25 }],
  ['listSalesStaff', () => insights.listSalesStaff(), 'counter_sales_staff_options', undefined],
];

beforeEach(() => {
  mocks.invoke.mockClear();
  mocks.isTauriRuntime.mockReturnValue(true);
});

describe('native insight command wrappers', () => {
  it.each(table)('%s sends the exact native command and arguments', async (_name, run, command, args) => {
    await expect(run()).resolves.toBe('native-result');
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(command, args);
  });

  it('wraps every exported function (a new export without a table row fails here)', () => {
    const pure = new Set(['netByKind']);
    const exported = Object.entries(insights).filter(([, value]) => typeof value === 'function').map(([name]) => name);
    const covered = new Set(table.map(([name]) => name.split(' ')[0]));
    expect(exported.filter(name => !covered.has(name) && !pure.has(name))).toEqual([]);
  });

  it('refuses to run outside the Tauri desktop shell', () => {
    mocks.isTauriRuntime.mockReturnValue(false);
    expect(() => insights.getSalesSummary(filter)).toThrow('only in the Tauri runtime');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

describe('netByKind', () => {
  it('takes each refund off the kind it was made against', () => {
    expect(insights.netByKind({
      advanceCollectedMinor: 90000, balanceCollectedMinor: 60000, advanceRefundedMinor: 0, balanceRefundedMinor: 5000,
    })).toEqual({ advanceMinor: 90000, balanceMinor: 55000 });
  });

  it('keeps a refund of advance out of the balance figure', () => {
    expect(insights.netByKind({
      advanceCollectedMinor: 30000, balanceCollectedMinor: 20000, advanceRefundedMinor: 30000, balanceRefundedMinor: 0,
    })).toEqual({ advanceMinor: 0, balanceMinor: 20000 });
  });

  it('is zero for both kinds when nothing was taken', () => {
    expect(insights.netByKind({
      advanceCollectedMinor: 0, balanceCollectedMinor: 0, advanceRefundedMinor: 0, balanceRefundedMinor: 0,
    })).toEqual({ advanceMinor: 0, balanceMinor: 0 });
  });

  it('can read a series point as well as a summary', () => {
    const point = {
      bucket: '2026-03-15', orders: 1, pieces: 2, grossMinor: 10000, discountMinor: 0, netBilledMinor: 10000,
      collectedMinor: 8000, refundedMinor: 1000, advanceCollectedMinor: 5000, balanceCollectedMinor: 3000,
      advanceRefundedMinor: 0, balanceRefundedMinor: 1000,
    };
    expect(insights.netByKind(point)).toEqual({ advanceMinor: 5000, balanceMinor: 2000 });
  });
});
