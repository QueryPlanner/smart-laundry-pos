// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CounterSavedOrder } from '@/lib/localFirst/counter';
import { OrderWorkspace } from './OrderWorkspace';
import { order, owingOrder } from './handoverFixtures';

const api = vi.hoisted(() => ({
  updateCounterOrderStatus: vi.fn(), cancelCounterOrder: vi.fn(), trashCounterOrder: vi.fn(), requestCounterOrderTrash: vi.fn(), recordCounterPayment: vi.fn(),
  collectCounterOrder: vi.fn(), getCounterOrder: vi.fn(), matchOrderPieces: vi.fn(),
}));
vi.mock('@/lib/localFirst/counter', () => api);

type Props = ComponentProps<typeof OrderWorkspace>;
const props = (over: Partial<Props> = {}): Props => ({
  order: owingOrder({ status: 'received' }), view: 'detail', isAdmin: true, backLabel: 'Dashboard',
  onBack: vi.fn(), onView: vi.fn(), onOrder: vi.fn(), onError: vi.fn(), onNotice: vi.fn(),
  onReprintBill: vi.fn(), onReprintTags: vi.fn(), onOpenPrints: vi.fn(), onFinished: vi.fn(), ...over,
});
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const settled = (over: Partial<CounterSavedOrder>): CounterSavedOrder => owingOrder(over);

beforeEach(() => {
  vi.clearAllMocks();
  api.matchOrderPieces.mockResolvedValue({ matchedCount: 4, expectedCount: 4, missingIds: [], duplicateIds: [], wrongOrderIds: [], complete: true });
});
afterEach(cleanup);

describe('the detail view', () => {
  it('shows the order with its customer and where Back goes', () => {
    const p = props();
    render(<OrderWorkspace {...p} />);
    expect(screen.getByRole('heading', { name: '202610170001' })).toBeTruthy();
    expect(screen.getByText('Rita Joshi · 9876543210')).toBeTruthy();
    fireEvent.click(button('← Dashboard'));
    expect(p.onBack).toHaveBeenCalledTimes(1);
  });

  it('offers hand-over only when the order is ready, and opens the hand-over view', () => {
    const early = props();
    const { unmount } = render(<OrderWorkspace {...early} />);
    expect(screen.queryByRole('button', { name: 'Hand over to customer →' })).toBeNull();
    unmount();
    const ready = props({ order: owingOrder() });
    render(<OrderWorkspace {...ready} />);
    fireEvent.click(button('Hand over to customer →'));
    expect(ready.onView).toHaveBeenCalledWith('handover');
  });

  it.each([['ironing', true], ['quality_check', true], ['packing', true], ['received', false], ['washing', false], ['ready', false]])(
    'shows the packing check for %s: %s', (status, shown) => {
      render(<OrderWorkspace {...props({ order: owingOrder({ status }) })} />);
      expect(screen.queryByRole('heading', { name: 'Packing check' }) !== null).toBe(shown);
    });

  it('saves the packing check, marks the order ready and hands the fresh order up', async () => {
    const fresh = owingOrder({ status: 'ready' });
    api.updateCounterOrderStatus.mockResolvedValue(fresh);
    api.getCounterOrder.mockResolvedValue(fresh);
    const p = props({ order: owingOrder({ status: 'packing' }) });
    render(<OrderWorkspace {...p} />);
    expect(button('Save check & mark Ready').disabled).toBe(true);
    fireEvent.click(button('Tick all'));
    fireEvent.click(button('Save check & mark Ready'));
    await waitFor(() => expect(p.onOrder).toHaveBeenCalledWith(fresh));
    expect(api.matchOrderPieces).toHaveBeenCalledWith('o-1', 'packing', ['p1', 'p2', 'u1', 'u2']);
    expect(api.updateCounterOrderStatus).toHaveBeenCalledWith('o-1', 'ready');
    expect(p.onNotice).toHaveBeenCalledWith('Packing checked. Order is ready for pickup.');
  });

  it('moves to the next stage and says so', async () => {
    const moved = owingOrder({ status: 'washing' });
    api.updateCounterOrderStatus.mockResolvedValue(moved);
    const p = props();
    render(<OrderWorkspace {...p} />);
    fireEvent.click(button('Move to Washing'));
    await waitFor(() => expect(p.onOrder).toHaveBeenCalledWith(moved));
    expect(api.updateCounterOrderStatus).toHaveBeenCalledWith('o-1', 'washing');
    expect(p.onNotice).toHaveBeenCalledWith('Order 202610170001 moved to washing.');
  });

  it('reports a failed stage change and lets the cashier try again', async () => {
    api.updateCounterOrderStatus.mockRejectedValueOnce(new Error('cannot move'));
    const p = props();
    render(<OrderWorkspace {...p} />);
    fireEvent.click(button('Move to Washing'));
    await waitFor(() => expect(p.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'cannot move' })));
    expect(p.onOrder).not.toHaveBeenCalled();
    await waitFor(() => expect(button('Move to Washing').disabled).toBe(false));
  });

  it('runs one stage change at a time', async () => {
    let finish!: (order: CounterSavedOrder) => void;
    api.updateCounterOrderStatus.mockReturnValue(new Promise<CounterSavedOrder>(resolve => { finish = resolve; }));
    render(<OrderWorkspace {...props()} />);
    // Two taps in the same instant, before the screen has had time to disable the button.
    const move = button('Move to Washing');
    act(() => { move.click(); move.click(); });
    await waitFor(() => expect(button('Move to Washing').disabled).toBe(true));
    expect(api.updateCounterOrderStatus).toHaveBeenCalledTimes(1);
    finish(owingOrder({ status: 'washing' }));
    await waitFor(() => expect(button('Move to Washing').disabled).toBe(false));
  });

  it('receives the whole balance from the money panel', async () => {
    const paid = settled({ status: 'received', paidMinor: 70000, balanceMinor: 0, paymentStatus: 'paid' });
    api.recordCounterPayment.mockResolvedValue(paid);
    const p = props();
    render(<OrderWorkspace {...p} />);
    fireEvent.click(button('Receive ₹700.00'));
    await waitFor(() => expect(p.onOrder).toHaveBeenCalledWith(paid));
    expect(api.recordCounterPayment).toHaveBeenCalledWith('o-1', {
      amountMinor: 70000, method: 'cash', reference: undefined, idempotencyKey: expect.any(String),
    });
    expect(p.onNotice).toHaveBeenCalledWith('Payment saved.');
  });

  it('passes the reprint and print-status requests up', () => {
    const p = props();
    render(<OrderWorkspace {...p} />);
    fireEvent.click(button('More actions'));
    fireEvent.click(button('Reprint bill'));
    fireEvent.click(button('Reprint tags'));
    fireEvent.click(button('Print status'));
    expect([p.onReprintBill, p.onReprintTags, p.onOpenPrints].map(fn => (fn as ReturnType<typeof vi.fn>).mock.calls.length)).toEqual([1, 1, 1]);
  });

  describe('moving to the trash', () => {
    const openTrash = () => {
      fireEvent.click(button('More actions'));
      fireEvent.click(button('Move to trash'));
      fireEvent.click(button('Confirm move to trash'));
    };

    it('trashes the order, says so and returns to where the admin came from', async () => {
      api.trashCounterOrder.mockResolvedValue(undefined);
      const p = props();
      render(<OrderWorkspace {...p} />);
      openTrash();
      await waitFor(() => expect(p.onBack).toHaveBeenCalled());
      expect(api.trashCounterOrder).toHaveBeenCalledWith('o-1');
      expect(p.onNotice).toHaveBeenCalledWith(`Order ${p.order.orderNumber} moved to the trash.`);
    });

    it('stays on the order and reports a failure', async () => {
      api.trashCounterOrder.mockRejectedValue(new Error('only admins'));
      const p = props();
      render(<OrderWorkspace {...p} />);
      openTrash();
      await waitFor(() => expect(p.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'only admins' })));
      expect(p.onBack).not.toHaveBeenCalled();
    });
  });

  describe('marking for the trash (staff)', () => {
    const send = () => {
      fireEvent.click(button('More actions'));
      fireEvent.click(button('Mark for trash'));
      fireEvent.change(screen.getByLabelText('Why should this bill be trashed?'), { target: { value: 'Added by mistake' } });
      fireEvent.click(button('Send to the owner'));
    };

    it('sends the request, says the bill still counts, and stays on the order', async () => {
      api.requestCounterOrderTrash.mockResolvedValue(undefined);
      const p = props({ isAdmin: false });
      render(<OrderWorkspace {...p} />);
      send();
      await waitFor(() => expect(p.onNotice).toHaveBeenCalled());
      expect(api.requestCounterOrderTrash).toHaveBeenCalledWith('o-1', 'Added by mistake');
      expect(vi.mocked(p.onNotice).mock.calls[0][0]).toMatch(/still counts in sales/);
      expect(p.onBack).not.toHaveBeenCalled();
    });

    it('reports a failure', async () => {
      api.requestCounterOrderTrash.mockRejectedValue(new Error('already marked'));
      const p = props({ isAdmin: false });
      render(<OrderWorkspace {...p} />);
      send();
      await waitFor(() => expect(p.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'already marked' })));
    });
  });

  describe('cancelling', () => {
    const openCancel = () => {
      fireEvent.click(button('More actions'));
      fireEvent.click(button('Cancel order'));
      fireEvent.change(screen.getByLabelText('Reason for cancelling'), { target: { value: 'Customer changed their mind' } });
    };

    it('cancels with the reason and says how much to hand back', async () => {
      const cancelled = owingOrder({ status: 'cancelled', refundDueMinor: 25000 });
      api.cancelCounterOrder.mockResolvedValue(cancelled);
      const p = props({ order: owingOrder({ status: 'received', paidMinor: 25000, balanceMinor: 45000 }) });
      render(<OrderWorkspace {...p} />);
      openCancel();
      fireEvent.click(button('Refund ₹250.00 to the customer'));
      await waitFor(() => expect(p.onOrder).toHaveBeenCalledWith(cancelled));
      expect(api.cancelCounterOrder).toHaveBeenCalledWith('o-1', 'Customer changed their mind');
      expect(p.onNotice).toHaveBeenCalledWith('Order cancelled. Hand back ₹250.00.');
    });

    it('says plainly when there is nothing to hand back', async () => {
      api.cancelCounterOrder.mockResolvedValue(owingOrder({ status: 'cancelled', refundDueMinor: 0 }));
      const p = props();
      render(<OrderWorkspace {...p} />);
      openCancel();
      fireEvent.click(button('Confirm cancel order'));
      await waitFor(() => expect(p.onNotice).toHaveBeenCalledWith('Order cancelled.'));
    });

    it('reports a failed cancel', async () => {
      api.cancelCounterOrder.mockRejectedValue(new Error('only admins'));
      const p = props();
      render(<OrderWorkspace {...p} />);
      openCancel();
      fireEvent.click(button('Confirm cancel order'));
      await waitFor(() => expect(p.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'only admins' })));
      expect(p.onOrder).not.toHaveBeenCalled();
    });

    it('tells staff to ask an admin', () => {
      render(<OrderWorkspace {...props({ isAdmin: false })} />);
      fireEvent.click(button('More actions'));
      expect(screen.getByText('Ask an admin to cancel this order.')).toBeTruthy();
    });
  });
});

describe('the hand-over view', () => {
  it('goes back to the order', () => {
    const p = props({ view: 'handover', order: owingOrder() });
    render(<OrderWorkspace {...p} />);
    fireEvent.click(button('← Order'));
    expect(p.onView).toHaveBeenCalledWith('detail');
  });

  it('shows the customer and the balance still to receive', () => {
    render(<OrderWorkspace {...props({ view: 'handover', order: owingOrder() })} />);
    expect(screen.getByText('Rita Joshi · 9876543210')).toBeTruthy();
    expect(screen.getByText('Balance due ₹700.00')).toBeTruthy();
  });

  it('receives the balance and hands over in one step once every garment is checked', async () => {
    const collected = owingOrder({ status: 'collected', paidMinor: 70000, balanceMinor: 0, paymentStatus: 'paid' });
    api.collectCounterOrder.mockResolvedValue(collected);
    const p = props({ view: 'handover', order: owingOrder() });
    render(<OrderWorkspace {...p} />);
    // Money first while garments are unchecked: the sticky button only receives, it does not hand over yet.
    // (The money panel has its own Receive button with the same label; the sticky one comes last.)
    const sticky = screen.getAllByRole('button', { name: 'Receive ₹700.00' }).at(-1) as HTMLButtonElement;
    expect(sticky.disabled).toBe(false);
    expect(screen.queryByRole('button', { name: 'Receive ₹700.00 & hand over' })).toBeNull();
    fireEvent.click(button('Tick all'));
    fireEvent.click(button('Receive ₹700.00 & hand over'));
    await waitFor(() => expect(screen.getByText('Handed over ✓ 202610170001')).toBeTruthy());
    expect(api.collectCounterOrder).toHaveBeenCalledWith('o-1', ['p1', 'p2', 'u1', 'u2'], expect.any(String), {
      amountMinor: 70000, method: 'cash', reference: undefined, idempotencyKey: expect.any(String),
    });
    expect(p.onOrder).toHaveBeenCalledWith(collected);
    expect(p.onNotice).toHaveBeenCalledWith('Order handed over.');
    fireEvent.click(button('Next order'));
    expect(p.onFinished).toHaveBeenCalledTimes(1);
  });

  it('hands over a paid order without taking any payment', async () => {
    api.collectCounterOrder.mockResolvedValue(order({ status: 'collected' }));
    render(<OrderWorkspace {...props({ view: 'handover', order: order() })} />);
    fireEvent.click(button('Tick all'));
    fireEvent.click(button('Hand over order'));
    await waitFor(() => expect(screen.getByText('Handed over ✓ 202610170001')).toBeTruthy());
    expect(api.collectCounterOrder).toHaveBeenCalledWith('o-1', ['p1', 'p2', 'u1', 'u2'], expect.any(String));
  });

  it('takes the whole balance when Receive is pressed before the garments are checked, even if a part payment was typed', async () => {
    api.recordCounterPayment.mockResolvedValue(owingOrder({ paidMinor: 70000, balanceMinor: 0, paymentStatus: 'paid' }));
    render(<OrderWorkspace {...props({ view: 'handover', order: owingOrder() })} />);
    fireEvent.click(button('Part payment'));
    fireEvent.change(screen.getByLabelText('Amount received'), { target: { value: '300' } });
    fireEvent.click(button('Receive ₹700.00'));
    await waitFor(() => expect(api.recordCounterPayment).toHaveBeenCalled());
    expect(api.recordCounterPayment.mock.calls[0][1].amountMinor).toBe(70000);
  });

  it('marks an order ready from the hand-over screen and stays there', async () => {
    const ready = owingOrder({ status: 'ready' });
    api.updateCounterOrderStatus.mockResolvedValue(ready);
    const p = props({ view: 'handover', order: owingOrder({ status: 'packing' }) });
    render(<OrderWorkspace {...p} />);
    fireEvent.click(button('Mark ready now & continue'));
    await waitFor(() => expect(p.onOrder).toHaveBeenCalledWith(ready));
    expect(api.updateCounterOrderStatus).toHaveBeenCalledWith('o-1', 'ready');
    expect(p.onView).not.toHaveBeenCalled();
  });

  it('shows a failed hand-over and keeps the cashier on the screen', async () => {
    api.collectCounterOrder.mockRejectedValue(new Error('payment would exceed the balance'));
    api.getCounterOrder.mockResolvedValue(null);
    const p = props({ view: 'handover', order: order() });
    render(<OrderWorkspace {...p} />);
    fireEvent.click(button('Tick all'));
    fireEvent.click(button('Hand over order'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('payment would exceed the balance'));
    expect(p.onError).toHaveBeenCalled();
  });
});

describe('opening a different order', () => {
  it('starts its checklist and payment form from scratch', () => {
    const first = props({ view: 'handover', order: owingOrder() });
    const { rerender } = render(<OrderWorkspace {...first} />);
    fireEvent.click(button('Tick all'));
    expect(screen.getAllByRole('checkbox').every(box => (box as HTMLInputElement).checked)).toBe(true);
    rerender(<OrderWorkspace {...first} order={owingOrder({ orderId: 'o-2', orderNumber: '202610170002' })} />);
    expect(screen.getAllByRole('checkbox').some(box => (box as HTMLInputElement).checked)).toBe(false);
  });
});
