// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CounterCatalogue, CounterPiece, CounterQuote, CounterSavedOrder } from '@/lib/localFirst/counter';
import { EditBill } from './EditBill';

const api = vi.hoisted(() => ({ editCounterOrder: vi.fn(), quoteCounterOrder: vi.fn(), voidCounterPayment: vi.fn() }));
vi.mock('@/lib/localFirst/counter', () => api);

const catalogue: CounterCatalogue = {
  garments: [
    { id: 'shirt', key: 'shirt', nameEn: 'Shirt', nameMr: 'शर्ट', category: 'c', imageKey: 'shirt', billingUnit: 'piece', active: true },
    { id: 'coat', key: 'coat', nameEn: 'Coat', nameMr: 'कोट', category: 'c', imageKey: 'coat', billingUnit: 'piece', active: true },
    { id: 'old', key: 'old', nameEn: 'Old thing', nameMr: 'x', category: 'c', imageKey: 'old', billingUnit: 'piece', active: false },
  ],
  services: [
    { id: 'wash', key: 'wash', name: 'Wash', active: true },
    { id: 'iron', key: 'iron', name: 'Iron', active: true },
    { id: 'gone', key: 'custom_1', name: 'Gone', active: false },
  ],
  rates: [
    { garmentId: 'shirt', serviceId: 'wash', priceMinor: 3000, configured: true, available: true, version: 1 },
    { garmentId: 'shirt', serviceId: 'iron', priceMinor: 1000, configured: true, available: true, version: 1 },
    { garmentId: 'shirt', serviceId: 'gone', priceMinor: 500, configured: true, available: true, version: 1 },
    { garmentId: 'coat', serviceId: 'wash', priceMinor: null, configured: false, available: true, version: 1 },
    { garmentId: 'old', serviceId: 'wash', priceMinor: 100, configured: true, available: true, version: 1 },
  ],
};
const piece = (over: Partial<CounterPiece> = {}): CounterPiece => ({ id: 'p', shortId: 's', garmentId: 'shirt', garment: 'Shirt', service: 'Wash', position: 1, total: 1, matched: false, packingMatched: false, collectionMatched: false, tagged: true, ...over });
const order = (over: Partial<CounterSavedOrder> = {}): CounterSavedOrder => ({
  orderId: 'o-1', orderNumber: '202611060001', customerName: 'Rita Mehta', customerPhone: '9876543210', receivedAt: '2026-11-06T06:00:00Z', promisedAt: '2026-11-08T11:30:00Z', status: 'received',
  totalMinor: 6000, subtotalMinor: 6000, discountMinor: 0, manualDiscountMinor: 0, paidMinor: 6000, balanceMinor: 0, paymentStatus: 'paid', collectedAt: null, refundDueMinor: 0,
  payments: [{ id: 'pay-1', at: '2026-11-06T06:01:00Z', method: 'cash', amountMinor: 6000, reference: null, kind: 'advance', voided: false }],
  lines: [{ itemId: 'i-1', garmentId: 'shirt', serviceId: 'wash', garment: 'Shirt', service: 'Wash', quantity: 2, unitPriceMinor: 3000, lineTotalMinor: 6000, pieceCount: 2, handedOverCount: 0 }],
  pieces: [piece()], printJobs: [], ...over,
});
const quoteOf = (totalMinor: number): CounterQuote => ({ lines: [], subtotalMinor: totalMinor, discountPercentBp: 0, discountMinor: 0, manualDiscountMinor: 0, totalMinor, pieceCount: 2, promisedAt: '', catalogueVersion: '2' });
const setup = (o: CounterSavedOrder = order()) => {
  const props = { order: o, catalogue, onSaved: vi.fn(), onCancel: vi.fn(), onError: vi.fn(), onNotice: vi.fn() };
  render(<EditBill {...props} />);
  return props;
};
const field = (label: string | RegExp) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string | RegExp, value: string) => fireEvent.change(field(label), { target: { value } });
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;

beforeEach(() => { vi.clearAllMocks(); api.quoteCounterOrder.mockResolvedValue(quoteOf(6000)); });
afterEach(cleanup);

describe('EditBill', () => {
  it('starts from the saved bill and prices it again with every price pinned', async () => {
    setup();
    expect(field('Customer name').value).toBe('Rita Mehta');
    expect(field('Mobile number').value).toBe('9876543210');
    expect(field('Quantity of Shirt · Wash').value).toBe('2');
    expect(field('Price of Shirt · Wash').value).toBe('30.00');
    await waitFor(() => expect(api.quoteCounterOrder).toHaveBeenCalledWith({
      customer: { name: 'Rita Mehta', phone: '9876543210' },
      items: [{ garmentId: 'shirt', serviceId: 'wash', quantity: 2, unitPriceOverrideMinor: 3000 }],
      manualDiscountMinor: 0,
    }));
    await screen.findByText('Balance');
    expect(screen.getByText('Was').nextSibling?.textContent).toBe('₹60.00');
    expect(screen.getByText('Now').nextSibling?.textContent).toBe('₹60.00');
  });

  it('shows what is still being worked out, and what the customer is owed when the total drops', async () => {
    api.quoteCounterOrder.mockReturnValue(new Promise(() => undefined));
    setup();
    expect(screen.getByText('Now').nextSibling?.textContent).toBe('…');
    expect(screen.getByText('Balance').nextSibling?.textContent).toBe('…');
    expect(button('Save changes').disabled).toBe(true);
    cleanup();
    api.quoteCounterOrder.mockResolvedValue(quoteOf(5000));
    setup();
    await screen.findByText('To give back');
    expect(screen.getByText('To give back').nextSibling?.textContent).toBe('₹10.00');
    cleanup();
    api.quoteCounterOrder.mockResolvedValue(quoteOf(9000));
    setup();
    await waitFor(() => expect(screen.getByText('Balance').nextSibling?.textContent).toBe('₹30.00'));
  });

  it('explains each input that cannot be priced, without asking the native side', async () => {
    setup();
    await waitFor(() => expect(api.quoteCounterOrder).toHaveBeenCalledTimes(1));
    api.quoteCounterOrder.mockClear();
    type('Customer name', '  ');
    expect((await screen.findByRole('alert')).textContent).toBe('Enter the customer name.');
    type('Customer name', 'Rita');
    type('Extra discount (₹)', 'abc');
    expect((await screen.findByRole('alert')).textContent).toContain('extra discount');
    type('Extra discount (₹)', '');
    type('Quantity of Shirt · Wash', '0');
    expect((await screen.findByRole('alert')).textContent).toContain('Quantity for Shirt · Wash');
    type('Quantity of Shirt · Wash', '2');
    type('Price of Shirt · Wash', '');
    expect((await screen.findByRole('alert')).textContent).toBe('Enter a price for Shirt · Wash.');
    type('Price of Shirt · Wash', '1.234');
    expect((await screen.findByRole('alert')).textContent).toBe('Enter a price for Shirt · Wash.');
    expect(api.quoteCounterOrder).not.toHaveBeenCalled();
  });

  it('shows the message when the native side cannot price the bill, as text or as an Error', async () => {
    api.quoteCounterOrder.mockRejectedValue(new Error('This garment and service combination is unavailable.'));
    setup();
    expect((await screen.findByRole('alert')).textContent).toContain('unavailable');
    api.quoteCounterOrder.mockRejectedValue('plain failure');
    type('Quantity of Shirt · Wash', '3');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('plain failure'));
    expect(button('Save changes').disabled).toBe(true);
  });

  it('adds items from the rate card, adds one more of a line already there, and removes lines', async () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Add item' })).toBeNull();
    const garments = Array.from((screen.getByLabelText('Add garment') as HTMLSelectElement).options).map(option => option.text);
    expect(garments).toEqual(['Choose a garment', 'Shirt']);
    expect((screen.getByLabelText('Service') as HTMLSelectElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Add garment'), { target: { value: 'shirt' } });
    expect(Array.from((screen.getByLabelText('Service') as HTMLSelectElement).options).map(option => option.text)).toEqual(['Choose a service', 'Wash', 'Iron']);
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: 'iron' } });
    fireEvent.click(button('Add item'));
    expect(field('Quantity of Shirt · Iron').value).toBe('1');
    expect(field('Price of Shirt · Iron').value).toBe('10.00');
    expect(screen.queryByRole('button', { name: 'Add item' })).toBeNull();

    fireEvent.change(screen.getByLabelText('Add garment'), { target: { value: 'shirt' } });
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: 'wash' } });
    fireEvent.click(button('Add item'));
    expect(field('Quantity of Shirt · Wash').value).toBe('3');
    type('Quantity of Shirt · Wash', 'x');
    fireEvent.change(screen.getByLabelText('Add garment'), { target: { value: 'shirt' } });
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: 'wash' } });
    fireEvent.click(button('Add item'));
    expect(field('Quantity of Shirt · Wash').value).toBe('1');

    fireEvent.click(button('Remove Shirt · Wash'));
    expect(screen.queryByLabelText('Quantity of Shirt · Wash')).toBeNull();
    expect(button('Remove Shirt · Iron').disabled).toBe(true);
  });

  it.each([
    ['matched', { matched: true }],
    ['packingMatched', { packingMatched: true }],
    ['collectionMatched', { collectionMatched: true }],
  ])('locks items and quantities once a piece is %s, but not prices', (_name, change) => {
    setup(order({ pieces: [piece(), piece(change as Partial<CounterPiece>)] }));
    expect(screen.getByRole('status').textContent).toContain('locked');
    expect(field('Quantity of Shirt · Wash').disabled).toBe(true);
    expect(button('Remove Shirt · Wash').disabled).toBe(true);
    expect(field('Price of Shirt · Wash').disabled).toBe(false);
    expect(screen.queryByLabelText('Add garment')).toBeNull();
  });

  it('saves the whole bill with the reviewed total and the reason, then reports it', async () => {
    api.quoteCounterOrder.mockResolvedValue(quoteOf(5500));
    api.editCounterOrder.mockResolvedValue(order({ totalMinor: 5500 }));
    const props = setup(order({ manualDiscountMinor: 500, customerName: 'Rita' }));
    expect(field('Extra discount (₹)').value).toBe('5.00');
    type('Customer name', 'Rita Mehta');
    type('Mobile number', ' 9876543210 ');
    await screen.findByText('₹55.00');
    expect(button('Save changes').disabled).toBe(true);
    type('Reason for the change', 'ab');
    expect(button('Save changes').disabled).toBe(true);
    type('Reason for the change', '  Customer added a shirt  ');
    fireEvent.click(button('Save changes'));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith(expect.objectContaining({ totalMinor: 5500 })));
    expect(api.editCounterOrder).toHaveBeenCalledWith('o-1', expect.objectContaining({
      customer: { name: 'Rita Mehta', phone: '9876543210' }, manualDiscountMinor: 500, reason: 'Customer added a shirt', reviewedTotalMinor: 5500,
    }));
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringContaining('Bill updated'));
  });

  it('keeps the screen and reports the error when the save is refused, and shows Saving while it runs', async () => {
    let finish: (value: unknown) => void = () => undefined;
    api.editCounterOrder.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const props = setup();
    await screen.findByText('Balance');
    type('Reason for the change', 'Fix price');
    await waitFor(() => expect(button('Save changes').disabled).toBe(false));
    fireEvent.click(button('Save changes'));
    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeTruthy();
    finish(order());
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
    api.editCounterOrder.mockRejectedValueOnce(new Error('Some items were already packed'));
    fireEvent.click(button('Save changes'));
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Some items were already packed' })));
  });

  it('voids one payment with a reason, can back out, and lists voided payments', async () => {
    api.voidCounterPayment.mockResolvedValue(order({ paidMinor: 0 }));
    const props = setup(order({ payments: [
      { id: 'pay-1', at: '2026-11-06T06:01:00Z', method: 'cash', amountMinor: 6000, reference: null, kind: 'advance', voided: false },
      { id: 'pay-2', at: '2026-11-06T07:00:00Z', method: 'upi', amountMinor: 1000, reference: null, kind: 'settlement', voided: true },
    ] }));
    expect(screen.getByText('Voided')).toBeTruthy();
    fireEvent.click(button('Void ₹60.00 payment'));
    expect(button('Confirm void').disabled).toBe(true);
    fireEvent.click(button('Keep payment'));
    expect(screen.queryByRole('button', { name: 'Confirm void' })).toBeNull();
    fireEvent.click(button('Void ₹60.00 payment'));
    type('Reason for voiding', 'Typed the wrong amount');
    fireEvent.click(button('Confirm void'));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
    expect(api.voidCounterPayment).toHaveBeenCalledWith('o-1', 'pay-1', 'Typed the wrong amount');
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringContaining('Payment voided'));
  });

  it('reports a refused void and keeps the reason box', async () => {
    api.voidCounterPayment.mockRejectedValue(new Error('already voided'));
    const props = setup();
    fireEvent.click(button('Void ₹60.00 payment'));
    type('Reason for voiding', 'Typed wrong');
    fireEvent.click(button('Confirm void'));
    await waitFor(() => expect(props.onError).toHaveBeenCalled());
    expect(screen.getByLabelText('Reason for voiding')).toBeTruthy();
  });

  it('says so when there are no payments, and goes back from either button', () => {
    const props = setup(order({ payments: [], paidMinor: 0, balanceMinor: 6000 }));
    expect(screen.getByText('No payments were taken.')).toBeTruthy();
    expect(screen.queryByText(/Hand the money back/)).toBeNull();
    fireEvent.click(button('← Back to bill'));
    fireEvent.click(button('Cancel'));
    expect(props.onCancel).toHaveBeenCalledTimes(2);
  });
});
