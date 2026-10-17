// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MoneyPanel } from './MoneyPanel';
import { detailMoneyForm, detailOrder, detailPayment } from './detailFixtures';

const renderPanel = (order = detailOrder(), form = detailMoneyForm(), compact?: boolean) => render(<MoneyPanel order={order} form={form} compact={compact} />);
const button = (name: string) => screen.queryByRole('button', { name }) as HTMLButtonElement | null;
const banner = () => screen.getByRole('status');
const historyRows = () => within(screen.getByRole('list', { name: 'Payment history' })).getAllByRole('listitem');

afterEach(cleanup);

describe('MoneyPanel banner', () => {
  it('shows the balance due for an order with money still owed', () => {
    renderPanel(detailOrder({ totalMinor: 4000, paidMinor: 1000, balanceMinor: 3000 }));
    expect(banner().textContent).toBe('Balance due ₹30.00');
    expect(screen.getByText('Total').nextSibling?.textContent).toBe('₹40.00');
    expect(screen.getByText('Paid').nextSibling?.textContent).toBe('₹10.00');
  });

  it('shows paid in full when the balance is settled', () => {
    renderPanel(detailOrder({ totalMinor: 4000, paidMinor: 4000, balanceMinor: 0, status: 'ready' }));
    expect(banner().textContent).toBe('Paid in full');
    expect(button('Part payment')).toBeNull();
  });

  it('shows no payment due for an order that costs nothing', () => {
    renderPanel(detailOrder({ totalMinor: 0, paidMinor: 0, balanceMinor: 0 }));
    expect(banner().textContent).toBe('No payment due');
  });

  it('tells staff how much to hand back on a cancelled order that had payments', () => {
    renderPanel(detailOrder({ status: 'cancelled', paidMinor: 0, balanceMinor: 0, refundDueMinor: 1500 }));
    expect(banner().textContent).toBe('Cancelled. Hand back ₹15.00');
    expect(screen.queryByRole('group', { name: 'Payment method' })).toBeNull();
  });

  it('says there is nothing to hand back on a cancelled order with no refund due', () => {
    renderPanel(detailOrder({ status: 'cancelled', refundDueMinor: 0 }));
    expect(banner().textContent).toBe('Cancelled. Nothing to hand back.');
  });

  it('does not offer to take money on a collected order, even one that still shows a balance', () => {
    renderPanel(detailOrder({ status: 'collected', totalMinor: 4000, paidMinor: 0, balanceMinor: 4000 }));
    expect(banner().textContent).toBe('Balance due ₹40.00');
    expect(screen.queryByRole('group', { name: 'Payment method' })).toBeNull();
    expect(button('Receive ₹40.00')).toBeNull();
  });

  it('marks the compact variant with a class and leaves the default unmarked', () => {
    const { unmount } = renderPanel(detailOrder(), detailMoneyForm(), true);
    expect(screen.getByRole('region', { name: 'Payment' }).classList.contains('compact')).toBe(true);
    unmount();
    renderPanel();
    expect(screen.getByRole('region', { name: 'Payment' }).classList.contains('compact')).toBe(false);
  });
});

describe('MoneyPanel payment history', () => {
  it('says so when no payments have been recorded', () => {
    renderPanel();
    expect(screen.getByText('No payments yet.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Payment history' })).toBeNull();
  });

  it('lists each payment with its method, amount, advance or balance label, reference and voided state', () => {
    renderPanel(detailOrder({
      payments: [
        detailPayment({ id: 'a', method: 'cash', amountMinor: 1000, kind: 'advance' }),
        detailPayment({ id: 'b', method: 'upi', amountMinor: 3000, kind: 'settlement', reference: 'UTR123' }),
        detailPayment({ id: 'c', method: 'bank_transfer', amountMinor: 500, kind: 'settlement', voided: true }),
      ],
    }));
    const [advance, balance, voided] = historyRows();
    expect(within(advance).getByText('Advance')).toBeTruthy();
    expect(within(advance).getByText('Cash')).toBeTruthy();
    expect(within(advance).getByText('₹10.00')).toBeTruthy();
    expect(within(balance).getByText('Balance')).toBeTruthy();
    expect(within(balance).getByText('UPI')).toBeTruthy();
    expect(within(balance).getByText('Ref UTR123')).toBeTruthy();
    expect(within(voided).getByText('Cancelled')).toBeTruthy();
    expect(within(voided).getByText('Bank transfer')).toBeTruthy();
    expect(within(advance).queryByText('Cancelled')).toBeNull();
  });
});

describe('MoneyPanel receive form', () => {
  it('offers the five payment methods with the chosen one pressed', () => {
    renderPanel(detailOrder(), detailMoneyForm({ method: 'cash' }));
    const group = screen.getByRole('group', { name: 'Payment method' });
    const chips = within(group).getAllByRole('button');
    expect(chips.map(chip => chip.textContent)).toEqual(['Cash', 'UPI', 'Card', 'Bank transfer', 'Other']);
    expect(within(group).getByRole('button', { name: 'Cash' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(group).getByRole('button', { name: 'UPI' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('reports a method chip choice', () => {
    const form = detailMoneyForm();
    renderPanel(detailOrder(), form);
    fireEvent.click(screen.getByRole('button', { name: 'UPI' }));
    expect(form.onMethod).toHaveBeenCalledWith('upi');
  });

  it('asks for a reference only for a non-cash method', () => {
    const form = detailMoneyForm({ method: 'cash' });
    const { rerender } = renderPanel(detailOrder(), form);
    expect(screen.queryByLabelText('Reference (optional)')).toBeNull();
    rerender(<MoneyPanel order={detailOrder()} form={detailMoneyForm({ method: 'card', onReference: form.onReference })} />);
    fireEvent.change(screen.getByLabelText('Reference (optional)'), { target: { value: 'TXN-9' } });
    expect(form.onReference).toHaveBeenCalledWith('TXN-9');
  });

  it('shows the amount field and the toggle state only when part payment is on', () => {
    const form = detailMoneyForm();
    const { rerender } = renderPanel(detailOrder(), form);
    const toggle = button('Part payment') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByLabelText('Amount received')).toBeNull();
    fireEvent.click(toggle);
    expect(form.onPartial).toHaveBeenCalledWith(true);

    rerender(<MoneyPanel order={detailOrder()} form={detailMoneyForm({ partial: true, amount: '1' })} />);
    expect(button('Part payment')?.getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Amount received') as HTMLInputElement).value).toBe('1');
  });

  it('reports every typed amount exactly as typed', () => {
    const form = detailMoneyForm({ partial: true });
    renderPanel(detailOrder(), form);
    fireEvent.change(screen.getByLabelText('Amount received'), { target: { value: '12.5' } });
    expect(form.onAmount).toHaveBeenCalledWith('12.5');
  });

  it('labels the button with the whole balance when no part payment is typed', () => {
    renderPanel(detailOrder({ balanceMinor: 4000 }));
    expect(button('Receive ₹40.00')).not.toBeNull();
  });

  it('labels the button with a valid typed part payment', () => {
    renderPanel(detailOrder({ balanceMinor: 4000 }), detailMoneyForm({ partial: true, amount: '12.5' }));
    expect(button('Receive ₹12.50')).not.toBeNull();
  });

  it('falls back to the whole balance for an empty, zero, unreadable or too large typed amount', () => {
    const cases = ['', '0', '1.234', 'abc', '50000'];
    for (const amount of cases) {
      const { unmount } = renderPanel(detailOrder({ balanceMinor: 4000 }), detailMoneyForm({ partial: true, amount }));
      expect(button('Receive ₹40.00'), `typed "${amount}"`).not.toBeNull();
      unmount();
    }
  });

  it('shows the error line when the form has one', () => {
    renderPanel(detailOrder(), detailMoneyForm({ error: 'Enter the amount as 12 or 12.50.' }));
    expect(screen.getByRole('alert').textContent).toBe('Enter the amount as 12 or 12.50.');
  });

  it('receives the payment when the button is pressed, and not while busy', () => {
    const form = detailMoneyForm();
    const { rerender } = renderPanel(detailOrder(), form);
    fireEvent.click(button('Receive ₹40.00') as HTMLButtonElement);
    expect(form.onReceive).toHaveBeenCalledOnce();
    rerender(<MoneyPanel order={detailOrder()} form={detailMoneyForm({ busy: true })} />);
    expect(button('Receive ₹40.00')?.disabled).toBe(true);
  });
});
