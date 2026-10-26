// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SalesTransaction } from '@/lib/localFirst/insights';
import { DailyReportPage } from './DailyReportPage';
import { transactionOf } from './insightFixtures';

const api = vi.hoisted(() => ({ listSalesTransactions: vi.fn(), listSalesStaff: vi.fn(), exportSalesCsv: vi.fn() }));
const dialog = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('@/lib/localFirst/insights', () => api);
vi.mock('@tauri-apps/plugin-dialog', () => dialog);

const rows: SalesTransaction[] = [
  transactionOf({ id: 'p1', amountMinor: 68600, method: 'cash', orderNumber: '202610260001', customerName: 'Swapnil Dhane', customerAddress: 'Sambhaji nagar', customerPhone: '9800001011', staffName: 'Vishal More' }),
  transactionOf({ id: 'p2', amountMinor: 32300, method: 'upi', reference: 'UTR123', staffName: null }),
  transactionOf({ id: 'p1', kind: 'refund', amountMinor: 6900, method: 'cash', voidedByName: null }),
];
const page = (items: SalesTransaction[], total = items.length) => ({ items, total });
const setup = () => {
  const props = { account: { id: 'a', fullName: 'Owner', role: 'admin' as const, active: true }, onError: vi.fn(), onNotice: vi.fn(), onOpenOrder: vi.fn() };
  render(<DailyReportPage {...props} />);
  return props;
};
const lastFilter = () => api.listSalesTransactions.mock.calls.at(-1)?.[0];
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-26T10:00:00Z'));
  api.listSalesStaff.mockResolvedValue([{ id: 's1', fullName: 'Vishal More' }]);
  api.listSalesTransactions.mockResolvedValue(page(rows));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('DailyReportPage', () => {
  it('shows today’s payments with order, customer, address, mode and who took them, and the totals', async () => {
    const props = setup();
    const table = within(await screen.findByRole('table'));
    expect(lastFilter()).toEqual({ from: '2026-10-26T00:00', to: '2026-10-27T00:00', paymentMethods: [], statuses: [], staffId: undefined, search: undefined, discountedOnly: false, includeCancelled: false });
    expect(table.getByText('Swapnil Dhane')).toBeTruthy();
    expect(table.getByText('Sambhaji nagar')).toBeTruthy();
    expect(table.getByText('9800001011')).toBeTruthy();
    expect(table.getByText('Vishal More')).toBeTruthy();
    expect(table.getByText('UTR123')).toBeTruthy();
    expect(table.getByText('Refund by unknown')).toBeTruthy();
    expect(screen.getByText('Payments on 2026-10-26')).toBeTruthy();
    const cards = [...document.querySelectorAll('.counter-stat')].map(card => card.textContent);
    expect(cards).toEqual(['Received₹1,009.002 payments', 'Refunded₹69.00', 'Net₹940.00', 'Cash₹617.00', 'UPI₹323.00']);
    fireEvent.click(table.getByRole('button', { name: '202610260001' }));
    expect(props.onOpenOrder).toHaveBeenCalledWith('o1');
  });

  it('narrows by days, mode, who took it and a search, and Today goes back', async () => {
    setup();
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Payment mode'), { target: { value: 'upi' } });
    fireEvent.change(screen.getByLabelText('Taken by'), { target: { value: 's1' } });
    fireEvent.change(screen.getByLabelText(/Customer or bill/), { target: { value: ' Swapnil ' } });
    fireEvent.click(button('Search'));
    await waitFor(() => expect(lastFilter()).toEqual(expect.objectContaining({ from: '2026-10-01T00:00', to: '2026-10-27T00:00', paymentMethods: ['upi'], staffId: 's1', search: 'Swapnil' })));
    expect(screen.getByText('Payments from 2026-10-01 to 2026-10-26 · UPI · “Swapnil”')).toBeTruthy();
    fireEvent.click(button('Today'));
    await waitFor(() => expect(lastFilter()).toEqual(expect.objectContaining({ from: '2026-10-26T00:00' })));
  });

  it('says so when the days are backwards, and loads nothing', async () => {
    setup();
    await screen.findByRole('table');
    const calls = api.listSalesTransactions.mock.calls.length;
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-25' } });
    expect(screen.getByRole('alert').textContent).toBe('Choose a From day on or before the To day.');
    expect(button('Export to Excel (CSV)').disabled).toBe(true);
    expect(api.listSalesTransactions.mock.calls.length).toBe(calls);
  });

  it('reads every page, and shows only the newest rows when there are very many', async () => {
    api.listSalesTransactions.mockImplementation(async (_filter, offset: number) => page(Array.from({ length: 100 }, (_, i) => transactionOf({ id: `p${offset + i}` })), 2500));
    setup();
    await screen.findByText('Showing the newest 2000 of 2500 rows. Export to Excel (CSV) saves every row.');
    expect(api.listSalesTransactions).toHaveBeenCalledTimes(20);
    expect(api.listSalesTransactions.mock.calls.at(-1)?.slice(1)).toEqual([1900, 100]);
  });

  it('stops at a short page', async () => {
    const full = Array.from({ length: 100 }, (_, i) => transactionOf({ id: `q${i}` }));
    api.listSalesTransactions.mockResolvedValueOnce(page(full, 150)).mockResolvedValueOnce(page(rows.slice(0, 1), 150));
    setup();
    await screen.findByText('Showing the newest 101 of 150 rows. Export to Excel (CSV) saves every row.');
    expect(api.listSalesTransactions).toHaveBeenCalledTimes(2);
  });

  it('counts a single payment in the singular', async () => {
    api.listSalesTransactions.mockResolvedValue(page(rows.slice(0, 1)));
    setup();
    expect(await screen.findByText('1 payment')).toBeTruthy();
    expect(screen.queryByText('Refunded')).toBeNull();
  });

  it('says when there is nothing, and Print needs rows', async () => {
    api.listSalesTransactions.mockResolvedValue(page([]));
    setup();
    await screen.findByText('No payments in this period.');
    expect(button('Print').disabled).toBe(true);
  });

  it('prints the page and refreshes on request', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    setup();
    await screen.findByRole('table');
    fireEvent.click(button('Print'));
    expect(print).toHaveBeenCalledOnce();
    fireEvent.click(button('Refresh'));
    await waitFor(() => expect(api.listSalesTransactions).toHaveBeenCalledTimes(2));
  });

  it('exports to the file the user picks and says where', async () => {
    dialog.save.mockResolvedValueOnce('/Users/me/sales-2026-10-26.csv').mockResolvedValueOnce('/Users/me/one.csv').mockResolvedValueOnce(null);
    api.exportSalesCsv.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
    const props = setup();
    await screen.findByRole('table');
    fireEvent.click(button('Export to Excel (CSV)'));
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith('Saved 3 rows to /Users/me/sales-2026-10-26.csv.'));
    expect(dialog.save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'sales-2026-10-26.csv' }));
    expect(api.exportSalesCsv).toHaveBeenCalledWith(lastFilter(), '/Users/me/sales-2026-10-26.csv');
    fireEvent.click(button('Export to Excel (CSV)'));
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith('Saved 1 row to /Users/me/one.csv.'));
    // Cancelling the file choice saves nothing.
    fireEvent.click(button('Export to Excel (CSV)'));
    await waitFor(() => expect(button('Export to Excel (CSV)').disabled).toBe(false));
    expect(api.exportSalesCsv).toHaveBeenCalledTimes(2);
  });

  it('reports failures to load, to list staff and to export', async () => {
    let fail: (error: Error) => void = () => undefined;
    api.listSalesStaff.mockRejectedValue(new Error('staff failed'));
    api.listSalesTransactions.mockRejectedValue(new Error('list failed'));
    dialog.save.mockResolvedValue('/x.csv');
    api.exportSalesCsv.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    const props = setup();
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'list failed' })));
    expect(props.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'staff failed' }));
    fireEvent.click(button('Export to Excel (CSV)'));
    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeTruthy();
    fail(new Error('The report could not be saved: denied'));
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'The report could not be saved: denied' })));
  });

  it('ignores answers that arrive after the page was left', async () => {
    let answer: (value: unknown) => void = () => undefined;
    let staffAnswer: (value: unknown) => void = () => undefined;
    api.listSalesTransactions.mockReturnValue(new Promise(resolve => { answer = resolve; }));
    api.listSalesStaff.mockReturnValue(new Promise((_, reject) => { staffAnswer = reject; }));
    const props = setup();
    cleanup();
    answer(page(rows));
    staffAnswer(new Error('late'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(props.onError).not.toHaveBeenCalled();
  });

  it('ignores failures that arrive after the page was left', async () => {
    let fail: (error: Error) => void = () => undefined;
    let staffOk: (value: unknown) => void = () => undefined;
    api.listSalesTransactions.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    api.listSalesStaff.mockReturnValue(new Promise(resolve => { staffOk = resolve; }));
    const props = setup();
    cleanup();
    fail(new Error('late'));
    staffOk([]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(props.onError).not.toHaveBeenCalled();
  });
});
