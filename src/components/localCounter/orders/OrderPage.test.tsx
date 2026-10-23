// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CounterOrderLine, CounterSavedOrder } from '@/lib/localFirst/counter';
import { OrderPage, type OrderPageProps } from './OrderPage';

const api = vi.hoisted(() => ({ getCounterOrder: vi.fn(), handOverCounterItems: vi.fn(), recordCounterPayment: vi.fn() }));
vi.mock('@/lib/localFirst/counter', () => api);

const line = (itemId: string, garment: string, service: string, pieceCount: number, lineTotalMinor: number, handedOverCount = 0): CounterOrderLine => ({
  itemId, garment, service, quantity: pieceCount, unitPriceMinor: lineTotalMinor / Math.max(1, pieceCount), lineTotalMinor, pieceCount, handedOverCount,
});
const order = (over: Partial<CounterSavedOrder> = {}): CounterSavedOrder => ({
  orderId: 'o-1', orderNumber: '202610170001', customerName: 'Rita Mehta', customerPhone: '9876543210', receivedAt: '2026-10-15T06:00:00Z', promisedAt: '2026-10-17T11:30:00Z',
  status: 'received', totalMinor: 23000, paidMinor: 0, balanceMinor: 23000, paymentStatus: 'unpaid', collectedAt: null, refundDueMinor: 0, payments: [],
  lines: [line('iron', 'Shirt', 'Iron', 3, 3000), line('dry', 'Saree', 'Dry Clean', 2, 20000)],
  pieces: [{ id: 'p-1', shortId: '2610170001-1', garmentId: 'saree', garment: 'Saree', service: 'Dry Clean', position: 1, total: 2, matched: false, packingMatched: false, collectionMatched: false, tagged: true }],
  printJobs: [], ...over,
});
const props = (over: Partial<OrderPageProps> = {}): OrderPageProps => ({
  order: order(), isAdmin: true, busy: false, backLabel: 'Orders', onBack: vi.fn(), onOrder: vi.fn(), onError: vi.fn(), onNotice: vi.fn(), onCustomer: vi.fn(),
  onPreviewBill: vi.fn(), onReprintBill: vi.fn(), onReprintTags: vi.fn(), onOpenPrints: vi.fn(), onTrash: vi.fn(), onRequestTrash: vi.fn(), ...over,
});
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const items = () => within(screen.getByRole('list', { name: 'Items' }));

beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

describe('OrderPage', () => {
  it('shows the bill, the customer, the lines with their amounts and the money', () => {
    render(<OrderPage {...props()} />);
    expect(screen.getByRole('heading', { name: '202610170001' })).toBeTruthy();
    expect(screen.getByText('Not collected')).toBeTruthy();
    expect(items().getByText('3 × Shirt · Iron')).toBeTruthy();
    expect(items().getByText('₹30.00')).toBeTruthy();
    expect(items().getAllByText('At the shop')).toHaveLength(2);
    const money = within(screen.getByRole('region', { name: 'Payment' }));
    expect(money.getByText('Balance').nextSibling?.textContent).toBe('₹230.00');
    expect(screen.queryByRole('list', { name: 'Payment history' })).toBeNull();
    expect(button('Receive ₹230.00 and hand over 5 pieces').disabled).toBe(false);
  });

  it('opens the customer’s bills from the name, and runs the bill and trash actions', () => {
    const p = props();
    render(<OrderPage {...p} />);
    fireEvent.click(button('Rita Mehta'));
    fireEvent.click(button('← Orders'));
    fireEvent.click(button('Preview bill'));
    fireEvent.click(button('Reprint bill'));
    fireEvent.click(button('Reprint tags'));
    fireEvent.click(button('Print status'));
    fireEvent.click(button('Move to trash'));
    fireEvent.click(button('Confirm move to trash'));
    expect(p.onCustomer).toHaveBeenCalledWith('9876543210');
    for (const callback of [p.onBack, p.onPreviewBill, p.onReprintBill, p.onReprintTags, p.onOpenPrints, p.onTrash]) expect(callback).toHaveBeenCalledOnce();
  });

  it('offers no tag reprint when nothing was tagged', () => {
    render(<OrderPage {...props({ order: order({ pieces: [] }) })} />);
    expect(screen.queryByRole('button', { name: 'Reprint tags' })).toBeNull();
  });

  it('hands over the ticked lines with the share they cost, as the cashier chooses', async () => {
    const after = order({ paidMinor: 3000, balanceMinor: 20000, lines: [line('iron', 'Shirt', 'Iron', 3, 3000, 3), line('dry', 'Saree', 'Dry Clean', 2, 20000)] });
    api.recordCounterPayment.mockResolvedValue(order({ paidMinor: 3000, balanceMinor: 20000 }));
    api.handOverCounterItems.mockResolvedValue(after);
    const p = props();
    render(<OrderPage {...p} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Hand over 2 × Saree · Dry Clean' }));
    expect((screen.getByLabelText('Amount received now (₹)') as HTMLInputElement).value).toBe('30.00');
    fireEvent.click(button('UPI'));
    expect(button('UPI').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button('Receive ₹30.00 and hand over 3 pieces'));
    await waitFor(() => expect(p.onNotice).toHaveBeenCalledWith('Received ₹30.00. 3 pieces handed over.'));
    expect(api.recordCounterPayment).toHaveBeenCalledWith('o-1', expect.objectContaining({ amountMinor: 3000, method: 'upi' }));
    expect(p.onOrder).toHaveBeenLastCalledWith(after);
  });

  it('says why the button cannot be used, and lets the amount be typed', () => {
    render(<OrderPage {...props()} />);
    fireEvent.change(screen.getByLabelText('Amount received now (₹)'), { target: { value: '100' } });
    expect(screen.getByRole('alert').textContent).toContain('take the whole balance first');
    expect(button('Receive ₹100.00 and hand over 5 pieces').disabled).toBe(true);
  });

  it('shows what is already taken and the payments so far, for a part collected order', () => {
    const part = order({
      paidMinor: 3000, balanceMinor: 20000,
      lines: [line('iron', 'Shirt', 'Iron', 3, 3000, 3), line('dry', 'Saree', 'Dry Clean', 2, 20000, 1)],
      payments: [{ id: 'pay-1', at: '2026-10-16T06:00:00Z', method: 'upi', amountMinor: 3000, reference: null, kind: 'settlement', voided: false },
        { id: 'pay-2', at: '2026-10-16T07:00:00Z', method: 'cash', amountMinor: 500, reference: null, kind: 'settlement', voided: true }],
    });
    render(<OrderPage {...props({ order: part })} />);
    expect(screen.getByText('Part collected')).toBeTruthy();
    expect(items().getByText('Taken')).toBeTruthy();
    expect(items().getByText('1 of 2 taken')).toBeTruthy();
    expect(items().queryByRole('checkbox', { name: /Shirt/ })).toBeNull();
    const history = within(screen.getByRole('list', { name: 'Payment history' }));
    expect(history.getByText('UPI')).toBeTruthy();
    expect(history.getByText('Cancelled')).toBeTruthy();
  });

  it('shows a collected order with its date and no pickup box', () => {
    const done = order({ status: 'collected', collectedAt: '2026-10-18T06:00:00Z', paidMinor: 23000, balanceMinor: 0, lines: [line('iron', 'Shirt', 'Iron', 3, 3000, 3), line('old', 'Coat', 'Wash', 0, 0)] });
    render(<OrderPage {...props({ order: done })} />);
    expect(screen.getAllByText('Collected')).toHaveLength(1);
    expect(screen.getByText(/^Collected 18 Oct 2026/)).toBeTruthy();
    expect(screen.queryByLabelText('Amount received now (₹)')).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('shows a cancelled order as cancelled, with nothing to pay or hand over', () => {
    render(<OrderPage {...props({ order: order({ status: 'cancelled', balanceMinor: -500 }) })} />);
    expect(screen.getByRole('status').textContent).toContain('cancelled');
    expect(within(screen.getByRole('region', { name: 'Payment' })).getByText('Balance').nextSibling?.textContent).toBe('₹0.00');
    expect(screen.queryByLabelText('Amount received now (₹)')).toBeNull();
  });

  it('locks every action while the shell is busy', () => {
    render(<OrderPage {...props({ busy: true })} />);
    for (const name of ['Preview bill', 'Reprint bill', 'Reprint tags', 'Print status', 'Move to trash']) expect(button(name).disabled).toBe(true);
    expect((screen.getByLabelText('Amount received now (₹)') as HTMLInputElement).disabled).toBe(true);
    expect(button(/Receive/).disabled).toBe(true);
  });

  it('says it is saving while the pickup is being recorded', async () => {
    let finish: (value: CounterSavedOrder) => void = () => undefined;
    api.handOverCounterItems.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<OrderPage {...props({ order: order({ paidMinor: 23000, balanceMinor: 0 }) })} />);
    fireEvent.click(button('Hand over 5 pieces'));
    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeTruthy();
    finish(order({ status: 'collected', paidMinor: 23000, balanceMinor: 0 }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Saving…' })).toBeNull());
  });
});
