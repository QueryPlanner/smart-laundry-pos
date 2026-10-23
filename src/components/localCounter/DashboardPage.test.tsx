// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DashboardPage } from './DashboardPage';
import { overviewOf, pointOf, summaryOf } from './insightFixtures';
import { money } from './ui';
import type { CounterAccount } from '@/lib/localFirst/counter';

const api = vi.hoisted(() => ({ getDashboardOverview: vi.fn(), getSalesSeries: vi.fn() }));
vi.mock('@/lib/localFirst/insights', () => api);

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

beforeEach(() => {
  vi.clearAllMocks();
  api.getDashboardOverview.mockResolvedValue(overviewOf());
  api.getSalesSeries.mockResolvedValue(series);
});
afterEach(cleanup);

describe('DashboardPage', () => {
  it('shows today, the month, the graph and recent orders, with no advance or stage figures', async () => {
    setup();
    expect(screen.getByText('Loading...')).toBeTruthy();
    await screen.findByText('Figures for today, 15 Mar 2026, and the month so far.');
    const today = screen.getByRole('heading', { name: 'Today' }).nextElementSibling as HTMLElement;
    expect(stat(today, 'Orders').textContent).toContain('2');
    expect(stat(today, 'Orders').textContent).toContain('5 pieces');
    expect(stat(today, 'Billed').textContent).toContain(money(60000));
    expect(stat(today, 'Billed').textContent).toContain(`${money(5000)} discount given`);
    expect(stat(today, 'Collected').textContent).toContain(money(55000));
    expect(stat(today, 'To collect').textContent).toContain(money(12500));
    expect(stat(today, 'To collect').textContent).toContain('2 orders with a balance');
    expect(stat(today, 'To collect').classList.contains('warn')).toBe(true);
    expect(stat(today, 'Low stock').textContent).toContain('2');
    const month = screen.getByRole('heading', { name: 'This month' }).nextElementSibling as HTMLElement;
    expect(stat(month, 'Billed').textContent).toContain(money(900000));
    expect(stat(month, 'Collected').textContent).toContain(money(800000));
    expect(stat(month, 'Expenses').textContent).toContain(money(100000));
    expect(stat(month, 'Profit').textContent).toContain(money(700000));
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('Sales for the last 14 days');
    expect(api.getSalesSeries).toHaveBeenCalledWith({ from: '2026-03-02T00:00', to: '2026-03-16T00:00' }, 'day');
    expect(screen.queryByText(/Advance|Balance received|Ready to collect|In process|Ready and waiting/)).toBeNull();
  });

  it('lists recent orders and opens one', async () => {
    const { props } = setup();
    const recent = (await screen.findByRole('heading', { name: 'Recent orders' })).parentElement as HTMLElement;
    expect(within(recent).getByText('Cancelled')).toBeTruthy();
    expect(within(recent).getByText(money(12000))).toBeTruthy();
    fireEvent.click(within(recent).getByRole('button', { name: 'LA-2026-00002' }));
    expect(props.onOpenOrder).toHaveBeenCalledWith('o2');
  });

  it('says so when there are no orders, and how much was refunded', async () => {
    api.getDashboardOverview.mockResolvedValue(overviewOf({
      readyWaiting: { total: 0, orders: [] }, inProcess: { total: 0, orders: [] }, recentOrders: [], lowStockCount: 0,
      queue: { received: 0, inProcess: 0, ready: 0 },
      today: summaryOf({
        discountMinor: 0, collectedMinor: 10000, advanceCollectedMinor: 7500, balanceCollectedMinor: 2500,
        refundedMinor: 2500, advanceRefundedMinor: 0, balanceRefundedMinor: 2500, netCollectedMinor: 7500,
      }),
    }));
    setup();
    await screen.findByText('No orders yet.');
    const today = screen.getByRole('heading', { name: 'Today' }).nextElementSibling as HTMLElement;
    expect(stat(today, 'Billed').textContent).not.toContain('discount');
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
    await screen.findByText('Recent orders');
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
