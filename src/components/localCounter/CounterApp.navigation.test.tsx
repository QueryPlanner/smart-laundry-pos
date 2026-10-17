// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CounterApp } from './CounterApp';
import { NAV_GROUPS, canOpen, visibleNavGroups, type SectionProps } from './sections';
import type { CounterAccount, CounterCatalogue, CounterSavedOrder } from '@/lib/localFirst/counter';

const api = vi.hoisted(() => ({
  getCounterBootstrap: vi.fn(), getCounterCatalogue: vi.fn(), getCounterOrder: vi.fn(), getCounterOrderQueueCounts: vi.fn(), getOrderPieces: vi.fn(),
  listPrintJobs: vi.fn(), lockCounter: vi.fn(), quoteCounterOrder: vi.fn(), searchCounterCustomers: vi.fn(), searchCounterOrders: vi.fn(),
  listCounterStaff: vi.fn(), enumeratePrinters: vi.fn(), getPrinterProfiles: vi.fn(),
}));
vi.mock('@/lib/localFirst/counter', () => api);

// The section screens are built and tested on their own. Here each one is a stand-in that shows
// who it was given and can ask the shell to open an order, so only the shell's wiring is under test.
const received = vi.hoisted(() => ({ props: {} as Record<string, unknown> }));
const stand = vi.hoisted(() => (name: string) => (props: SectionProps) => {
  received.props[name] = props;
  return (
    <section>
      <h1>{name} page</h1>
      <p>{`${name} for ${props.account.fullName}`}</p>
      <button onClick={() => props.onOpenOrder('o-7')}>{`Open order from ${name}`}</button>
      <button onClick={() => props.onNotice(`${name} notice`)}>{`Notify from ${name}`}</button>
      <button onClick={() => props.onError(new Error(`${name} failed`))}>{`Fail from ${name}`}</button>
    </section>
  );
});
vi.mock('./DashboardPage', () => ({ DashboardPage: stand('Dashboard') }));
vi.mock('./SalesPage', () => ({ SalesPage: stand('Sales') }));
vi.mock('./CustomersPage', () => ({ CustomersPage: stand('Customers') }));
vi.mock('./ExpensesPage', () => ({ ExpensesPage: stand('Expenses') }));
vi.mock('./InventoryPage', () => ({ InventoryPage: stand('Inventory') }));
vi.mock('./MachinesPage', () => ({ MachinesPage: stand('Machines') }));
vi.mock('./ShopSettingsPage', () => ({ ShopSettingsPage: stand('Settings') }));

const staff: CounterAccount = { id: 'staff-1', fullName: 'Asha Patil', role: 'staff', active: true };
const admin: CounterAccount = { id: 'admin-1', fullName: 'Mira Shah', role: 'admin', active: true };
const catalogue: CounterCatalogue = {
  services: [{ id: 'wash', key: 'wash', name: 'Wash', active: true }],
  garments: [{ id: 'shirt', key: 'shirt', nameEn: 'Shirt', nameMr: 'शर्ट', category: 'tops', imageKey: 'shirt', billingUnit: 'piece', active: true }],
  rates: [{ garmentId: 'shirt', serviceId: 'wash', priceMinor: 1200, configured: true, available: true, version: 1 }],
};
const order = (): CounterSavedOrder => ({
  orderId: 'o-7', orderNumber: 'SL-7', customerName: 'Rita Joshi', customerPhone: '9876543210', paymentStatus: 'unpaid', collectedAt: null, refundDueMinor: 0, payments: [], receivedAt: '2026-10-15T06:00:00Z', promisedAt: '2026-10-17T11:30:00Z', status: 'ready',
  totalMinor: 4000, paidMinor: 0, balanceMinor: 4000, pieces: [], printJobs: [],
} as unknown as CounterSavedOrder);

const signedInAs = async (account: CounterAccount) => {
  api.getCounterBootstrap.mockResolvedValue({ setupRequired: false, authenticated: true, account, accounts: [account], warning: null });
  render(<CounterApp />);
  await screen.findByText('Choose service');
};
const navigation = () => within(screen.getByRole('navigation', { name: 'Workspace sections' }));
const go = (name: string) => fireEvent.click(navigation().getByRole('button', { name }));
const labels = () => navigation().getAllByRole('button').map(button => button.textContent);
const startDraft = () => fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Rita Joshi' } });
const draftDialog = () => screen.queryByRole('alertdialog', { name: 'Unsaved order' });

beforeEach(() => {
  vi.clearAllMocks();
  received.props = {};
  api.getCounterCatalogue.mockResolvedValue(catalogue);
  api.getCounterOrder.mockResolvedValue(order());
  api.getOrderPieces.mockResolvedValue([]);
  api.listPrintJobs.mockResolvedValue([]);
  api.lockCounter.mockResolvedValue(undefined);
  api.searchCounterCustomers.mockResolvedValue([]);
  api.searchCounterOrders.mockResolvedValue([]);
  api.getCounterOrderQueueCounts.mockResolvedValue({ ready: 0, balanceDue: 0, overdue: 0, inProcess: 0, today: 0, all: 0, balanceDueMinor: 0 });
  api.listCounterStaff.mockResolvedValue([]);
  api.enumeratePrinters.mockResolvedValue([]);
  api.getPrinterProfiles.mockResolvedValue(null);
});
afterEach(cleanup);

describe('navigation registry', () => {
  it('lists the groups in the order the shell shows them', () => {
    expect(NAV_GROUPS.map(group => group.label)).toEqual(['Counter', 'Insights', 'Shop', 'Admin']);
    expect(NAV_GROUPS.flatMap(group => group.sections.map(section => section.label))).toEqual([
      'New order', 'Orders / Pickup', 'Print queue', 'Dashboard', 'Sales', 'Customers', 'Expenses', 'Inventory', 'Machines', 'Admin', 'Shop settings',
    ]);
  });

  it('drops admin-only sections, and the whole Admin group, for staff', () => {
    expect(visibleNavGroups('staff').map(group => group.label)).toEqual(['Counter', 'Insights', 'Shop']);
    expect(visibleNavGroups('admin').map(group => group.label)).toEqual(['Counter', 'Insights', 'Shop', 'Admin']);
    expect(canOpen('admin', 'staff')).toBe(false);
    expect(canOpen('settings', 'staff')).toBe(false);
    expect(canOpen('sales', 'staff')).toBe(true);
    expect(canOpen('settings', 'admin')).toBe(true);
  });
});

describe('role-filtered navigation', () => {
  it('shows staff the counter, insights and shop sections but never Admin or Shop settings', async () => {
    await signedInAs(staff);
    expect(labels()).toEqual(['New order', 'Orders / Pickup', 'Print queue', 'Dashboard', 'Sales', 'Customers', 'Expenses', 'Inventory', 'Machines']);
    expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Shop settings' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Admin' })).toBeNull();
  });

  it('shows administrators every section in four labelled groups', async () => {
    await signedInAs(admin);
    expect(labels()).toHaveLength(11);
    expect(navigation().getByRole('button', { name: 'Admin' })).toBeTruthy();
    expect(navigation().getByRole('button', { name: 'Shop settings' })).toBeTruthy();
    for (const group of ['Counter', 'Insights', 'Shop', 'Admin']) expect(navigation().getByRole('group', { name: group })).toBeTruthy();
  });

  it('keeps the signed-in name, role badge and Lock in the top bar', async () => {
    await signedInAs(staff);
    expect(screen.getByText('Staff · Asha Patil')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Lock/ })).toBeTruthy();
    cleanup();
    await signedInAs(admin);
    expect(screen.getByText('Admin · Mira Shah')).toBeTruthy();
  });

  it('lands on New order for both roles and marks the current section', async () => {
    await signedInAs(staff);
    expect(navigation().getByRole('button', { name: 'New order' }).getAttribute('aria-current')).toBe('page');
    expect(navigation().getByRole('button', { name: 'Sales' }).getAttribute('aria-current')).toBeNull();
    cleanup();
    await signedInAs(admin);
    expect(navigation().getByRole('button', { name: 'New order' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('heading', { name: 'Dashboard page' })).toBeNull();
  });
});

describe('section pages', () => {
  const pages: Array<[nav: string, heading: string]> = [
    ['Dashboard', 'Dashboard page'], ['Sales', 'Sales page'], ['Customers', 'Customers page'], ['Expenses', 'Expenses page'],
    ['Machines', 'Machines page'], ['Inventory', 'Inventory page'],
  ];

  it.each(pages)('opens %s for staff and passes it the signed-in account', async (name, heading) => {
    await signedInAs(staff);
    go(name);
    expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
    expect(navigation().getByRole('button', { name }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByText('Choose service')).toBeNull();
  });

  it('opens Shop settings and Admin for administrators', async () => {
    await signedInAs(admin);
    go('Shop settings');
    expect(await screen.findByRole('heading', { name: 'Settings page' })).toBeTruthy();
    expect(screen.getByText('Settings for Mira Shah')).toBeTruthy();
    go('Admin');
    expect(await screen.findByText('Rates, staff & printers')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Settings page' })).toBeNull();
  });

  it('shows a section notice and error from a page in the shell banners', async () => {
    await signedInAs(staff);
    go('Customers');
    fireEvent.click(await screen.findByRole('button', { name: 'Notify from Customers' }));
    expect((await screen.findByRole('status')).textContent).toBe('Customers notice');
    fireEvent.click(screen.getByRole('button', { name: 'Fail from Customers' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Customers failed');
  });

  it('gives sections callbacks that stay the same across shell renders', async () => {
    await signedInAs(staff);
    go('Sales');
    fireEvent.click(await screen.findByRole('button', { name: 'Notify from Sales' }));
    await screen.findByRole('status');
    const first = received.props.Sales as SectionProps;
    fireEvent.click(screen.getByRole('button', { name: 'Notify from Sales' }));
    const latest = received.props.Sales as SectionProps;
    expect(latest.onOpenOrder).toBe(first.onOpenOrder);
    expect(latest.onError).toBe(first.onError);
    expect(latest.onNotice).toBe(first.onNotice);
  });
});

describe('opening an order from another section', () => {
  it('shows the order details under Orders / Pickup when a section asks for it', async () => {
    await signedInAs(staff);
    go('Customers');
    fireEvent.click(await screen.findByRole('button', { name: 'Open order from Customers' }));
    expect(await screen.findByRole('heading', { name: 'SL-7' })).toBeTruthy();
    expect(api.getCounterOrder).toHaveBeenCalledWith('o-7');
    expect(navigation().getByRole('button', { name: 'Orders / Pickup' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('heading', { name: 'Customers page' })).toBeNull();
    // The order says who it belongs to, and Back goes to the section it was opened from.
    expect(screen.getByText('Rita Joshi · 9876543210')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '← Customers' }));
    expect(await screen.findByRole('heading', { name: 'Customers page' })).toBeTruthy();
  });

  it('reports an order that cannot be opened and stays on the section', async () => {
    api.getCounterOrder.mockResolvedValue(null);
    await signedInAs(staff);
    go('Sales');
    fireEvent.click(await screen.findByRole('button', { name: 'Open order from Sales' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This order is no longer available.');
    expect(screen.getByRole('heading', { name: 'Sales page' })).toBeTruthy();
  });

  it('keeps Orders / Pickup current on every page of the opened order, with no extra navigation items', async () => {
    await signedInAs(staff);
    go('Machines');
    fireEvent.click(await screen.findByRole('button', { name: 'Open order from Machines' }));
    await screen.findByRole('heading', { name: 'SL-7' });
    expect(labels()).not.toContain('Print progress');
    expect(labels()).not.toContain('Packing / pickup');
    fireEvent.click(screen.getByRole('button', { name: 'Hand over to customer →' }));
    await screen.findByRole('button', { name: '← Order' });
    expect(navigation().getByRole('button', { name: 'Orders / Pickup' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: '← Order' }));
    fireEvent.click(await screen.findByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Print status' }));
    await screen.findByRole('heading', { name: 'SL-7 · Print progress' });
    expect(navigation().getByRole('button', { name: 'Orders / Pickup' }).getAttribute('aria-current')).toBe('page');
    go('Dashboard');
    expect(await screen.findByRole('heading', { name: 'Dashboard page' })).toBeTruthy();
    expect(navigation().getByRole('button', { name: 'Orders / Pickup' }).getAttribute('aria-current')).toBeNull();
  });

  it('goes back from the order to the section it was opened from, and from there back to its own pages', async () => {
    await signedInAs(staff);
    go('Machines');
    fireEvent.click(await screen.findByRole('button', { name: 'Open order from Machines' }));
    fireEvent.click(await screen.findByRole('button', { name: '← Machines' }));
    expect(await screen.findByRole('heading', { name: 'Machines page' })).toBeTruthy();
  });
});

describe('the unsaved-order guard on every section', () => {
  const destinations = ['Orders / Pickup', 'Print queue', 'Dashboard', 'Sales', 'Customers', 'Expenses', 'Inventory', 'Machines'];

  it.each(destinations)('asks before %s replaces an order being taken, and Keep editing stays put', async name => {
    await signedInAs(staff);
    startDraft();
    go(name);
    expect(draftDialog()?.textContent).toContain('You have an unsaved order. Discard it?');
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(draftDialog()).toBeNull();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Rita Joshi');
  });

  it.each(['Dashboard', 'Sales', 'Customers', 'Expenses', 'Machines'])('goes to %s after the draft is discarded', async name => {
    await signedInAs(staff);
    startDraft();
    go(name);
    fireEvent.click(screen.getByRole('button', { name: 'Discard order' }));
    expect(await screen.findByRole('heading', { name: `${name} page` })).toBeTruthy();
    expect(draftDialog()).toBeNull();
    go('New order');
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('');
  });

  it('guards the administrator sections too', async () => {
    await signedInAs(admin);
    startDraft();
    go('Shop settings');
    expect(draftDialog()).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    go('Admin');
    expect(draftDialog()).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Discard order' }));
    expect(await screen.findByText('Rates, staff & printers')).toBeTruthy();
  });

  it('moves on at once when there is no draft, and does nothing for New order while already on it', async () => {
    await signedInAs(staff);
    go('New order');
    expect(draftDialog()).toBeNull();
    go('Sales');
    expect(draftDialog()).toBeNull();
    expect(await screen.findByRole('heading', { name: 'Sales page' })).toBeTruthy();
    go('New order');
    expect(await screen.findByText('Choose service')).toBeTruthy();
  });

  it('still guards Lock, and a failed lock keeps the draft', async () => {
    await signedInAs(staff);
    startDraft();
    api.lockCounter.mockRejectedValue(new Error('session store unavailable'));
    fireEvent.click(screen.getByRole('button', { name: /Lock/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard order' }));
    expect((await screen.findByRole('alert')).textContent).toContain('could not be locked');
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Rita Joshi');
  });

  it('refreshes the print jobs when the queue opens', async () => {
    await signedInAs(staff);
    go('Print queue');
    await waitFor(() => expect(api.listPrintJobs).toHaveBeenCalledWith());
  });
});

describe('narrow screens', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

  it('renders the navigation as one bar with grouped, non-wrapping buttons', async () => {
    await signedInAs(admin);
    const bar = screen.getByRole('navigation', { name: 'Workspace sections' });
    expect(bar.className).toBe('counter-nav');
    expect(bar.querySelectorAll('.counter-nav-group')).toHaveLength(4);
  });

  it('styles that bar to wrap onto further rows, with buttons that never shrink', () => {
    const bar = /\.counter-nav\{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(bar).toContain('display:flex');
    expect(bar).toContain('flex-wrap:wrap');
    expect(bar).not.toContain('overflow-x');
    expect(css).toMatch(/\.counter-nav-group\{[^}]*flex-wrap:wrap/);
    expect(css).toMatch(/\.counter-nav button\{[^}]*flex:none;white-space:nowrap/);
    expect(css).toMatch(/@media\(max-width:620px\)\{[^@]*\.counter-nav-label\{display:none\}/);
  });
});
