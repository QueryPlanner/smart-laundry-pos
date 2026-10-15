// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CounterApp } from './CounterApp';
import type { CounterAccount, CounterCatalogue, CounterOrderInput, CounterOrderSummary, CounterPiece, CounterPrintJob, CounterSavedOrder } from '@/lib/localFirst/counter';

const api = vi.hoisted(() => ({
  cancelCounterOrder: vi.fn(), collectCounterOrder: vi.fn(), createCounterStaff: vi.fn(), dispatchPrintJob: vi.fn(), dispatchPrintJobs: vi.fn(), enumeratePrinters: vi.fn(),
  getCounterBootstrap: vi.fn(), getCounterCatalogue: vi.fn(), getCounterOrder: vi.fn(), getOrderPieces: vi.fn(), getPrinterProfiles: vi.fn(),
  listCounterStaff: vi.fn(), listPrintJobs: vi.fn(), lockCounter: vi.fn(), loginCounter: vi.fn(), matchOrderPieces: vi.fn(), quoteCounterOrder: vi.fn(),
  recordCounterPayment: vi.fn(), reprintCounterOutput: vi.fn(), resetCounterStaffPin: vi.fn(), retryPrintJob: vi.fn(), saveCounterOrder: vi.fn(),
  searchCounterCustomers: vi.fn(), searchCounterOrders: vi.fn(), setCounterRate: vi.fn(), setCounterStaffActive: vi.fn(), setPrinterProfiles: vi.fn(),
  setupCounterAdmin: vi.fn(), updateCounterOrderStatus: vi.fn(),
}));
vi.mock('@/lib/localFirst/counter', () => api);

const staff: CounterAccount = { id: 'staff-1', fullName: 'Asha Patil', role: 'staff', active: true };
const admin: CounterAccount = { id: 'admin-1', fullName: 'Mira Shah', role: 'admin', active: true };
const retired: CounterAccount = { id: 'staff-2', fullName: 'Gone Away', role: 'staff', active: false };
const catalogue: CounterCatalogue = {
  services: [{ id: 'wash', key: 'wash', name: 'Wash', active: true }, { id: 'wash-iron', key: 'wash_iron', name: 'Wash + Iron', active: true }],
  garments: [{ id: 'shirt', key: 'shirt', nameEn: 'Shirt', nameMr: 'शर्ट', category: 'tops', imageKey: 'shirt', billingUnit: 'piece', active: true }],
  rates: [
    { garmentId: 'shirt', serviceId: 'wash', priceMinor: 1200, configured: true, available: true, version: 1 },
    { garmentId: 'shirt', serviceId: 'wash-iron', priceMinor: 2000, configured: true, available: true, version: 1 },
  ],
};
const job = (kind: 'bill' | 'tags', state: CounterPrintJob['state'] = 'pending', orderId = 'o-1'): CounterPrintJob => ({ id: `${kind}-job`, kind, state, printerId: null, osJobId: null, lastError: state === 'failed' ? 'Queue unavailable' : null, orderId, orderNumber: 'SL-1' });
const pieces: CounterPiece[] = [
  { id: 'p-1', shortId: '2600001-1', garmentId: 'shirt', garment: 'Shirt', service: 'Wash + Iron', position: 1, total: 2, matched: false, packingMatched: false, collectionMatched: false },
  { id: 'p-2', shortId: '2600001-2', garmentId: 'shirt', garment: 'Shirt', service: 'Wash + Iron', position: 2, total: 2, matched: false, packingMatched: false, collectionMatched: false },
];
const savedOrder = (over: Partial<CounterSavedOrder> = {}): CounterSavedOrder => ({ orderId: 'o-1', orderNumber: 'SL-1', receivedAt: '2026-10-15T06:00:00Z', promisedAt: '2026-10-17T11:30:00Z', status: 'ready', totalMinor: 4000, paidMinor: 0, balanceMinor: 4000, pieces, printJobs: [job('bill'), job('tags')], ...over });
const summary = (n: number): CounterOrderSummary => ({ id: `o-${n}`, orderNumber: `SL-${n}`, customerName: `Customer ${n}`, customerPhone: '9876543210', status: 'ready', receivedAt: '2026-10-15T06:00:00Z', promisedAt: '2026-10-17T11:30:00Z', totalMinor: 4000, paidMinor: 0, balanceMinor: 4000, pieceCount: 2 });
const quoteFor = (input: CounterOrderInput, total?: number) => {
  const pieceCount = input.items.reduce((n, x) => n + x.quantity, 0);
  const subtotal = 2000 * pieceCount;
  return { lines: input.items.map(x => ({ garmentId: x.garmentId, serviceId: x.serviceId, garment: 'Shirt', service: 'Wash + Iron', quantity: x.quantity, unitPriceMinor: 2000, lineTotalMinor: 2000 * x.quantity, rateVersion: 1 })), subtotalMinor: subtotal, discountPercentBp: 0, discountMinor: 0, totalMinor: total ?? subtotal, pieceCount, promisedAt: '2026-10-17T11:30:00.000Z', catalogueVersion: '2' };
};
const unauthenticated = (extra: Record<string, unknown> = {}) => ({ setupRequired: false, authenticated: false, account: null, accounts: [staff, admin, retired], warning: null, ...extra });

const mount = () => { render(<CounterApp />); };
const signIn = async (account: CounterAccount = staff) => {
  api.getCounterBootstrap.mockResolvedValue(unauthenticated());
  api.loginCounter.mockResolvedValue(account);
  mount();
  await screen.findByText('Choose your name and enter your PIN.');
  if (account.role === 'admin') fireEvent.click(screen.getByRole('button', { name: 'Admin' }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: account.id } });
  fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '1234' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByText('Choose service');
};
const nav = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const openOrdersAndFirstOrder = async (results = [summary(1)]) => {
  api.searchCounterOrders.mockResolvedValue(results);
  nav('Orders / Pickup');
  await screen.findByText(results[0].orderNumber);
  fireEvent.click(screen.getAllByRole('button', { name: 'Open order' })[0]);
  await screen.findByText(`${results[0].orderNumber} · Order details`);
};
const startOrder = async () => {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Rita Joshi' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add Shirt' }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Save & Print' }) as HTMLButtonElement).disabled).toBe(false));
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getCounterCatalogue.mockResolvedValue(catalogue);
  api.quoteCounterOrder.mockImplementation(async (input: CounterOrderInput) => quoteFor(input));
  api.searchCounterCustomers.mockResolvedValue([]);
  api.searchCounterOrders.mockResolvedValue([]);
  api.listPrintJobs.mockResolvedValue([]);
  api.lockCounter.mockResolvedValue(undefined);
  api.saveCounterOrder.mockResolvedValue(savedOrder({ status: 'received', paidMinor: 2000, balanceMinor: 0, totalMinor: 2000 }));
  api.dispatchPrintJobs.mockResolvedValue([job('bill', 'submitted'), job('tags', 'submitted')]);
  api.dispatchPrintJob.mockResolvedValue(job('tags', 'submitted'));
  api.retryPrintJob.mockResolvedValue(job('tags', 'submitted'));
  api.getOrderPieces.mockResolvedValue(pieces);
  api.getCounterOrder.mockResolvedValue(savedOrder());
  api.updateCounterOrderStatus.mockImplementation(async (_id: string, status: string) => savedOrder({ status }));
  api.recordCounterPayment.mockImplementation(async (_id: string, input: { amountMinor: number }) => savedOrder({ paidMinor: input.amountMinor, balanceMinor: 4000 - input.amountMinor }));
  api.matchOrderPieces.mockResolvedValue({ matchedCount: 2, expectedCount: 2, missingIds: [], duplicateIds: [], wrongOrderIds: [], complete: true });
  api.collectCounterOrder.mockResolvedValue(savedOrder({ status: 'collected' }));
  api.enumeratePrinters.mockResolvedValue([]);
  api.getPrinterProfiles.mockResolvedValue(null);
});
afterEach(cleanup);

describe('first run and sign-in', () => {
  const fillSetup = (name: string, pin: string, confirm: string) => {
    fireEvent.change(screen.getByLabelText('Admin name'), { target: { value: name } });
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: pin } });
    fireEvent.change(screen.getByLabelText('Confirm PIN'), { target: { value: confirm } });
    fireEvent.click(screen.getByRole('button', { name: 'Create admin account' }));
  };

  it('creates the first administrator after checking the PIN twice, then opens the counter', async () => {
    api.getCounterBootstrap.mockResolvedValueOnce(unauthenticated({ setupRequired: true, accounts: [] }));
    api.setupCounterAdmin.mockResolvedValue(admin);
    mount();
    await screen.findByText('Set up Smart Laundry');
    fillSetup('Mira Shah', '2468', '2469');
    expect((await screen.findByRole('alert')).textContent).toBe('PINs do not match.');
    expect(api.setupCounterAdmin).not.toHaveBeenCalled();
    api.getCounterBootstrap.mockResolvedValue({ setupRequired: false, authenticated: true, account: admin, accounts: [admin], warning: 'Automatic startup backup failed: disk full' });
    fillSetup('Mira Shah', '2468', '2468');
    await waitFor(() => expect(api.setupCounterAdmin).toHaveBeenCalledWith({ fullName: 'Mira Shah', pin: '2468' }));
    await screen.findByText('Choose service');
    expect(screen.getByText('Automatic startup backup failed: disk full')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Admin' })).toBeTruthy();
  });

  it('shows why the administrator could not be created and stays on the setup screen', async () => {
    api.getCounterBootstrap.mockResolvedValue(unauthenticated({ setupRequired: true, accounts: [] }));
    api.setupCounterAdmin.mockRejectedValue(new Error('PIN must contain 4 to 8 digits.'));
    mount();
    await screen.findByText('Set up Smart Laundry');
    fillSetup('Mira Shah', '12', '12');
    expect((await screen.findByRole('alert')).textContent).toBe('PIN must contain 4 to 8 digits.');
    expect(screen.getByText('Set up Smart Laundry')).toBeTruthy();
  });

  it('opens straight into the counter when an administrator is already signed in, and without a warning', async () => {
    api.getCounterBootstrap.mockResolvedValue({ setupRequired: false, authenticated: true, account: staff, accounts: [staff], warning: null });
    mount();
    await screen.findByText('Choose service');
    expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull();
  });

  it('lists only active people for the chosen role, refreshes the list, and explains a rejected PIN', async () => {
    api.getCounterBootstrap.mockResolvedValue(unauthenticated());
    api.loginCounter.mockRejectedValue(new Error('Incorrect name or PIN.'));
    mount();
    await screen.findByText('Choose your name and enter your PIN.');
    expect(screen.getByRole('option', { name: 'Asha Patil' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Gone Away' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Mira Shah' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Admin' }));
    expect(screen.getByRole('option', { name: 'Mira Shah' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Asha Patil' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Staff login' }));
    expect(screen.getByRole('option', { name: 'Asha Patil' })).toBeTruthy();
    const loads = api.getCounterBootstrap.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh account list' }));
    await waitFor(() => expect(api.getCounterBootstrap.mock.calls.length).toBe(loads + 1));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'staff-1' } });
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '0000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Incorrect name or PIN.');
    expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not try to sign in until a name is chosen, and words unknown failures sensibly', async () => {
    api.getCounterBootstrap.mockResolvedValue(unauthenticated());
    mount();
    await screen.findByText('Choose your name and enter your PIN.');
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '1234' } });
    expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!);
    expect(api.loginCounter).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'staff-1' } });
    for (const [rejection, expected] of [['plain text failure', 'plain text failure'], [undefined, 'Something went wrong.']] as const) {
      api.loginCounter.mockRejectedValueOnce(rejection);
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
      await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(expected));
    }
  });

  it('locks back to the sign-in screen and forgets the draft order', async () => {
    await signIn();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Rita Joshi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Shirt' }));
    api.getCounterBootstrap.mockResolvedValue(unauthenticated());
    fireEvent.click(screen.getByRole('button', { name: /Lock/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard order' }));
    await screen.findByText('Choose your name and enter your PIN.');
    expect(api.lockCounter).toHaveBeenCalledOnce();
    api.loginCounter.mockResolvedValue(staff);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'staff-1' } });
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('Choose service');
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('');
    expect(screen.getByText('Tap garment pictures to add items.')).toBeTruthy();
  });
});

describe('taking and saving an order', () => {
  it('removes the whole line with the bin button, however many were added', async () => {
    await signIn();
    await startOrder();
    fireEvent.change(screen.getByLabelText('Shirt quantity'), { target: { value: '3' } });
    await waitFor(() => expect((screen.getByLabelText('Shirt summary quantity') as HTMLInputElement).value).toBe('3'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Shirt' }));
    await screen.findByText('Tap garment pictures to add items.');
    expect((screen.getByLabelText('Shirt quantity') as HTMLInputElement).value).toBe('0');
  });

  it('keeps the same request key after a failed save so a retry cannot create a second order', async () => {
    await signIn();
    await startOrder();
    api.saveCounterOrder.mockRejectedValueOnce(new Error('database is busy'));
    fireEvent.click(screen.getByRole('button', { name: 'Save & Print' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Order save did not complete: database is busy');
    fireEvent.click(screen.getByRole('button', { name: 'Save & Print' }));
    await screen.findByText(/Order SL-1 saved/);
    const keys = api.saveCounterOrder.mock.calls.map(call => call[0].idempotencyKey);
    expect(keys.length).toBe(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('says the order is saved when only printing could not start', async () => {
    await signIn();
    await startOrder();
    api.dispatchPrintJobs.mockRejectedValueOnce(new Error('Configure both bill and tag printers in Admin settings.'));
    fireEvent.click(screen.getByRole('button', { name: 'Save & Print' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Order SL-1 is saved, but print dispatch failed');
    expect(alert.textContent).toContain('Configure both bill and tag printers');
    expect(screen.getAllByText('Waiting to print').length).toBe(2);
  });

  it('collects the full discounted amount and sends no payment when nothing is due', async () => {
    await signIn();
    api.quoteCounterOrder.mockImplementation(async (input: CounterOrderInput) => quoteFor(input, 1800));
    await startOrder();
    fireEvent.change(screen.getByLabelText('Paid by'), { target: { value: 'upi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & Print' }));
    await waitFor(() => expect(api.saveCounterOrder).toHaveBeenCalledWith(expect.objectContaining({ payment: { amountMinor: 1800, method: 'upi' } })));
    cleanup();
    vi.clearAllMocks();
    api.getCounterCatalogue.mockResolvedValue(catalogue);
    api.searchCounterCustomers.mockResolvedValue([]);
    api.listPrintJobs.mockResolvedValue([]);
    api.dispatchPrintJobs.mockResolvedValue([]);
    api.saveCounterOrder.mockResolvedValue(savedOrder({ totalMinor: 0, paidMinor: 0, balanceMinor: 0 }));
    api.quoteCounterOrder.mockImplementation(async (input: CounterOrderInput) => quoteFor(input, 0));
    await signIn();
    await startOrder();
    fireEvent.click(screen.getByRole('button', { name: 'Save & Print' }));
    await waitFor(() => expect(api.saveCounterOrder).toHaveBeenCalledTimes(1));
    expect(api.saveCounterOrder.mock.calls[0][0].payment).toBeUndefined();
  });

  it('shows a quote problem instead of an amount, and recovers when the draft changes', async () => {
    await signIn();
    api.quoteCounterOrder.mockRejectedValueOnce(new Error('A rate has not been configured for this garment and service.'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Rita Joshi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Shirt' }));
    expect((await screen.findByRole('alert')).textContent).toContain('rate has not been configured');
    expect((screen.getByRole('button', { name: 'Save & Print' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Add Shirt' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save & Print' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('small order-screen behaviours', () => {
  it('removes a line when its quantity is typed as zero', async () => {
    await signIn();
    await startOrder();
    fireEvent.change(screen.getByLabelText('Shirt quantity'), { target: { value: '3' } });
    await waitFor(() => expect(api.quoteCounterOrder).toHaveBeenLastCalledWith(expect.objectContaining({ items: [expect.objectContaining({ quantity: 3 })] })));
    fireEvent.change(screen.getByLabelText('Shirt quantity'), { target: { value: '0' } });
    await screen.findByText('Tap garment pictures to add items.');
  });

  it('starts on the first service when Wash + Iron is not offered', async () => {
    api.getCounterCatalogue.mockResolvedValue({ ...catalogue, services: [catalogue.services[0]] });
    await signIn();
    expect(screen.getByRole('tab', { name: 'Wash' }).getAttribute('aria-selected')).toBe('true');
  });

  it('shows an empty name list rather than failing if the account list is missing', async () => {
    api.getCounterBootstrap.mockResolvedValue({ setupRequired: false, authenticated: false, account: null, warning: null });
    mount();
    await screen.findByText('Choose your name and enter your PIN.');
    expect(screen.queryByRole('option', { name: 'Asha Patil' })).toBeNull();
  });

  it('opens the counter after first-run setup even when no startup warning exists', async () => {
    api.getCounterBootstrap.mockResolvedValueOnce(unauthenticated({ setupRequired: true, accounts: [] }));
    api.setupCounterAdmin.mockResolvedValue(admin);
    api.getCounterBootstrap.mockResolvedValue({ setupRequired: false, authenticated: true, account: admin, accounts: [admin] });
    mount();
    await screen.findByText('Set up Smart Laundry');
    fireEvent.change(screen.getByLabelText('Admin name'), { target: { value: 'Mira Shah' } });
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '2468' } });
    fireEvent.change(screen.getByLabelText('Confirm PIN'), { target: { value: '2468' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create admin account' }));
    await screen.findByText('Choose service');
  });

  it('reaches the print progress of the order just saved from the navigation bar', async () => {
    await signIn();
    await startOrder();
    fireEvent.click(screen.getByRole('button', { name: 'Save & Print' }));
    await screen.findByText(/Order SL-1 saved/);
    nav('New order');
    nav('Orders / Pickup');
    api.searchCounterOrders.mockResolvedValue([summary(1)]);
    fireEvent.click(await screen.findByRole('button', { name: 'Open order' }));
    await screen.findByText('SL-1 · Order details');
    nav('Print progress');
    await screen.findByText('SL-1 · Print progress');
  });
});

describe('finding orders and pickup', () => {
  it('searches by what is typed and pages through long result lists', async () => {
    await signIn();
    const first = Array.from({ length: 50 }, (_, i) => summary(i + 1));
    api.searchCounterOrders.mockResolvedValue(first);
    nav('Orders / Pickup');
    await screen.findByText('SL-50');
    fireEvent.change(screen.getByLabelText(/Search bill number/), { target: { value: '98765' } });
    await waitFor(() => expect(api.searchCounterOrders).toHaveBeenCalledWith('98765', 0, 50));
    api.searchCounterOrders.mockResolvedValue([summary(51)]);
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    await screen.findByText('SL-51');
    expect(api.searchCounterOrders).toHaveBeenLastCalledWith('98765', 50, 50);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    expect(screen.getByText('SL-1')).toBeTruthy();
  });

  it('keeps the list and reports an error when loading more fails, and when searching fails', async () => {
    await signIn();
    api.searchCounterOrders.mockResolvedValue(Array.from({ length: 50 }, (_, i) => summary(i + 1)));
    nav('Orders / Pickup');
    await screen.findByText('SL-50');
    api.searchCounterOrders.mockRejectedValueOnce(new Error('search failed'));
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect((await screen.findByRole('alert')).textContent).toBe('search failed');
    expect(screen.getByText('SL-1')).toBeTruthy();
    api.searchCounterOrders.mockRejectedValueOnce(new Error('typing search failed'));
    fireEvent.change(screen.getByLabelText(/Search bill number/), { target: { value: 'zzz' } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('typing search failed'));
  });

  it('says so when nothing matches', async () => {
    await signIn();
    nav('Orders / Pickup');
    await screen.findByText('No matching saved orders.');
  });

  it('explains an order that has gone missing', async () => {
    await signIn();
    api.getCounterOrder.mockResolvedValue(null);
    api.searchCounterOrders.mockResolvedValue([summary(1)]);
    nav('Orders / Pickup');
    await screen.findByText('SL-1');
    fireEvent.click(screen.getByRole('button', { name: 'Open order' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This order is no longer available.');
  });

  it('moves an order through processing steps and shows a refused step', async () => {
    await signIn();
    await openOrdersAndFirstOrder();
    const status = screen.getByLabelText('Processing status') as HTMLSelectElement;
    expect((within(status).getByRole('option', { name: 'Received' }) as HTMLOptionElement).disabled).toBe(true);
    expect((within(status).getByRole('option', { name: /Collected/ }) as HTMLOptionElement).disabled).toBe(true);
    fireEvent.change(status, { target: { value: 'ironing' } });
    await screen.findByText('Order SL-1 moved to ironing.');
    api.updateCounterOrderStatus.mockRejectedValueOnce(new Error('Order cannot move from ironing to washing.'));
    fireEvent.change(status, { target: { value: 'washing' } });
    expect((await screen.findByRole('alert')).textContent).toBe('Order cannot move from ironing to washing.');
  });

  it('records a later payment on an old order, with every input checked', async () => {
    await signIn();
    await openOrdersAndFirstOrder();
    const record = () => fireEvent.click(screen.getByRole('button', { name: 'Save payment' }));
    record();
    expect((await screen.findByRole('alert')).textContent).toContain('greater than zero');
    fireEvent.change(screen.getByLabelText('Amount received'), { target: { value: '9999' } });
    record();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('cannot exceed the remaining balance'));
    fireEvent.change(screen.getByLabelText('Amount received'), { target: { value: '19.99' } });
    fireEvent.change(screen.getByLabelText('Method'), { target: { value: 'upi' } });
    fireEvent.change(screen.getByLabelText(/Reference/), { target: { value: ' UTR 42 ' } });
    api.recordCounterPayment.mockRejectedValueOnce(new Error('Payment cannot exceed the outstanding balance.'));
    record();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Payment cannot exceed the outstanding balance.'));
    const firstKey = api.recordCounterPayment.mock.calls[0][1].idempotencyKey;
    record();
    await screen.findByText('Payment saved to this order.');
    expect(api.recordCounterPayment).toHaveBeenLastCalledWith('o-1', expect.objectContaining({ amountMinor: 1999, method: 'upi', reference: 'UTR 42', idempotencyKey: firstKey }));
    expect((screen.getByLabelText('Amount received') as HTMLInputElement).value).toBe('');
  });

  it('goes from the order to its packing checklist and to its print progress', async () => {
    await signIn();
    await openOrdersAndFirstOrder();
    fireEvent.click(screen.getByRole('button', { name: 'Packing checklist' }));
    await screen.findByText(/Check the physical pieces as they are packed/);
    nav('Orders / Pickup');
    fireEvent.click(screen.getAllByRole('button', { name: 'Open order' })[0]);
    await screen.findByText('SL-1 · Order details');
    fireEvent.click(screen.getByRole('button', { name: 'Print progress / reprints' }));
    await screen.findByText('SL-1 · Print progress');
  });
});

describe('packing and pickup checks', () => {
  const goToChecklist = async (stage: 'Packing checklist' | 'Verify pickup collection') => {
    await signIn();
    await openOrdersAndFirstOrder();
    fireEvent.click(screen.getByRole('button', { name: stage }));
    await screen.findByText(stage === 'Packing checklist' ? /Check the physical pieces as they are packed/ : /Check each printed piece ID with the customer/);
  };

  it('lets a piece be unchecked again and says how many are still missing', async () => {
    await goToChecklist('Packing checklist');
    const boxes = screen.getAllByRole('checkbox');
    fireEvent.click(boxes[0]); fireEvent.click(boxes[1]); fireEvent.click(boxes[1]);
    api.matchOrderPieces.mockResolvedValue({ matchedCount: 1, expectedCount: 2, missingIds: ['2600001-2'], duplicateIds: [], wrongOrderIds: [], complete: false });
    fireEvent.click(screen.getByRole('button', { name: 'Save packing checklist' }));
    await screen.findByText('1 of 2 pieces checked for packing. Missing pieces must be checked.');
    expect(api.matchOrderPieces).toHaveBeenCalledWith('o-1', 'packing', ['p-1']);
  });

  it('keeps the pickup button off until every piece is ticked, then collects once', async () => {
    await goToChecklist('Verify pickup collection');
    const submit = screen.getByRole('button', { name: 'Verify and complete collection' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await screen.findByText('All pieces collected.');
    expect(api.collectCounterOrder).toHaveBeenCalledWith('o-1', ['p-1', 'p-2'], expect.any(String));
  });

  it('reports a rejected pickup check without marking anything collected', async () => {
    await goToChecklist('Verify pickup collection');
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
    api.matchOrderPieces.mockRejectedValueOnce(new Error('A restore is staged. Close and reopen the app before writing.'));
    fireEvent.click(screen.getByRole('button', { name: 'Verify and complete collection' }));
    expect((await screen.findByRole('alert')).textContent).toContain('restore is staged');
    expect(api.collectCounterOrder).not.toHaveBeenCalled();
    expect(screen.queryByText('All pieces collected.')).toBeNull();
  });

  it('shows what is still outstanding when a complete-looking pickup is refused natively', async () => {
    await goToChecklist('Verify pickup collection');
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
    api.collectCounterOrder.mockRejectedValueOnce(new Error('This order still has ₹40.00 to pay.'));
    fireEvent.click(screen.getByRole('button', { name: 'Verify and complete collection' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This order still has ₹40.00 to pay.');
  });

  it('reports a failure to load the pieces when opening the checklist', async () => {
    await signIn();
    await openOrdersAndFirstOrder();
    api.getOrderPieces.mockRejectedValueOnce(new Error('pieces unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Packing checklist' }));
    expect((await screen.findByRole('alert')).textContent).toBe('pieces unavailable');
    expect(screen.queryByText(/Check the physical pieces as they are packed/)).toBeNull();
  });
});

describe('print queue and recovery', () => {
  it('explains an empty queue and refreshes it', async () => {
    await signIn();
    nav('Print queue');
    await screen.findByText('No saved print jobs.');
    api.listPrintJobs.mockResolvedValue([job('bill', 'submitted')]);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh queue' }));
    await screen.findByText('SL-1 · Canon bill');
  });

  it('opens the order behind a job, resumes a pending job and retries a failed one', async () => {
    await signIn();
    api.listPrintJobs.mockResolvedValue([job('bill', 'pending'), job('tags', 'failed')]);
    nav('Print queue');
    await screen.findByText('Queue unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Resume this job' }));
    await waitFor(() => expect(api.dispatchPrintJob).toHaveBeenCalledWith('bill-job'));
    fireEvent.click(screen.getByRole('button', { name: 'Retry this job' }));
    await waitFor(() => expect(api.retryPrintJob).toHaveBeenCalledWith('tags-job', false));
    fireEvent.click(screen.getAllByRole('button', { name: 'Open order' })[0]);
    await screen.findByText('SL-1 · Order details');
  });

  it('needs a second, explicit step before an uncertain job can be sent again, and can be cancelled', async () => {
    await signIn();
    api.listPrintJobs.mockResolvedValue([job('tags', 'uncertain')]);
    nav('Print queue');
    fireEvent.click(await screen.findByRole('button', { name: 'Review uncertain job' }));
    expect(api.retryPrintJob).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Review uncertain job' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review uncertain job' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reprint' }));
    await waitFor(() => expect(api.retryPrintJob).toHaveBeenCalledWith('tags-job', true));
  });

  it('reports resume and retry failures from the queue', async () => {
    await signIn();
    api.listPrintJobs.mockResolvedValue([job('bill', 'pending'), job('tags', 'failed')]);
    nav('Print queue');
    await screen.findByText('Queue unavailable');
    api.dispatchPrintJob.mockRejectedValueOnce(new Error('printer offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Resume this job' }));
    expect((await screen.findByRole('alert')).textContent).toBe('printer offline');
    api.retryPrintJob.mockRejectedValueOnce(new Error('retry refused'));
    fireEvent.click(screen.getByRole('button', { name: 'Retry this job' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('retry refused'));
  });

  it('names the failed output when offering a retry on the order page', async () => {
    await signIn();
    api.getCounterOrder.mockResolvedValue(savedOrder({ printJobs: [job('bill', 'failed'), job('tags', 'failed')] }));
    api.listPrintJobs.mockResolvedValue([job('bill', 'failed'), job('tags', 'failed')]);
    await openOrdersAndFirstOrder();
    fireEvent.click(screen.getByRole('button', { name: 'Print progress / reprints' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry bill' }));
    await waitFor(() => expect(api.retryPrintJob).toHaveBeenCalledWith('bill-job', false));
    fireEvent.click(screen.getByRole('button', { name: 'Retry tags' }));
    await waitFor(() => expect(api.retryPrintJob).toHaveBeenCalledWith('tags-job', false));
  });

  it('shows per-order progress with resume, retry and a cancellable uncertain confirmation', async () => {
    await signIn();
    api.getCounterOrder.mockResolvedValue(savedOrder({ printJobs: [job('bill', 'pending'), job('tags', 'uncertain')] }));
    api.listPrintJobs.mockResolvedValue([job('bill', 'pending'), job('tags', 'uncertain')]);
    await openOrdersAndFirstOrder();
    fireEvent.click(screen.getByRole('button', { name: 'Print progress / reprints' }));
    await screen.findByText('SL-1 · Print progress');
    fireEvent.click(screen.getByRole('button', { name: 'Resume bill' }));
    await waitFor(() => expect(api.dispatchPrintJob).toHaveBeenCalledWith('bill-job'));
    fireEvent.click(screen.getByRole('button', { name: 'Review uncertain tags job' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Review uncertain tags job' })).toBeTruthy();
  });

  it('reprints selected tags and a bill, and reports a reprint that could not be queued', async () => {
    await signIn();
    await openOrdersAndFirstOrder();
    fireEvent.click(screen.getByRole('button', { name: 'Print progress / reprints' }));
    await screen.findByText('SL-1 · Print progress');
    const first = screen.getByRole('checkbox', { name: /2600001-1/ });
    fireEvent.click(first);
    fireEvent.click(first);
    expect((screen.getByRole('button', { name: 'Reprint selected tags (0)' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /2600001-2/ }));
    api.reprintCounterOutput.mockRejectedValueOnce(new Error('database is busy'));
    fireEvent.click(screen.getByRole('button', { name: 'Reprint selected tags (1)' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Retry this same selection to safely resume: database is busy');
    api.reprintCounterOutput.mockResolvedValue(job('tags'));
    fireEvent.click(screen.getByRole('button', { name: 'Reprint selected tags (1)' }));
    await screen.findByText('1 selected garment tag(s) were added to the TSC queue.');
    const keys = api.reprintCounterOutput.mock.calls.map(call => call[3]);
    expect(keys[0]).toBe(keys[1]);
    api.reprintCounterOutput.mockResolvedValue(job('bill'));
    fireEvent.click(screen.getByRole('button', { name: 'Reprint customer bill' }));
    await screen.findByText('A bill reprint was added to the Canon queue.');
  });
});

describe('failures in small actions are always shown, never swallowed', () => {
  it('shows a message if the queue cannot be reloaded', async () => {
    await signIn();
    api.listPrintJobs.mockRejectedValue(new Error('queue unreadable'));
    nav('Print queue');
    expect((await screen.findByRole('alert')).textContent).toBe('queue unreadable');
  });

  it('stays signed in and says so if locking fails', async () => {
    await signIn();
    api.lockCounter.mockRejectedValue(new Error('session store unavailable'));
    fireEvent.click(screen.getByRole('button', { name: /Lock/ }));
    expect((await screen.findByRole('alert')).textContent).toBe('The counter could not be locked: session store unavailable');
    expect(screen.getByText('Choose service')).toBeTruthy();
  });

  it('shows a message if the account list cannot be refreshed', async () => {
    api.getCounterBootstrap.mockResolvedValueOnce(unauthenticated());
    mount();
    await screen.findByText('Choose your name and enter your PIN.');
    api.getCounterBootstrap.mockRejectedValueOnce(new Error('accounts unreadable'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh account list' }));
    expect((await screen.findByRole('alert')).textContent).toBe('accounts unreadable');
  });

  it('shows a message if the printer list cannot be reloaded', async () => {
    await signIn(admin);
    nav('Admin');
    await screen.findByText('Rates, staff & printers');
    fireEvent.click(screen.getByRole('button', { name: 'Printers' }));
    await waitFor(() => expect(api.getPrinterProfiles).toHaveBeenCalled());
    api.enumeratePrinters.mockRejectedValue(new Error('print system down'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh printer list' }));
    await waitFor(() => expect(screen.getAllByRole('alert').some(a => a.textContent === 'print system down')).toBe(true));
  });
});

describe('administrator entry points', () => {
  it('reloads the printer list for the administrator only', async () => {
    await signIn(admin);
    api.enumeratePrinters.mockResolvedValue([{ id: 'Canon', name: 'Canon', isDefault: false, isAvailable: true }]);
    nav('Admin');
    await screen.findByText('Rates, staff & printers');
    fireEvent.click(screen.getByRole('button', { name: 'Printers' }));
    await waitFor(() => expect(api.getPrinterProfiles).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Refresh printer list' }));
    await waitFor(() => expect(api.enumeratePrinters.mock.calls.length).toBeGreaterThan(1));
  });

  it('reports an admin-panel error in the counter banner', async () => {
    await signIn(admin);
    nav('Admin');
    await screen.findByText('Rates, staff & printers');
    api.listCounterStaff.mockRejectedValue(new Error('staff list failed'));
    fireEvent.click(screen.getByRole('button', { name: 'Staff' }));
    expect((await screen.findByRole('alert')).textContent).toBe('staff list failed');
    fireEvent.click(screen.getByRole('button', { name: 'Rate card' }));
    api.setCounterRate.mockResolvedValue(undefined);
    fireEvent.change(screen.getByLabelText('Shirt Wash price'), { target: { value: '13' } });
    fireEvent.click(within(screen.getByLabelText('Shirt Wash price').closest('.counter-rate-row') as HTMLElement).getByRole('button', { name: 'Save' }));
    await screen.findByText('Rate updated for future orders.');
  });
});

const dialog = () => screen.queryByRole('alertdialog');
const SAVED_BUT_QUIET = 'This order may already be saved. Check Orders / Pickup for the bill before saving again.';
const saveAndWaitForPrints = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Save & Print' }));
  await screen.findByText(/Order SL-1 saved/);
};

describe('protecting an order that is being taken', () => {
  it('does nothing when New order is tapped while already taking an order', async () => {
    await signIn();
    await startOrder();
    nav('New order');
    expect(dialog()).toBeNull();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Rita Joshi');
    expect((screen.getByLabelText('Shirt quantity') as HTMLInputElement).value).toBe('1');
  });

  it('asks before leaving the order page throws the draft away, and can keep or discard it', async () => {
    await signIn();
    await startOrder();
    nav('Orders / Pickup');
    expect(dialog()?.textContent).toContain('You have an unsaved order. Discard it?');
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(dialog()).toBeNull();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Rita Joshi');
    nav('Print queue');
    fireEvent.click(screen.getByRole('button', { name: 'Discard order' }));
    expect(dialog()).toBeNull();
    expect(screen.queryByLabelText('Mobile number')).toBeNull();
    nav('New order');
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('');
    expect(screen.getByText('Tap garment pictures to add items.')).toBeTruthy();
  });

  it('counts a typed mobile number or a lone garment as an order in progress', async () => {
    await signIn();
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '9876543210' } });
    nav('Print queue');
    expect(dialog()).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Discard order' }));
    nav('New order');
    fireEvent.click(screen.getByRole('button', { name: 'Add Shirt' }));
    nav('Print queue');
    expect(dialog()).not.toBeNull();
  });

  it('goes straight to a blank order from another page when nothing was started', async () => {
    await signIn();
    nav('Orders / Pickup');
    nav('New order');
    expect(dialog()).toBeNull();
    await screen.findByText('Choose service');
  });

  it('asks before Lock discards the draft, and locks at once when there is none', async () => {
    await signIn();
    await startOrder();
    fireEvent.click(screen.getByRole('button', { name: /Lock/ }));
    expect(dialog()).not.toBeNull();
    expect(api.lockCounter).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(api.lockCounter).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Rita Joshi');
    cleanup();
    vi.clearAllMocks();
    api.getCounterCatalogue.mockResolvedValue(catalogue);
    api.listPrintJobs.mockResolvedValue([]);
    api.lockCounter.mockResolvedValue(undefined);
    await signIn();
    api.getCounterBootstrap.mockResolvedValue(unauthenticated());
    fireEvent.click(screen.getByRole('button', { name: /Lock/ }));
    await screen.findByText('Choose your name and enter your PIN.');
    expect(api.lockCounter).toHaveBeenCalledOnce();
  });

  it('keeps the draft when locking fails after it was confirmed', async () => {
    await signIn();
    await startOrder();
    api.lockCounter.mockRejectedValue(new Error('session store unavailable'));
    fireEvent.click(screen.getByRole('button', { name: /Lock/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard order' }));
    expect((await screen.findByRole('alert')).textContent).toContain('could not be locked');
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Rita Joshi');
  });

  it('locks the whole order-entry area while a save is in flight, so nothing typed is silently lost', async () => {
    await signIn();
    await startOrder();
    let finish: (order: CounterSavedOrder) => void = () => undefined;
    api.saveCounterOrder.mockReturnValue(new Promise<CounterSavedOrder>(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Save & Print' }));
    await waitFor(() => expect(screen.getByLabelText('Name').closest('fieldset')!.disabled).toBe(true));
    for (const control of [screen.getByLabelText('Name'), screen.getByLabelText('Mobile number'), screen.getByRole('tab', { name: 'Wash' }), screen.getByRole('button', { name: 'Add Shirt' }), screen.getByLabelText('Shirt summary quantity'), screen.getByRole('button', { name: 'Remove Shirt' })]) {
      expect(control.matches(':disabled'), control.outerHTML).toBe(true);
    }
    finish(savedOrder({ status: 'received', paidMinor: 2000, balanceMinor: 0, totalMinor: 2000 }));
    await screen.findByText(/Order SL-1 saved/);
  });
});

describe('saving failures that need a clear next step', () => {
  it('says the order may already be saved when the key was used for a different draft, and keeps the key', async () => {
    await signIn();
    await startOrder();
    api.saveCounterOrder.mockRejectedValueOnce(new Error('This request key was already used for a different order draft.'));
    fireEvent.click(screen.getByRole('button', { name: 'Save & Print' }));
    expect((await screen.findByRole('alert')).textContent).toBe(SAVED_BUT_QUIET);
    fireEvent.click(screen.getByRole('button', { name: 'Save & Print' }));
    await screen.findByText(/Order SL-1 saved/);
    const keys = api.saveCounterOrder.mock.calls.map(call => call[0].idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
  });

  it('fetches a fresh quote when rates or the promised time changed, keeps the explanation, and then saves', async () => {
    await signIn();
    let quoteCalls = 0;
    api.quoteCounterOrder.mockImplementation(async (input: CounterOrderInput) => quoteFor(input, ++quoteCalls === 1 ? 2000 : 2400));
    await startOrder();
    expect(screen.getByText('Amount to collect').nextSibling?.textContent).toBe('₹20.00');
    api.saveCounterOrder.mockRejectedValueOnce('Rates or the promised time changed. Review the refreshed quote before saving.');
    fireEvent.click(screen.getByRole('button', { name: 'Save & Print' }));
    await waitFor(() => expect(screen.getByText('Amount to collect').nextSibling?.textContent).toBe('₹24.00'));
    expect(quoteCalls).toBe(2);
    expect(screen.getByRole('alert').textContent).toBe('Rates or the promised time changed. Review the refreshed quote before saving.');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save & Print' }) as HTMLButtonElement).disabled).toBe(false));
    await saveAndWaitForPrints();
    expect(api.saveCounterOrder.mock.calls[1][0].reviewedQuote.totalMinor).toBe(2400);
    expect(api.saveCounterOrder.mock.calls[1][0].payment.amountMinor).toBe(2400);
  });

  it('keeps a save error visible when the quote itself is fine, and shows quote and save problems separately', async () => {
    await signIn();
    await startOrder();
    api.saveCounterOrder.mockRejectedValueOnce(new Error('database is busy'));
    fireEvent.click(screen.getByRole('button', { name: 'Save & Print' }));
    await screen.findByText(/Order save did not complete: database is busy/);
    api.quoteCounterOrder.mockRejectedValueOnce(new Error('A rate has not been configured for this garment and service.'));
    fireEvent.click(screen.getByRole('button', { name: 'Add Shirt' }));
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBe(2));
    expect(screen.getByText('The price could not be worked out. See the message above.')).toBeTruthy();
  });
});

describe('quotes that arrive late', () => {
  it('ignores the price of an earlier draft that comes back after the draft changed', async () => {
    await signIn();
    let late: (quote: ReturnType<typeof quoteFor>) => void = () => undefined;
    api.quoteCounterOrder.mockReturnValueOnce(new Promise(resolve => { late = resolve; }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Rita Joshi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Shirt' }));
    await waitFor(() => expect(api.quoteCounterOrder).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Add Shirt' }));
    await waitFor(() => expect(screen.getByText('Amount to collect').nextSibling?.textContent).toBe('₹40.00'));
    late(quoteFor({ customer: { name: 'Rita Joshi', phone: '' }, items: [{ garmentId: 'shirt', serviceId: 'wash-iron', quantity: 1 }] }));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(screen.getByText('Amount to collect').nextSibling?.textContent).toBe('₹40.00');
  });
});

describe('the Orders / Pickup page', () => {
  it('lists recent orders as soon as it opens, asking the native side for the empty query', async () => {
    await signIn();
    api.searchCounterOrders.mockResolvedValue([summary(1), summary(2)]);
    nav('Orders / Pickup');
    await screen.findByText('SL-2');
    expect(api.searchCounterOrders).toHaveBeenCalledWith('', 0, 50);
    expect(screen.queryByText('No matching saved orders.')).toBeNull();
  });

  it('does not claim "No matching saved orders" before the first search has come back', async () => {
    await signIn();
    let finish: (rows: CounterOrderSummary[]) => void = () => undefined;
    api.searchCounterOrders.mockReturnValue(new Promise<CounterOrderSummary[]>(resolve => { finish = resolve; }));
    nav('Orders / Pickup');
    expect(screen.queryByText('No matching saved orders.')).toBeNull();
    expect(screen.getByText('Searching saved orders…')).toBeTruthy();
    finish([summary(1)]);
    await screen.findByText('SL-1');
  });

  it('asks for two characters when one is typed, and says "No matching" only for a real empty result', async () => {
    await signIn();
    nav('Orders / Pickup');
    await screen.findByText('No matching saved orders.');
    fireEvent.change(screen.getByLabelText(/Search bill number/), { target: { value: '9' } });
    await screen.findByText('Type at least 2 characters of the bill number or mobile number.');
    await waitFor(() => expect(api.searchCounterOrders).toHaveBeenLastCalledWith('9', 0, 50));
    expect(screen.queryByText('No matching saved orders.')).toBeNull();
    fireEvent.change(screen.getByLabelText(/Search bill number/), { target: { value: '98' } });
    await screen.findByText('No matching saved orders.');
    expect(screen.queryByText(/Type at least 2 characters/)).toBeNull();
  });

  it('shows an error when refreshing the list after a status change fails', async () => {
    await signIn();
    await openOrdersAndFirstOrder();
    api.searchCounterOrders.mockRejectedValueOnce(new Error('list refresh failed'));
    fireEvent.change(screen.getByLabelText('Processing status'), { target: { value: 'packing' } });
    await screen.findByText('Order SL-1 moved to packing.');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('list refresh failed'));
  });
});

describe('opening one order after another', () => {
  it('starts every newly opened order with an empty payment form and fresh request keys', async () => {
    await signIn();
    const orders = [summary(1), summary(2)];
    api.searchCounterOrders.mockResolvedValue(orders);
    api.getCounterOrder.mockImplementation(async (id: string) => savedOrder({ orderId: id, orderNumber: id === 'o-1' ? 'SL-1' : 'SL-2' }));
    nav('Orders / Pickup');
    await screen.findByText('SL-2');
    fireEvent.click(screen.getAllByRole('button', { name: 'Open order' })[0]);
    await screen.findByText('SL-1 · Order details');
    fireEvent.change(screen.getByLabelText('Amount received'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Method'), { target: { value: 'card' } });
    fireEvent.change(screen.getByLabelText(/Reference/), { target: { value: 'TXN 9' } });
    api.recordCounterPayment.mockRejectedValueOnce(new Error('database is busy'));
    fireEvent.click(screen.getByRole('button', { name: 'Save payment' }));
    await screen.findByText('database is busy');
    const firstKey = api.recordCounterPayment.mock.calls[0][1].idempotencyKey;

    // Coming back to the same order keeps what was typed and the same key, so a retry stays safe.
    nav('Orders / Pickup');
    fireEvent.click((await screen.findAllByRole('button', { name: 'Open order' }))[0]);
    await screen.findByText('SL-1 · Order details');
    expect((screen.getByLabelText('Amount received') as HTMLInputElement).value).toBe('5');

    nav('Orders / Pickup');
    fireEvent.click((await screen.findAllByRole('button', { name: 'Open order' }))[1]);
    await screen.findByText('SL-2 · Order details');
    expect((screen.getByLabelText('Amount received') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Method') as HTMLSelectElement).value).toBe('cash');
    expect((screen.getByLabelText(/Reference/) as HTMLInputElement).value).toBe('');
    expect(screen.queryByText('database is busy')).toBeNull();
    fireEvent.change(screen.getByLabelText('Amount received'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save payment' }));
    await screen.findByText('Payment saved to this order.');
    expect(api.recordCounterPayment.mock.calls[1][0]).toBe('o-2');
    expect(api.recordCounterPayment.mock.calls[1][1].idempotencyKey).not.toBe(firstKey);
  });

  it('drops the reprint selection of the previous order', async () => {
    await signIn();
    api.searchCounterOrders.mockResolvedValue([summary(1), summary(2)]);
    api.getCounterOrder.mockImplementation(async (id: string) => savedOrder({ orderId: id, orderNumber: id === 'o-1' ? 'SL-1' : 'SL-2' }));
    nav('Orders / Pickup');
    await screen.findByText('SL-2');
    fireEvent.click(screen.getAllByRole('button', { name: 'Open order' })[0]);
    await screen.findByText('SL-1 · Order details');
    fireEvent.click(screen.getByRole('button', { name: 'Print progress / reprints' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /2600001-1/ }));
    expect(screen.getByRole('button', { name: 'Reprint selected tags (1)' })).toBeTruthy();
    nav('Orders / Pickup');
    fireEvent.click((await screen.findAllByRole('button', { name: 'Open order' }))[1]);
    await screen.findByText('SL-2 · Order details');
    fireEvent.click(screen.getByRole('button', { name: 'Print progress / reprints' }));
    expect(await screen.findByRole('button', { name: 'Reprint selected tags (0)' })).toBeTruthy();
  });

  it('shows no order tabs from an earlier session after signing in again', async () => {
    await signIn();
    await startOrder();
    await saveAndWaitForPrints();
    expect(screen.getByRole('button', { name: 'Print progress' })).toBeTruthy();
    api.getCounterBootstrap.mockResolvedValue(unauthenticated());
    fireEvent.click(screen.getByRole('button', { name: /Lock/ }));
    await screen.findByText('Choose your name and enter your PIN.');
    api.loginCounter.mockResolvedValue(admin);
    fireEvent.click(screen.getByRole('button', { name: 'Admin' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'admin-1' } });
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('Choose service');
    expect(screen.queryByRole('button', { name: 'Print progress' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Packing / pickup' })).toBeNull();
  });
});

describe('print progress and the print queue', () => {
  const other = { ...job('bill', 'failed', 'o-2'), id: 'bill-job-other', lastError: 'Other customer problem' };

  it('shows only this order\'s jobs on its page, even after a retry, while the queue shows every job', async () => {
    await signIn();
    const mine = [job('bill', 'failed'), job('tags', 'submitted')];
    api.getCounterOrder.mockResolvedValue(savedOrder({ printJobs: mine }));
    api.listPrintJobs.mockImplementation(async (orderId?: string) => (orderId ? mine : [...mine, other]));
    await openOrdersAndFirstOrder();
    fireEvent.click(screen.getByRole('button', { name: 'Print progress / reprints' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry bill' }));
    await waitFor(() => expect(api.retryPrintJob).toHaveBeenCalledWith('bill-job', false));
    await waitFor(() => expect(api.listPrintJobs).toHaveBeenLastCalledWith('o-1'));
    expect(screen.queryByText('Other customer problem')).toBeNull();
    nav('Print queue');
    await screen.findByText('Other customer problem');
  });

  it('hides other orders\' jobs from the order page even if the shared list holds them', async () => {
    await signIn();
    const mine = [job('bill', 'failed')];
    api.getCounterOrder.mockResolvedValue(savedOrder({ printJobs: mine }));
    api.listPrintJobs.mockResolvedValue([...mine, other]);
    await openOrdersAndFirstOrder();
    fireEvent.click(screen.getByRole('button', { name: 'Print progress / reprints' }));
    await screen.findByText('SL-1 · Print progress');
    await waitFor(() => expect(api.listPrintJobs).toHaveBeenCalledWith('o-1'));
    expect(screen.getByText('Queue unavailable')).toBeTruthy();
    expect(screen.queryByText('Other customer problem')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry bill' }));
    await waitFor(() => expect(api.retryPrintJob).toHaveBeenCalled());
    expect(screen.queryByText('Other customer problem')).toBeNull();
  });

  it('falls back to the order\'s own saved jobs when the shared list has none of them', async () => {
    await signIn();
    api.getCounterOrder.mockResolvedValue(savedOrder({ printJobs: [job('bill', 'pending')] }));
    api.listPrintJobs.mockResolvedValue([other]);
    await openOrdersAndFirstOrder();
    fireEvent.click(screen.getByRole('button', { name: 'Print progress / reprints' }));
    await screen.findByRole('button', { name: 'Resume bill' });
    expect(screen.queryByText('Other customer problem')).toBeNull();
  });

  it('describes every print state in plain words', async () => {
    await signIn();
    api.listPrintJobs.mockResolvedValue([
      { ...job('bill', 'pending'), id: 'a' }, { ...job('bill', 'submitting'), id: 'b' }, { ...job('bill', 'submitted'), id: 'c' },
      { ...job('bill', 'failed'), id: 'd' }, { ...job('bill', 'uncertain'), id: 'e' },
    ]);
    nav('Print queue');
    for (const label of ['Waiting to print', 'Sending to printer…', 'Sent to printer', 'Failed', 'Check the printer']) {
      expect(await screen.findByText(label)).toBeTruthy();
    }
    expect(screen.queryByText('pending')).toBeNull();
    expect(screen.queryByText('uncertain')).toBeNull();
  });

  it('lists jobs that still need attention before finished ones in the queue', async () => {
    await signIn();
    api.listPrintJobs.mockResolvedValue([
      { ...job('bill', 'submitted'), id: 'done' }, { ...job('tags', 'failed'), id: 'broken' }, { ...job('bill', 'uncertain'), id: 'maybe' },
    ]);
    nav('Print queue');
    await screen.findByText('Sent to printer');
    const cards = Array.from(document.querySelectorAll('article.counter-job')).map(card => card.querySelector('.counter-job-state')?.textContent);
    expect(cards).toEqual(['Failed', 'Check the printer', 'Sent to printer']);
  });

  it('explains how to avoid duplicate tags when an uncertain tag job is reviewed, on the order page and in the queue', async () => {
    await signIn();
    api.getCounterOrder.mockResolvedValue(savedOrder({ printJobs: [job('tags', 'uncertain')] }));
    api.listPrintJobs.mockResolvedValue([job('tags', 'uncertain')]);
    await openOrdersAndFirstOrder();
    fireEvent.click(screen.getByRole('button', { name: 'Print progress / reprints' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Review uncertain tags job' }));
    expect(screen.getByText('Some tags may already be printed. To avoid duplicates, use Reprint selected tags below to print only the missing tags.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm reprint of tags' })).toBeTruthy();
    nav('Print queue');
    fireEvent.click(await screen.findByRole('button', { name: 'Review uncertain job' }));
    expect(screen.getByText(/Some tags may already be printed\. To avoid duplicates, open the order/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reprint' }));
    await waitFor(() => expect(api.retryPrintJob).toHaveBeenCalledWith('tags-job', true));
  });

  it('keeps the bill wording for an uncertain bill in the queue', async () => {
    await signIn();
    api.listPrintJobs.mockResolvedValue([job('bill', 'uncertain')]);
    nav('Print queue');
    fireEvent.click(await screen.findByRole('button', { name: 'Review uncertain job' }));
    expect(screen.getByText('Check the printer first; confirm only if you need another copy.')).toBeTruthy();
  });

  it('only reports a reprint as queued when it was really sent, otherwise keeps the key and says what happened', async () => {
    await signIn();
    await openOrdersAndFirstOrder();
    fireEvent.click(screen.getByRole('button', { name: 'Print progress / reprints' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /2600001-1/ }));
    api.reprintCounterOutput.mockResolvedValue(job('tags'));
    api.dispatchPrintJob.mockResolvedValueOnce(job('tags', 'failed'));
    fireEvent.click(screen.getByRole('button', { name: 'Reprint selected tags (1)' }));
    expect((await screen.findByRole('alert')).textContent).toBe('The reprint was saved but did not print (Failed). Use Retry in the Print queue.');
    expect(screen.queryByText(/were added to the TSC queue/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Reprint selected tags (1)' })).toBeTruthy();
    api.dispatchPrintJob.mockResolvedValueOnce(job('tags', 'uncertain'));
    fireEvent.click(screen.getByRole('button', { name: 'Reprint selected tags (1)' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('(Check the printer)'));
    fireEvent.click(screen.getByRole('button', { name: 'Reprint selected tags (1)' }));
    await screen.findByText('1 selected garment tag(s) were added to the TSC queue.');
    const keys = api.reprintCounterOutput.mock.calls.map(call => call[3]);
    expect(new Set(keys).size).toBe(1);
    expect(keys.length).toBe(3);
    expect(screen.getByRole('button', { name: 'Reprint selected tags (0)' })).toBeTruthy();
  });
});

describe('a double tap never runs a print or pickup action twice', () => {
  const deferred = <T,>() => {
    let resolve: (value: T) => void = () => undefined;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
  };

  it('ignores a second tap on Retry and Resume while the first is still running, then works again', async () => {
    await signIn();
    api.listPrintJobs.mockResolvedValue([job('bill', 'pending'), job('tags', 'failed')]);
    nav('Print queue');
    const retry = deferred<CounterPrintJob>();
    api.retryPrintJob.mockReturnValue(retry.promise);
    const retryButton = await screen.findByRole('button', { name: 'Retry this job' });
    fireEvent.click(retryButton);
    fireEvent.click(retryButton);
    fireEvent.click(screen.getByRole('button', { name: 'Resume this job' }));
    expect(api.retryPrintJob).toHaveBeenCalledTimes(1);
    expect(api.dispatchPrintJob).not.toHaveBeenCalled();
    retry.resolve(job('tags', 'submitted'));
    await waitFor(() => expect(api.listPrintJobs.mock.calls.length).toBeGreaterThan(2));
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Resume this job' }));
    await waitFor(() => expect(api.dispatchPrintJob).toHaveBeenCalledTimes(1));
  });

  it('ignores a second tap on a reprint while the first is running', async () => {
    await signIn();
    await openOrdersAndFirstOrder();
    fireEvent.click(screen.getByRole('button', { name: 'Print progress / reprints' }));
    await screen.findByText('SL-1 · Print progress');
    const created = deferred<CounterPrintJob>();
    api.reprintCounterOutput.mockReturnValue(created.promise);
    const button = screen.getByRole('button', { name: 'Reprint customer bill' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(api.reprintCounterOutput).toHaveBeenCalledTimes(1);
    created.resolve(job('bill'));
    await screen.findByText('A bill reprint was added to the Canon queue.');
    expect(api.dispatchPrintJob).toHaveBeenCalledTimes(1);
  });

  it('ignores a second tap on the packing and pickup submit while the first is running', async () => {
    await signIn();
    await openOrdersAndFirstOrder();
    fireEvent.click(screen.getByRole('button', { name: 'Packing checklist' }));
    await screen.findByText(/Check the physical pieces as they are packed/);
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    const match = deferred<{ matchedCount: number; expectedCount: number; missingIds: string[]; duplicateIds: string[]; wrongOrderIds: string[]; complete: boolean }>();
    api.matchOrderPieces.mockReturnValue(match.promise);
    const submit = screen.getByRole('button', { name: 'Save packing checklist' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(api.matchOrderPieces).toHaveBeenCalledTimes(1);
    match.resolve({ matchedCount: 2, expectedCount: 2, missingIds: [], duplicateIds: [], wrongOrderIds: [], complete: true });
    await screen.findByText('Every garment is checked for packing.');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('cancelling an order', () => {
  const cancelled = (over: Partial<CounterSavedOrder> = {}) => savedOrder({ status: 'cancelled', paidMinor: 0, balanceMinor: 0, ...over });
  const openCancel = () => fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }));

  it('lets an administrator cancel with a written reason and an explicit confirmation', async () => {
    await signIn(admin);
    api.cancelCounterOrder.mockResolvedValue(cancelled());
    await openOrdersAndFirstOrder();
    expect(api.cancelCounterOrder).not.toHaveBeenCalled();
    openCancel();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm cancel order' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Enter a reason of 3 to 200 characters.');
    fireEvent.change(screen.getByLabelText('Reason for cancelling'), { target: { value: 'x'.repeat(201) } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm cancel order' }));
    await screen.findByText('Enter a reason of 3 to 200 characters.');
    expect(api.cancelCounterOrder).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Reason for cancelling'), { target: { value: '  Customer changed their mind  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm cancel order' }));
    await screen.findByText('Order cancelled. Hand back any money received.');
    expect(api.cancelCounterOrder).toHaveBeenCalledWith('o-1', 'Customer changed their mind');
    const status = screen.getByLabelText('Processing status') as HTMLSelectElement;
    expect(status.value).toBe('cancelled');
    expect(status.disabled).toBe(true);
    expect((within(status).getByRole('option', { name: 'Cancelled' }) as HTMLOptionElement).selected).toBe(true);
    expect(screen.queryByRole('button', { name: 'Cancel order' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Record later payment' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Packing checklist' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Verify pickup collection' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Packing / pickup' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Print progress / reprints' })).toBeTruthy();
    expect(api.searchCounterOrders.mock.calls.length).toBeGreaterThan(1);
  });

  it('can be backed out of, and keeps the reason and explains a refusal', async () => {
    await signIn(admin);
    await openOrdersAndFirstOrder();
    openCancel();
    fireEvent.change(screen.getByLabelText('Reason for cancelling'), { target: { value: 'Duplicate bill' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep order' }));
    expect(screen.queryByLabelText('Reason for cancelling')).toBeNull();
    openCancel();
    expect((screen.getByLabelText('Reason for cancelling') as HTMLInputElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('Reason for cancelling'), { target: { value: 'Duplicate bill' } });
    api.cancelCounterOrder.mockRejectedValueOnce(new Error('A collected order cannot be cancelled.'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm cancel order' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('A collected order cannot be cancelled.'));
    expect((screen.getByLabelText('Reason for cancelling') as HTMLInputElement).value).toBe('Duplicate bill');
  });

  it('is never offered to staff, nor for collected or already cancelled orders', async () => {
    await signIn(staff);
    await openOrdersAndFirstOrder();
    expect(screen.queryByRole('button', { name: 'Cancel order' })).toBeNull();
    cleanup();
    await signIn(admin);
    api.getCounterOrder.mockResolvedValue(savedOrder({ status: 'collected' }));
    await openOrdersAndFirstOrder();
    expect(screen.queryByRole('button', { name: 'Cancel order' })).toBeNull();
    api.getCounterOrder.mockResolvedValue(cancelled());
    nav('Orders / Pickup');
    fireEvent.click((await screen.findAllByRole('button', { name: 'Open order' }))[0]);
    await waitFor(() => expect((screen.getByLabelText('Processing status') as HTMLSelectElement).value).toBe('cancelled'));
    expect(screen.queryByRole('button', { name: 'Cancel order' })).toBeNull();
    expect(screen.getByText('This order was cancelled. No payment or pickup can be recorded for it.')).toBeTruthy();
  });
});

describe('the counter at start-up', () => {
  it('shows why the counter could not open and lets the operator try again', async () => {
    api.getCounterBootstrap.mockRejectedValueOnce(new Error('The database is locked by another program.'));
    mount();
    expect((await screen.findByRole('alert')).textContent).toBe('The database is locked by another program.');
    expect(screen.queryByText('Opening local counter…')).toBeNull();
    api.getCounterBootstrap.mockResolvedValue(unauthenticated());
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Choose your name and enter your PIN.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps showing the problem when trying again fails too, and shows the spinner only while a request is pending', async () => {
    api.getCounterBootstrap.mockRejectedValueOnce(new Error('first failure'));
    mount();
    await screen.findByText('first failure');
    let fail: (reason: Error) => void = () => undefined;
    api.getCounterBootstrap.mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Opening local counter…')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    fail(new Error('second failure'));
    expect((await screen.findByRole('alert')).textContent).toBe('second failure');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('shows the opening text while the first request is pending', async () => {
    api.getCounterBootstrap.mockReturnValue(new Promise(() => undefined));
    mount();
    expect(screen.getByText('Opening local counter…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});

describe('admin tabs keep their data while the counter re-renders', () => {
  it('does not reload the printer tab or lose a picked printer when the counter around it changes', async () => {
    await signIn(admin);
    const printers = [{ id: 'Canon', name: 'Canon', isDefault: false, isAvailable: true }, { id: 'TSC', name: 'TSC', isDefault: false, isAvailable: true }];
    api.enumeratePrinters.mockResolvedValue(printers);
    nav('Admin');
    fireEvent.click(await screen.findByRole('button', { name: 'Printers' }));
    await waitFor(() => expect(api.getPrinterProfiles).toHaveBeenCalledTimes(1));
    await screen.findAllByRole('option', { name: 'TSC' });
    fireEvent.change(screen.getByLabelText('TSC tag printer'), { target: { value: 'TSC' } });
    // Refreshing the printer list changes state in the counter itself, which re-renders the admin panel.
    fireEvent.click(screen.getByRole('button', { name: 'Refresh printer list' }));
    await waitFor(() => expect(api.enumeratePrinters.mock.calls.length).toBeGreaterThan(1));
    const calls = api.enumeratePrinters.mock.calls.length;
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(api.getPrinterProfiles).toHaveBeenCalledTimes(1);
    expect(api.enumeratePrinters.mock.calls.length).toBe(calls);
    expect((screen.getByLabelText('TSC tag printer') as HTMLSelectElement).value).toBe('TSC');
  });
});
