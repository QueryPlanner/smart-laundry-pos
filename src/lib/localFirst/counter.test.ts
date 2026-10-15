import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async (_command: string, _args?: Record<string, unknown>): Promise<unknown> => 'native-result'),
  isTauriRuntime: vi.fn(() => true),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('./runtime', () => ({ isTauriRuntime: mocks.isTauriRuntime }));

import * as counter from './counter';

const order = { customer: { name: 'A', phone: '1' }, items: [{ garmentId: 'g', serviceId: 's', quantity: 1 }] };
const quote = { lines: [], subtotalMinor: 0, discountPercentBp: 0, discountMinor: 0, totalMinor: 0, pieceCount: 0, promisedAt: '', catalogueVersion: '2' };

/** [wrapper call, native command, exact arguments sent]. Every exported wrapper appears once. */
const table: Array<[string, () => Promise<unknown>, string, Record<string, unknown> | undefined]> = [
  ['getCounterBootstrap', () => counter.getCounterBootstrap(), 'counter_bootstrap', undefined],
  ['setupCounterAdmin', () => counter.setupCounterAdmin({ fullName: 'A', pin: '1234' }), 'counter_setup_admin', { input: { fullName: 'A', pin: '1234' } }],
  ['loginCounter', () => counter.loginCounter('u', '1234'), 'counter_login', { userId: 'u', pin: '1234' }],
  ['lockCounter', () => counter.lockCounter(), 'counter_lock', undefined],
  ['logoutCounter', () => counter.logoutCounter(), 'counter_lock', undefined],
  ['listCounterStaff', () => counter.listCounterStaff(), 'counter_list_staff', undefined],
  ['createCounterStaff', () => counter.createCounterStaff({ fullName: 'B', pin: '4321' }), 'counter_create_staff', { input: { fullName: 'B', pin: '4321' } }],
  ['setCounterStaffActive', () => counter.setCounterStaffActive('u', false), 'counter_set_staff_active', { userId: 'u', active: false }],
  ['resetCounterStaffPin', () => counter.resetCounterStaffPin('u', '999999'), 'counter_reset_staff_pin', { userId: 'u', pin: '999999' }],
  ['getCounterCatalogue', () => counter.getCounterCatalogue(), 'counter_get_catalogue', undefined],
  ['searchCounterCustomers', () => counter.searchCounterCustomers('98'), 'counter_search_customers', { phone: '98' }],
  ['setCounterRate', () => counter.setCounterRate('g', 's', 1500, true), 'counter_set_rate', { garmentId: 'g', serviceId: 's', priceMinor: 1500, available: true }],
  ['listCounterDiscounts', () => counter.listCounterDiscounts(), 'counter_list_discounts', undefined],
  ['setCounterDiscount', () => counter.setCounterDiscount(null, 1000, true, 'Festive'), 'counter_set_discount', { customerId: null, percentBp: 1000, active: true, label: 'Festive' }],
  ['getCounterBackupSettings', () => counter.getCounterBackupSettings(), 'counter_backup_settings', undefined],
  ['setCounterBackupMirror', () => counter.setCounterBackupMirror('E:\\Backups'), 'counter_set_backup_mirror', { directory: 'E:\\Backups' }],
  ['runCounterBackup', () => counter.runCounterBackup(), 'counter_backup_now', undefined],
  ['quoteCounterOrder', () => counter.quoteCounterOrder(order), 'counter_quote_order', { input: order }],
  ['saveCounterOrder', () => counter.saveCounterOrder({ ...order, reviewedQuote: quote, idempotencyKey: 'k' }), 'counter_save_order', { input: { ...order, reviewedQuote: quote, idempotencyKey: 'k' } }],
  ['getOrderPieces', () => counter.getOrderPieces('o'), 'counter_get_order_pieces', { orderId: 'o' }],
  ['matchOrderPieces', () => counter.matchOrderPieces('o', 'packing', ['p']), 'counter_match_order_pieces', { orderId: 'o', stage: 'packing', pieceIds: ['p'] }],
  ['searchCounterOrders', () => counter.searchCounterOrders('SL', 5, 10), 'counter_search_orders', { query: 'SL', offset: 5, limit: 10 }],
  ['searchCounterOrders defaults', () => counter.searchCounterOrders('SL'), 'counter_search_orders', { query: 'SL', offset: 0, limit: 50 }],
  ['getCounterOrder', () => counter.getCounterOrder('o'), 'counter_get_order', { orderId: 'o' }],
  ['recordCounterPayment', () => counter.recordCounterPayment('o', { amountMinor: 100, method: 'cash', idempotencyKey: 'k' }), 'counter_record_payment', { orderId: 'o', input: { amountMinor: 100, method: 'cash', idempotencyKey: 'k' } }],
  ['updateCounterOrderStatus', () => counter.updateCounterOrderStatus('o', 'ready'), 'counter_update_order_status', { orderId: 'o', status: 'ready' }],
  ['cancelCounterOrder', () => counter.cancelCounterOrder('o', 'Customer changed their mind'), 'counter_cancel_order', { orderId: 'o', reason: 'Customer changed their mind' }],
  ['collectCounterOrder', () => counter.collectCounterOrder('o', ['p'], 'r'), 'counter_collect_order', { orderId: 'o', pieceIds: ['p'], requestId: 'r' }],
  ['enumeratePrinters', () => counter.enumeratePrinters(), 'counter_enumerate_printers', undefined],
  ['setPrinterProfiles', () => counter.setPrinterProfiles({ billPrinterId: 'a', tagPrinterId: 'b' }), 'counter_set_printer_profiles', { profiles: { billPrinterId: 'a', tagPrinterId: 'b' } }],
  ['getPrinterProfiles', () => counter.getPrinterProfiles(), 'counter_get_printer_profiles', undefined],
  ['listPrintJobs', () => counter.listPrintJobs('o'), 'counter_list_print_jobs', { orderId: 'o' }],
  ['dispatchPrintJobs', () => counter.dispatchPrintJobs('o'), 'counter_dispatch_print_jobs', { orderId: 'o' }],
  ['dispatchPrintJob', () => counter.dispatchPrintJob('j'), 'counter_dispatch_print_job', { jobId: 'j' }],
  ['retryPrintJob', () => counter.retryPrintJob('j', true), 'counter_retry_print_job', { jobId: 'j', confirmUncertain: true }],
  ['reprintCounterOutput', () => counter.reprintCounterOutput('o', 'tags', ['p'], 'r'), 'counter_reprint_output', { orderId: 'o', kind: 'tags', pieceIds: ['p'], requestId: 'r' }],
];

beforeEach(() => {
  mocks.invoke.mockClear();
  mocks.isTauriRuntime.mockReturnValue(true);
});

describe('native counter command wrappers', () => {
  it.each(table)('%s sends the exact native command and arguments', async (_name, run, command, args) => {
    await expect(run()).resolves.toBe('native-result');
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(command, args);
  });

  it('wraps every exported function (a new export without a table row fails here)', () => {
    const exported = Object.entries(counter).filter(([, value]) => typeof value === 'function').map(([name]) => name);
    const covered = new Set(table.map(([name]) => name.split(' ')[0]));
    expect(exported.filter(name => !covered.has(name))).toEqual([]);
  });

  it('only calls commands the Rust backend registers (frontend/backend drift guard)', () => {
    const source = readFileSync(fileURLToPath(new URL('../../../src-tauri/src/lib.rs', import.meta.url)), 'utf8');
    const handlerBlock = /generate_handler!\[([\s\S]*?)\]/.exec(source)?.[1] ?? '';
    const registered = new Set(handlerBlock.split(',').map(entry => entry.trim()).filter(Boolean));
    const used = new Set(table.map(([, , command]) => command));
    expect([...used].filter(command => !registered.has(command))).toEqual([]);
    const unusedByUi = [...registered].filter(command => command.startsWith('counter_') && !used.has(command));
    expect(unusedByUi).toEqual([]);
  });

  it('refuses to run outside the Tauri desktop shell', () => {
    mocks.isTauriRuntime.mockReturnValue(false);
    expect(() => counter.lockCounter()).toThrow('only in the Tauri runtime');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
