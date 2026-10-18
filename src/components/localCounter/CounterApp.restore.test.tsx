// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { CounterApp } from './CounterApp';
import type { CounterAccount, CounterCatalogue } from '@/lib/localFirst/counter';

const api = vi.hoisted(() => ({
  getCounterBootstrap: vi.fn(), getCounterCatalogue: vi.fn(), lockCounter: vi.fn(), searchCounterCustomers: vi.fn(),
  searchCounterOrders: vi.fn(), enumeratePrinters: vi.fn(), getPrinterProfiles: vi.fn(), listCounterStaff: vi.fn(), listCounterTrashRequests: vi.fn(), listPrintJobs: vi.fn(),
  quoteCounterOrder: vi.fn(), getCounterOrder: vi.fn(), getOrderPieces: vi.fn(),
}));
vi.mock('@/lib/localFirst/counter', () => api);

// The Admin screen is tested on its own. Here it is a stand-in that reports a staged restore, so
// only the shell's banner wiring is under test.
vi.mock('./CounterAdmin', () => ({
  CounterAdmin: ({ onRestoreStaged }: { onRestoreStaged: () => void }) => <button onClick={onRestoreStaged}>Stage a restore</button>,
}));

const staff: CounterAccount = { id: 'staff-1', fullName: 'Asha Patil', role: 'staff', active: true };
const admin: CounterAccount = { id: 'admin-1', fullName: 'Mira Shah', role: 'admin', active: true };
const catalogue: CounterCatalogue = {
  services: [{ id: 'wash', key: 'wash', name: 'Wash', active: true }],
  garments: [{ id: 'shirt', key: 'shirt', nameEn: 'Shirt', nameMr: 'शर्ट', category: 'tops', imageKey: 'shirt', billingUnit: 'piece', active: true }],
  rates: [{ garmentId: 'shirt', serviceId: 'wash', priceMinor: 1200, configured: true, available: true, version: 1 }],
};
const bootstrapFor = (account: CounterAccount | null, restorePending: boolean) => ({
  setupRequired: false, authenticated: account !== null, account, accounts: [staff, admin], warning: null, restorePending,
});
const banner = () => screen.queryByText(/A backup restore is staged/);

beforeEach(() => {
  vi.clearAllMocks();
  api.getCounterCatalogue.mockResolvedValue(catalogue);
  api.lockCounter.mockResolvedValue(undefined);
  api.searchCounterCustomers.mockResolvedValue([]);
  api.searchCounterOrders.mockResolvedValue([]);
  api.listCounterStaff.mockResolvedValue([]);
  api.listCounterTrashRequests.mockResolvedValue([]);
  api.listPrintJobs.mockResolvedValue([]);
  api.getOrderPieces.mockResolvedValue([]);
  api.enumeratePrinters.mockResolvedValue([]);
  api.getPrinterProfiles.mockResolvedValue(null);
});
afterEach(cleanup);

describe('restore-pending banner', () => {
  it('is not shown when nothing is staged', async () => {
    api.getCounterBootstrap.mockResolvedValue(bootstrapFor(admin, false));
    render(<CounterApp />);
    await screen.findByLabelText('Garments');
    expect(banner()).toBeNull();
  });

  it('warns on the sign-in screen when a restore was staged before the app was reopened', async () => {
    api.getCounterBootstrap.mockResolvedValue(bootstrapFor(null, true));
    render(<CounterApp />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Close and reopen Smart Laundry/);
    expect(alert.textContent).toMatch(/accounts and PINs/);
    expect(alert.textContent).toMatch(/deactivated/);
    expect(screen.getByText('Choose your name and enter your PIN.')).toBeTruthy();
  });

  it('shows in the workspace for a signed-in user while a staged restore waits for a restart', async () => {
    api.getCounterBootstrap.mockResolvedValue(bootstrapFor(staff, true));
    render(<CounterApp />);
    await screen.findByLabelText('Garments');
    expect(banner()).toBeTruthy();
  });

  it('appears as soon as an administrator stages a restore and stays on every screen', async () => {
    api.getCounterBootstrap.mockResolvedValue(bootstrapFor(admin, false));
    render(<CounterApp />);
    await screen.findByLabelText('Garments');
    const nav = within(screen.getByRole('navigation', { name: 'Workspace sections' }));
    fireEvent.click(nav.getByRole('button', { name: 'Admin' }));
    expect(banner()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stage a restore' }));
    expect(banner()).toBeTruthy();
    fireEvent.click(nav.getByRole('button', { name: 'New order' }));
    expect(await screen.findByLabelText('Garments')).toBeTruthy();
    expect(banner()).toBeTruthy();
  });
});
