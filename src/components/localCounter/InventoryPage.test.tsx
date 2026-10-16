// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { InventoryPage } from './InventoryPage';
import type { CounterAccount } from '@/lib/localFirst/counter';
import type { OfficeInventoryItem } from '@/lib/localFirst/office';

const api = vi.hoisted(() => ({ listOfficeInventory: vi.fn(), createOfficeInventoryItem: vi.fn(), adjustOfficeInventory: vi.fn(), deleteOfficeInventoryItem: vi.fn() }));
vi.mock('@/lib/localFirst/office', () => api);

const staff: CounterAccount = { id: 's1', fullName: 'Clerk', role: 'staff', active: true };
const admin: CounterAccount = { id: 'a1', fullName: 'Owner', role: 'admin', active: true };
const soap: OfficeInventoryItem = { id: 'i1', name: 'Detergent', unit: 'kg', currentQuantity: 1.5, minimumQuantity: 2, purchaseCostMinor: 12050, notes: 'Blue drum', updatedAt: '2026-01-01', lowStock: true };
const hangers: OfficeInventoryItem = { id: 'i2', name: 'Hangers', unit: 'pcs', currentQuantity: 100, minimumQuantity: 0, purchaseCostMinor: null, notes: null, updatedAt: '2026-01-01', lowStock: false };

const setup = (account: CounterAccount = staff) => {
  const props = { account, onError: vi.fn(), onNotice: vi.fn(), onOpenOrder: vi.fn() };
  render(<InventoryPage {...props} />);
  return props;
};
const rowFor = async (name: string): Promise<HTMLElement> => (await screen.findByText(name)).closest('tr') as HTMLElement;
const fill = (form: HTMLElement, values: Record<string, string>) => {
  for (const [label, value] of Object.entries(values)) fireEvent.change(within(form).getByLabelText(label), { target: { value } });
};
const adjustForm = async (name: string) => {
  fireEvent.click(within(await rowFor(name)).getByRole('button', { name: 'Adjust stock' }));
  return screen.getByRole('form', { name: 'Adjust stock' });
};

beforeEach(() => {
  vi.clearAllMocks();
  api.listOfficeInventory.mockResolvedValue([soap, hangers]);
  api.createOfficeInventoryItem.mockResolvedValue(soap);
  api.adjustOfficeInventory.mockResolvedValue(soap);
  api.deleteOfficeInventoryItem.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('InventoryPage', () => {
  it('lists stock with low-stock warnings and counts', async () => {
    setup();
    const low = await rowFor('Detergent');
    expect(within(low).getByText('1.5 kg')).toBeTruthy();
    expect(within(low).getByText('Low stock')).toBeTruthy();
    expect(within(low).getByText('2 kg')).toBeTruthy();
    expect(within(low).getByText('₹120.50')).toBeTruthy();
    expect(within(low).getByText('Blue drum')).toBeTruthy();
    const fine = await rowFor('Hangers');
    expect(within(fine).queryByText('Low stock')).toBeNull();
    expect(within(fine).getAllByText('—')).toHaveLength(2);
    const cards = Array.from(document.querySelectorAll<HTMLElement>('.counter-stat'));
    expect(within(cards[0]).getByText('2')).toBeTruthy();
    expect(within(cards[1]).getByText('1')).toBeTruthy();
  });

  it('shows an all-clear when nothing is low and explains an empty list', async () => {
    api.listOfficeInventory.mockResolvedValue([hangers]);
    setup();
    await rowFor('Hangers');
    expect(document.querySelector('.counter-stat.good')).toBeTruthy();
    cleanup();
    api.listOfficeInventory.mockResolvedValue([]);
    setup();
    await screen.findByText(/No items yet/);
  });

  it('adds an item with the opening stock and cost in the right units', async () => {
    const props = setup();
    await rowFor('Detergent');
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    const form = screen.getByRole('form', { name: 'Add item' });
    fill(form, { 'Item name': ' Starch ', Unit: 'kg', 'Warn me at or below': '2.5', 'Stock on hand now': '10', 'Cost per unit (₹, optional)': '45.5', 'Notes (optional)': 'Aisle 2' });
    fireEvent.click(within(form).getByRole('button', { name: 'Save item' }));
    await waitFor(() => expect(api.createOfficeInventoryItem).toHaveBeenCalledWith({
      name: 'Starch', unit: 'kg', minimumQuantity: 2.5, openingQuantity: 10, purchaseCostMinor: 4550, notes: 'Aisle 2',
    }));
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith('Item added.'));
    expect(screen.queryByRole('form', { name: 'Add item' })).toBeNull();
  });

  it('leaves optional numbers out when blank or zero', async () => {
    setup();
    await rowFor('Detergent');
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    const form = screen.getByRole('form', { name: 'Add item' });
    fill(form, { 'Item name': 'Pegs', Unit: 'pcs', 'Warn me at or below': '0' });
    fireEvent.click(within(form).getByRole('button', { name: 'Save item' }));
    await waitFor(() => expect(api.createOfficeInventoryItem).toHaveBeenCalledWith({
      name: 'Pegs', unit: 'pcs', minimumQuantity: 0, openingQuantity: undefined, purchaseCostMinor: undefined, notes: undefined,
    }));
  });

  it('rejects bad quantities and costs before calling the native side', async () => {
    const props = setup();
    await rowFor('Detergent');
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    const form = screen.getByRole('form', { name: 'Add item' });
    fill(form, { 'Item name': 'X', Unit: 'kg' });
    for (const bad of [{ 'Warn me at or below': '-1' }, { 'Warn me at or below': '1.2345' }, { 'Warn me at or below': '', 'Stock on hand now': 'lots' }]) {
      fill(form, bad);
      fireEvent.click(within(form).getByRole('button', { name: 'Save item' }));
    }
    expect(props.onError.mock.calls[0][0].message).toContain('quantity');
    fill(form, { 'Warn me at or below': '1', 'Stock on hand now': '', 'Cost per unit (₹, optional)': 'free' });
    fireEvent.click(within(form).getByRole('button', { name: 'Save item' }));
    expect(props.onError).toHaveBeenCalledTimes(4);
    expect(props.onError.mock.calls[3][0].message).toContain('cost');
    expect(api.createOfficeInventoryItem).not.toHaveBeenCalled();
  });

  it('reports a native refusal when adding and can cancel', async () => {
    api.createOfficeInventoryItem.mockRejectedValue(new Error('An inventory item with this name already exists.'));
    const props = setup();
    await rowFor('Detergent');
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    const form = screen.getByRole('form', { name: 'Add item' });
    fill(form, { 'Item name': 'Detergent', Unit: 'kg' });
    fireEvent.click(within(form).getByRole('button', { name: 'Save item' }));
    await waitFor(() => expect(props.onError).toHaveBeenCalled());
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'Add item' })).toBeNull();
  });

  it('sends stock out as a negative change and keeps the reason', async () => {
    const props = setup();
    const form = await adjustForm('Detergent');
    expect(within(form).getByText('Adjust stock: Detergent')).toBeTruthy();
    expect((within(form).getByLabelText('Reason') as HTMLInputElement).value).toBe('Stock received');
    fill(form, { 'What happened': 'out' });
    expect((within(form).getByLabelText('Reason') as HTMLInputElement).value).toBe('Used in the shop');
    fill(form, { Quantity: '0.5', Reason: ' Washed the sheets ' });
    fireEvent.click(within(form).getByRole('button', { name: 'Save stock change' }));
    await waitFor(() => expect(api.adjustOfficeInventory).toHaveBeenCalledWith({ itemId: 'i1', transactionType: 'stock_out', changeQuantity: -0.5, reason: 'Washed the sheets' }));
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith('Stock updated.'));
    expect(screen.queryByRole('form', { name: 'Adjust stock' })).toBeNull();
  });

  it('maps stock in and both count corrections to the right sign', async () => {
    setup();
    const cases: Array<[string, string, number]> = [['in', 'stock_in', 3], ['up', 'adjustment', 3], ['down', 'adjustment', -3]];
    for (const [move, type, change] of cases) {
      const form = await adjustForm('Hangers');
      fill(form, { 'What happened': move, Quantity: '3' });
      fireEvent.click(within(form).getByRole('button', { name: 'Save stock change' }));
      await waitFor(() => expect(api.adjustOfficeInventory).toHaveBeenLastCalledWith(expect.objectContaining({ itemId: 'i2', transactionType: type, changeQuantity: change })));
      await waitFor(() => expect(screen.queryByRole('form', { name: 'Adjust stock' })).toBeNull());
    }
  });

  it('refuses a missing or zero quantity and shows a native refusal such as negative stock', async () => {
    api.adjustOfficeInventory.mockRejectedValue(new Error('Stock cannot become negative; only 1.5 kg in stock.'));
    const props = setup();
    const form = await adjustForm('Detergent');
    for (const bad of ['', '0', '1,5']) {
      fill(form, { Quantity: bad });
      fireEvent.click(within(form).getByRole('button', { name: 'Save stock change' }));
    }
    expect(props.onError).toHaveBeenCalledTimes(3);
    expect(api.adjustOfficeInventory).not.toHaveBeenCalled();
    fill(form, { 'What happened': 'out', Quantity: '9' });
    fireEvent.click(within(form).getByRole('button', { name: 'Save stock change' }));
    await waitFor(() => expect(props.onError).toHaveBeenCalledTimes(4));
    expect(props.onError.mock.calls[3][0].message).toContain('negative');
    expect(screen.getByRole('form', { name: 'Adjust stock' })).toBeTruthy();
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'Adjust stock' })).toBeNull();
  });

  it('keeps delete controls away from staff', async () => {
    setup(staff);
    await rowFor('Detergent');
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('lets an administrator delete an item with a reason', async () => {
    const props = setup(admin);
    const row = await rowFor('Detergent');
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    fireEvent.change(within(row).getByLabelText('Reason'), { target: { value: 'Stopped stocking' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(api.deleteOfficeInventoryItem).toHaveBeenCalledWith('i1', 'Stopped stocking'));
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith('Item deleted.'));
  });

  it('reports a failed delete', async () => {
    api.deleteOfficeInventoryItem.mockRejectedValue(new Error('Inventory item not found.'));
    const props = setup(admin);
    const row = await rowFor('Detergent');
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    fireEvent.change(within(row).getByLabelText('Reason'), { target: { value: 'Stopped stocking' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Inventory item not found.' })));
  });

  it('passes load failures to the shell', async () => {
    api.listOfficeInventory.mockRejectedValue(new Error('db down'));
    const props = setup();
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'db down' })));
  });
});
