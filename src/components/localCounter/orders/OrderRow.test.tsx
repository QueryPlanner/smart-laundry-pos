// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { OrderRow, type OrderRowProps } from './OrderRow';
import { orderOf } from './listFixtures';

const setup = (over: Partial<OrderRowProps> = {}) => {
  const props: OrderRowProps = { order: orderOf(), isAdmin: true, busy: false, onOpen: vi.fn(), onCustomer: vi.fn(), onPreviewBill: vi.fn(), onTrash: vi.fn(), onRequestTrash: vi.fn(), ...over };
  render(<ul><OrderRow {...props} /></ul>);
  return props;
};
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
afterEach(cleanup);

describe('OrderRow', () => {
  it('draws a 12-digit bill with the date part small and the last four digits large', () => {
    setup();
    expect(document.querySelector('.counter-bill-small')?.textContent).toBe('20261017');
    expect(document.querySelector('.counter-bill-large')?.textContent).toBe('0001');
  });

  it('shows an older bill number whole', () => {
    setup({ order: orderOf({ orderNumber: 'SL-7' }) });
    expect(document.querySelector('.counter-bill-number')?.textContent).toBe('SL-7');
  });

  it('shows the items, the pickup state, the total and what is still due', () => {
    setup();
    expect(screen.getByText('3 Shirt · Iron, 2 Saree · Dry Clean')).toBeTruthy();
    expect(screen.getByText('Not collected')).toBeTruthy();
    expect(screen.getByText('₹250.00')).toBeTruthy();
    expect(screen.getByText('Due ₹150.00')).toBeTruthy();
  });

  it.each([
    ['part collected', { handedOverCount: 3 }, 'Part collected'],
    ['collected', { status: 'collected', handedOverCount: 5, balanceMinor: 0 }, 'Collected'],
    ['cancelled', { status: 'cancelled', balanceMinor: 1000 }, 'Cancelled'],
  ])('says when an order is %s, with nothing due', (_label, over, words) => {
    setup({ order: orderOf({ balanceMinor: 0, ...over }) });
    expect(screen.getByText(words)).toBeTruthy();
    expect(screen.queryByText(/^Due/)).toBeNull();
  });

  it('shows a dash for an order with no lines', () => {
    setup({ order: orderOf({ itemsText: '' }) });
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('opens the order, the customer’s bills and the bill preview', () => {
    const p = setup();
    fireEvent.click(button('Open bill 202610170001'));
    fireEvent.click(button('Rahul Patil'));
    fireEvent.click(button('Preview'));
    expect(p.onOpen).toHaveBeenCalledWith('o1');
    expect(p.onCustomer).toHaveBeenCalledWith('9876543210');
    expect(p.onPreviewBill).toHaveBeenCalledWith('o1', '202610170001');
  });

  it('trashes for an administrator and asks the owner for staff', () => {
    const admin = setup();
    fireEvent.click(button('Move to trash'));
    fireEvent.click(button('Confirm move to trash'));
    expect(admin.onTrash).toHaveBeenCalledWith('o1', '202610170001');
    cleanup();
    const staff = setup({ isAdmin: false });
    fireEvent.click(button('Mark for trash'));
    fireEvent.change(screen.getByLabelText('Why should this bill be trashed?'), { target: { value: 'Entered twice' } });
    fireEvent.click(button('Send to the owner'));
    expect(staff.onRequestTrash).toHaveBeenCalledWith('o1', '202610170001', 'Entered twice');
  });

  it('shows why the order matched a search', () => {
    setup({ order: orderOf({ matchReason: 'Phone' }) });
    expect(screen.getByText('Phone')).toBeTruthy();
  });

  it('locks its buttons while another action is busy', () => {
    setup({ busy: true });
    for (const name of ['Open bill 202610170001', 'Preview', 'Move to trash']) expect(button(name).disabled).toBe(true);
  });
});
