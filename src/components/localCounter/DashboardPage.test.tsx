// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DashboardPage } from './DashboardPage';
import { attentionOf, overviewOf, pointOf, summaryOf } from './insightFixtures';
import { money } from './ui';
import type { CounterAccount } from '@/lib/localFirst/counter';

const api = vi.hoisted(() => ({ getDashboardOverview: vi.fn(), getSalesSeries: vi.fn() }));
// Only the two loaders are faked; the pure netByKind helper keeps its real behaviour.
vi.mock('@/lib/localFirst/insights', async () => ({ ...(await vi.importActual<object>('@/lib/localFirst/insights')), ...api }));

const staff: CounterAccount = { id: 's1', fullName: 'Clerk', role: 'staff', active: true };
const series = {
  bucket: 'day',
  points: [
    pointOf('2026-03-14', 40000, { advanceCollectedMinor: 20000, balanceCollectedMinor: 10000 }),
    pointOf('2026-03-15', 60000, { advanceCollectedMinor: 35000, balanceCollectedMinor: 20000 }),
  ],
};

const setup = () => {
  const props = { account: staff, onError: vi.fn(), onNotice: vi.fn(), onOpenOrder: vi.fn() };
  const view = render(<DashboardPage {...props} />);
  return { props, ...view };
};
const stat = (section: HTMLElement, label: string): HTMLElement =>
  within(section).getByText(label, { selector: 'span.counter-section-label' }).closest('.counter-stat') as HTMLElement;
const heading = (name: string): HTMLElement => screen.getByRole('heading', { name }).parentElement as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  api.getDashboardOverview.mockResolvedValue(overviewOf());
  api.getSalesSeries.mockResolvedValue(series);
});
afterEach(cleanup);

describe('DashboardPage', () => {
  it('shows today, the month, the graph, what needs attention and recent orders', async () => {
    setup();
    expect(screen.getByText('Loading...')).toBeTruthy();
    await screen.findByText('Figures for today, 15 Mar 2026, and the month so far.');
    const today = screen.getByRole('heading', { name: 'Today' }).nextElementSibling as HTMLElement;
    expect(stat(today, 'Orders').textContent).toContain('2');
    expect(stat(today, 'Orders').textContent).toContain('5 pieces');
    expect(stat(today, 'Billed').textContent).toContain(money(60000));
    expect(stat(today, 'Billed').textContent).toContain(`${money(5000)} discount given`);
    expect(stat(today, 'Advance collected').textContent).toContain(money(35000));
    expect(stat(today, 'Advance collected').textContent).toContain('Taken when the order was booked');
    expect(stat(today, 'Balance received').textContent).toContain(money(20000));
    expect(stat(today, 'Balance received').textContent).toContain('Taken at or after pickup');
    expect(stat(today, 'Collected').textContent).toContain(money(55000));
    expect(stat(today, 'To collect').textContent).toContain(money(12500));
    expect(stat(today, 'To collect').textContent).toContain('2 orders with a balance');
    expect(stat(today, 'To collect').classList.contains('warn')).toBe(true);
    expect(stat(today, 'Ready to collect').textContent).toContain('4');
    expect(stat(today, 'In process').textContent).toContain('5');
    expect(stat(today, 'In process').textContent).toContain('2 not started');
    expect(stat(today, 'Low stock').textContent).toContain('2');
    const month = screen.getByRole('heading', { name: 'This month' }).nextElementSibling as HTMLElement;
    expect(stat(month, 'Billed').textContent).toContain(money(900000));
    expect(stat(month, 'Advance collected').textContent).toContain(money(500000));
    expect(stat(month, 'Balance received').textContent).toContain(money(300000));
    expect(stat(month, 'Collected').textContent).toContain(money(800000));
    expect(stat(month, 'Expenses').textContent).toContain(money(100000));
    expect(stat(month, 'Profit').textContent).toContain(money(700000));
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('Sales for the last 14 days');
    expect(api.getSalesSeries).toHaveBeenCalledWith({ from: '2026-03-02T00:00', to: '2026-03-16T00:00' }, 'day');
  });

  it('lists ready orders that are waiting and orders that are in process', async () => {
    const { props } = setup();
    await screen.findByText('LA-2026-00007');
    const waiting = heading('Ready and waiting over 2 days');
    expect(within(waiting).getByText('5 days')).toBeTruthy();
    expect(within(waiting).getByText('Paid')).toBeTruthy();
    expect(within(waiting).getByText('4 pieces')).toBeTruthy();
    fireEvent.click(within(waiting).getByRole('button', { name: 'LA-2026-00007' }));
    expect(props.onOpenOrder).toHaveBeenLastCalledWith('r1');
    const working = heading('In process');
    expect(within(working).getByText('Washing')).toBeTruthy();
    expect(within(working).getByText('Overdue')).toBeTruthy();
    expect(within(working).getAllByText('—').length).toBe(1);
    expect(within(working).getByRole('columnheader', { name: 'To pay' })).toBeTruthy();
    expect(within(working).getAllByText('Paid')).toHaveLength(2);
    fireEvent.click(within(working).getByRole('button', { name: 'LA-2026-00009' }));
    expect(props.onOpenOrder).toHaveBeenLastCalledWith('w2');
    expect(screen.queryByText(/Showing/)).toBeNull();
  });

  it('shows what is owed on a waiting order and a day count of one', async () => {
    api.getDashboardOverview.mockResolvedValue(overviewOf({
      readyWaiting: { total: 3, orders: [attentionOf({ balanceMinor: 4500, daysWaiting: 1 })] },
      inProcess: { total: 25, orders: [attentionOf({ id: 'w', orderNumber: 'LA-W', status: 'packing' })] },
    }));
    setup();
    await screen.findByText('1 day');
    expect(screen.getByText(money(4500))).toBeTruthy();
    expect(screen.getByText('Showing 1 of 3.')).toBeTruthy();
    expect(screen.getByText('Showing 1 of 25, soonest promise first.')).toBeTruthy();
  });

  it('shows the balance still to pay on an order in process, and Paid when nothing is owed', async () => {
    api.getDashboardOverview.mockResolvedValue(overviewOf({
      inProcess: {
        total: 2,
        orders: [
          attentionOf({ id: 'w1', orderNumber: 'LA-W1', status: 'drying', balanceMinor: 7500, promisedAt: null }),
          attentionOf({ id: 'w2', orderNumber: 'LA-W2', status: 'packing', balanceMinor: 0, promisedAt: null }),
        ],
      },
    }));
    setup();
    const working = (await screen.findByRole('heading', { name: 'In process' })).parentElement as HTMLElement;
    const owing = within(working).getByRole('button', { name: 'LA-W1' }).closest('tr') as HTMLElement;
    expect(owing.textContent).toContain('Drying');
    expect(owing.textContent).toContain(money(7500));
    const settled = within(working).getByRole('button', { name: 'LA-W2' }).closest('tr') as HTMLElement;
    expect(settled.textContent).toContain('Paid');
  });

  it('lists recent orders and opens one', async () => {
    const { props } = setup();
    const recent = (await screen.findByRole('heading', { name: 'Recent orders' })).parentElement as HTMLElement;
    expect(within(recent).getByText('Cancelled')).toBeTruthy();
    expect(within(recent).getByText(money(12000))).toBeTruthy();
    fireEvent.click(within(recent).getByRole('button', { name: 'LA-2026-00002' }));
    expect(props.onOpenOrder).toHaveBeenCalledWith('o2');
  });

  it('says so when nothing needs attention and there are no orders', async () => {
    api.getDashboardOverview.mockResolvedValue(overviewOf({
      readyWaiting: { total: 0, orders: [] }, inProcess: { total: 0, orders: [] }, recentOrders: [], lowStockCount: 0,
      queue: { received: 0, inProcess: 0, ready: 0 },
      today: summaryOf({
        discountMinor: 0, collectedMinor: 10000, advanceCollectedMinor: 7500, balanceCollectedMinor: 2500,
        refundedMinor: 2500, advanceRefundedMinor: 0, balanceRefundedMinor: 2500, netCollectedMinor: 7500,
      }),
    }));
    setup();
    await screen.findByText('Nothing has been waiting for pickup for more than 2 days.');
    const today = screen.getByRole('heading', { name: 'Today' }).nextElementSibling as HTMLElement;
    expect(stat(today, 'Billed').textContent).not.toContain('discount');
    expect(stat(today, 'Collected').textContent).toContain(`After ${money(2500)} refunded`);
    expect(stat(today, 'Advance collected').textContent).toContain(money(7500));
    expect(stat(today, 'Balance received').textContent).toContain(money(0));
    expect(screen.getByText('No orders are being processed.')).toBeTruthy();
    expect(screen.getByText('No orders yet.')).toBeTruthy();
  });

  it('takes refunds off each kind of money, not off the other', async () => {
    api.getDashboardOverview.mockResolvedValue(overviewOf({
      today: summaryOf({
        collectedMinor: 55000, advanceCollectedMinor: 35000, balanceCollectedMinor: 20000, refundedMinor: 2500,
        advanceRefundedMinor: 1000, balanceRefundedMinor: 1500, netCollectedMinor: 52500,
      }),
    }));
    setup();
    await screen.findByText('Figures for today, 15 Mar 2026, and the month so far.');
    const today = screen.getByRole('heading', { name: 'Today' }).nextElementSibling as HTMLElement;
    expect(stat(today, 'Advance collected').textContent).toContain(money(34000));
    expect(stat(today, 'Balance received').textContent).toContain(money(18500));
    expect(stat(today, 'Collected').textContent).toContain(money(52500));
    expect(stat(today, 'Collected').textContent).toContain(`After ${money(2500)} refunded`);
  });

  it('says nothing is owed in neutral tone when every balance is paid', async () => {
    api.getDashboardOverview.mockResolvedValue(overviewOf({ receivable: { orders: 0, minor: 0 } }));
    setup();
    await screen.findByText('Figures for today, 15 Mar 2026, and the month so far.');
    const today = screen.getByRole('heading', { name: 'Today' }).nextElementSibling as HTMLElement;
    expect(stat(today, 'To collect').textContent).toContain(money(0));
    expect(stat(today, 'To collect').textContent).toContain('Nothing owed');
    expect(stat(today, 'To collect').classList.contains('warn')).toBe(false);
    expect(stat(today, 'To collect').classList.contains('neutral')).toBe(true);
  });

  it('says one order is still owing in the singular', async () => {
    api.getDashboardOverview.mockResolvedValue(overviewOf({ receivable: { orders: 1, minor: 4500 } }));
    setup();
    await screen.findByText('Figures for today, 15 Mar 2026, and the month so far.');
    const today = screen.getByRole('heading', { name: 'Today' }).nextElementSibling as HTMLElement;
    expect(stat(today, 'To collect').textContent).toContain('1 order with a balance');
  });

  it('works out profit itself if the native side leaves it out, and flags a loss', async () => {
    api.getDashboardOverview.mockResolvedValue(overviewOf({
      monthToDate: overviewOf().monthToDate && { ...overviewOf().monthToDate, profitMinor: null, netCollectedMinor: 10000, expensesMinor: 25000 },
    }));
    setup();
    await screen.findByText('Profit');
    const month = screen.getByRole('heading', { name: 'This month' }).nextElementSibling as HTMLElement;
    expect(stat(month, 'Profit').textContent).toContain(money(-15000));
    expect(stat(month, 'Profit').classList.contains('bad')).toBe(true);
  });

  it('reloads on Refresh', async () => {
    setup();
    await screen.findByText('LA-2026-00007');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(api.getDashboardOverview).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.getSalesSeries).toHaveBeenCalledTimes(2));
  });

  it('reports a failed load and stays on the loading screen', async () => {
    api.getDashboardOverview.mockRejectedValue(new Error('database busy'));
    const { props } = setup();
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'database busy' })));
    expect(screen.getByText('Loading...')).toBeTruthy();
  });

  it('ignores answers that arrive after leaving the page', async () => {
    let finish: (value: unknown) => void = () => undefined;
    api.getDashboardOverview.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { unmount, props } = setup();
    unmount();
    finish(overviewOf());
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(api.getSalesSeries).toHaveBeenCalled();
    expect(props.onError).not.toHaveBeenCalled();

    api.getDashboardOverview.mockReturnValue(new Promise((_, reject) => { finish = reject; }));
    const second = setup();
    second.unmount();
    finish(new Error('late failure'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(second.props.onError).not.toHaveBeenCalled();
  });
});
