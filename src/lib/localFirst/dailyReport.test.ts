import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async (_command: string, _args?: Record<string, unknown>): Promise<unknown> => 'native-result'),
  isTauriRuntime: vi.fn(() => true),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('./runtime', () => ({ isTauriRuntime: mocks.isTauriRuntime }));

import * as dailyReport from './dailyReport';

/** [wrapper, call, native command, exact arguments]. Every exported wrapper appears once. */
const table: Array<[string, () => Promise<unknown>, string, Record<string, unknown> | undefined]> = [
  ['getDailyReport', () => dailyReport.getDailyReport(), 'counter_daily_report', undefined],
  ['exportDailyReportCsv', () => dailyReport.exportDailyReportCsv('/tmp/report.csv'), 'counter_export_daily_report_csv', { path: '/tmp/report.csv' }],
];

beforeEach(() => {
  mocks.invoke.mockClear();
  mocks.isTauriRuntime.mockReturnValue(true);
});

describe('daily report command wrappers', () => {
  it.each(table)('%s sends the exact native command and arguments', async (_name, run, command, args) => {
    await expect(run()).resolves.toBe('native-result');
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(command, args);
  });

  it('wraps every exported command function (a new export without a table row fails here)', () => {
    const exported = Object.entries(dailyReport)
      .filter(([name, value]) => name !== 'dailyReportFileName' && typeof value === 'function')
      .map(([name]) => name);
    const covered = new Set(table.map(([name]) => name.split(' ')[0]));
    expect(exported.filter(name => !covered.has(name))).toEqual([]);
  });

  it('names the suggested file after the report date', () => {
    expect(dailyReport.dailyReportFileName('2026-11-12')).toBe('daily-report-2026-11-12.csv');
  });

  it('refuses to run outside the Tauri desktop shell', () => {
    mocks.isTauriRuntime.mockReturnValue(false);
    expect(() => dailyReport.getDailyReport()).toThrow('only in the Tauri runtime');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
