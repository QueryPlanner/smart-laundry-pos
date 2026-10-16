// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MachinesPage } from './MachinesPage';
import { shopToday } from './officeFormat';
import type { CounterAccount } from '@/lib/localFirst/counter';
import type { OfficeMachine } from '@/lib/localFirst/office';

const api = vi.hoisted(() => ({ listOfficeMachines: vi.fn(), createOfficeMachine: vi.fn(), updateOfficeMachine: vi.fn(), deleteOfficeMachine: vi.fn() }));
vi.mock('@/lib/localFirst/office', () => api);

const staff: CounterAccount = { id: 's1', fullName: 'Clerk', role: 'staff', active: true };
const admin: CounterAccount = { id: 'a1', fullName: 'Owner', role: 'admin', active: true };
const washer: OfficeMachine = {
  id: 'm1', name: 'Washer 1', machineType: 'Washer', capacity: '12 kg', purchaseDate: '2024-05-01',
  lastMaintenanceDate: '2025-12-01', nextMaintenanceDate: '2026-01-15', notes: 'Belt noisy', maintenanceDue: true,
};
const iron: OfficeMachine = {
  id: 'm2', name: 'Iron A', machineType: 'Iron', capacity: null, purchaseDate: null,
  lastMaintenanceDate: null, nextMaintenanceDate: null, notes: null, maintenanceDue: false,
};

const setup = (account: CounterAccount = staff) => {
  const props = { account, onError: vi.fn(), onNotice: vi.fn(), onOpenOrder: vi.fn() };
  render(<MachinesPage {...props} />);
  return props;
};
const rowFor = async (name: string): Promise<HTMLElement> => (await screen.findByText(name)).closest('tr') as HTMLElement;
const fill = (form: HTMLElement, values: Record<string, string>) => {
  for (const [label, value] of Object.entries(values)) fireEvent.change(within(form).getByLabelText(label), { target: { value } });
};

beforeEach(() => {
  vi.clearAllMocks();
  api.listOfficeMachines.mockResolvedValue([washer, iron]);
  api.createOfficeMachine.mockResolvedValue(washer);
  api.updateOfficeMachine.mockResolvedValue(washer);
  api.deleteOfficeMachine.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('MachinesPage', () => {
  it('lists machines with service dates and flags what is due', async () => {
    setup();
    const due = await rowFor('Washer 1');
    expect(within(due).getByText('12 kg')).toBeTruthy();
    expect(within(due).getByText('Belt noisy')).toBeTruthy();
    expect(within(due).getByText('01 Dec 2025')).toBeTruthy();
    expect(within(due).getByText('15 Jan 2026')).toBeTruthy();
    expect(within(due).getByText('Due')).toBeTruthy();
    const unscheduled = await rowFor('Iron A');
    expect(within(unscheduled).getAllByText('—')).toHaveLength(2);
    expect(within(unscheduled).queryByText('Due')).toBeNull();
    const cards = Array.from(document.querySelectorAll<HTMLElement>('.counter-stat'));
    expect(within(cards[0]).getByText('2')).toBeTruthy();
    expect(within(cards[1]).getByText('1')).toBeTruthy();
  });

  it('shows an all-clear and explains an empty list', async () => {
    api.listOfficeMachines.mockResolvedValue([iron]);
    setup();
    await rowFor('Iron A');
    expect(document.querySelector('.counter-stat.good')).toBeTruthy();
    cleanup();
    api.listOfficeMachines.mockResolvedValue([]);
    setup();
    await screen.findByText(/No machines yet/);
  });

  it('adds a machine with only the filled details', async () => {
    const props = setup();
    await rowFor('Washer 1');
    fireEvent.click(screen.getByRole('button', { name: 'Add machine' }));
    const form = screen.getByRole('form', { name: 'Add machine' });
    fill(form, { Name: ' Dryer 1 ', Type: 'Dryer', 'Next service due': '2026-06-01' });
    fireEvent.click(within(form).getByRole('button', { name: 'Save machine' }));
    await waitFor(() => expect(api.createOfficeMachine).toHaveBeenCalledWith({
      name: 'Dryer 1', machineType: 'Dryer', capacity: undefined, purchaseDate: undefined,
      lastMaintenanceDate: undefined, nextMaintenanceDate: '2026-06-01', notes: undefined,
    }));
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith('Machine added.'));
    expect(screen.queryByRole('form', { name: 'Add machine' })).toBeNull();
  });

  it('edits every detail of a machine', async () => {
    const props = setup();
    fireEvent.click(within(await rowFor('Washer 1')).getByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: 'Edit machine' });
    expect((within(form).getByLabelText('Name') as HTMLInputElement).value).toBe('Washer 1');
    expect((within(form).getByLabelText('Last serviced') as HTMLInputElement).value).toBe('2025-12-01');
    fill(form, { 'Capacity (optional)': '', 'Notes (optional)': 'Fixed', 'Bought on': '2024-06-01', 'Last serviced': '2025-12-02', 'Next service due': '2026-01-16' });
    fireEvent.click(within(form).getByRole('button', { name: 'Save machine' }));
    await waitFor(() => expect(api.updateOfficeMachine).toHaveBeenCalledWith('m1', {
      name: 'Washer 1', machineType: 'Washer', capacity: undefined, purchaseDate: '2024-06-01',
      lastMaintenanceDate: '2025-12-02', nextMaintenanceDate: '2026-01-16', notes: 'Fixed',
    }));
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith('Machine updated.'));
  });

  it('edits a machine that has no optional details yet', async () => {
    setup();
    fireEvent.click(within(await rowFor('Iron A')).getByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: 'Edit machine' });
    expect((within(form).getByLabelText('Bought on') as HTMLInputElement).value).toBe('');
    expect((within(form).getByLabelText('Notes (optional)') as HTMLTextAreaElement).value).toBe('');
  });

  it('records a service: last date, next due date and notes', async () => {
    const props = setup();
    fireEvent.click(within(await rowFor('Washer 1')).getByRole('button', { name: 'Record service' }));
    const form = screen.getByRole('form', { name: 'Record service' });
    expect(within(form).getByText('Record service: Washer 1')).toBeTruthy();
    expect((within(form).getByLabelText('Serviced on') as HTMLInputElement).value).toBe(shopToday());
    expect((within(form).getByLabelText('Service notes') as HTMLTextAreaElement).value).toBe('Belt noisy');
    fill(form, { 'Next service due': '2026-09-01', 'Service notes': 'Replaced belt' });
    fireEvent.click(within(form).getByRole('button', { name: 'Save service' }));
    await waitFor(() => expect(api.updateOfficeMachine).toHaveBeenCalledWith('m1', {
      name: 'Washer 1', machineType: 'Washer', capacity: '12 kg', purchaseDate: '2024-05-01',
      lastMaintenanceDate: shopToday(), nextMaintenanceDate: '2026-09-01', notes: 'Replaced belt',
    }));
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith('Service recorded.'));
    expect(screen.queryByRole('form', { name: 'Record service' })).toBeNull();
  });

  it('records a first service on a machine with nothing else set', async () => {
    setup();
    fireEvent.click(within(await rowFor('Iron A')).getByRole('button', { name: 'Record service' }));
    const form = screen.getByRole('form', { name: 'Record service' });
    fireEvent.change(within(form).getByLabelText('Serviced on'), { target: { value: '2026-01-02' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save service' }));
    await waitFor(() => expect(api.updateOfficeMachine).toHaveBeenCalledWith('m2', {
      name: 'Iron A', machineType: 'Iron', capacity: undefined, purchaseDate: undefined,
      lastMaintenanceDate: '2026-01-02', nextMaintenanceDate: undefined, notes: undefined,
    }));
  });

  it('shows a native refusal and lets the operator cancel each form', async () => {
    api.updateOfficeMachine.mockRejectedValue(new Error('The next maintenance date cannot be before the last one.'));
    const props = setup();
    fireEvent.click(within(await rowFor('Washer 1')).getByRole('button', { name: 'Record service' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save service' }));
    await waitFor(() => expect(props.onError).toHaveBeenCalled());
    expect(props.onNotice).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'Record service' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add machine' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'Add machine' })).toBeNull();
  });

  it('closes one form when another opens', async () => {
    setup();
    const row = await rowFor('Washer 1');
    fireEvent.click(within(row).getByRole('button', { name: 'Record service' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    expect(screen.queryByRole('form', { name: 'Record service' })).toBeNull();
    expect(screen.getByRole('form', { name: 'Edit machine' })).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Record service' }));
    expect(screen.queryByRole('form', { name: 'Edit machine' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add machine' }));
    expect(screen.queryByRole('form', { name: 'Record service' })).toBeNull();
  });

  it('keeps delete controls away from staff', async () => {
    setup(staff);
    await rowFor('Washer 1');
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('lets an administrator delete a machine with a reason', async () => {
    const props = setup(admin);
    const row = await rowFor('Washer 1');
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    fireEvent.change(within(row).getByLabelText('Reason'), { target: { value: 'Sold the machine' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(api.deleteOfficeMachine).toHaveBeenCalledWith('m1', 'Sold the machine'));
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith('Machine deleted.'));
  });

  it('reports a failed delete', async () => {
    api.deleteOfficeMachine.mockRejectedValue(new Error('Machine not found.'));
    const props = setup(admin);
    const row = await rowFor('Washer 1');
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    fireEvent.change(within(row).getByLabelText('Reason'), { target: { value: 'Sold the machine' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Machine not found.' })));
  });

  it('passes load failures to the shell', async () => {
    api.listOfficeMachines.mockRejectedValue(new Error('db down'));
    const props = setup();
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'db down' })));
  });
});
