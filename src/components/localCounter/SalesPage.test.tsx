// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SalesPage } from './SalesPage';
import { orderRowOf, pointOf, summaryOf, transactionOf } from './insightFixtures';
import { money } from './ui';
import type { CounterAccount } from '@/lib/localFirst/counter';
import type { SalesBucket } from '@/lib/localFirst/insights';

const api = vi.hoisted(() => ({
  getSalesSummary: vi.fn(), getSalesSeries: vi.fn(), listSalesOrders: vi.fn(), listSalesTransactions: vi.fn(), listSalesStaff: vi.fn(),
}));
// Only the loaders are faked; the pure netByKind helper keeps its real behaviour.
vi.mock('@/lib/localFirst/insights', async () => ({ ...(await vi.importActual<object>('@/lib/localFirst/insights')), ...api }));

const staff: CounterAccount = { id: 's1', fullName: 'Clerk', role: 'staff', active: true };
const KEY: Record<SalesBucket, string> = { hour: '2026-03-15T09:00', day: '2026-03-15', month: '2026-03' };

const setup = () => {
  const props = { account: staff, onError: vi.fn(), onNotice: vi.fn(), onOpenOrder: vi.fn() };
  const view = render(<SalesPage {...props} />);
  return { props, ...view };
};
const lastFilter = () => api.getSalesSummary.mock.lastCall?.[0];
const lastBucket = () => api.getSalesSeries.mock.lastCall?.[1];
const stat = (label: string): HTMLElement =>
  screen.getByText(label, { selector: 'span.counter-section-label' }).closest('.counter-stat') as HTMLElement;
const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const rowOf = (bill: string): HTMLElement => screen.getByRole('button', { name: bill }).closest('tr') as HTMLElement;
const ready = async () => { await screen.findByText('LA-2026-00001'); await waitFor(() => expect(stat('Billed')).toBeTruthy()); };
const panel = (name: string): HTMLElement => screen.getByRole('region', { name });
const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  // 15 March 2026, 12:00 in shop time.
  vi.setSystemTime(new Date('2026-03-15T06:30:00Z'));
  api.listSalesStaff.mockResolvedValue([{ id: 's1', fullName: 'Asha Patil' }, { id: 's2', fullName: 'Ravi Kulkarni' }]);
  api.getSalesSummary.mockResolvedValue(summaryOf());
  api.getSalesSeries.mockImplementation(async (_filter: unknown, bucket: SalesBucket) => ({
    bucket,
    points: [pointOf(KEY[bucket], 60000, { advanceCollectedMinor: 30000, balanceCollectedMinor: 20000 })],
  }));
  api.listSalesOrders.mockResolvedValue({
    items: [
      orderRowOf({ discountMinor: 2000, balanceMinor: 500, paidMinor: 29500, methods: ['cash', 'upi'] }),
      orderRowOf({ id: 'o2', orderNumber: 'LA-2026-00002', status: 'cancelled', cancelledAt: '2026-03-15T05:00:00+00:00', paidMinor: 0, balanceMinor: 0, methods: [], staffName: null }),
    ],
    total: 2,
  });
  api.listSalesTransactions.mockResolvedValue({
    items: [
      transactionOf({ reference: 'UTR 99' }),
      transactionOf({ id: 'p2', kind: 'refund', amountMinor: 5000, voidedByName: 'Meera Shah', voidReason: 'order cancelled', staffName: null }),
      transactionOf({ id: 'p3', kind: 'refund', amountMinor: 700, voidedByName: null, voidReason: null, method: 'upi' }),
    ],
    total: 3,
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('SalesPage default view', () => {
  it('opens on today with summary, graph, breakdowns and the order list', async () => {
    setup();
    await ready();
    expect(lastFilter()).toEqual({
      from: '2026-03-15T00:00', to: '2026-03-16T00:00', paymentMethods: [], statuses: [], staffId: undefined,
      search: undefined, discountedOnly: false, includeCancelled: false,
    });
    expect(lastBucket()).toBe('hour');
    expect(api.listSalesOrders).toHaveBeenLastCalledWith(lastFilter(), 0, 25);
    expect(screen.getByRole('button', { name: 'Today' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/Period: 15 Mar 2026, 12:00\s?am up to, not including, 16 Mar 2026, 12:00\s?am \(shop time\)\./i)).toBeTruthy();
    expect(stat('Orders').textContent).toContain('9 pieces');
    expect(stat('Before discount').textContent).toContain(money(200000));
    expect(stat('Discounts').textContent).toContain(money(20000));
    expect(stat('Billed').textContent).toContain(money(180000));
    expect(stat('Billed').textContent).toContain(`Average ${money(45000)} per order`);
    expect(stat('Collected').textContent).toContain(money(150000));
    expect(stat('Advance collected').textContent).toContain(money(90000));
    expect(stat('Advance collected').textContent).toContain('Taken when booked, after refunds');
    expect(stat('Balance received').textContent).toContain(money(55000));
    expect(stat('Balance received').textContent).toContain('Taken at pickup, after refunds');
    expect(stat('Refunded').textContent).toContain(money(5000));
    expect(stat('Refunded').classList.contains('warn')).toBe(true);
    expect(stat('Net collected').textContent).toContain(money(145000));
    expect(stat('Cancelled').textContent).toContain(`1${money(5000)} worth`);
    expect(stat('Expenses').textContent).toContain(money(30000));
    expect(stat('Profit').textContent).toContain(money(115000));
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('Hourly sales');
    expect(screen.getByText(/The staff filter follows who created each order/)).toBeTruthy();
    expect(screen.getByText(/Expenses are kept by day/)).toBeTruthy();
    expect(screen.getByText(/Billed counts orders created in the period/)).toBeTruthy();
    expect(screen.getByText('Advance is the part paid when the order is booked; balance is what is paid at or after pickup.')).toBeTruthy();
  });

  it('nets refunds off advance and balance separately', async () => {
    api.getSalesSummary.mockResolvedValue(summaryOf({
      collectedMinor: 60000, refundedMinor: 10000, advanceCollectedMinor: 40000, balanceCollectedMinor: 20000,
      advanceRefundedMinor: 10000, balanceRefundedMinor: 0, netCollectedMinor: 50000,
    }));
    setup();
    await waitFor(() => expect(stat('Advance collected').textContent).toContain(money(30000)));
    expect(stat('Balance received').textContent).toContain(money(20000));
    expect(stat('Net collected').textContent).toContain(money(50000));
  });

  it('breaks the figures down by method, staff, service and status', async () => {
    setup();
    await ready();
    const method = panel('By payment method');
    expect(within(method).getByText('Cash').parentElement?.textContent).toContain('3 payments');
    expect(within(method).getByText(`${money(100000)} (${money(5000)} back)`)).toBeTruthy();
    expect(within(method).getByText(money(50000))).toBeTruthy();
    const people = panel('By staff');
    expect(within(people).getByText('Asha Patil').parentElement?.textContent).toContain(`3 orders, ${money(150000)} billed`);
    expect(within(people).getByText(money(115000))).toBeTruthy();
    expect(within(people).getByText('Former account')).toBeTruthy();
    expect(within(panel('By service')).getByText('Wash + Iron').parentElement?.textContent).toContain('7 pieces, before discount');
    expect(within(panel('By order status')).getByText('Quality check')).toBeTruthy();
  });

  it('shows empty breakdowns and an unavailable profit when filters hide it', async () => {
    api.getSalesSummary.mockResolvedValue(summaryOf({
      profitMinor: null, refundedMinor: 0, balanceRefundedMinor: 0, netCollectedMinor: 150000,
      byMethod: [], byStaff: [], byService: [], byStatus: [],
    }));
    setup();
    await waitFor(() => expect(stat('Profit').textContent).toContain('—'));
    expect(stat('Profit').textContent).toContain('Not shown while filters are on');
    expect(stat('Refunded').classList.contains('warn')).toBe(false);
    expect(within(panel('By payment method')).getByText('No payments.')).toBeTruthy();
    expect(within(panel('By staff')).getByText('No staff activity.')).toBeTruthy();
    expect(within(panel('By service')).getByText('No orders.')).toBeTruthy();
    expect(within(panel('By order status')).getByText('No orders.')).toBeTruthy();
  });

  it('flags a loss', async () => {
    api.getSalesSummary.mockResolvedValue(summaryOf({ profitMinor: -4200 }));
    setup();
    await waitFor(() => expect(stat('Profit').textContent).toContain(money(-4200)));
    expect(stat('Profit').classList.contains('bad')).toBe(true);
  });
});

describe('SalesPage period', () => {
  it('switches presets and picks a sensible graph for each', async () => {
    setup();
    await ready();
    press('Yesterday');
    await waitFor(() => expect(lastFilter()).toMatchObject({ from: '2026-03-14T00:00', to: '2026-03-15T00:00' }));
    expect(lastBucket()).toBe('hour');
    press('Last 7 days');
    await waitFor(() => expect(lastFilter()).toMatchObject({ from: '2026-03-09T00:00', to: '2026-03-16T00:00' }));
    expect(lastBucket()).toBe('day');
    press('This month');
    await waitFor(() => expect(lastFilter()).toMatchObject({ from: '2026-03-01T00:00', to: '2026-04-01T00:00' }));
    expect(lastBucket()).toBe('day');
    expect(screen.getByRole('button', { name: 'This month' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('lets the graph detail be switched and falls back when the range no longer allows it', async () => {
    setup();
    await ready();
    press('Last 7 days');
    await waitFor(() => expect(lastBucket()).toBe('day'));
    expect(screen.getAllByRole('button', { name: /^(Hourly|Daily|Monthly)$/ }).map(button => button.textContent)).toEqual(['Hourly', 'Daily', 'Monthly']);
    press('Hourly');
    await waitFor(() => expect(lastBucket()).toBe('hour'));
    expect(screen.getByRole('button', { name: 'Hourly' }).getAttribute('aria-pressed')).toBe('true');
    press('Custom');
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2024-01-01' } });
    await waitFor(() => expect(lastBucket()).toBe('month'));
    expect(screen.queryByRole('button', { name: 'Hourly' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Daily' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Monthly' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('takes a custom start and end with times, end not included', async () => {
    setup();
    await ready();
    expect(screen.queryByLabelText('From date')).toBeNull();
    press('Custom');
    expect((screen.getByLabelText('From date') as HTMLInputElement).value).toBe('2026-03-15');
    expect((screen.getByLabelText('To time') as HTMLInputElement).value).toBe('00:00');
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-03-10' } });
    fireEvent.change(screen.getByLabelText('From time'), { target: { value: '09:30' } });
    fireEvent.change(screen.getByLabelText(/^To date/), { target: { value: '2026-03-12' } });
    fireEvent.change(screen.getByLabelText('To time'), { target: { value: '18:15' } });
    await waitFor(() => expect(lastFilter()).toMatchObject({ from: '2026-03-10T09:30', to: '2026-03-12T18:15' }));
    expect(lastBucket()).toBe('day');
    expect(screen.getByText('Up to, not including')).toBeTruthy();
    expect(screen.getByText(/Period: 10 Mar 2026, 9:30\s?am up to, not including, 12 Mar 2026, 6:15\s?pm/i)).toBeTruthy();
  });

  it('explains an impossible range and does not query it', async () => {
    setup();
    await ready();
    press('Custom');
    const calls = api.getSalesSummary.mock.calls.length;
    const listCalls = api.listSalesOrders.mock.calls.length;
    fireEvent.change(screen.getByLabelText(/^To date/), { target: { value: '2026-03-14' } });
    expect((await screen.findByRole('alert')).textContent).toBe('The end must be after the start.');
    expect(screen.queryByText(/Period:/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Daily' })).toBeNull();
    expect(screen.queryByText('LA-2026-00001')).toBeNull();
    expect(screen.queryByRole('tablist', { name: 'Graph detail' })).toBeNull();
    expect(api.getSalesSummary.mock.calls.length).toBe(calls);
    expect(api.listSalesOrders.mock.calls.length).toBe(listCalls);
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '' } });
    expect((await screen.findByRole('alert')).textContent).toContain('start and an end');
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-03-01' } });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    await waitFor(() => expect(lastFilter()).toMatchObject({ from: '2026-03-01T00:00', to: '2026-03-14T00:00' }));
  });
});

describe('SalesPage filters', () => {
  it('filters by payment method, status, staff, discounts and cancelled orders', async () => {
    setup();
    await ready();
    await screen.findByRole('option', { name: 'Asha Patil' });
    press('Cash');
    press('UPI');
    await waitFor(() => expect(lastFilter().paymentMethods).toEqual(['cash', 'upi']));
    press('Cash');
    await waitFor(() => expect(lastFilter().paymentMethods).toEqual(['upi']));
    expect(screen.getByRole('button', { name: 'Cash' }).getAttribute('aria-pressed')).toBe('false');
    press('Ready');
    press('In process');
    await waitFor(() => expect(lastFilter().statuses).toEqual(['washing', 'drying', 'ironing', 'quality_check', 'packing', 'ready']));
    press('Ready');
    press('In process');
    press('Received');
    await waitFor(() => expect(lastFilter().statuses).toEqual(['received']));
    press('Received');
    press('Collected');
    await waitFor(() => expect(lastFilter().statuses).toEqual(['collected']));
    fireEvent.change(screen.getByLabelText(/^Staff/), { target: { value: 's2' } });
    await waitFor(() => expect(lastFilter().staffId).toBe('s2'));
    expect(screen.getByText('Orders by who created them; money by who took the payment.')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Discounted orders only'));
    fireEvent.click(screen.getByLabelText('Include cancelled orders'));
    await waitFor(() => expect(lastFilter()).toMatchObject({ discountedOnly: true, includeCancelled: true, staffId: 's2' }));
    fireEvent.change(screen.getByLabelText(/^Staff/), { target: { value: '' } });
    await waitFor(() => expect(lastFilter().staffId).toBeUndefined());
    expect(api.listSalesOrders).toHaveBeenLastCalledWith(lastFilter(), 0, 25);
    expect(api.getSalesSeries.mock.lastCall?.[0]).toEqual(lastFilter());
  });

  it('searches only when asked, with the text trimmed, and clears the search', async () => {
    setup();
    await ready();
    const box = screen.getByLabelText(/^Search/);
    fireEvent.change(box, { target: { value: '  rita  ' } });
    expect(lastFilter().search).toBeUndefined();
    press('Search');
    await waitFor(() => expect(lastFilter().search).toBe('rita'));
    fireEvent.change(box, { target: { value: '   ' } });
    fireEvent.submit(box.closest('form') as HTMLFormElement);
    await waitFor(() => expect(lastFilter().search).toBeUndefined());
  });

  it('starts from the first page whenever the question changes', async () => {
    api.listSalesOrders.mockResolvedValue({ items: [orderRowOf()], total: 60 });
    setup();
    await ready();
    press('Next');
    await waitFor(() => expect(api.listSalesOrders).toHaveBeenLastCalledWith(lastFilter(), 25, 25));
    press('Cash');
    await waitFor(() => expect(api.listSalesOrders).toHaveBeenLastCalledWith(expect.objectContaining({ paymentMethods: ['cash'] }), 0, 25));
  });
});

describe('SalesPage order list', () => {
  it('shows each order with its money, payment methods and who created it', async () => {
    const { props } = setup();
    await ready();
    const first = rowOf('LA-2026-00001');
    expect(first.textContent).toContain('Rita Joshi');
    expect(first.textContent).toContain('9876543210');
    expect(first.textContent).toContain('Ready');
    expect(first.textContent).toContain(`${money(2000)} off`);
    expect(first.textContent).toContain(money(500));
    expect(first.textContent).toContain('Cash, UPI');
    expect(first.textContent).toContain('Asha Patil');
    expect(first.textContent).toMatch(/15 Mar 2026, 10:00\s?am/i);
    const cancelled = rowOf('LA-2026-00002');
    expect(cancelled.textContent).toContain('Cancelled');
    expect(cancelled.textContent).toMatch(/Cancelled 15 Mar 2026, 10:30\s?am/i);
    expect(within(cancelled).getAllByText('—')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'LA-2026-00002' }));
    expect(props.onOpenOrder).toHaveBeenCalledWith('o2');
  });

  it('pages through the orders', async () => {
    api.listSalesOrders.mockResolvedValue({ items: [orderRowOf()], total: 60 });
    setup();
    await ready();
    expect(screen.getByText('Showing 1 to 25 of 60')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true);
    press('Next');
    await screen.findByText('Showing 26 to 50 of 60');
    press('Next');
    await screen.findByText('Showing 51 to 60 of 60');
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
    press('Previous');
    await screen.findByText('Showing 26 to 50 of 60');
    press('Previous');
    await screen.findByText('Showing 1 to 25 of 60');
  });

  it('says so when no order matches', async () => {
    api.listSalesOrders.mockResolvedValue({ items: [], total: 0 });
    setup();
    await screen.findByText('No orders match.');
  });
});

describe('SalesPage transactions', () => {
  const open = async () => {
    setup();
    await ready();
    fireEvent.click(screen.getByRole('tab', { name: 'Transactions' }));
    await screen.findAllByText('Refund');
  };

  it('lists payments and refunds with who took them and why money went back', async () => {
    await open();
    expect(screen.getByRole('tab', { name: 'Transactions' }).getAttribute('aria-selected')).toBe('true');
    expect(api.listSalesTransactions).toHaveBeenLastCalledWith(lastFilter(), 0, 25);
    const table = screen.getByRole('columnheader', { name: 'Taken by' }).closest('table') as HTMLElement;
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('Payment');
    expect(rows[0].textContent).toContain('Ref UTR 99');
    expect(rows[0].textContent).toContain(money(30000));
    expect(rows[0].textContent).toContain('Asha Patil');
    expect(rows[0].textContent).toMatch(/15 Mar 2026, 10:01\s?am/i);
    expect(rows[1].textContent).toContain(`−${money(5000)}`);
    expect(rows[1].textContent).toContain('By Meera Shah: order cancelled');
    expect(rows[1].textContent).toContain('—');
    expect(rows[2].textContent).toContain(`−${money(700)}`);
    expect(rows[2].textContent).toContain('By unknown');
    expect(rows[2].textContent).not.toContain(': ');
    expect(rows[2].textContent).toContain('UPI');
  });

  it('opens the order behind a transaction and returns to the order list', async () => {
    await open();
    expect(screen.getByText('Showing 1 to 3 of 3')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'LA-2026-00001' })[0]);
    fireEvent.click(screen.getByRole('tab', { name: 'Orders' }));
    await screen.findByText('Cash, UPI');
  });

  it('says so when there are no transactions', async () => {
    api.listSalesTransactions.mockResolvedValue({ items: [], total: 0 });
    setup();
    await ready();
    fireEvent.click(screen.getByRole('tab', { name: 'Transactions' }));
    await screen.findByText('No payments or refunds match.');
  });

  it('pages through transactions', async () => {
    api.listSalesTransactions.mockResolvedValue({ items: [transactionOf()], total: 30 });
    setup();
    await ready();
    fireEvent.click(screen.getByRole('tab', { name: 'Transactions' }));
    await screen.findByText('Showing 1 to 25 of 30');
    press('Next');
    await waitFor(() => expect(api.listSalesTransactions).toHaveBeenLastCalledWith(lastFilter(), 25, 25));
  });
});

describe('SalesPage refresh and failures', () => {
  it('re-reads the preset so a page left open overnight moves on', async () => {
    setup();
    await ready();
    vi.setSystemTime(new Date('2026-03-16T06:30:00Z'));
    press('Refresh');
    await waitFor(() => expect(lastFilter()).toMatchObject({ from: '2026-03-16T00:00', to: '2026-03-17T00:00' }));
  });

  it('refreshes a custom range as it is', async () => {
    setup();
    await ready();
    press('Custom');
    const calls = api.getSalesSummary.mock.calls.length;
    press('Refresh');
    await waitFor(() => expect(api.getSalesSummary.mock.calls.length).toBe(calls + 1));
    expect(lastFilter()).toMatchObject({ from: '2026-03-15T00:00', to: '2026-03-16T00:00' });
  });

  it('reports every kind of failed load', async () => {
    api.listSalesStaff.mockRejectedValue(new Error('staff failed'));
    api.getSalesSeries.mockRejectedValue(new Error('graph failed'));
    api.listSalesOrders.mockRejectedValue(new Error('orders failed'));
    const { props } = setup();
    await waitFor(() => expect(props.onError).toHaveBeenCalledTimes(3));
    const messages = props.onError.mock.calls.map(call => (call[0] as Error).message).sort();
    expect(messages).toEqual(['graph failed', 'orders failed', 'staff failed']);
    api.listSalesTransactions.mockRejectedValue(new Error('payments failed'));
    fireEvent.click(screen.getByRole('tab', { name: 'Transactions' }));
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'payments failed' })));
  });

  it('ignores answers that arrive after leaving the page', async () => {
    const pending = { staff: deferred<unknown>(), summary: deferred<unknown>(), orders: deferred<unknown>(), payments: deferred<unknown>() };
    api.listSalesStaff.mockReturnValue(pending.staff.promise);
    api.getSalesSummary.mockReturnValue(pending.summary.promise);
    api.listSalesOrders.mockReturnValue(pending.orders.promise);
    api.listSalesTransactions.mockReturnValue(pending.payments.promise);
    const first = setup();
    first.unmount();
    await act(async () => {
      pending.staff.resolve([]);
      pending.summary.resolve(summaryOf());
      pending.orders.resolve({ items: [], total: 0 });
    });
    expect(first.props.onError).not.toHaveBeenCalled();

    const second = setup();
    fireEvent.click(screen.getByRole('tab', { name: 'Transactions' }));
    second.unmount();
    await act(async () => { pending.payments.resolve({ items: [], total: 0 }); });
    expect(second.props.onError).not.toHaveBeenCalled();

    const failing = { staff: deferred<unknown>(), summary: deferred<unknown>(), orders: deferred<unknown>(), payments: deferred<unknown>() };
    api.listSalesStaff.mockReturnValue(failing.staff.promise);
    api.getSalesSummary.mockReturnValue(failing.summary.promise);
    api.listSalesOrders.mockReturnValue(failing.orders.promise);
    api.listSalesTransactions.mockReturnValue(failing.payments.promise);
    const third = setup();
    fireEvent.click(screen.getByRole('tab', { name: 'Transactions' }));
    third.unmount();
    await act(async () => {
      failing.staff.reject(new Error('x'));
      failing.summary.reject(new Error('x'));
      failing.orders.reject(new Error('x'));
      failing.payments.reject(new Error('x'));
    });
    expect(third.props.onError).not.toHaveBeenCalled();
  });
});
