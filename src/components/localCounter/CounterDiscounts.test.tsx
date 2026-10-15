// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CounterDiscounts } from './CounterDiscounts';
import type { CounterDiscountRule } from '@/lib/localFirst/counter';

const api = vi.hoisted(() => ({ listCounterDiscounts: vi.fn(), setCounterDiscount: vi.fn(), searchCounterCustomers: vi.fn() }));
vi.mock('@/lib/localFirst/counter', () => api);

const shop: CounterDiscountRule = { id: 'd1', scope: 'all', customerId: null, customerName: null, customerPhone: null, percentBp: 1250, label: 'Diwali', active: false };
const mine: CounterDiscountRule = { id: 'd2', scope: 'customer', customerId: 'c-1', customerName: 'Rita Joshi', customerPhone: '9876543210', percentBp: 500, label: 'Regular', active: true };
const plain: CounterDiscountRule = { ...mine, id: 'd3', customerId: 'c-2', customerName: 'Om', customerPhone: '9000000000', label: '', active: false };
const setup = () => {
  const onError = vi.fn(); const onNotice = vi.fn();
  render(<CounterDiscounts onError={onError} onNotice={onNotice} />);
  return { onError, onNotice };
};
beforeEach(() => {
  vi.clearAllMocks();
  api.listCounterDiscounts.mockResolvedValue([shop, mine, plain]);
  api.setCounterDiscount.mockResolvedValue(undefined);
  api.searchCounterCustomers.mockResolvedValue([{ id: 'c-9', name: 'New Person', phone: '9111111111' }]);
});
afterEach(cleanup);

describe('CounterDiscounts', () => {
  it('shows the saved shop-wide rule and the customer-specific rules', async () => {
    setup();
    await waitFor(() => expect((screen.getByLabelText('Shop-wide discount %') as HTMLInputElement).value).toBe('12.5'));
    expect((screen.getByLabelText('Label (optional)', { selector: '#shop-discount-label' }) as HTMLInputElement).value).toBe('Diwali');
    expect((screen.getByLabelText('Shop-wide discount active') as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText('Rita Joshi')).toBeTruthy();
    expect(screen.getByText(/5% · Regular · Active/)).toBeTruthy();
    expect(screen.getByText(/0% ?|5% · Off/)).toBeTruthy();
  });

  it('starts empty and active when no rules exist', async () => {
    api.listCounterDiscounts.mockResolvedValue([]);
    setup();
    await screen.findByText('No customer-specific discounts.');
    expect((screen.getByLabelText('Shop-wide discount %') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Shop-wide discount active') as HTMLInputElement).checked).toBe(true);
  });

  it('saves the shop-wide rule as basis points and confirms', async () => {
    const { onNotice } = setup();
    await screen.findByText('Rita Joshi');
    fireEvent.change(screen.getByLabelText('Shop-wide discount %'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Label (optional)', { selector: '#shop-discount-label' }), { target: { value: 'Festive' } });
    fireEvent.click(screen.getByLabelText('Shop-wide discount active'));
    fireEvent.click(screen.getByRole('button', { name: 'Save shop-wide discount' }));
    await waitFor(() => expect(api.setCounterDiscount).toHaveBeenCalledWith(null, 1000, true, 'Festive'));
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('applies automatically')));
  });

  it('needs an extra tick before a shop-wide discount above 50% can be saved', async () => {
    const { onNotice } = setup();
    await screen.findByText('Rita Joshi');
    const save = () => screen.getByRole('button', { name: 'Save shop-wide discount' }) as HTMLButtonElement;
    expect(screen.queryByLabelText(/applies to every customer/)).toBeNull();
    fireEvent.click(screen.getByLabelText('Shop-wide discount active'));
    fireEvent.change(screen.getByLabelText('Shop-wide discount %'), { target: { value: '100' } });
    expect(save().disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('I understand this applies to every customer'));
    expect(save().disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('Shop-wide discount %'), { target: { value: '90' } });
    expect(save().disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('I understand this applies to every customer'));
    fireEvent.click(save());
    await waitFor(() => expect(api.setCounterDiscount).toHaveBeenCalledWith(null, 9000, true, 'Diwali'));
    await waitFor(() => expect(onNotice).toHaveBeenCalled());
    expect(save().disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('Shop-wide discount %'), { target: { value: '50' } });
    expect(screen.queryByLabelText(/applies to every customer/)).toBeNull();
    expect(save().disabled).toBe(false);
  });

  it('does not ask for the extra tick when a large shop-wide discount is switched off', async () => {
    api.listCounterDiscounts.mockResolvedValue([{ ...shop, percentBp: 6000, active: true }]);
    setup();
    await waitFor(() => expect((screen.getByLabelText('Shop-wide discount %') as HTMLInputElement).value).toBe('60'));
    fireEvent.click(screen.getByLabelText('Shop-wide discount active'));
    expect(screen.queryByLabelText(/applies to every customer/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save shop-wide discount' }));
    await waitFor(() => expect(api.setCounterDiscount).toHaveBeenCalledWith(null, 6000, false, 'Diwali'));
  });

  it('rejects an invalid percentage without calling the native API', async () => {
    const { onError } = setup();
    await screen.findByText('Rita Joshi');
    fireEvent.change(screen.getByLabelText('Shop-wide discount %'), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save shop-wide discount' }));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('0 to 100') }));
    expect(api.setCounterDiscount).not.toHaveBeenCalled();
  });

  it('reports native save and load failures', async () => {
    api.setCounterDiscount.mockRejectedValue(new Error('Administrator access is required'));
    const { onError } = setup();
    await screen.findByText('Rita Joshi');
    fireEvent.click(screen.getByRole('button', { name: 'Save shop-wide discount' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Administrator access is required' })));
    cleanup();
    api.listCounterDiscounts.mockRejectedValue(new Error('load failed'));
    const second = setup();
    await waitFor(() => expect(second.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'load failed' })));
  });

  it('finds a customer by mobile, selects them and saves their own rule', async () => {
    setup();
    await screen.findByText('Rita Joshi');
    expect((screen.getByRole('button', { name: 'Save customer discount' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Customer mobile'), { target: { value: '91' } });
    expect(api.searchCounterCustomers).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Customer mobile'), { target: { value: '9111' } });
    fireEvent.click(await screen.findByRole('option', { name: /New Person/ }));
    expect(screen.getByText(/Selected:/).textContent).toContain('New Person');
    fireEvent.change(screen.getByLabelText('Discount %'), { target: { value: '7.5' } });
    fireEvent.change(screen.getByLabelText('Label (optional)', { selector: '#customer-discount-label' }), { target: { value: 'Friend' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save customer discount' }));
    await waitFor(() => expect(api.setCounterDiscount).toHaveBeenCalledWith('c-9', 750, true, 'Friend'));
    await waitFor(() => expect((screen.getByLabelText('Customer mobile') as HTMLInputElement).value).toBe(''));
    expect(screen.queryByText(/Selected:/)).toBeNull();
  });

  it('keeps the selected customer when saving their rule fails or the percentage is invalid', async () => {
    api.setCounterDiscount.mockRejectedValue(new Error('nope'));
    const { onError } = setup();
    await screen.findByText('Rita Joshi');
    fireEvent.change(screen.getByLabelText('Customer mobile'), { target: { value: '9111' } });
    fireEvent.click(await screen.findByRole('option', { name: /New Person/ }));
    fireEvent.change(screen.getByLabelText('Discount %'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save customer discount' }));
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Discount %'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save customer discount' }));
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/Selected:/)).toBeTruthy();
  });

  it('surfaces a failing customer search and ignores a late result after typing changes', async () => {
    api.searchCounterCustomers.mockRejectedValue(new Error('search down'));
    const { onError } = setup();
    await screen.findByText('Rita Joshi');
    fireEvent.change(screen.getByLabelText('Customer mobile'), { target: { value: '9111' } });
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'search down' })));
    let finish: (value: unknown[]) => void = () => undefined;
    api.searchCounterCustomers.mockReturnValue(new Promise(resolve => { finish = resolve as typeof finish; }));
    fireEvent.change(screen.getByLabelText('Customer mobile'), { target: { value: '9222' } });
    await waitFor(() => expect(api.searchCounterCustomers).toHaveBeenCalledWith('9222'));
    fireEvent.change(screen.getByLabelText('Customer mobile'), { target: { value: '9' } });
    finish([{ id: 'late', name: 'Late Person', phone: '9222' }]);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(screen.queryByRole('option', { name: /Late Person/ })).toBeNull();
  });

  it('turns a customer rule off and on, keeping its percentage and label', async () => {
    setup();
    await screen.findByText('Rita Joshi');
    fireEvent.click(screen.getAllByRole('button', { name: 'Turn off' })[0]);
    await waitFor(() => expect(api.setCounterDiscount).toHaveBeenCalledWith('c-1', 500, false, 'Regular'));
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(api.setCounterDiscount).toHaveBeenCalledWith('c-2', 500, true, ''));
  });
});
