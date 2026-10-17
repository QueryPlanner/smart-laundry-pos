// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HandoverPage } from './HandoverPage';
import { allChecked, order, owingOrder } from './handoverFixtures';

type Props = ComponentProps<typeof HandoverPage>;
const props = (overrides: Partial<Props> = {}): Props => ({
  order: order(), busy: false, error: '', backLabel: 'Orders', onBack: vi.fn(),
  checkedTaggedIds: [], onCheckedTagged: vi.fn(), untaggedCounts: {}, onUntaggedCounts: vi.fn(),
  moneySlot: <p>Money panel</p>, receivedNote: '', onAction: vi.fn(), done: false, onNext: vi.fn(),
  ...overrides,
});
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const maybeButton = (name: string) => screen.queryByRole('button', { name });
afterEach(cleanup);

describe('HandoverPage primary button', () => {
  it('receives the balance when garments are still unchecked', () => {
    const p = props({ order: owingOrder() });
    render(<HandoverPage {...p} />);
    fireEvent.click(button('Receive ₹700.00'));
    expect(p.onAction).toHaveBeenCalledWith('receive');
  });

  it('receives the balance and hands over when everything is checked', () => {
    const p = props({ order: owingOrder(), ...allChecked });
    render(<HandoverPage {...p} />);
    fireEvent.click(button('Receive ₹700.00 & hand over'));
    expect(p.onAction).toHaveBeenCalledWith('receive_and_handover');
  });

  it('hands over a fully paid, fully checked order', () => {
    const p = props({ ...allChecked });
    render(<HandoverPage {...p} />);
    fireEvent.click(button('Hand over order'));
    expect(p.onAction).toHaveBeenCalledWith('handover');
  });

  it('is disabled and asks for the last garments when some are unchecked and nothing is owed', () => {
    const p = props({ checkedTaggedIds: ['p1', 'p2'], untaggedCounts: { 'g-shirt|Iron': 1 } });
    render(<HandoverPage {...p} />);
    expect(button('Check 1 more garment').disabled).toBe(true);
    fireEvent.click(button('Check 1 more garment'));
    expect(p.onAction).not.toHaveBeenCalled();
  });

  it('is disabled and names the stage when the order is not ready yet', () => {
    const p = props({ order: order({ status: 'washing' }) });
    render(<HandoverPage {...p} />);
    expect(button('Order is Washing').disabled).toBe(true);
    fireEvent.click(button('Order is Washing'));
    expect(p.onAction).not.toHaveBeenCalled();
  });

  it('is disabled and says cancelled for a cancelled order', () => {
    render(<HandoverPage {...props({ order: order({ status: 'cancelled' }) })} />);
    expect(button('Order is cancelled').disabled).toBe(true);
  });

  it('is disabled and says Handed over for a collected order', () => {
    render(<HandoverPage {...props({ order: order({ status: 'collected' }) })} />);
    expect(button('Handed over').disabled).toBe(true);
  });

  it('disables the primary button while busy', () => {
    render(<HandoverPage {...props({ busy: true, ...allChecked })} />);
    expect(button('Hand over order').disabled).toBe(true);
  });
});

describe('HandoverPage mark ready', () => {
  it('offers Mark ready now & continue for an order before ready, and fires mark_ready', () => {
    const p = props({ order: order({ status: 'packing' }) });
    render(<HandoverPage {...p} />);
    fireEvent.click(button('Mark ready now & continue'));
    expect(p.onAction).toHaveBeenCalledWith('mark_ready');
  });

  it('disables Mark ready now & continue while busy', () => {
    render(<HandoverPage {...props({ order: order({ status: 'packing' }), busy: true })} />);
    expect(button('Mark ready now & continue').disabled).toBe(true);
  });

  it.each([
    ['a ready order', 'ready'],
    ['a cancelled order', 'cancelled'],
    ['a collected order', 'collected'],
  ])('is not offered for %s', (_label, status) => {
    render(<HandoverPage {...props({ order: order({ status }) })} />);
    expect(maybeButton('Mark ready now & continue')).toBeNull();
  });
});

describe('HandoverPage layout and state', () => {
  it('shows the error as an alert', () => {
    render(<HandoverPage {...props({ error: 'Could not receive the payment.' })} />);
    expect(screen.getByRole('alert').textContent).toBe('Could not receive the payment.');
  });

  it('shows no alert without an error', () => {
    render(<HandoverPage {...props()} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the bill number, and the customer when the parent has one', () => {
    const { unmount } = render(<HandoverPage {...props({ customer: { name: 'Rita', phone: '9876543210' } })} />);
    expect(screen.getByRole('heading', { name: '202610170001' })).toBeTruthy();
    expect(screen.getByText('Rita · 9876543210')).toBeTruthy();
    unmount();
    render(<HandoverPage {...props()} />);
    expect(screen.queryByText(/Rita/)).toBeNull();
  });

  it('goes back with the back label', () => {
    const p = props({ backLabel: 'Orders' });
    render(<HandoverPage {...p} />);
    fireEvent.click(button('← Orders'));
    expect(p.onBack).toHaveBeenCalledOnce();
  });

  it('shows garments checked of total and the balance as steps', () => {
    render(<HandoverPage {...props({ order: owingOrder(), checkedTaggedIds: ['p1'] })} />);
    expect(screen.getByText('1 Garments 1/4')).toBeTruthy();
    expect(screen.getByText('2 Balance ₹700.00')).toBeTruthy();
    expect(screen.getByText('3 Hand over')).toBeTruthy();
  });

  it('shows Balance paid when nothing is owed', () => {
    render(<HandoverPage {...props({ ...allChecked })} />);
    expect(screen.getByText('1 Garments 4/4')).toBeTruthy();
    expect(screen.getByText('2 Balance paid')).toBeTruthy();
  });

  it('shows the money panel only when money is due or a payment was just received', () => {
    const { unmount } = render(<HandoverPage {...props({ order: owingOrder() })} />);
    expect(screen.getByText('Money panel')).toBeTruthy();
    unmount();
    const paid = render(<HandoverPage {...props()} />);
    expect(screen.queryByText('Money panel')).toBeNull();
    paid.unmount();
    render(<HandoverPage {...props({ receivedNote: '₹700.00 received' })} />);
    expect(screen.getByText('Money panel')).toBeTruthy();
  });

  it('announces the received note as a status line', () => {
    render(<HandoverPage {...props({ order: owingOrder(), receivedNote: '₹700.00 received' })} />);
    expect(screen.getAllByRole('status').map(status => status.textContent)).toContain('₹700.00 received');
  });

  it('lists what still blocks hand-over', () => {
    render(<HandoverPage {...props({ order: owingOrder({ status: 'washing' }) })} />);
    expect(screen.getByText('Order is Washing, not ready yet')).toBeTruthy();
    expect(screen.getByText('₹700.00 still to receive')).toBeTruthy();
    expect(screen.getByText('4 garments not checked')).toBeTruthy();
    expect(screen.queryByText('Everything is ready')).toBeNull();
  });

  it('confirms that everything is ready when nothing blocks hand-over', () => {
    render(<HandoverPage {...props({ ...allChecked })} />);
    expect(screen.getByText('Everything is ready')).toBeTruthy();
  });

  it('asks for the pickup check copy', () => {
    render(<HandoverPage {...props()} />);
    expect(screen.getByText('Check each garment with the customer')).toBeTruthy();
  });
});

describe('HandoverPage done screen', () => {
  it('replaces the screen with the handed-over confirmation and goes to the next order', () => {
    const p = props({ done: true });
    render(<HandoverPage {...p} />);
    expect(screen.getByRole('heading', { name: 'Handed over ✓ 202610170001' })).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(button('Next order'));
    expect(p.onNext).toHaveBeenCalledOnce();
  });
});
