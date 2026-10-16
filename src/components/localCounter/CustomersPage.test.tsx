// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CustomersPage } from './CustomersPage';
import type { CounterAccount, CounterOrderSummary } from '@/lib/localFirst/counter';
import type { OfficeCustomer } from '@/lib/localFirst/office';

const api = vi.hoisted(() => ({
  listOfficeCustomers: vi.fn(), getOfficeCustomer: vi.fn(), createOfficeCustomer: vi.fn(),
  updateOfficeCustomer: vi.fn(), deleteOfficeCustomer: vi.fn(),
}));
vi.mock('@/lib/localFirst/office', () => api);

const staff: CounterAccount = { id: 's1', fullName: 'Clerk', role: 'staff', active: true };
const admin: CounterAccount = { id: 'a1', fullName: 'Owner', role: 'admin', active: true };
const rahul: OfficeCustomer = {
  id: 'c1', customerCode: 'C-1111', name: 'Rahul Patil', phone: '9876543210', alternatePhone: '9123456789',
  address: '12 MG Road', customerType: 'student', notes: 'Prefers starch', createdAt: '2026-01-01T00:00:00Z',
  orderCount: 2, billedMinor: 123456, lastOrderAt: '2026-01-31T10:00:00.000Z', hasDiscountRule: true,
};
const priya: OfficeCustomer = {
  id: 'c2', customerCode: 'C-2222', name: 'Priya Shah', phone: '9000000001', alternatePhone: null, address: null,
  customerType: 'regular', notes: null, createdAt: '2026-01-01T00:00:00Z', orderCount: 0, billedMinor: 0, lastOrderAt: null, hasDiscountRule: false,
};
const order: CounterOrderSummary = {
  id: 'o1', orderNumber: 'LA-2026-00007', customerName: 'Rahul Patil', customerPhone: '9876543210', status: 'ready_for_pickup',
  receivedAt: '2026-01-31T10:00:00.000Z', promisedAt: null, totalMinor: 25000, paidMinor: 10000, balanceMinor: 15000, pieceCount: 3,
};

const setup = (account: CounterAccount = staff) => {
  const props = { account, onError: vi.fn(), onNotice: vi.fn(), onOpenOrder: vi.fn() };
  render(<CustomersPage {...props} />);
  return props;
};
const open = async (name: string) => { fireEvent.click(await screen.findByRole('button', { name })); return await screen.findByLabelText('Customer details'); };

beforeEach(() => {
  vi.clearAllMocks();
  api.listOfficeCustomers.mockResolvedValue([rahul, priya]);
  api.getOfficeCustomer.mockImplementation(async (id: string) => ({ customer: id === 'c1' ? rahul : priya, recentOrders: id === 'c1' ? [order] : [] }));
  api.createOfficeCustomer.mockResolvedValue({ ...priya, id: 'new' });
  api.updateOfficeCustomer.mockResolvedValue(rahul);
  api.deleteOfficeCustomer.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('CustomersPage', () => {
  it('lists customers with order count, total billed and last order', async () => {
    setup();
    const row = (await screen.findByRole('button', { name: 'Rahul Patil' })).closest('tr') as HTMLElement;
    expect(within(row).getByText('9876543210')).toBeTruthy();
    expect(within(row).getByText('2')).toBeTruthy();
    expect(within(row).getByText('₹1,234.56')).toBeTruthy();
    expect(within(row).getByText('31 Jan 2026')).toBeTruthy();
    expect(within(row).getByText('Discount')).toBeTruthy();
    const other = screen.getByRole('button', { name: 'Priya Shah' }).closest('tr') as HTMLElement;
    expect(within(other).getByText('—')).toBeTruthy();
    expect(within(other).queryByText('Discount')).toBeNull();
    expect(api.listOfficeCustomers).toHaveBeenCalledWith('', 0, 100);
  });

  it('searches as the operator types and explains empty results', async () => {
    api.listOfficeCustomers.mockImplementation(async (search: string) => (search === '' ? [rahul] : []));
    setup();
    await screen.findByRole('button', { name: 'Rahul Patil' });
    fireEvent.change(screen.getByLabelText('Search customers'), { target: { value: '  zzz ' } });
    await screen.findByText('No customer matches that search.');
    expect(api.listOfficeCustomers).toHaveBeenLastCalledWith('zzz', 0, 100);
  });

  it('explains an empty customer book', async () => {
    api.listOfficeCustomers.mockResolvedValue([]);
    setup();
    await screen.findByText(/No customers yet/);
  });

  it('tells the operator when the list was cut at one page', async () => {
    api.listOfficeCustomers.mockResolvedValue(Array.from({ length: 100 }, (_, index) => ({ ...priya, id: `x${index}`, name: `Person ${index}` })));
    setup();
    await screen.findByText(/Showing the first 100 customers/);
  });

  it('shows the customer detail and opens an order from the recent orders', async () => {
    const props = setup();
    const detail = await open('Rahul Patil');
    expect(within(detail).getByText('C-1111 · Student')).toBeTruthy();
    for (const text of ['9123456789', '12 MG Road', 'Prefers starch', '₹1,234.56']) expect(within(detail).getByText(text)).toBeTruthy();
    expect(within(detail).getByText('Ready for pickup')).toBeTruthy();
    expect(within(detail).getByText('₹150.00')).toBeTruthy();
    expect(within(detail).getByText(/automatic discount/)).toBeTruthy();
    fireEvent.click(within(detail).getByRole('button', { name: 'LA-2026-00007' }));
    expect(props.onOpenOrder).toHaveBeenCalledWith('o1');
  });

  it('shows a customer without optional details or orders', async () => {
    setup();
    const detail = await open('Priya Shah');
    expect(within(detail).getByText('No orders yet.')).toBeTruthy();
    expect(within(detail).queryByText('Alternate')).toBeNull();
    expect(within(detail).queryByText('Address')).toBeNull();
    expect(within(detail).queryByText('Notes')).toBeNull();
    expect(within(detail).queryByText(/automatic discount/)).toBeNull();
  });

  it('keeps delete controls away from staff', async () => {
    setup(staff);
    const detail = await open('Rahul Patil');
    expect(within(detail).getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryByText(/cannot be deleted/)).toBeNull();
  });

  it('adds a customer with trimmed fields and blank options left out', async () => {
    const props = setup();
    await screen.findByRole('button', { name: 'Rahul Patil' });
    fireEvent.click(screen.getByRole('button', { name: 'Add customer' }));
    const form = await screen.findByRole('form', { name: 'Add customer' });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: ' Neha Rao ' } });
    fireEvent.change(within(form).getByLabelText('Mobile number'), { target: { value: ' +91 98765 00000 ' } });
    fireEvent.change(within(form).getByLabelText('Customer type'), { target: { value: 'hostel' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save customer' }));
    await waitFor(() => expect(api.createOfficeCustomer).toHaveBeenCalledWith({
      name: 'Neha Rao', phone: '+91 98765 00000', alternatePhone: undefined, address: undefined, customerType: 'hostel', notes: undefined,
    }));
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith('Customer added.'));
    expect(screen.queryByRole('form', { name: 'Add customer' })).toBeNull();
    await waitFor(() => expect(api.getOfficeCustomer).toHaveBeenCalledWith('new'));
    expect(api.listOfficeCustomers.mock.calls.length).toBeGreaterThan(1);
  });

  it('reports a save failure and keeps the form open', async () => {
    api.createOfficeCustomer.mockRejectedValue(new Error('A customer with this name and phone number already exists.'));
    const props = setup();
    await screen.findByRole('button', { name: 'Rahul Patil' });
    fireEvent.click(screen.getByRole('button', { name: 'Add customer' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save customer' }));
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('already exists') })));
    expect(screen.getByRole('form', { name: 'Add customer' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'Add customer' })).toBeNull();
  });

  it('edits a customer and sends every field', async () => {
    const props = setup(admin);
    const detail = await open('Rahul Patil');
    fireEvent.click(within(detail).getByRole('button', { name: 'Edit' }));
    const form = await screen.findByRole('form', { name: 'Edit customer' });
    expect((within(form).getByLabelText('Name') as HTMLInputElement).disabled).toBe(false);
    fireEvent.change(within(form).getByLabelText('Address (optional)'), { target: { value: '' } });
    fireEvent.change(within(form).getByLabelText('Notes (optional)'), { target: { value: 'New note' } });
    fireEvent.change(within(form).getByLabelText('Alternate mobile (optional)'), { target: { value: '9222222222' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save customer' }));
    await waitFor(() => expect(api.updateOfficeCustomer).toHaveBeenCalledWith('c1', {
      name: 'Rahul Patil', phone: '9876543210', alternatePhone: '9222222222', address: undefined, customerType: 'student', notes: 'New note',
    }));
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith('Customer updated.'));
  });

  it('locks name and mobile for staff when the customer has a discount', async () => {
    setup(staff);
    fireEvent.click(within(await open('Rahul Patil')).getByRole('button', { name: 'Edit' }));
    const form = await screen.findByRole('form', { name: 'Edit customer' });
    expect((within(form).getByLabelText('Name') as HTMLInputElement).disabled).toBe(true);
    expect((within(form).getByLabelText('Mobile number') as HTMLInputElement).disabled).toBe(true);
    expect(within(form).getByText(/only the administrator can change the name/)).toBeTruthy();
    expect((within(form).getByLabelText('Address (optional)') as HTMLInputElement).disabled).toBe(false);
  });

  it('leaves name and mobile open for staff on a customer without a discount', async () => {
    setup(staff);
    fireEvent.click(within(await open('Priya Shah')).getByRole('button', { name: 'Edit' }));
    const form = await screen.findByRole('form', { name: 'Edit customer' });
    expect((within(form).getByLabelText('Name') as HTMLInputElement).disabled).toBe(false);
    expect(within(form).queryByText(/only the administrator/)).toBeNull();
  });

  it('lets an administrator delete with a reason', async () => {
    const props = setup(admin);
    const detail = await open('Priya Shah');
    fireEvent.click(within(detail).getByRole('button', { name: 'Delete' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Duplicate entry' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(api.deleteOfficeCustomer).toHaveBeenCalledWith('c2', 'Duplicate entry'));
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith('Customer deleted.'));
    await waitFor(() => expect(screen.queryByLabelText('Customer details')).toBeNull());
  });

  it('warns the administrator that a customer with orders cannot be deleted, and shows a refusal', async () => {
    api.deleteOfficeCustomer.mockRejectedValue(new Error('This customer has 2 order(s)'));
    const props = setup(admin);
    const detail = await open('Rahul Patil');
    expect(within(detail).getByText(/orders are never deleted/)).toBeTruthy();
    fireEvent.click(within(detail).getByRole('button', { name: 'Delete' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Cleaning up' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(props.onError).toHaveBeenCalled());
    expect(props.onNotice).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Customer details')).toBeTruthy();
  });

  it('opens the add form instead of a selected customer and back', async () => {
    setup();
    await open('Rahul Patil');
    fireEvent.click(screen.getByRole('button', { name: 'Add customer' }));
    expect(screen.queryByLabelText('Customer details')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Priya Shah' }));
    await screen.findByLabelText('Customer details');
    fireEvent.click(screen.getByRole('button', { name: 'Add customer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rahul Patil' }));
    await screen.findByLabelText('Customer details');
    expect(screen.queryByRole('form', { name: 'Add customer' })).toBeNull();
  });

  it('passes load failures to the shell', async () => {
    api.listOfficeCustomers.mockRejectedValue(new Error('db down'));
    const props = setup();
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'db down' })));
  });

  it('passes detail load failures to the shell', async () => {
    api.getOfficeCustomer.mockRejectedValue(new Error('read failed'));
    const props = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Rahul Patil' }));
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'read failed' })));
  });
});
