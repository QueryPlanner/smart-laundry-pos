// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { OrderSummary } from './OrderSummary';
import type { CounterCatalogue, CounterQuote } from '@/lib/localFirst/counter';
import { ADVANCE_ABOVE_TOTAL, ADVANCE_NOT_AMOUNT } from '@/lib/localFirst/payment';

const catalogue: CounterCatalogue = { garments: [{ id: 'g1', key: 'shirt', nameEn: 'Shirt', nameMr: 'शर्ट', category: 'tops', imageKey: 'shirt', billingUnit: 'piece', active: true }], services: [{ id: 's1', key: 'wash_iron', name: 'Wash + Iron', active: true }], rates: [] };
const quote: CounterQuote = { lines: [{ garmentId: 'g1', serviceId: 's1', garment: 'Shirt', service: 'Wash + Iron', quantity: 1, unitPriceMinor: 1200, listPriceMinor: 1200, lineTotalMinor: 1200, rateVersion: 2, serviceKey: 'wash_iron' }], subtotalMinor: 1200, discountPercentBp: 0, discountMinor: 0, totalMinor: 1200, pieceCount: 1, promisedAt: '2026-10-17T11:30:00Z', catalogueVersion: '2' };
const props = (overrides: Partial<React.ComponentProps<typeof OrderSummary>> = {}) => ({
  catalogue, lines: { 'g1|s1': 1 }, quote, customer: { name: 'Rita', phone: '9876543210' }, advance: '', onAdvance: vi.fn(), paymentMethod: 'cash' as const,
  onPaymentMethod: vi.fn(), onRemove: vi.fn(), onQuantity: vi.fn(), onPrice: vi.fn(), onSave: vi.fn(), onPreview: vi.fn(), busy: false, quoteFailed: false, ...overrides,
});
const saveButton = () => screen.getByRole('button', { name: /Save & Print|Saving and dispatching/ }) as HTMLButtonElement;
const advanceInput = () => screen.getByLabelText('Advance received now') as HTMLInputElement;
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
afterEach(cleanup);

describe('OrderSummary', () => {
  it('shows the fixed promise, the amount to collect and an empty advance field with nothing paid now', () => {
    render(<OrderSummary {...props()} />);
    expect(screen.getByText('17 Oct 2026, 5:00 pm')).toBeTruthy();
    expect(screen.getByText('Amount to collect').nextSibling?.textContent).toBe('₹12.00');
    expect(advanceInput().value).toBe('');
    expect(screen.getByText('Any amount can be paid now. The rest is due at pickup.')).toBeTruthy();
    expect(screen.getByText('Balance to pay at pickup ₹12.00')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Payment method' })).toBeNull();
    expect(screen.queryByText(/Discount/)).toBeNull();
    expect(saveButton().disabled).toBe(false);
  });

  describe('preview bill button', () => {
    const previewButton = () => screen.getByRole('button', { name: 'Preview bill' }) as HTMLButtonElement;

    it('is next to Save and asks for the preview', () => {
      const p = props();
      render(<OrderSummary {...p} />);
      expect(previewButton().disabled).toBe(false);
      fireEvent.click(previewButton());
      expect(p.onPreview).toHaveBeenCalledOnce();
      expect(p.onSave).not.toHaveBeenCalled();
    });

    it.each([
      ['no price yet', { quote: null }],
      ['no customer name', { customer: { name: ' ', phone: '' } }],
      ['nothing added', { lines: {} }],
      ['an advance that cannot be taken', { advance: '99999' }],
      ['a save in progress', { busy: true }],
    ])('is disabled with %s, exactly when Save is', (_label, over) => {
      render(<OrderSummary {...props(over as Partial<React.ComponentProps<typeof OrderSummary>>)} />);
      expect(previewButton().disabled).toBe(true);
      expect(saveButton().disabled).toBe(true);
    });
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

  describe('price for this bill', () => {
    const priceInput = () => screen.getByLabelText('Shirt price for this bill') as HTMLInputElement;

    it('starts at the rate-card price with no "rate card" note', () => {
      render(<OrderSummary {...props()} />);
      expect(priceInput().value).toBe('12.00');
      expect(screen.queryByText(/Rate card/)).toBeNull();
    });

    it('reports a different price in paise, and the rate-card price as "no override"', () => {
      const p = props();
      render(<OrderSummary {...p} />);
      fireEvent.change(priceInput(), { target: { value: '9.5' } });
      fireEvent.change(priceInput(), { target: { value: '12' } });
      expect(p.onPrice.mock.calls).toEqual([['g1', 's1', 950], ['g1', 's1', undefined]]);
    });

    it('ignores an empty or non-numeric price and shows the charged price again on leaving the box', () => {
      const p = props();
      render(<OrderSummary {...p} />);
      fireEvent.change(priceInput(), { target: { value: '' } });
      fireEvent.change(priceInput(), { target: { value: 'abc' } });
      expect(p.onPrice).not.toHaveBeenCalled();
      fireEvent.blur(priceInput());
      expect(priceInput().value).toBe('12.00');
    });

    it('shows the rate-card price beside a changed price, including a free line', () => {
      const changed = { ...quote, lines: [{ ...quote.lines[0], unitPriceMinor: 0, lineTotalMinor: 0 }] };
      render(<OrderSummary {...props({ quote: changed })} />);
      expect(priceInput().value).toBe('0.00');
      expect(screen.getByText('Rate card ₹12.00')).toBeTruthy();
    });

    it('shows no price box while the quote is still being worked out', () => {
      render(<OrderSummary {...props({ quote: null })} />);
      expect(screen.queryByLabelText('Shirt price for this bill')).toBeNull();
    });
  });

  it('shows the automatic discount and the discounted amount to collect', () => {
    const discounted = { ...quote, discountPercentBp: 1250, discountMinor: 150, totalMinor: 1050 };
    render(<OrderSummary {...props({ quote: discounted })} />);
    expect(screen.getByText('Discount (12.5%)').nextSibling?.textContent).toBe('-₹1.50');
    expect(screen.getByText('Amount to collect').nextSibling?.textContent).toBe('₹10.50');
  });

  it('reports every typed advance exactly as typed', () => {
    const p = props();
    render(<OrderSummary {...p} />);
    fireEvent.change(advanceInput(), { target: { value: '25' } });
    expect(p.onAdvance).toHaveBeenCalledWith('25');
  });

  it('fills the advance with nothing, half (rounded down to paise) or the whole total', () => {
    const p = props({ quote: { ...quote, totalMinor: 1201 } });
    render(<OrderSummary {...p} />);
    fireEvent.click(button('Half'));
    fireEvent.click(button('Full'));
    fireEvent.click(button('Nothing now'));
    expect(p.onAdvance.mock.calls).toEqual([['6.00'], ['12.01'], ['']]);
  });

  it('disables Half and Full while there is no quote, but still lets the advance be cleared', () => {
    const p = props({ quote: null, lines: {} });
    render(<OrderSummary {...p} />);
    expect(button('Half').disabled).toBe(true);
    expect(button('Full').disabled).toBe(true);
    expect(button('Nothing now').disabled).toBe(false);
    fireEvent.click(button('Nothing now'));
    expect(p.onAdvance).toHaveBeenCalledWith('');
  });

  it('shows the payment method buttons only when the advance is above zero, and reports the choice', () => {
    const p = props();
    const view = render(<OrderSummary {...p} />);
    expect(screen.queryByRole('group', { name: 'Payment method' })).toBeNull();
    view.rerender(<OrderSummary {...p} advance="0" />);
    expect(screen.queryByRole('group', { name: 'Payment method' })).toBeNull();
    view.rerender(<OrderSummary {...p} advance="4" />);
    for (const label of ['Cash', 'UPI', 'Card', 'Bank transfer', 'Other']) expect(button(label).getAttribute('aria-pressed')).not.toBeNull();
    expect(button('Cash').getAttribute('aria-pressed')).toBe('true');
    expect(button('UPI').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button('UPI'));
    expect(p.onPaymentMethod).toHaveBeenCalledWith('upi');
  });

  it('states the balance to pay at pickup as one line of text, from the live advance', () => {
    const p = props();
    const view = render(<OrderSummary {...p} advance="4.50" />);
    expect(screen.getByText('Balance to pay at pickup ₹7.50')).toBeTruthy();
    view.rerender(<OrderSummary {...p} advance="12" />);
    expect(screen.getByText('Balance to pay at pickup ₹0.00')).toBeTruthy();
  });

  it('shows no balance while there is no quote', () => {
    render(<OrderSummary {...props({ quote: null, advance: '10' })} />);
    expect(screen.queryByText(/Balance to pay at pickup/)).toBeNull();
  });

  it('refuses text that is not an amount, with a message and a disabled Save', () => {
    const p = props();
    const view = render(<OrderSummary {...p} advance="12.345" />);
    expect(screen.getByRole('alert').textContent).toBe(ADVANCE_NOT_AMOUNT);
    expect(saveButton().disabled).toBe(true);
    expect(screen.queryByText(/Balance to pay at pickup/)).toBeNull();
    expect(screen.queryByRole('group', { name: 'Payment method' })).toBeNull();
    for (const text of ['abc', '-5']) {
      view.rerender(<OrderSummary {...p} advance={text} />);
      expect(screen.getByRole('alert').textContent, text).toBe(ADVANCE_NOT_AMOUNT);
    }
  });

  it('refuses an advance above the amount to collect, and accepts one that equals it', () => {
    const p = props();
    const view = render(<OrderSummary {...p} advance="12.01" />);
    expect(screen.getByRole('alert').textContent).toBe(ADVANCE_ABOVE_TOTAL);
    expect(saveButton().disabled).toBe(true);
    view.rerender(<OrderSummary {...p} advance="12" />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(saveButton().disabled).toBe(false);
  });

  it('asks for no payment when a full discount leaves nothing to collect, and ignores any advance typed earlier', () => {
    const free = { ...quote, discountPercentBp: 10_000, discountMinor: 1200, totalMinor: 0 };
    render(<OrderSummary {...props({ quote: free, advance: '500' })} />);
    expect(screen.getByText('No payment due')).toBeTruthy();
    expect(screen.queryByLabelText('Advance received now')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
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
    expect(screen.getByText('Tap a service on a garment to add it.')).toBeTruthy();
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
