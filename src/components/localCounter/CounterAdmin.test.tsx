// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CounterAdmin } from './CounterAdmin';
import type { CounterAccount, CounterCatalogue, NativePrinter } from '@/lib/localFirst/counter';

const api = vi.hoisted(() => ({
  createCounterStaff: vi.fn(), enumeratePrinters: vi.fn(), getPrinterProfiles: vi.fn(), listCounterStaff: vi.fn(),
  resetCounterStaffPin: vi.fn(), setCounterRate: vi.fn(), setCounterStaffActive: vi.fn(), setPrinterProfiles: vi.fn(), getCounterCatalogue: vi.fn(),
}));
vi.mock('@/lib/localFirst/counter', () => api);
vi.mock('./CounterDiscounts', () => ({ CounterDiscounts: () => <p>discounts panel</p> }));
vi.mock('./CounterBackups', () => ({ CounterBackups: () => <p>backups panel</p> }));

const catalogue: CounterCatalogue = {
  garments: [
    { id: 'shirt', key: 'shirt', nameEn: 'Shirt', nameMr: 'शर्ट', category: 'tops', imageKey: 'shirt', billingUnit: 'piece', active: true },
    { id: 'shoe', key: 'shoes', nameEn: 'Shoes', nameMr: 'शूज', category: 'foot', imageKey: 'shoes', billingUnit: 'pair', active: true },
    { id: 'retired', key: 'retired', nameEn: 'Retired', nameMr: '', category: 'x', imageKey: 'x', billingUnit: 'piece', active: false },
  ],
  services: [
    { id: 'wash', key: 'wash', name: 'Wash', active: true }, { id: 'iron', key: 'iron', name: 'Iron', active: true },
    { id: 'wi', key: 'wash_iron', name: 'Wash + Iron', active: true }, { id: 'off', key: 'dry_clean', name: 'Dry Clean', active: false },
  ],
  rates: [
    { garmentId: 'shirt', serviceId: 'wash', priceMinor: 1500, configured: true, available: true, version: 1 },
    { garmentId: 'shirt', serviceId: 'iron', priceMinor: null, configured: false, available: false, version: 1 },
    { garmentId: 'shoe', serviceId: 'wash', priceMinor: 15000, configured: true, available: false, version: 3 },
  ],
};
const printers: NativePrinter[] = [
  { id: 'Canon LBP', name: 'Canon LBP', isDefault: true, isAvailable: true },
  { id: 'TSC TE244', name: 'TSC TE244', isDefault: false, isAvailable: true },
  { id: 'Offline', name: 'Offline', isDefault: false, isAvailable: false },
];
const staffRow = (extra: Partial<CounterAccount>): CounterAccount => ({ id: 's1', fullName: 'Asha', role: 'staff', active: true, ...extra });

const setup = (overrides: Partial<React.ComponentProps<typeof CounterAdmin>> = {}) => {
  const props = { catalogue, onCatalogue: vi.fn(), printers, onReloadPrinters: vi.fn(), onError: vi.fn(), onNotice: vi.fn(), onRestoreStaged: vi.fn(), ...overrides };
  render(<CounterAdmin {...props} />);
  return props;
};
const rateRow = (label: string) => screen.getByLabelText(label).closest('.counter-rate-row') as HTMLElement;
const tab = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => {
  vi.clearAllMocks();
  api.getCounterCatalogue.mockResolvedValue(catalogue);
  api.setCounterRate.mockResolvedValue(undefined);
  api.listCounterStaff.mockResolvedValue([staffRow({}), staffRow({ id: 's2', fullName: 'Ravi', active: false }), staffRow({ id: 'a1', fullName: 'Owner', role: 'admin' })]);
  api.enumeratePrinters.mockResolvedValue(printers);
  api.getPrinterProfiles.mockResolvedValue({ billPrinterId: 'Canon LBP', tagPrinterId: 'TSC TE244' });
  api.createCounterStaff.mockResolvedValue(staffRow({}));
  api.setCounterStaffActive.mockResolvedValue(undefined);
  api.resetCounterStaffPin.mockResolvedValue(undefined);
  api.setPrinterProfiles.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('CounterAdmin rate card', () => {
  it('lists active garments and services, locks ironing for shoes, and shows unset rates blank', () => {
    setup();
    expect((screen.getByLabelText('Shirt Wash price') as HTMLInputElement).value).toBe('15.00');
    expect((screen.getByLabelText('Shirt Iron price') as HTMLInputElement).value).toBe('');
    expect(screen.queryByLabelText('Retired Wash price')).toBeNull();
    expect(screen.queryByLabelText('Shirt Dry Clean price')).toBeNull();
    expect((screen.getByLabelText('Shoes Iron price') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getAllByText(/not supported for shoes/).length).toBe(2);
  });

  it('saves a price in paise and refreshes the catalogue', async () => {
    const props = setup();
    fireEvent.change(screen.getByLabelText('Shirt Wash price'), { target: { value: '15.50' } });
    fireEvent.click(within(rateRow('Shirt Wash price')).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.setCounterRate).toHaveBeenCalledWith('shirt', 'wash', 1550, true));
    await waitFor(() => expect(props.onCatalogue).toHaveBeenCalledWith(catalogue));
    expect(props.onNotice).toHaveBeenCalledWith('Rate updated for future orders.');
  });

  it('clears a rate when the box is emptied and honours the available checkbox', async () => {
    setup();
    fireEvent.change(screen.getByLabelText('Shirt Wash price'), { target: { value: '' } });
    expect((screen.getByLabelText('Shirt Wash available') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(within(rateRow('Shirt Wash price')).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.setCounterRate).toHaveBeenCalledWith('shirt', 'wash', null, true));
    fireEvent.change(screen.getByLabelText('Shoes Wash price'), { target: { value: '120' } });
    fireEvent.click(screen.getByLabelText('Shoes Wash available'));
    fireEvent.click(within(rateRow('Shoes Wash price')).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.setCounterRate).toHaveBeenCalledWith('shoe', 'wash', 12000, true));
  });

  it('rejects negative and overflowing prices and reports native failures', async () => {
    const props = setup();
    const bad = ['-5', '1e308', '1e3', '15.505', '12,5', 'abc'];
    for (const value of bad) {
      fireEvent.change(screen.getByLabelText('Shirt Wash price'), { target: { value } });
      fireEvent.click(within(rateRow('Shirt Wash price')).getByRole('button', { name: 'Save' }));
    }
    await waitFor(() => expect(props.onError).toHaveBeenCalledTimes(bad.length));
    expect(props.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Enter a valid non-negative amount.' }));
    expect(api.setCounterRate).not.toHaveBeenCalled();
    api.setCounterRate.mockRejectedValue(new Error('Administrator access is required'));
    fireEvent.change(screen.getByLabelText('Shirt Wash price'), { target: { value: '20' } });
    fireEvent.click(within(rateRow('Shirt Wash price')).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(props.onError).toHaveBeenCalledTimes(bad.length + 1));
  });

  it('warns that the starting prices are estimates', () => {
    setup();
    expect(screen.getByText('The starting prices are estimates. Check every price before using the app with customers.')).toBeTruthy();
  });

  it('makes a garment sellable when its first price is typed, unless the admin unticked it', async () => {
    setup();
    const available = () => screen.getByLabelText('Shirt Iron available') as HTMLInputElement;
    expect(available().checked).toBe(false);
    fireEvent.change(screen.getByLabelText('Shirt Iron price'), { target: { value: '8' } });
    expect(available().checked).toBe(true);
    fireEvent.click(within(rateRow('Shirt Iron price')).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.setCounterRate).toHaveBeenCalledWith('shirt', 'iron', 800, true));
    // Clearing the box and typing again must not undo a deliberate untick.
    fireEvent.click(available());
    fireEvent.change(screen.getByLabelText('Shirt Iron price'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Shirt Iron price'), { target: { value: '9' } });
    expect(available().checked).toBe(false);
    fireEvent.click(within(rateRow('Shirt Iron price')).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.setCounterRate).toHaveBeenLastCalledWith('shirt', 'iron', 900, false));
  });

  it('leaves an existing price and its availability alone when the price is edited', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Shoes Wash price'), { target: { value: '140' } });
    expect((screen.getByLabelText('Shoes Wash available') as HTMLInputElement).checked).toBe(false);
  });

  it('has no link to a second admin workspace and switches between every tab', async () => {
    setup();
    expect(screen.queryByRole('button', { name: /full admin workspace/i })).toBeNull();
    tab('Discounts'); expect(screen.getByText('discounts panel')).toBeTruthy();
    tab('Backups'); expect(screen.getByText('backups panel')).toBeTruthy();
    tab('Rate card'); expect(screen.getByLabelText('Shirt Wash price')).toBeTruthy();
  });

  it('picks up a refreshed catalogue passed in from above', () => {
    const view = render(<CounterAdmin catalogue={catalogue} onCatalogue={vi.fn()} printers={printers} onReloadPrinters={vi.fn()} onError={vi.fn()} onNotice={vi.fn()} onRestoreStaged={vi.fn()} />);
    const changed = { ...catalogue, rates: catalogue.rates.map(r => (r.garmentId === 'shirt' && r.serviceId === 'wash' ? { ...r, priceMinor: 2000 } : r)) };
    view.rerender(<CounterAdmin catalogue={changed} onCatalogue={vi.fn()} printers={printers} onReloadPrinters={vi.fn()} onError={vi.fn()} onNotice={vi.fn()} onRestoreStaged={vi.fn()} />);
    expect((screen.getAllByLabelText('Shirt Wash price')[0] as HTMLInputElement).value).toBe('20.00');
  });

  it('renders with no catalogue loaded', () => {
    setup({ catalogue: null });
    expect(screen.queryByLabelText('Shirt Wash price')).toBeNull();
  });
});

describe('CounterAdmin staff', () => {
  it('lists only staff, creates an account and clears the form', async () => {
    const props = setup();
    tab('Staff');
    await screen.findByText('Asha');
    expect(screen.queryByText('Owner')).toBeNull();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Meera' } });
    fireEvent.change(screen.getByLabelText('Initial PIN'), { target: { value: '4321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create staff' }));
    await waitFor(() => expect(api.createCounterStaff).toHaveBeenCalledWith({ fullName: 'Meera', pin: '4321' }));
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith('Staff account created.'));
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('');
  });

  it('reports a failed creation and keeps what was typed', async () => {
    api.createCounterStaff.mockRejectedValue(new Error('PIN must contain 4 to 8 digits.'));
    const props = setup();
    tab('Staff');
    await screen.findByText('Asha');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Meera' } });
    fireEvent.change(screen.getByLabelText('Initial PIN'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create staff' }));
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'PIN must contain 4 to 8 digits.' })));
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Meera');
  });

  it('deactivates, reactivates and resets a PIN', async () => {
    const props = setup();
    tab('Staff');
    await screen.findByText('Asha');
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(api.setCounterStaffActive).toHaveBeenCalledWith('s1', false));
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
    await waitFor(() => expect(api.setCounterStaffActive).toHaveBeenCalledWith('s2', true));
    const reset = screen.getAllByRole('button', { name: 'Reset PIN' })[0] as HTMLButtonElement;
    expect(reset.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('New PIN for Asha'), { target: { value: '9999' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Reset PIN' })[0]);
    await waitFor(() => expect(api.resetCounterStaffPin).toHaveBeenCalledWith('s1', '9999'));
    await waitFor(() => expect((screen.getByLabelText('New PIN for Asha') as HTMLInputElement).value).toBe(''));
    expect(props.onError).not.toHaveBeenCalled();
    expect(props.onNotice).toHaveBeenCalledWith('Asha can no longer sign in.');
    expect(props.onNotice).toHaveBeenCalledWith('Ravi can sign in again.');
    expect(props.onNotice).toHaveBeenCalledWith('New PIN saved for Asha.');
  });

  it('reports failures to change or reset an account, and a failed list', async () => {
    const props = setup();
    tab('Staff');
    await screen.findByText('Asha');
    api.setCounterStaffActive.mockRejectedValue(new Error('cannot'));
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(props.onError).toHaveBeenCalledTimes(1));
    api.resetCounterStaffPin.mockRejectedValue(new Error('cannot reset'));
    fireEvent.change(screen.getByLabelText('New PIN for Asha'), { target: { value: '9999' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Reset PIN' })[0]);
    await waitFor(() => expect(props.onError).toHaveBeenCalledTimes(2));
    cleanup();
    api.listCounterStaff.mockRejectedValue(new Error('list failed'));
    const second = setup();
    tab('Staff');
    await waitFor(() => expect(second.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'list failed' })));
  });
});

describe('CounterAdmin printers', () => {
  it('shows available queues, the saved choice, and the system default', async () => {
    setup();
    tab('Printers');
    await waitFor(() => expect((screen.getByLabelText('Canon bill printer') as HTMLSelectElement).value).toBe('Canon LBP'));
    expect((screen.getByLabelText('TSC tag printer') as HTMLSelectElement).value).toBe('TSC TE244');
    expect(screen.getByText(/Canon LBP · Available · system default/)).toBeTruthy();
    expect(screen.getByText(/Offline · Unavailable/)).toBeTruthy();
    expect(within(screen.getByLabelText('Canon bill printer')).queryByRole('option', { name: 'Offline' })).toBeNull();
  });

  it('saves a new choice for each printer', async () => {
    const props = setup();
    api.getPrinterProfiles.mockResolvedValue(null);
    tab('Printers');
    await waitFor(() => expect(api.enumeratePrinters).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Canon bill printer'), { target: { value: 'Canon LBP' } });
    fireEvent.change(screen.getByLabelText('TSC tag printer'), { target: { value: 'TSC TE244' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save printers' }));
    await waitFor(() => expect(api.setPrinterProfiles).toHaveBeenCalledWith({ billPrinterId: 'Canon LBP', tagPrinterId: 'TSC TE244' }));
    expect(props.onNotice).toHaveBeenCalledWith('Printer profiles saved.');
  });

  it('shows a reloaded printer list from above without touching the printers already picked', async () => {
    const props = { catalogue, onCatalogue: vi.fn(), printers, onReloadPrinters: vi.fn(), onError: vi.fn(), onNotice: vi.fn(), onRestoreStaged: vi.fn() };
    api.getPrinterProfiles.mockResolvedValue(null);
    const view = render(<CounterAdmin {...props} />);
    tab('Printers');
    await waitFor(() => expect(api.getPrinterProfiles).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Canon bill printer'), { target: { value: 'Canon LBP' } });
    const reloaded = [...printers, { id: 'New queue', name: 'New queue', isDefault: false, isAvailable: true }];
    view.rerender(<CounterAdmin {...props} printers={reloaded} />);
    expect(screen.getAllByText(/New queue · Available/).length).toBe(1);
    expect((screen.getByLabelText('Canon bill printer') as HTMLSelectElement).value).toBe('Canon LBP');
    expect(api.getPrinterProfiles).toHaveBeenCalledTimes(1);
  });

  it('refreshes the list, and reports save and load failures', async () => {
    api.setPrinterProfiles.mockRejectedValue(new Error('Selected printer is not available'));
    const props = setup();
    tab('Printers');
    await waitFor(() => expect(api.getPrinterProfiles).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Refresh printer list' }));
    expect(props.onReloadPrinters).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Save printers' }));
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Selected printer is not available' })));
    cleanup();
    api.enumeratePrinters.mockRejectedValue(new Error('no print system'));
    const second = setup();
    tab('Printers');
    await waitFor(() => expect(second.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'no print system' })));
  });
});
