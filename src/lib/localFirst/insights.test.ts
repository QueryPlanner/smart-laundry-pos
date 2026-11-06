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
  ['exportSalesCsv', () => insights.exportSalesCsv(filter, '/tmp/r.csv'), 'counter_export_sales_csv', { filter, path: '/tmp/r.csv' }],
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
    const exported = Object.entries(insights).filter(([, value]) => typeof value === 'function').map(([name]) => name);
    const covered = new Set(table.map(([name]) => name.split(' ')[0]));
    expect(exported.filter(name => !covered.has(name))).toEqual([]);
  });

  it('refuses to run outside the Tauri desktop shell', () => {
    mocks.isTauriRuntime.mockReturnValue(false);
    expect(() => insights.getSalesSummary(filter)).toThrow('only in the Tauri runtime');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
