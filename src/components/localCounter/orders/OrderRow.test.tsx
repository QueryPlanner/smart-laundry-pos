// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { OrderRow } from './OrderRow';
import { orderOf } from './listFixtures';

const renderRow = (order = orderOf(), busy = false) => {
  const props = { order, busy, onOpen: vi.fn(), onHandover: vi.fn() };
  render(<ul><OrderRow {...props} /></ul>);
  return props;
};

afterEach(cleanup);

describe('OrderRow', () => {
  describe('bill number', () => {
    it('draws a 12-digit bill with the date part small and the last four digits large', () => {
      renderRow(orderOf({ orderNumber: '202610170007' }));
      const bill = screen.getByRole('img', { name: '202610170007' });
      expect(within(bill).getByText('20261017').className).toBe('counter-bill-small');
      expect(within(bill).getByText('0007').className).toBe('counter-bill-large');
    });

    it.each(['LA-2026-00123', '2026101700', 'A02610170007'])('shows the legacy or unusual bill %s whole', number => {
      renderRow(orderOf({ orderNumber: number }));
      expect(screen.getByText(number)).toBeTruthy();
      expect(screen.queryByRole('img')).toBeNull();
    });
  });

  it('shows the customer, phone, piece count and status', () => {
    renderRow();
    expect(screen.getByText('Rahul Patil')).toBeTruthy();
    expect(screen.getByText('9876543210')).toBeTruthy();
    expect(screen.getByText('3 pieces')).toBeTruthy();
    expect(screen.getByText('Washing')).toBeTruthy();
  });

  it('uses the singular for a single piece', () => {
    renderRow(orderOf({ pieceCount: 1 }));
    expect(screen.getByText('1 piece')).toBeTruthy();
  });

  it('shows the promised time in shop time', () => {
    renderRow();
    expect(screen.getByText('Due 17 Oct 2026, 5:00 pm')).toBeTruthy();
  });

  it('shows a dash when there is no promised time', () => {
    renderRow(orderOf({ promisedAt: null }));
    expect(screen.getByText('Due —')).toBeTruthy();
  });

  it('adds an Overdue badge only for overdue orders', () => {
    const { unmount } = render(<ul><OrderRow order={orderOf({ overdue: true })} busy={false} onOpen={vi.fn()} onHandover={vi.fn()} /></ul>);
    expect(screen.getByText('Overdue')).toBeTruthy();
    unmount();
    renderRow(orderOf({ overdue: false }));
    expect(screen.queryByText('Overdue')).toBeNull();
  });

  it('shows why the order matched the search, and nothing when it matched the filter alone', () => {
    const { unmount } = render(<ul><OrderRow order={orderOf({ matchReason: 'Matched tag 2610170001-3' })} busy={false} onOpen={vi.fn()} onHandover={vi.fn()} /></ul>);
    expect(screen.getByText('Matched tag 2610170001-3')).toBeTruthy();
    unmount();
    renderRow(orderOf({ matchReason: null }));
    expect(screen.queryByText(/Matched/)).toBeNull();
  });

  describe('money chip', () => {
    it('shows the balance with a warning when money is still due', () => {
      renderRow(orderOf({ balanceMinor: 15000 }));
      expect(screen.getByText('Balance ₹150.00')).toBeTruthy();
    });

    it('shows Paid when the balance is settled', () => {
      renderRow(orderOf({ status: 'ready', balanceMinor: 0, paidMinor: 25000 }));
      expect(screen.getByText('Paid')).toBeTruthy();
      expect(screen.queryByText(/Balance/)).toBeNull();
    });

    it('shows No charge for a zero-value order', () => {
      renderRow(orderOf({ totalMinor: 0, paidMinor: 0, balanceMinor: 0 }));
      expect(screen.getByText('No charge')).toBeTruthy();
    });

    it('shows Cancelled on the chip and on the status badge', () => {
      renderRow(orderOf({ status: 'cancelled', balanceMinor: 0 }));
      expect(screen.getAllByText('Cancelled')).toHaveLength(2);
    });
  });

  describe('primary button', () => {
    const cases = [
      { label: 'a ready order with money due', overrides: { status: 'ready', balanceMinor: 15000 }, name: 'Receive ₹150.00 & hand over', callback: 'onHandover' as const },
      { label: 'a ready order that is paid', overrides: { status: 'ready', balanceMinor: 0, paidMinor: 25000 }, name: 'Hand over', callback: 'onHandover' as const },
      { label: 'an order still in process', overrides: { status: 'washing' }, name: 'Open', callback: 'onOpen' as const },
      { label: 'a collected order', overrides: { status: 'collected', balanceMinor: 0 }, name: 'View', callback: 'onOpen' as const },
      { label: 'a cancelled order', overrides: { status: 'cancelled', balanceMinor: 0 }, name: 'View', callback: 'onOpen' as const },
    ];
    it.each(cases)('for $label is "$name" and calls $callback only', ({ overrides, name, callback }) => {
      const props = renderRow(orderOf(overrides));
      fireEvent.click(screen.getByRole('button', { name }));
      expect(props[callback]).toHaveBeenCalledWith('o1');
      const other = callback === 'onHandover' ? 'onOpen' : 'onHandover';
      expect(props[other]).not.toHaveBeenCalled();
    });

    it('is disabled while another action is busy', () => {
      renderRow(orderOf(), true);
      expect((screen.getByRole('button', { name: 'Open' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('is enabled when nothing is busy', () => {
      renderRow();
      expect((screen.getByRole('button', { name: 'Open' }) as HTMLButtonElement).disabled).toBe(false);
    });
  });
});
