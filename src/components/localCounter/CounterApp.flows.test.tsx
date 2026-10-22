// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CounterApp } from './CounterApp';
import { ADVANCE_ABOVE_TOTAL, ADVANCE_NOT_AMOUNT } from '@/lib/localFirst/payment';
import type { CounterAccount, CounterCatalogue, CounterOrderInput, CounterOrderSummary, CounterPiece, CounterPrintJob, CounterSavedOrder } from '@/lib/localFirst/counter';

const api = vi.hoisted(() => ({
  listCounterTrashRequests: vi.fn(), cancelCounterOrder: vi.fn(), collectCounterOrder: vi.fn(), createCounterStaff: vi.fn(), dispatchPrintJob: vi.fn(), dispatchPrintJobs: vi.fn(), enumeratePrinters: vi.fn(),
  getCounterBootstrap: vi.fn(), getCounterCatalogue: vi.fn(), getCounterOrder: vi.fn(), getCounterOrderQueueCounts: vi.fn(), getOrderPieces: vi.fn(), getPrinterProfiles: vi.fn(),
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
  { id: 'p-1', shortId: '2600001-1', garmentId: 'shirt', garment: 'Shirt', service: 'Wash + Iron', position: 1, total: 2, matched: false, packingMatched: false, collectionMatched: false, tagged: true },
  { id: 'p-2', shortId: '2600001-2', garmentId: 'shirt', garment: 'Shirt', service: 'Wash + Iron', position: 2, total: 2, matched: false, packingMatched: false, collectionMatched: false, tagged: true },
];
const savedOrder = (over: Partial<CounterSavedOrder> = {}): CounterSavedOrder => ({ orderId: 'o-1', orderNumber: 'SL-1', customerName: 'Customer 1', customerPhone: '9876543210', receivedAt: '2026-10-15T06:00:00Z', promisedAt: '2026-10-17T11:30:00Z', status: 'ready', totalMinor: 4000, paidMinor: 0, balanceMinor: 4000, paymentStatus: 'unpaid', collectedAt: null, refundDueMinor: 0, payments: [], pieces, printJobs: [job('bill'), job('tags')], ...over });
const summary = (n: number, over: Partial<CounterOrderSummary> = {}): CounterOrderSummary => ({ id: `o-${n}`, orderNumber: `SL-${n}`, customerName: `Customer ${n}`, customerPhone: '9876543210', status: 'ready', receivedAt: '2026-10-15T06:00:00Z', promisedAt: '2026-10-17T11:30:00Z', totalMinor: 4000, paidMinor: 0, balanceMinor: 4000, pieceCount: 2, paymentStatus: 'unpaid', overdue: false, untaggedCount: 0, matchReason: null, ...over });
const quoteFor = (input: CounterOrderInput, total?: number) => {
  const pieceCount = input.items.reduce((n, x) => n + x.quantity, 0);
  const unit = (x: CounterOrderInput['items'][number]) => x.unitPriceOverrideMinor ?? 2000;
  const subtotal = input.items.reduce((n, x) => n + unit(x) * x.quantity, 0);
  return { lines: input.items.map(x => ({ garmentId: x.garmentId, serviceId: x.serviceId, garment: 'Shirt', service: 'Wash + Iron', quantity: x.quantity, unitPriceMinor: unit(x), listPriceMinor: 2000, lineTotalMinor: unit(x) * x.quantity, rateVersion: 1 })), subtotalMinor: subtotal, discountPercentBp: 0, discountMinor: 0, totalMinor: total ?? subtotal, pieceCount, promisedAt: '2026-10-17T11:30:00.000Z', catalogueVersion: '2' };
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
  await screen.findByLabelText('Garments');
};
const nav = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
/** Opens the Orders / Pickup list and the detail page of its first order (an order still being washed, so it opens as detail). */
const openOrdersAndFirstOrder = async (results = [summary(1, { status: 'washing' })]) => {
  api.searchCounterOrders.mockResolvedValue(results);
  nav('Orders / Pickup');
  await screen.findByText(results[0].orderNumber);
  fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[0]);
  await screen.findByRole('heading', { name: results[0].orderNumber });
};
/** From an order's detail page to its print progress, through More actions. */
const openPrintProgress = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  fireEvent.click(screen.getByRole('button', { name: 'Print status' }));
  await screen.findByText(/· Print progress/);
};
const saveButton = () => screen.getByRole('button', { name: 'Save & Print' }) as HTMLButtonElement;
const advanceInput = () => screen.getByLabelText('Advance received now') as HTMLInputElement;
const saveNow = () => fireEvent.click(screen.getByRole('button', { name: 'Save & Print' }));
const startOrder = async () => {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Rita Joshi' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add Shirt Wash' }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Save & Print' }) as HTMLButtonElement).disabled).toBe(false));
};

beforeEach(() => {
  vi.clearAllMocks();
  api.listCounterTrashRequests.mockResolvedValue([]);
  api.getCounterCatalogue.mockResolvedValue(catalogue);
  api.quoteCounterOrder.mockImplementation(async (input: CounterOrderInput) => quoteFor(input));
  api.searchCounterCustomers.mockResolvedValue([]);
  api.searchCounterOrders.mockResolvedValue([]);
  api.getCounterOrderQueueCounts.mockResolvedValue({ ready: 1, balanceDue: 1, overdue: 0, inProcess: 0, today: 1, all: 1, balanceDueMinor: 4000 });
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
    await screen.findByLabelText('Garments');
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
    await screen.findByLabelText('Garments');
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
    fireEvent.click(screen.getByRole('button', { name: 'Add Shirt Wash' }));
    api.getCounterBootstrap.mockResolvedValue(unauthenticated());
    fireEvent.click(screen.getByRole('button', { name: /Lock/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard order' }));
    await screen.findByText('Choose your name and enter your PIN.');
    expect(api.lockCounter).toHaveBeenCalledOnce();
    api.loginCounter.mockResolvedValue(staff);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'staff-1' } });
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByLabelText('Garments');
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('');
    expect(screen.getByText('Tap a service on a garment to add it.')).toBeTruthy();
  });
});

describe('taking and saving an order', () => {
  it('removes the whole line with the bin button, however many were added', async () => {
    await signIn();
    await startOrder();
    for (let tap = 0; tap < 2; tap += 1) fireEvent.click(screen.getByRole('button', { name: 'Add Shirt Wash' }));
    await waitFor(() => expect((screen.getByLabelText('Shirt summary quantity') as HTMLInputElement).value).toBe('3'));
    expect(screen.getByLabelText('3 added').textContent).toBe('×3');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Shirt' }));
    await screen.findByText('Tap a service on a garment to add it.');
    expect(screen.queryByLabelText(/added/)).toBeNull();
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

  it('sends no payment when nothing is paid now, including after an advance was typed and cleared', async () => {
    await signIn();
    await startOrder();
    fireEvent.change(advanceInput(), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Nothing now' }));
    expect(advanceInput().value).toBe('');
    saveNow();
    await waitFor(() => expect(api.saveCounterOrder).toHaveBeenCalledTimes(1));
    expect(api.saveCounterOrder.mock.calls[0][0]).not.toHaveProperty('payment');
  });

  it('sends the advance in rupees as paise with the method chosen, and nothing else', async () => {
    await signIn();
    api.quoteCounterOrder.mockImplementation(async (input: CounterOrderInput) => quoteFor(input, 20000));
    await startOrder();
    fireEvent.change(advanceInput(), { target: { value: '100.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'UPI' }));
    expect(screen.getByText('Balance to pay at pickup ₹99.50')).toBeTruthy();
    saveNow();
    await waitFor(() => expect(api.saveCounterOrder).toHaveBeenCalledTimes(1));
    expect(api.saveCounterOrder.mock.calls[0][0].payment).toEqual({ amountMinor: 10050, method: 'upi' });
  });

  it('fills the advance with half of the total when Half is chosen, then saves that amount', async () => {
    await signIn();
    api.quoteCounterOrder.mockImplementation(async (input: CounterOrderInput) => quoteFor(input, 1800));
    await startOrder();
    fireEvent.click(screen.getByRole('button', { name: 'Half' }));
    expect(advanceInput().value).toBe('9.00');
    saveNow();
    await waitFor(() => expect(api.saveCounterOrder).toHaveBeenCalledTimes(1));
    expect(api.saveCounterOrder.mock.calls[0][0].payment).toEqual({ amountMinor: 900, method: 'cash' });
  });

  it('fills the advance with the whole total when Full is chosen, then saves that amount', async () => {
    await signIn();
    api.quoteCounterOrder.mockImplementation(async (input: CounterOrderInput) => quoteFor(input, 1800));
    await startOrder();
    fireEvent.click(screen.getByRole('button', { name: 'Full' }));
    expect(advanceInput().value).toBe('18.00');
    saveNow();
    await waitFor(() => expect(api.saveCounterOrder).toHaveBeenCalledTimes(1));
    expect(api.saveCounterOrder.mock.calls[0][0].payment).toEqual({ amountMinor: 1800, method: 'cash' });
  });

  it('blocks Save while the advance is not an amount or is more than the amount to collect', async () => {
    await signIn();
    await startOrder();
    fireEvent.change(advanceInput(), { target: { value: '12.345' } });
    expect(screen.getByRole('alert').textContent).toBe(ADVANCE_NOT_AMOUNT);
    expect(saveButton().disabled).toBe(true);
    fireEvent.change(advanceInput(), { target: { value: '25' } });
    expect(screen.getByRole('alert').textContent).toBe(ADVANCE_ABOVE_TOTAL);
    expect(saveButton().disabled).toBe(true);
    fireEvent.change(advanceInput(), { target: { value: '20' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(saveButton().disabled).toBe(false);
  });

  it('sends no payment for an order with nothing to pay, even if an advance was typed before its total dropped to zero', async () => {
    await signIn();
    api.quoteCounterOrder.mockImplementation(async (input: CounterOrderInput) => quoteFor(input, 0));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Rita Joshi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Shirt Wash' }));
    fireEvent.change(advanceInput(), { target: { value: '5' } });
    await screen.findByText('No payment due');
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    saveNow();
    await waitFor(() => expect(api.saveCounterOrder).toHaveBeenCalledTimes(1));
    expect(api.saveCounterOrder.mock.calls[0][0]).not.toHaveProperty('payment');
  });

  it('shows a quote problem instead of an amount, and recovers when the draft changes', async () => {
    await signIn();
    api.quoteCounterOrder.mockRejectedValueOnce(new Error('A rate has not been configured for this garment and service.'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Rita Joshi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Shirt Wash' }));
    expect((await screen.findByRole('alert')).textContent).toContain('rate has not been configured');
    expect((screen.getByRole('button', { name: 'Save & Print' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Add Shirt Wash' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save & Print' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('small order-screen behaviours', () => {
  it('lets staff change a price for this bill only, and forgets it when the line is removed', async () => {
    await signIn();
    await startOrder();
    fireEvent.click(screen.getByRole('button', { name: 'Add Shirt Wash' }));
    const price = await screen.findByLabelText('Shirt price for this bill');
    fireEvent.change(price, { target: { value: '15' } });
    await waitFor(() => expect(api.quoteCounterOrder).toHaveBeenLastCalledWith(expect.objectContaining({ items: [expect.objectContaining({ quantity: 2, unitPriceOverrideMinor: 1500 })] })));
    await screen.findByText('Rate card ₹20.00');
    // Back to the rate-card price: no override is sent.
    fireEvent.change(screen.getByLabelText('Shirt price for this bill'), { target: { value: '20' } });
    await waitFor(() => expect(api.quoteCounterOrder).toHaveBeenLastCalledWith(expect.objectContaining({ items: [expect.not.objectContaining({ unitPriceOverrideMinor: expect.anything() })] })));
    // A price typed, the line removed and added again: the old price is gone.
    fireEvent.change(await screen.findByLabelText('Shirt price for this bill'), { target: { value: '5' } });
    await waitFor(() => expect(api.quoteCounterOrder).toHaveBeenLastCalledWith(expect.objectContaining({ items: [expect.objectContaining({ unitPriceOverrideMinor: 500 })] })));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Shirt' }));
    await screen.findByText('Tap a service on a garment to add it.');
    fireEvent.click(screen.getByRole('button', { name: 'Add Shirt Wash' }));
    await waitFor(() => expect(api.quoteCounterOrder).toHaveBeenLastCalledWith(expect.objectContaining({ items: [expect.not.objectContaining({ unitPriceOverrideMinor: expect.anything() })] })));
  });

  it('removes a line when its summary quantity is typed as zero', async () => {
    await signIn();
    await startOrder();
    for (let tap = 0; tap < 2; tap += 1) fireEvent.click(screen.getByRole('button', { name: 'Add Shirt Wash' }));
    await waitFor(() => expect(api.quoteCounterOrder).toHaveBeenLastCalledWith(expect.objectContaining({ items: [expect.objectContaining({ quantity: 3 })] })));
    fireEvent.change(screen.getByLabelText('Shirt summary quantity'), { target: { value: '0' } });
    await screen.findByText('Tap a service on a garment to add it.');
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
    await screen.findByLabelText('Garments');
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
    await screen.findByRole('heading', { name: 'SL-1' });
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
    await openPrintProgress();
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
    await openPrintProgress();
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
    await openPrintProgress();
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
    await screen.findByText('Bill SL-1 sent to the printer.');
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
    expect(screen.getByLabelText('Garments')).toBeTruthy();
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
    expect(screen.getByLabelText('1 added').textContent).toBe('×1');
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
    expect(screen.getByText('Tap a service on a garment to add it.')).toBeTruthy();
  });

  it('counts a typed mobile number or a lone garment as an order in progress', async () => {
    await signIn();
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '9876543210' } });
    nav('Print queue');
    expect(dialog()).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Discard order' }));
    nav('New order');
    fireEvent.click(screen.getByRole('button', { name: 'Add Shirt Wash' }));
    nav('Print queue');
    expect(dialog()).not.toBeNull();
  });

  it('goes straight to a blank order from another page when nothing was started', async () => {
    await signIn();
    nav('Orders / Pickup');
    nav('New order');
    expect(dialog()).toBeNull();
    await screen.findByLabelText('Garments');
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
    for (const control of [screen.getByLabelText('Name'), screen.getByLabelText('Mobile number'), screen.getByRole('button', { name: 'Add Shirt Wash' }), screen.getByLabelText('Shirt summary quantity'), screen.getByRole('button', { name: 'Remove Shirt' })]) {
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
    expect(api.saveCounterOrder.mock.calls[1][0]).not.toHaveProperty('payment');
  });

  it('keeps a save error visible when the quote itself is fine, and shows quote and save problems separately', async () => {
    await signIn();
    await startOrder();
    api.saveCounterOrder.mockRejectedValueOnce(new Error('database is busy'));
    fireEvent.click(screen.getByRole('button', { name: 'Save & Print' }));
    await screen.findByText(/Order save did not complete: database is busy/);
    api.quoteCounterOrder.mockRejectedValueOnce(new Error('A rate has not been configured for this garment and service.'));
    fireEvent.click(screen.getByRole('button', { name: 'Add Shirt Wash' }));
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBe(2));
    expect(screen.getByText('The price could not be worked out. See the message above.')).toBeTruthy();
  });
});

describe('the advance and the request key of a new order', () => {
  type RequestKey = ReturnType<typeof crypto.randomUUID>;
  let uuidSpy: { mockRestore: () => void } | null = null;
  // Until issueFreshKeys is called every key is 'stale-key', so a test can see whether a key was replaced.
  // Renders also call randomUUID, which is why the test does not count calls.
  let fresh = false;
  const stubRequestKeys = () => {
    let issued = 0;
    fresh = false;
    uuidSpy = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => (fresh ? `key-${++issued}` : 'stale-key') as RequestKey);
  };
  const issueFreshKeys = () => { fresh = true; };
  afterEach(() => {
    uuidSpy?.mockRestore();
    uuidSpy = null;
  });

  it('keeps the request key from sign-in when nothing about the payment is changed before saving', async () => {
    stubRequestKeys();
    await signIn();
    await startOrder();
    saveNow();
    await waitFor(() => expect(api.saveCounterOrder).toHaveBeenCalledTimes(1));
    expect(api.saveCounterOrder.mock.calls[0][0].idempotencyKey).toBe('stale-key');
  });

  it('issues a new request key when the advance changes before any save', async () => {
    stubRequestKeys();
    await signIn();
    await startOrder();
    issueFreshKeys();
    fireEvent.change(advanceInput(), { target: { value: '5' } });
    saveNow();
    await waitFor(() => expect(api.saveCounterOrder).toHaveBeenCalledTimes(1));
    expect(api.saveCounterOrder.mock.calls[0][0].idempotencyKey).not.toBe('stale-key');
  });

  it('issues a new request key when the method changes before any save', async () => {
    stubRequestKeys();
    await signIn();
    await startOrder();
    issueFreshKeys();
    fireEvent.change(advanceInput(), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Card' }));
    saveNow();
    await waitFor(() => expect(api.saveCounterOrder).toHaveBeenCalledTimes(1));
    expect(api.saveCounterOrder.mock.calls[0][0].payment).toEqual({ amountMinor: 500, method: 'card' });
    expect(api.saveCounterOrder.mock.calls[0][0].idempotencyKey).not.toBe('stale-key');
  });

  it('keeps the request key after a failed save, so a changed advance is sent with the same key and reported as possibly saved', async () => {
    stubRequestKeys();
    await signIn();
    await startOrder();
    issueFreshKeys();
    fireEvent.change(advanceInput(), { target: { value: '5' } });
    api.saveCounterOrder.mockRejectedValueOnce(new Error('This request key was already used for a different order draft.'));
    saveNow();
    expect((await screen.findByRole('alert')).textContent).toBe(SAVED_BUT_QUIET);
    fireEvent.change(advanceInput(), { target: { value: '6' } });
    api.saveCounterOrder.mockRejectedValueOnce(new Error('This request key was already used for a different order draft.'));
    saveNow();
    await waitFor(() => expect(api.saveCounterOrder).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(SAVED_BUT_QUIET));
    const [first, second] = api.saveCounterOrder.mock.calls.map(call => call[0]);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(first.payment).toEqual({ amountMinor: 500, method: 'cash' });
    expect(second.payment).toEqual({ amountMinor: 600, method: 'cash' });
  });

  it('clears the advance and the method after a successful save, and starts the next order with no advance', async () => {
    stubRequestKeys();
    await signIn();
    await startOrder();
    issueFreshKeys();
    fireEvent.change(advanceInput(), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'UPI' }));
    saveNow();
    await screen.findByText(/Order SL-1 saved/);
    nav('New order');
    await screen.findByLabelText('Garments');
    expect(advanceInput().value).toBe('');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Asha Rao' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Shirt Wash' }));
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(advanceInput().value).toBe('');
    expect(screen.queryByRole('group', { name: 'Payment method' })).toBeNull();
    saveNow();
    await waitFor(() => expect(api.saveCounterOrder).toHaveBeenCalledTimes(2));
    expect(api.saveCounterOrder.mock.calls[1][0]).not.toHaveProperty('payment');
    expect(api.saveCounterOrder.mock.calls[1][0].idempotencyKey).not.toBe(api.saveCounterOrder.mock.calls[0][0].idempotencyKey);
  });
});

describe('quotes that arrive late', () => {
  it('ignores the price of an earlier draft that comes back after the draft changed', async () => {
    await signIn();
    let late: (quote: ReturnType<typeof quoteFor>) => void = () => undefined;
    api.quoteCounterOrder.mockReturnValueOnce(new Promise(resolve => { late = resolve; }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Rita Joshi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Shirt Wash' }));
    await waitFor(() => expect(api.quoteCounterOrder).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Add Shirt Wash' }));
    await waitFor(() => expect(screen.getByText('Amount to collect').nextSibling?.textContent).toBe('₹40.00'));
    late(quoteFor({ customer: { name: 'Rita Joshi', phone: '' }, items: [{ garmentId: 'shirt', serviceId: 'wash-iron', quantity: 1 }] }));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(screen.getByText('Amount to collect').nextSibling?.textContent).toBe('₹40.00');
  });
});

describe('opening one order after another', () => {
  it('drops the reprint selection of the previous order', async () => {
    await signIn();
    api.searchCounterOrders.mockResolvedValue([summary(1, { status: 'washing' }), summary(2, { status: 'washing' })]);
    api.getCounterOrder.mockImplementation(async (id: string) => savedOrder({ orderId: id, orderNumber: id === 'o-1' ? 'SL-1' : 'SL-2' }));
    nav('Orders / Pickup');
    await screen.findByText('SL-2');
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[0]);
    await screen.findByRole('heading', { name: 'SL-1' });
    await openPrintProgress();
    fireEvent.click(await screen.findByRole('checkbox', { name: /2600001-1/ }));
    expect(screen.getByRole('button', { name: 'Reprint selected tags (1)' })).toBeTruthy();
    nav('Orders / Pickup');
    fireEvent.click((await screen.findAllByRole('button', { name: 'Open' }))[1]);
    await screen.findByRole('heading', { name: 'SL-2' });
    await openPrintProgress();
    expect(await screen.findByRole('button', { name: 'Reprint selected tags (0)' })).toBeTruthy();
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
    await openPrintProgress();
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
    await openPrintProgress();
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
    await openPrintProgress();
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
    await openPrintProgress();
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
    await openPrintProgress();
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
    await openPrintProgress();
    await screen.findByText('SL-1 · Print progress');
    const created = deferred<CounterPrintJob>();
    api.reprintCounterOutput.mockReturnValue(created.promise);
    const button = screen.getByRole('button', { name: 'Reprint customer bill' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(api.reprintCounterOutput).toHaveBeenCalledTimes(1);
    created.resolve(job('bill'));
    await screen.findByText('Bill SL-1 sent to the printer.');
    expect(api.dispatchPrintJob).toHaveBeenCalledTimes(1);
  });


});

describe('Orders / Pickup', () => {
  const searchBox = () => screen.getByLabelText('Search bill number, phone, name or tag ID') as HTMLInputElement;

  it('opens on the ready list with the counts, and marks Orders / Pickup as the current page', async () => {
    await signIn();
    api.searchCounterOrders.mockResolvedValue([summary(1)]);
    nav('Orders / Pickup');
    await screen.findByText('SL-1');
    expect(api.searchCounterOrders).toHaveBeenCalledWith('', 0, 50, 'ready');
    expect(api.getCounterOrderQueueCounts).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Orders / Pickup' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: /^Ready/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('To collect')).toBeTruthy();
  });

  it('has no navigation items for Print progress or Packing / pickup', async () => {
    await signIn();
    nav('Orders / Pickup');
    expect(screen.queryByRole('button', { name: 'Print progress' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Packing / pickup' })).toBeNull();
  });

  it('switches segment, and searches every order by what is typed', async () => {
    await signIn();
    nav('Orders / Pickup');
    await screen.findByText('Nothing is ready for pickup.');
    fireEvent.click(screen.getByRole('button', { name: /^Overdue/ }));
    await waitFor(() => expect(api.searchCounterOrders).toHaveBeenLastCalledWith('', 0, 50, 'overdue'));
    fireEvent.change(searchBox(), { target: { value: 'rita' } });
    await waitFor(() => expect(api.searchCounterOrders).toHaveBeenLastCalledWith('rita', 0, 50, 'all'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(api.searchCounterOrders).toHaveBeenLastCalledWith('', 0, 50, 'overdue'));
  });

  it('pages through a long list', async () => {
    await signIn();
    api.searchCounterOrders.mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => summary(i + 1))).mockResolvedValueOnce([summary(51)]);
    nav('Orders / Pickup');
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    await screen.findByText('SL-51');
    expect(api.searchCounterOrders).toHaveBeenLastCalledWith('', 50, 50, 'ready');
  });

  it('opens an order on its detail page, and Back restores the search that was typed', async () => {
    await signIn();
    api.searchCounterOrders.mockResolvedValue([summary(1, { status: 'washing' })]);
    nav('Orders / Pickup');
    await screen.findByText('SL-1');
    fireEvent.change(searchBox(), { target: { value: 'rita' } });
    await waitFor(() => expect(api.searchCounterOrders).toHaveBeenLastCalledWith('rita', 0, 50, 'all'));
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    await screen.findByRole('heading', { name: 'SL-1' });
    expect(screen.getByText('Customer 1 · 9876543210')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Orders / Pickup' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: '← Orders' }));
    await screen.findByText('Searching all orders');
    expect(searchBox().value).toBe('rita');
  });

  it('says so when an order has gone missing, and stays on the list', async () => {
    await signIn();
    api.getCounterOrder.mockResolvedValue(null);
    api.searchCounterOrders.mockResolvedValue([summary(1, { status: 'washing' })]);
    nav('Orders / Pickup');
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This order is no longer available.');
    expect(screen.getByRole('heading', { name: 'Orders / Pickup' })).toBeTruthy();
  });

  it('shows a refused lookup in the banner', async () => {
    await signIn();
    api.getCounterOrder.mockRejectedValue(new Error('database is busy'));
    api.searchCounterOrders.mockResolvedValue([summary(1, { status: 'washing' })]);
    nav('Orders / Pickup');
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    expect((await screen.findByRole('alert')).textContent).toBe('database is busy');
  });

  it('hands over a ready order from the list and returns to the ready list for the next customer', async () => {
    await signIn();
    const collected = savedOrder({ status: 'collected', paidMinor: 4000, balanceMinor: 0, paymentStatus: 'paid' });
    api.collectCounterOrder.mockResolvedValue(collected);
    api.searchCounterOrders.mockResolvedValue([summary(1)]);
    nav('Orders / Pickup');
    fireEvent.click(await screen.findByRole('button', { name: 'Receive ₹40.00 & hand over' }));
    await screen.findByText('Balance due ₹40.00');
    fireEvent.click(screen.getByRole('button', { name: 'Tick all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Receive ₹40.00 & hand over' }));
    await screen.findByText('Handed over ✓ SL-1');
    expect(api.collectCounterOrder).toHaveBeenCalledWith('o-1', ['p-1', 'p-2'], expect.any(String), expect.objectContaining({ amountMinor: 4000, method: 'cash' }));
    api.searchCounterOrders.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Next order' }));
    await screen.findByRole('heading', { name: 'Orders / Pickup' });
    await waitFor(() => expect(api.searchCounterOrders).toHaveBeenCalledWith('', 0, 50, 'ready'));
  });

  it('goes from the hand-over screen back to the order', async () => {
    await signIn();
    api.searchCounterOrders.mockResolvedValue([summary(1)]);
    nav('Orders / Pickup');
    fireEvent.click(await screen.findByRole('button', { name: 'Receive ₹40.00 & hand over' }));
    fireEvent.click(await screen.findByRole('button', { name: '← Order' }));
    await screen.findByRole('button', { name: 'Hand over to customer →' });
  });

  it('returns to where the order was opened from', async () => {
    await signIn();
    api.listPrintJobs.mockResolvedValue([job('bill', 'submitted')]);
    nav('Print queue');
    fireEvent.click(await screen.findByRole('button', { name: 'Open order' }));
    await screen.findByRole('heading', { name: 'SL-1' });
    fireEvent.click(screen.getByRole('button', { name: '← Print queue' }));
    await screen.findByRole('heading', { name: 'Saved print queue' });
  });

  it('moves the order to the next stage and shows the new status and a message', async () => {
    await signIn();
    api.getCounterOrder.mockResolvedValue(savedOrder({ status: 'received' }));
    await openOrdersAndFirstOrder();
    fireEvent.click(await screen.findByRole('button', { name: 'Move to Washing' }));
    await screen.findByText('Order SL-1 moved to washing.');
    expect(api.updateCounterOrderStatus).toHaveBeenCalledWith('o-1', 'washing');
  });

  it('shows a refused stage change', async () => {
    await signIn();
    api.getCounterOrder.mockResolvedValue(savedOrder({ status: 'received' }));
    await openOrdersAndFirstOrder();
    api.updateCounterOrderStatus.mockRejectedValueOnce(new Error('Order cannot move from received to washing.'));
    fireEvent.click(await screen.findByRole('button', { name: 'Move to Washing' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Order cannot move from received to washing.');
  });

  it('receives a payment on the order and shows the new balance', async () => {
    await signIn();
    await openOrdersAndFirstOrder();
    api.recordCounterPayment.mockResolvedValue(savedOrder({ status: 'washing', paidMinor: 4000, balanceMinor: 0, paymentStatus: 'paid' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Receive ₹40.00' })[0]);
    await screen.findByText('Payment saved.');
    expect(api.recordCounterPayment).toHaveBeenCalledWith('o-1', expect.objectContaining({ amountMinor: 4000, method: 'cash' }));
    expect(await screen.findByText('Paid in full')).toBeTruthy();
  });

  it('lets an administrator cancel with a reason, and says how much to hand back', async () => {
    await signIn(admin);
    await openOrdersAndFirstOrder();
    api.cancelCounterOrder.mockResolvedValue(savedOrder({ status: 'cancelled', refundDueMinor: 1500 }));
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }));
    fireEvent.change(screen.getByLabelText('Reason for cancelling'), { target: { value: 'Customer did not come back' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm cancel order' }));
    await screen.findByText('Order cancelled. Hand back ₹15.00.');
    expect(api.cancelCounterOrder).toHaveBeenCalledWith('o-1', 'Customer did not come back');
  });

  it('reprints the bill and the tags of the tagged pieces from the order page', async () => {
    await signIn();
    await openOrdersAndFirstOrder();
    api.reprintCounterOutput.mockResolvedValue(job('tags'));
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reprint tags' }));
    await screen.findByText('2 selected garment tag(s) were added to the TSC queue.');
    expect(api.reprintCounterOutput).toHaveBeenCalledWith('o-1', 'tags', ['2600001-1', '2600001-2'], expect.any(String));
    api.reprintCounterOutput.mockResolvedValue(job('bill'));
    fireEvent.click(screen.getByRole('button', { name: 'Reprint bill' }));
    await screen.findByText('Bill SL-1 sent to the printer.');
  });

  describe('reprinting a bill straight from the Orders list', () => {
    const openList = async (results = [summary(1, { status: 'washing' }), summary(2, { status: 'ready' })]) => {
      api.searchCounterOrders.mockResolvedValue(results);
      nav('Orders / Pickup');
      await screen.findByText(results[0].orderNumber);
    };

    it('prints the bill of the chosen order and says so, without opening the order', async () => {
      await signIn();
      await openList();
      api.reprintCounterOutput.mockResolvedValue(job('bill', 'pending', 'o-2'));
      api.dispatchPrintJob.mockResolvedValue(job('bill', 'submitted', 'o-2'));
      fireEvent.click(screen.getAllByRole('button', { name: 'Reprint bill' })[1]);
      await screen.findByText('Bill SL-1 sent to the printer.');
      expect(api.reprintCounterOutput).toHaveBeenCalledWith('o-2', 'bill', [], expect.any(String));
      expect(screen.queryByRole('heading', { name: 'SL-2' })).toBeNull();
    });

    it('uses a separate request key for each order, and a fresh one after a bill printed', async () => {
      await signIn();
      await openList();
      api.reprintCounterOutput.mockResolvedValue(job('bill', 'pending'));
      api.dispatchPrintJob.mockResolvedValue(job('bill', 'submitted'));
      const [first, second] = screen.getAllByRole('button', { name: 'Reprint bill' });
      fireEvent.click(first);
      await screen.findByText('Bill SL-1 sent to the printer.');
      fireEvent.click(second);
      await waitFor(() => expect(api.reprintCounterOutput).toHaveBeenCalledTimes(2));
      fireEvent.click(first);
      await waitFor(() => expect(api.reprintCounterOutput).toHaveBeenCalledTimes(3));
      const keys = api.reprintCounterOutput.mock.calls.map(call => call[3]);
      expect(new Set(keys).size).toBe(3);
    });

    it('keeps the request key and says what to do when the printer does not take the bill', async () => {
      await signIn();
      await openList();
      api.reprintCounterOutput.mockResolvedValue(job('bill', 'pending'));
      api.dispatchPrintJob.mockResolvedValue(job('bill', 'failed'));
      fireEvent.click(screen.getAllByRole('button', { name: 'Reprint bill' })[0]);
      expect((await screen.findByRole('alert')).textContent).toContain('did not print');
    });

    it('says in plain words when the reprint cannot be requested, and retries with the same key', async () => {
      await signIn();
      await openList();
      api.reprintCounterOutput.mockRejectedValueOnce(new Error('database is busy'));
      fireEvent.click(screen.getAllByRole('button', { name: 'Reprint bill' })[0]);
      expect((await screen.findByRole('alert')).textContent).toBe('The bill could not be printed: database is busy. Press Reprint bill again to retry.');
      api.reprintCounterOutput.mockResolvedValue(job('bill', 'pending'));
      api.dispatchPrintJob.mockResolvedValue(job('bill', 'submitted'));
      fireEvent.click(screen.getAllByRole('button', { name: 'Reprint bill' })[0]);
      await screen.findByText('Bill SL-1 sent to the printer.');
      const keys = api.reprintCounterOutput.mock.calls.map(call => call[3]);
      expect(keys[0]).toBe(keys[1]);
    });
  });

  it('opens the print progress from the order page, and Back returns to the order', async () => {
    await signIn();
    await openOrdersAndFirstOrder();
    await openPrintProgress();
    expect(screen.getByRole('heading', { name: 'SL-1 · Print progress' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '← Order' }));
    await screen.findByRole('heading', { name: 'SL-1' });
  });

  it('lists only tagged pieces for tag reprints, and says when no tags are needed', async () => {
    await signIn();
    const mixed = [{ ...pieces[0] }, { ...pieces[1], tagged: false, service: 'Iron' }];
    api.getCounterOrder.mockResolvedValue(savedOrder({ pieces: mixed }));
    await openOrdersAndFirstOrder();
    await openPrintProgress();
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '← Order' }));
    api.getCounterOrder.mockResolvedValue(savedOrder({ pieces: mixed.map(piece => ({ ...piece, tagged: false })) }));
    nav('Orders / Pickup');
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    await screen.findByRole('heading', { name: 'SL-1' });
    await openPrintProgress();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getByText('No tags needed for this order.')).toBeTruthy();
  });

  it('opens the order of a freshly saved bill from its print progress', async () => {
    await signIn();
    await startOrder();
    fireEvent.click(screen.getByRole('button', { name: 'Save & Print' }));
    await screen.findByText(/Order SL-1 saved/);
    fireEvent.click(screen.getByRole('button', { name: '← Order' }));
    await screen.findByRole('heading', { name: 'SL-1' });
    expect(screen.getByRole('button', { name: 'Orders / Pickup' }).getAttribute('aria-current')).toBe('page');
  });

  it('starts from a clean list for the next person who signs in', async () => {
    await signIn();
    api.searchCounterOrders.mockResolvedValue([summary(1)]);
    nav('Orders / Pickup');
    await screen.findByText('SL-1');
    fireEvent.change(searchBox(), { target: { value: 'rita' } });
    await waitFor(() => expect(api.searchCounterOrders).toHaveBeenLastCalledWith('rita', 0, 50, 'all'));
    api.getCounterBootstrap.mockResolvedValue(unauthenticated());
    fireEvent.click(screen.getByRole('button', { name: /Lock/ }));
    await screen.findByText('Choose your name and enter your PIN.');
    api.loginCounter.mockResolvedValue(admin);
    fireEvent.click(screen.getByRole('button', { name: 'Admin' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'admin-1' } });
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByLabelText('Garments');
    nav('Orders / Pickup');
    await screen.findByText('SL-1');
    expect(searchBox().value).toBe('');
    expect(screen.getByRole('button', { name: /^Ready/ }).getAttribute('aria-pressed')).toBe('true');
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
