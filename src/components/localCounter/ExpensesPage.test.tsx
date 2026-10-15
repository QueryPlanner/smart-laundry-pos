// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ExpensesPage } from './ExpensesPage';
import { shopMonthStart, shopToday } from './officeFormat';
import type { CounterAccount } from '@/lib/localFirst/counter';
import type { OfficeExpense, OfficeExpenseList } from '@/lib/localFirst/office';

const api = vi.hoisted(() => ({ listOfficeExpenses: vi.fn(), createOfficeExpense: vi.fn(), deleteOfficeExpense: vi.fn() }));
vi.mock('@/lib/localFirst/office', () => api);

const staff: CounterAccount = { id: 's1', fullName: 'Clerk', role: 'staff', active: true };
const admin: CounterAccount = { id: 'a1', fullName: 'Owner', role: 'admin', active: true };
const rent: OfficeExpense = {
  id: 'e1', expenseDate: '2026-01-05', category: 'Rent', description: 'January', amountMinor: 1500000, paymentMethod: 'bank_transfer',
  notes: 'Cheque 12', createdBy: 'a1', createdByName: 'Owner', createdAt: '2026-01-05T10:00:00Z',
};
const tea: OfficeExpense = {
  id: 'e2', expenseDate: '2026-01-06', category: 'Tea', description: null, amountMinor: 5050, paymentMethod: 'cash',
  notes: null, createdBy: 's1', createdByName: null, createdAt: '2026-01-06T10:00:00Z',
};
const list = (items: OfficeExpense[], extra: Partial<OfficeExpenseList> = {}): OfficeExpenseList => ({
  items, totalMinor: items.reduce((sum, item) => sum + item.amountMinor, 0), matching: items.length, categories: ['Rent', 'Tea'], ...extra,
});

const setup = (account: CounterAccount = staff) => {
  const props = { account, onError: vi.fn(), onNotice: vi.fn(), onOpenOrder: vi.fn() };
  render(<ExpensesPage {...props} />);
  return props;
};
/** The table row for an expense category (the same word is also a filter option). */
const rowFor = async (category: string): Promise<HTMLElement> =>
  (await screen.findAllByText(category)).find(element => element.tagName === 'TD')?.closest('tr') as HTMLElement;
const fillForm = (overrides: Record<string, string> = {}) => {
  const form = screen.getByRole('form', { name: 'Add expense' });
  const values: Record<string, string> = { Category: 'Detergent', 'Amount (₹)': '250.50', ...overrides };
  for (const [label, value] of Object.entries(values)) fireEvent.change(within(form).getByLabelText(label), { target: { value } });
  return form;
};

beforeEach(() => {
  vi.clearAllMocks();
  api.listOfficeExpenses.mockResolvedValue(list([rent, tea]));
  api.createOfficeExpense.mockResolvedValue(rent);
  api.deleteOfficeExpense.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('ExpensesPage', () => {
  it('starts on this month and shows the total and rows', async () => {
    setup();
    await rowFor('Rent');
    expect(api.listOfficeExpenses).toHaveBeenCalledWith({ from: shopMonthStart(), to: shopToday(), category: undefined });
    expect(screen.getByText('₹15,050.50')).toBeTruthy();
    const row = await rowFor('Rent');
    expect(within(row).getByText('05 Jan 2026')).toBeTruthy();
    expect(within(row).getByText('January · Cheque 12')).toBeTruthy();
    expect(within(row).getByText('Bank transfer')).toBeTruthy();
    expect(within(row).getByText('₹15,000.00')).toBeTruthy();
    expect(within(row).getByText('Owner')).toBeTruthy();
    const other = await rowFor('Tea');
    expect(within(other).getAllByText('—')).toHaveLength(2);
  });

  it('filters by dates and category and can show all time', async () => {
    setup();
    await rowFor('Rent');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-01-31' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Tea' } });
    await waitFor(() => expect(api.listOfficeExpenses).toHaveBeenLastCalledWith({ from: '2026-01-01', to: '2026-01-31', category: 'Tea' }));
    fireEvent.click(screen.getByRole('button', { name: 'All time' }));
    await waitFor(() => expect(api.listOfficeExpenses).toHaveBeenLastCalledWith({ from: undefined, to: undefined, category: 'Tea' }));
    fireEvent.click(screen.getByRole('button', { name: 'This month' }));
    await waitFor(() => expect(api.listOfficeExpenses).toHaveBeenLastCalledWith({ from: shopMonthStart(), to: shopToday(), category: 'Tea' }));
  });

  it('says so when nothing was spent and when the list is cut short', async () => {
    api.listOfficeExpenses.mockResolvedValue(list([], { categories: [] }));
    setup();
    await screen.findByText('No expenses in these dates.');
    cleanup();
    api.listOfficeExpenses.mockResolvedValue(list([rent], { matching: 600 }));
    setup();
    await screen.findByText('Showing the latest 1');
  });

  it('records an expense in paise with a trimmed category and blank options left out', async () => {
    const props = setup();
    await rowFor('Rent');
    fireEvent.click(screen.getByRole('button', { name: 'Add expense' }));
    fillForm({ 'Paid by': 'upi', 'Description (optional)': ' Refill ' });
    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }));
    await waitFor(() => expect(api.createOfficeExpense).toHaveBeenCalledWith({
      expenseDate: shopToday(), category: 'Detergent', description: 'Refill', amountMinor: 25050, paymentMethod: 'upi', notes: undefined,
    }));
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith('Expense recorded.'));
    expect(screen.queryByRole('form', { name: 'Add expense' })).toBeNull();
    expect(api.listOfficeExpenses.mock.calls.length).toBeGreaterThan(1);
  });

  it('refuses a missing or zero amount before calling the native side', async () => {
    const props = setup();
    await rowFor('Rent');
    fireEvent.click(screen.getByRole('button', { name: 'Add expense' }));
    for (const amount of ['', '0', 'abc', '1.234']) {
      fillForm({ 'Amount (₹)': amount });
      fireEvent.click(screen.getByRole('button', { name: 'Save expense' }));
    }
    expect(props.onError).toHaveBeenCalledTimes(4);
    expect(props.onError.mock.calls[0][0].message).toContain('above zero');
    expect(api.createOfficeExpense).not.toHaveBeenCalled();
  });

  it('keeps the form open and reports a native refusal', async () => {
    api.createOfficeExpense.mockRejectedValue(new Error('The amount must be between ₹0.01 and ₹10,00,000.'));
    const props = setup();
    await rowFor('Rent');
    fireEvent.click(screen.getByRole('button', { name: 'Add expense' }));
    fillForm({ Date: '2026-01-02', 'Notes (optional)': 'n' });
    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }));
    await waitFor(() => expect(props.onError).toHaveBeenCalled());
    expect(screen.getByRole('form', { name: 'Add expense' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'Add expense' })).toBeNull();
  });

  it('can open the form before the list has loaded', async () => {
    api.listOfficeExpenses.mockReturnValue(new Promise(() => undefined));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add expense' }));
    expect(screen.getByRole('form', { name: 'Add expense' })).toBeTruthy();
  });

  it('shows no delete control to staff', async () => {
    setup(staff);
    await rowFor('Rent');
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryByText('Actions')).toBeNull();
  });

  it('lets an administrator delete with a reason and warns that past profit changes', async () => {
    const props = setup(admin);
    await rowFor('Rent');
    const row = await rowFor('Rent');
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    expect(within(row).getByText(/profit for 05 Jan 2026 will change/)).toBeTruthy();
    fireEvent.change(within(row).getByLabelText('Reason'), { target: { value: 'Entered twice' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(api.deleteOfficeExpense).toHaveBeenCalledWith('e1', 'Entered twice'));
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith('Expense deleted.'));
  });

  it('reports a failed delete', async () => {
    api.deleteOfficeExpense.mockRejectedValue(new Error('Expense not found.'));
    const props = setup(admin);
    await rowFor('Rent');
    const row = await rowFor('Rent');
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    fireEvent.change(within(row).getByLabelText('Reason'), { target: { value: 'Entered twice' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Expense not found.' })));
    expect(props.onNotice).not.toHaveBeenCalled();
  });

  it('passes load failures to the shell', async () => {
    api.listOfficeExpenses.mockRejectedValue(new Error('db down'));
    const props = setup();
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'db down' })));
  });
});
