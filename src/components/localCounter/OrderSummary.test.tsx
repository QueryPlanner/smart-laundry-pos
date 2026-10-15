// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { OrderSummary } from './OrderSummary';
import type { CounterCatalogue, CounterQuote } from '@/lib/localFirst/counter';

const catalogue: CounterCatalogue = { garments: [{ id: 'g1', key: 'shirt', nameEn: 'Shirt', nameMr: 'शर्ट', category: 'tops', imageKey: 'shirt', billingUnit: 'piece', active: true }], services: [{ id: 's1', key: 'wash_iron', name: 'Wash + Iron', active: true }], rates: [] };
const quote: CounterQuote = { lines: [{ garmentId: 'g1', serviceId: 's1', garment: 'Shirt', service: 'Wash + Iron', quantity: 1, unitPriceMinor: 1200, lineTotalMinor: 1200, rateVersion: 2 }], subtotalMinor: 1200, discountPercentBp: 0, discountMinor: 0, totalMinor: 1200, pieceCount: 1, promisedAt: '2026-10-17T11:30:00Z', catalogueVersion: '2' };
const props = (overrides: Partial<React.ComponentProps<typeof OrderSummary>> = {}) => ({
  catalogue, lines: { 'g1|s1': 1 }, quote, customer: { name: 'Rita', phone: '9876543210' }, paymentMethod: 'cash' as const,
  onPaymentMethod: vi.fn(), onRemove: vi.fn(), onQuantity: vi.fn(), onSave: vi.fn(), busy: false, quoteFailed: false, ...overrides,
});
const saveButton = () => screen.getByRole('button', { name: /Save & Print|Saving and dispatching/ }) as HTMLButtonElement;
afterEach(cleanup);

describe('OrderSummary', () => {
  it('shows the fixed promise and the full amount to collect, with no editable amount', () => {
    render(<OrderSummary {...props()} />);
    expect(screen.getByText('17 Oct 2026, 5:00 pm')).toBeTruthy();
    expect(screen.getByText('Amount to collect').nextSibling?.textContent).toBe('₹12.00');
    expect(screen.queryByLabelText(/Payment amount/)).toBeNull();
    expect(screen.queryByText(/Discount/)).toBeNull();
    expect(screen.getByText('Collect the full amount before saving.')).toBeTruthy();
  });

  it('adjusts, removes and edits quantities, and saves', () => {
    const p = props();
    render(<OrderSummary {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Decrease Shirt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Increase Shirt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Shirt' }));
    fireEvent.change(screen.getByLabelText('Shirt summary quantity'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Shirt summary quantity'), { target: { value: '-3' } });
    fireEvent.change(screen.getByLabelText('Shirt summary quantity'), { target: { value: 'abc' } });
    fireEvent.click(saveButton());
    expect(p.onQuantity.mock.calls).toEqual([['g1', 0, 's1'], ['g1', 2, 's1'], ['g1', 4, 's1'], ['g1', 0, 's1'], ['g1', 0, 's1']]);
    expect(p.onRemove).toHaveBeenCalledWith('g1', 's1');
    expect(p.onSave).toHaveBeenCalledOnce();
  });

  it('shows the automatic discount and the discounted amount to collect', () => {
    const discounted = { ...quote, discountPercentBp: 1250, discountMinor: 150, totalMinor: 1050 };
    render(<OrderSummary {...props({ quote: discounted })} />);
    expect(screen.getByText('Discount (12.5%)').nextSibling?.textContent).toBe('-₹1.50');
    expect(screen.getByText('Amount to collect').nextSibling?.textContent).toBe('₹10.50');
  });

  it('offers the payment method and reports changes', () => {
    const p = props();
    render(<OrderSummary {...p} />);
    fireEvent.change(screen.getByLabelText('Paid by'), { target: { value: 'upi' } });
    expect(p.onPaymentMethod).toHaveBeenCalledWith('upi');
  });

  it('asks for no payment when a full discount leaves nothing to collect', () => {
    const free = { ...quote, discountPercentBp: 10_000, discountMinor: 1200, totalMinor: 0 };
    render(<OrderSummary {...props({ quote: free })} />);
    expect(screen.getByText('Nothing to collect for this order.')).toBeTruthy();
    expect(screen.queryByLabelText('Paid by')).toBeNull();
    expect(saveButton().disabled).toBe(false);
  });

  it('shows a dash, never 0.00, while there is no price, and says what is missing next to Save', () => {
    const view = render(<OrderSummary {...props({ quote: null })} />);
    expect(screen.getByText('Amount to collect').nextSibling?.textContent).toBe('—');
    expect(screen.getByText('Subtotal').nextSibling?.textContent).toBe('—');
    expect(screen.getByText('Working out the price…')).toBeTruthy();
    view.rerender(<OrderSummary {...props({ quote: null, quoteFailed: true })} />);
    expect(screen.getByText('The price could not be worked out. See the message above.')).toBeTruthy();
    expect(screen.getByText('Amount to collect').nextSibling?.textContent).toBe('—');
    view.rerender(<OrderSummary {...props({ quote: null, lines: {} })} />);
    expect(screen.getByText('Add at least one garment')).toBeTruthy();
    view.rerender(<OrderSummary {...props({ quote: null, customer: { name: ' ', phone: '1' } })} />);
    expect(screen.getByText('Enter the customer name')).toBeTruthy();
    view.rerender(<OrderSummary {...props()} />);
    expect(screen.queryByText(/Enter the customer name|Add at least one garment|Working out the price/)).toBeNull();
    expect(screen.getByText('Amount to collect').nextSibling?.textContent).toBe('₹12.00');
  });

  it('shows a real zero when a full discount makes the order free', () => {
    render(<OrderSummary {...props({ quote: { ...quote, discountPercentBp: 10_000, discountMinor: 1200, totalMinor: 0 } })} />);
    expect(screen.getByText('Amount to collect').nextSibling?.textContent).toBe('₹0.00');
  });

  it('handles an empty order, a pending quote, a missing name and a busy save', () => {
    const view = render(<OrderSummary {...props({ lines: {}, quote: null })} />);
    expect(screen.getByText('Tap garment pictures to add items.')).toBeTruthy();
    expect(screen.getByText('Saved date + 2 days, 5:00 PM IST')).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    view.rerender(<OrderSummary {...props({ quote: null })} />);
    expect(screen.getByText(/Quote…/)).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    view.rerender(<OrderSummary {...props({ customer: { name: '  ', phone: '' } })} />);
    expect(screen.getByText('Customer name needed')).toBeTruthy();
    expect(screen.getByText('Mobile number needed')).toBeTruthy();
    expect(screen.queryByText('Mobile number optional')).toBeNull();
    expect(saveButton().disabled).toBe(true);
    view.rerender(<OrderSummary {...props({ busy: true })} />);
    expect(saveButton().disabled).toBe(true);
    expect(saveButton().textContent).toContain('Saving and dispatching');
  });
});
