// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CounterTrashRequest } from '@/lib/localFirst/counter';
import { TrashRequestsPanel } from './TrashRequestsPanel';

const api = vi.hoisted(() => ({ listCounterTrashRequests: vi.fn(), trashCounterOrder: vi.fn(), dismissCounterTrashRequest: vi.fn() }));
vi.mock('@/lib/localFirst/counter', () => api);

const request = (over: Partial<CounterTrashRequest> = {}): CounterTrashRequest => ({
  orderId: 'o-1', orderNumber: '202610170001', customerName: 'Rita Mehta', totalMinor: 6000,
  reason: 'Added twice by mistake', requestedAt: '2026-10-17T10:00:00Z', requestedBy: 'Asha', ...over,
});
const props = () => ({ onError: vi.fn(), onNotice: vi.fn(), onChanged: vi.fn() });
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('TrashRequestsPanel', () => {
  it('shows nothing when no bill is marked', async () => {
    api.listCounterTrashRequests.mockResolvedValue([]);
    const { container } = render(<TrashRequestsPanel {...props()} />);
    await waitFor(() => expect(api.listCounterTrashRequests).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
  });

  it('lists each request with who asked and why', async () => {
    api.listCounterTrashRequests.mockResolvedValue([request(), request({ orderId: 'o-2', orderNumber: '202610170002', requestedBy: '' })]);
    render(<TrashRequestsPanel {...props()} />);
    await screen.findByText('Trash requests (2)');
    expect(screen.getByText(/Bill 202610170001 · Rita Mehta/)).not.toBeNull();
    expect(screen.getByText('Asha: Added twice by mistake')).not.toBeNull();
    expect(screen.getAllByRole('button', { name: 'Move to trash' })).toHaveLength(2);
  });

  it('moves the bill to the trash, tells the owner, refreshes the order list and the requests', async () => {
    api.listCounterTrashRequests.mockResolvedValueOnce([request()]).mockResolvedValueOnce([]);
    api.trashCounterOrder.mockResolvedValue(undefined);
    const p = props();
    render(<TrashRequestsPanel {...p} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Move to trash' }));
    await waitFor(() => expect(p.onChanged).toHaveBeenCalled());
    expect(api.trashCounterOrder).toHaveBeenCalledWith('o-1');
    expect(p.onNotice).toHaveBeenCalledWith('Order 202610170001 moved to the trash.');
    await waitFor(() => expect(screen.queryByText(/Trash requests/)).toBeNull());
  });

  it('keeps the bill when the owner declines', async () => {
    api.listCounterTrashRequests.mockResolvedValueOnce([request()]).mockResolvedValueOnce([]);
    api.dismissCounterTrashRequest.mockResolvedValue(undefined);
    const p = props();
    render(<TrashRequestsPanel {...p} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Keep bill' }));
    await waitFor(() => expect(p.onNotice).toHaveBeenCalledWith('Order 202610170001 kept.'));
    expect(api.dismissCounterTrashRequest).toHaveBeenCalledWith('o-1');
    expect(api.trashCounterOrder).not.toHaveBeenCalled();
  });

  it('reports a failed decision and keeps the request listed', async () => {
    api.listCounterTrashRequests.mockResolvedValue([request()]);
    api.trashCounterOrder.mockRejectedValue(new Error('no longer valid'));
    const p = props();
    render(<TrashRequestsPanel {...p} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Move to trash' }));
    await waitFor(() => expect(p.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'no longer valid' })));
    expect(p.onChanged).not.toHaveBeenCalled();
    expect(button('Move to trash').disabled).toBe(false);
  });

  it('reports a failure to load the requests', async () => {
    api.listCounterTrashRequests.mockRejectedValue(new Error('offline'));
    const p = props();
    render(<TrashRequestsPanel {...p} />);
    await waitFor(() => expect(p.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'offline' })));
  });
});
