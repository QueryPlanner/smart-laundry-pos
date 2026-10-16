import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async (_command: string, _args?: Record<string, unknown>): Promise<unknown> => 'native-result'),
  isTauriRuntime: vi.fn(() => true),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('./runtime', () => ({ isTauriRuntime: mocks.isTauriRuntime }));

import * as office from './office';

const customer = { name: 'Rahul', phone: '9876543210' };
const expense = { expenseDate: '2026-01-31', category: 'Rent', amountMinor: 100, paymentMethod: 'cash' as const };
const item = { name: 'Soap', unit: 'kg', minimumQuantity: 2 };
const adjustment = { itemId: 'i', transactionType: 'stock_out' as const, changeQuantity: -1, reason: 'Used today' };
const machine = { name: 'Washer', machineType: 'Washer' };

/** [wrapper, call, native command, exact arguments]. Every exported wrapper appears once. */
const table: Array<[string, () => Promise<unknown>, string, Record<string, unknown> | undefined]> = [
  ['listOfficeCustomers', () => office.listOfficeCustomers('rah', 5, 10), 'counter_list_customers', { search: 'rah', offset: 5, limit: 10 }],
  ['listOfficeCustomers defaults', () => office.listOfficeCustomers(), 'counter_list_customers', { search: '', offset: 0, limit: 50 }],
  ['getOfficeCustomer', () => office.getOfficeCustomer('c'), 'counter_get_customer', { customerId: 'c' }],
  ['createOfficeCustomer', () => office.createOfficeCustomer(customer), 'counter_create_customer', { input: customer }],
  ['updateOfficeCustomer', () => office.updateOfficeCustomer('c', customer), 'counter_update_customer', { customerId: 'c', input: customer }],
  ['deleteOfficeCustomer', () => office.deleteOfficeCustomer('c', 'Duplicate entry'), 'counter_delete_customer', { customerId: 'c', reason: 'Duplicate entry' }],
  ['listOfficeExpenses', () => office.listOfficeExpenses({ from: '2026-01-01', to: '2026-01-31', category: 'Rent', limit: 20 }), 'counter_list_expenses', { filter: { from: '2026-01-01', to: '2026-01-31', category: 'Rent', limit: 20 } }],
  ['listOfficeExpenses defaults', () => office.listOfficeExpenses(), 'counter_list_expenses', { filter: {} }],
  ['createOfficeExpense', () => office.createOfficeExpense(expense), 'counter_create_expense', { input: expense }],
  ['deleteOfficeExpense', () => office.deleteOfficeExpense('e', 'Entered twice'), 'counter_delete_expense', { expenseId: 'e', reason: 'Entered twice' }],
  ['listOfficeInventory', () => office.listOfficeInventory(), 'counter_list_inventory', undefined],
  ['createOfficeInventoryItem', () => office.createOfficeInventoryItem(item), 'counter_create_inventory_item', { input: item }],
  ['adjustOfficeInventory', () => office.adjustOfficeInventory(adjustment), 'counter_adjust_inventory', { input: adjustment }],
  ['deleteOfficeInventoryItem', () => office.deleteOfficeInventoryItem('i', 'Stopped stocking'), 'counter_delete_inventory_item', { itemId: 'i', reason: 'Stopped stocking' }],
  ['listOfficeMachines', () => office.listOfficeMachines(), 'counter_list_machines', undefined],
  ['createOfficeMachine', () => office.createOfficeMachine(machine), 'counter_create_machine', { input: machine }],
  ['updateOfficeMachine', () => office.updateOfficeMachine('m', machine), 'counter_update_machine', { machineId: 'm', input: machine }],
  ['deleteOfficeMachine', () => office.deleteOfficeMachine('m', 'Sold the machine'), 'counter_delete_machine', { machineId: 'm', reason: 'Sold the machine' }],
];

beforeEach(() => {
  mocks.invoke.mockClear();
  mocks.isTauriRuntime.mockReturnValue(true);
});

describe('native office command wrappers', () => {
  it.each(table)('%s sends the exact native command and arguments', async (_name, run, command, args) => {
    await expect(run()).resolves.toBe('native-result');
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(command, args);
  });

  it('wraps every exported function (a new export without a table row fails here)', () => {
    const exported = Object.entries(office).filter(([, value]) => typeof value === 'function').map(([name]) => name);
    const covered = new Set(table.map(([name]) => name.split(' ')[0]));
    expect(exported.filter(name => !covered.has(name))).toEqual([]);
  });

  it('refuses to run outside the Tauri desktop shell', () => {
    mocks.isTauriRuntime.mockReturnValue(false);
    expect(() => office.listOfficeInventory()).toThrow('only in the Tauri runtime');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
