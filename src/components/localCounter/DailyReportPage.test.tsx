// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DailyReportPage } from './DailyReportPage';
import { money } from './ui';
import type { DailyReport, DailyReportRow, DailyReportTotals } from '@/lib/localFirst/dailyReport';
import type { CounterAccount } from '@/lib/localFirst/counter';

const api = vi.hoisted(() => ({ getDailyReport: vi.fn(), exportDailyReportCsv: vi.fn() }));
vi.mock('@/lib/localFirst/dailyReport', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/localFirst/dailyReport')>();
  return { ...actual, getDailyReport: api.getDailyReport, exportDailyReportCsv: api.exportDailyReportCsv };
});

const staff: CounterAccount = { id: 's1', fullName: 'Asha Patil', role: 'staff', active: true };

const zero: DailyReportTotals = {
  billedMinor: 0, cashMinor: 0, upiMinor: 0, otherMinor: 0, refundedMinor: 0, netMinor: 0,
};
const row = (billNumber: string, values: Partial<DailyReportTotals> = {}): DailyReportRow => ({
  billNumber, ...zero, ...values,
});
const reportOf = (shopDate: string, rows: DailyReportRow[], totals: DailyReportTotals = zero): DailyReport => ({
  shopDate, rows, totals,
});
const base = reportOf('2026-11-12', [
  row('LA-01', { billedMinor: 50000, cashMinor: 20000, upiMinor: 30000, netMinor: 50000 }),
  row('LA-02', { refundedMinor: 5000, netMinor: -5000 }),
], {
  billedMinor: 50000, cashMinor: 20000, upiMinor: 30000, otherMinor: 0, refundedMinor: 5000, netMinor: 45000,
});

const setup = () => {
  const props = { account: staff, onError: vi.fn(), onNotice: vi.fn(), onOpenOrder: vi.fn(), onOpenSales: vi.fn() };
  const view = render(<DailyReportPage {...props} />);
  return { props, ...view };
};
const table = () => screen.getByRole('table');
const rowOf = (bill: string) => within(table()).getByText(bill).closest('tr') as HTMLElement;
const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getDailyReport.mockResolvedValue(base);
  api.exportDailyReportCsv.mockResolvedValue({ path: '/tmp/daily-report-2026-11-12.csv', report: base });
});
afterEach(cleanup);

describe('DailyReportPage', () => {
  it('shows the shop date, every column, one row per bill and the totals row', async () => {
    setup();
    expect(screen.getByText('Loading...')).toBeTruthy();
    await screen.findByRole('table');
    expect(api.getDailyReport).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Shop date:/).textContent).toContain('2026-11-12');
    const headers = within(table()).getAllByRole('columnheader').map(cell => cell.textContent);
    expect(headers).toEqual([
      'Shop date', 'Bill number', 'Billed today', 'Cash received', 'UPI received', 'Other received', 'Refunds', 'Net received',
    ]);
    expect(rowOf('LA-01').textContent).toContain('2026-11-12');
    expect(rowOf('LA-01').textContent).toContain(money(50000));
    expect(rowOf('LA-01').textContent).toContain(money(20000));
    expect(rowOf('LA-01').textContent).toContain(money(30000));
    expect(rowOf('LA-02').textContent).toContain(money(-5000));
    const totals = screen.getByText('TOTAL').closest('tr') as HTMLElement;
    expect(totals.textContent).toContain(money(50000));
    expect(totals.textContent).toContain(money(45000));
  });

  it('reloads the current shop day on Refresh', async () => {
    setup();
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(api.getDailyReport).toHaveBeenCalledTimes(2));
  });

  it('shows the first screenful but says the export has every bill', async () => {
    const rows = Array.from({ length: 201 }, (_, index) => row(`LA-${String(index + 1).padStart(3, '0')}`, { billedMinor: 100 }));
    api.getDailyReport.mockResolvedValue(reportOf('2026-11-12', rows, {
      ...zero, billedMinor: 20100, netMinor: 20100,
    }));
    setup();
    await screen.findByRole('table');
    expect(screen.getByText(/Showing the first 200 of 201 bills/)).toBeTruthy();
    expect(document.querySelectorAll('tbody tr')).toHaveLength(200);
    expect(screen.queryByText('LA-201')).toBeNull();
    expect((screen.getByText('TOTAL').closest('tr') as HTMLElement).textContent).toContain(money(20100));
  });

  it('shows an empty day with a zero totals row', async () => {
    api.getDailyReport.mockResolvedValue(reportOf('2026-11-12', []));
    setup();
    await screen.findByText('No activity on this shop day.');
    const totals = screen.getByText('TOTAL').closest('tr') as HTMLElement;
    expect(totals.textContent).toContain(money(0));
  });

  it('shows the saved path and replaces an older report with the exported snapshot', async () => {
    const saved = reportOf('2026-11-12', [row('LA-09', { cashMinor: 900, netMinor: 900 })], {
      ...zero, cashMinor: 900, netMinor: 900,
    });
    api.getDailyReport.mockResolvedValue(reportOf('2026-11-11', [row('LA-OLD')]));
    api.exportDailyReportCsv.mockResolvedValue({ path: '/tmp/daily-report-2026-11-12.csv', report: saved });
    const { props } = setup();
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(api.exportDailyReportCsv).toHaveBeenCalledExactlyOnceWith());
    expect(props.onNotice).toHaveBeenCalledWith('Saved /tmp/daily-report-2026-11-12.csv.');
    expect(await screen.findByText('LA-09')).toBeTruthy();
    expect(screen.queryByText('LA-OLD')).toBeNull();
  });

  it('returns to the report when the picker is cancelled', async () => {
    api.exportDailyReportCsv.mockResolvedValue(null);
    const { props } = setup();
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(api.exportDailyReportCsv).toHaveBeenCalled());
    expect(props.onNotice).not.toHaveBeenCalled();
    expect(props.onError).not.toHaveBeenCalled();
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('reports a failed load and stays on the loading screen', async () => {
    api.getDailyReport.mockRejectedValue(new Error('database busy'));
    const { props } = setup();
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'database busy' })));
    expect(screen.getByText('Loading...')).toBeTruthy();
  });

  it('reports an export error and re-enables the button', async () => {
    const { props } = setup();
    await screen.findByRole('table');

    api.exportDailyReportCsv.mockRejectedValueOnce(new Error('disk full'));
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'disk full' })));
    expect(props.onNotice).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Export CSV' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables Export while it is working', async () => {
    const pending = deferred<null>();
    const { props } = setup();
    await screen.findByRole('table');
    api.exportDailyReportCsv.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect((screen.getByRole('button', { name: 'Export CSV' }) as HTMLButtonElement).disabled).toBe(true);
    pending.resolve(null);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Export CSV' }) as HTMLButtonElement).disabled).toBe(false));
    expect(props.onError).not.toHaveBeenCalled();
  });

  it('ignores a load that finishes after leaving the page', async () => {
    const late = deferred<DailyReport>();
    api.getDailyReport.mockReturnValue(late.promise);
    const { unmount, props } = setup();
    unmount();
    late.resolve(base);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(props.onError).not.toHaveBeenCalled();

    const failed = deferred<DailyReport>();
    api.getDailyReport.mockReturnValue(failed.promise);
    const second = setup();
    second.unmount();
    failed.reject(new Error('late failure'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(second.props.onError).not.toHaveBeenCalled();
  });
});
