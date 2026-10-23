// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TrashPage } from './TrashPage';
import type { CounterTrashedOrder } from '@/lib/localFirst/counter';
import type { SectionProps } from './sections';

const api = vi.hoisted(() => ({ listCounterTrashedOrders: vi.fn(), restoreCounterOrder: vi.fn() }));
vi.mock('@/lib/localFirst/counter', () => api);

const trashed = (over: Partial<CounterTrashedOrder> = {}): CounterTrashedOrder => ({
  orderId: 'o1', orderNumber: '202610160003', customerName: 'Sunita Kulkarni', customerPhone: '9822012345', status: 'ready',
  totalMinor: 46000, receivedAt: '2026-10-16T06:00:00.000Z', trashedAt: '2026-10-18T04:30:00.000Z', trashedBy: 'Mira Shah', reason: '', ...over,
});
const props = (): SectionProps => ({
  account: { id: 'a1', fullName: 'Mira Shah', role: 'admin', active: true }, onError: vi.fn(), onNotice: vi.fn(), onOpenOrder: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
  api.listCounterTrashedOrders.mockResolvedValue([trashed()]);
  api.restoreCounterOrder.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('TrashPage', () => {
  it('lists each trashed order with the customer, the amount and who moved it', async () => {
    render(<TrashPage {...props()} />);
    const list = await screen.findByRole('list', { name: 'Orders in the trash' });
    expect(within(list).getByText('Bill 202610160003 · Sunita Kulkarni · ₹460.00')).toBeTruthy();
    expect(within(list).getByText(/9822012345 · received/)).toBeTruthy();
    expect(within(list).getByText(/Moved to the trash .* by Mira Shah/)).toBeTruthy();
    expect(within(list).queryByText(/Reason:/)).toBeNull();
  });

  it('shows the reason staff gave, and leaves out "by" when the account is gone', async () => {
    api.listCounterTrashedOrders.mockResolvedValue([trashed({ reason: 'Added twice', trashedBy: '' })]);
    render(<TrashPage {...props()} />);
    expect(await screen.findByText('Reason: Added twice')).toBeTruthy();
    expect(screen.getByText(/Moved to the trash [^b]*$/)).toBeTruthy();
    expect(screen.queryByText(/ by /)).toBeNull();
  });

  it('says when the trash is empty', async () => {
    api.listCounterTrashedOrders.mockResolvedValue([]);
    render(<TrashPage {...props()} />);
    expect(await screen.findByText('The trash is empty.')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('shows nothing but the heading until the list has loaded', () => {
    api.listCounterTrashedOrders.mockReturnValue(new Promise(() => undefined));
    render(<TrashPage {...props()} />);
    expect(screen.getByRole('heading', { name: 'Trash' })).toBeTruthy();
    expect(screen.queryByText('The trash is empty.')).toBeNull();
  });

  it('restores an order in one tap, says so, and reloads the list', async () => {
    const p = props();
    render(<TrashPage {...p} />);
    api.listCounterTrashedOrders.mockResolvedValue([]);
    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
    await screen.findByText('The trash is empty.');
    expect(api.restoreCounterOrder).toHaveBeenCalledWith('o1');
    expect(p.onNotice).toHaveBeenCalledWith('Order 202610160003 restored. It counts in sales and the order list again.');
  });

  it('reports a restore that fails and keeps the order listed', async () => {
    const p = props();
    api.restoreCounterOrder.mockRejectedValue(new Error('not in the trash'));
    render(<TrashPage {...p} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(p.onError).toHaveBeenCalled());
    expect(screen.getByText(/Bill 202610160003/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Restore' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('reports a list that cannot be loaded', async () => {
    const p = props();
    api.listCounterTrashedOrders.mockRejectedValue(new Error('database is busy'));
    render(<TrashPage {...p} />);
    await waitFor(() => expect(p.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'database is busy' })));
  });
});
