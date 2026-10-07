import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateOrderInput, LocalUser } from './types';

type TestStatement = {
  sql: string;
  values: Array<string | number | null>;
  expectedRows?: number;
  error?: string;
  mode?: 'execute' | 'select';
};

type NativeCall = { command: string; args?: Record<string, unknown> };

let mockDispatchNative: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string, args?: Record<string, unknown>) => mockDispatchNative(command, args),
}));

import { LocalLaundryRepository } from './repository';

const migration = readFileSync(new URL('../../../src-tauri/migrations/001_initial_schema.sql', import.meta.url), 'utf8');
let database: DatabaseSync;
let calls: NativeCall[];
let databaseInfoError: string | undefined;
let dropNextBatchResult = false;

const runStatement = (statement: TestStatement): {
  rowsAffected: number;
  lastInsertId: number | null;
  rows?: Record<string, unknown>[];
} => {
  if (statement.mode === 'select') {
    const rows = database.prepare(statement.sql).all(...statement.values) as Record<string, unknown>[];
    if (statement.expectedRows !== undefined && rows.length !== statement.expectedRows) {
      throw new Error(statement.error || `Expected ${statement.expectedRows} rows, received ${rows.length}.`);
    }
    return { rowsAffected: rows.length, lastInsertId: null, rows };
  }

  const result = database.prepare(statement.sql).run(...statement.values);
  const rowsAffected = Number(result.changes);
  if (statement.expectedRows !== undefined && rowsAffected !== statement.expectedRows) {
    throw new Error(statement.error || `Expected ${statement.expectedRows} affected rows, received ${rowsAffected}.`);
  }
  return { rowsAffected, lastInsertId: Number(result.lastInsertRowid) };
};

const installNativeAdapter = (): void => {
  mockDispatchNative = async (command, args) => {
    calls.push({ command, args });
    if (command === 'local_database_info') {
      return { path: '/native/test/laundry.db', restorePending: false, ...(databaseInfoError ? { error: databaseInfoError } : {}) };
    }
    if (command === 'local_select') {
      const { query, values } = args as { query: string; values: Array<string | number | null> };
      return database.prepare(query).all(...values);
    }
    if (command === 'local_read_batch') {
      const { statements } = args as { statements: TestStatement[] };
      database.exec('BEGIN');
      try {
        const results = statements.map(statement => (
          database.prepare(statement.sql).all(...statement.values) as Record<string, unknown>[]
        ));
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    }
    if (command === 'local_batch') {
      const { statements } = args as { statements: TestStatement[] };
      database.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(runStatement);
        database.exec('COMMIT');
        if (dropNextBatchResult) {
          dropNextBatchResult = false;
          return [];
        }
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    }
    throw new Error(`Unexpected native command: ${command}`);
  };
};

const createRepository = async (): Promise<{ repository: LocalLaundryRepository; user: LocalUser }> => {
  const repository = new LocalLaundryRepository();
  await repository.initialize();
  const user = await repository.createAdmin('Laundry Admin', '4826');
  return { repository, user };
};

const seedOrder = (
  user: LocalUser,
  input: {
    id: string;
    receivedAt: string;
    status: string;
    totalAmount: number;
    expectedReadyAt?: string;
  },
): void => {
  database.prepare(`INSERT INTO orders
    (id, order_number, customer_name, customer_phone, order_type, received_at, expected_ready_at, status,
     subtotal, discount_type, discount_value, discount_amount, total_amount, payment_status,
     created_by, created_at, updated_at, origin_device_id)
    VALUES (?, ?, 'Test Customer', '5550100', 'piece', ?, ?, ?, ?, 'fixed', 0, 0, ?, 'unpaid', ?, ?, ?, 'test-device')`)
    .run(input.id, `TEST-${input.id}`, input.receivedAt, input.expectedReadyAt || null,
      input.status, input.totalAmount, input.totalAmount, user.id, input.receivedAt, input.receivedAt);
};

const seedItem = (
  orderId: string,
  item: { id: string; type: 'piece' | 'weight' | 'combined'; quantity: number; weight: number; lineTotal: number },
): void => {
  database.prepare(`INSERT INTO order_items
    (id, order_id, item_name, service_name, service_type, quantity, weight_kg, rate, line_total, created_at)
    VALUES (?, ?, 'Garment', 'Wash', ?, ?, ?, 10, ?, '2025-03-09T12:00:00.000Z')`)
    .run(item.id, orderId, item.type, item.quantity, item.weight, item.lineTotal);
};

const seedPayment = (user: LocalUser, orderId: string, paymentId: string, amount: number, recordedAt: string): void => {
  database.prepare(`INSERT INTO payments
    (id, order_id, amount, method, recorded_at, recorded_by, created_at, updated_at, origin_device_id)
    VALUES (?, ?, ?, 'cash', ?, ?, ?, ?, 'test-device')`)
    .run(paymentId, orderId, amount, recordedAt, user.id, recordedAt, recordedAt);
};

const baseOrderItems = (): CreateOrderInput['items'] => ([
  { item_name: 'Shirt', service_name: 'Wash', service_type: 'piece', quantity: 1, weight_kg: 0, rate: 50 },
]);

describe('local laundry repository', () => {
  beforeEach(() => {
    database = new DatabaseSync(':memory:');
    database.exec(migration);
    calls = [];
    databaseInfoError = undefined;
    dropNextBatchResult = false;
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    installNativeAdapter();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    database.close();
  });

  it('initializes through native database info and atomically creates one local administrator', async () => {
    const repository = new LocalLaundryRepository();
    await repository.initialize();
    expect(calls[0]?.command).toBe('local_database_info');
    await expect(repository.hasLocalUser()).resolves.toBe(false);
    await expect(repository.createAdmin('  ', '4826')).rejects.toThrow('administrator name');
    await expect(repository.createAdmin('Admin', '123')).rejects.toThrow('4 to 8 digits');

    const user = await repository.createAdmin('  Laundry Admin  ', '4826');
    await expect(repository.hasLocalUser()).resolves.toBe(true);
    await expect(repository.authenticate('4826')).resolves.toMatchObject({ id: user.id, full_name: 'Laundry Admin' });
    await expect(repository.authenticate('1111')).resolves.toBeNull();
    await expect(repository.createAdmin('Second Admin', '1111'))
      .rejects.toThrow('already configured');
    expect(database.prepare('SELECT COUNT(*) AS count FROM local_users').get()).toEqual({ count: 1 });
    expect(calls.filter(call => call.command === 'local_batch')).toHaveLength(2);
  });

  it('surfaces native initialization errors before repository operations begin', async () => {
    databaseInfoError = 'Database migration is unsafe.';
    const repository = new LocalLaundryRepository();

    await expect(repository.initialize()).rejects.toThrow('Database migration is unsafe.');
    expect(calls.map(call => call.command)).toEqual(['local_database_info']);
  });

  it('returns defaults for damaged settings and saves only the supplied allowlisted keys', async () => {
    const { repository, user } = await createRepository();
    const intactSettings = await repository.getSettings();
    expect(intactSettings.shop_name).toBe('Smart Laundry');
    expect(intactSettings.order_prefix).toBe('LA');
    database.prepare("UPDATE app_settings SET value = '' WHERE key IN ('shop_name', 'order_prefix')").run();
    database.prepare("UPDATE app_settings SET value = 'NaN' WHERE key = 'default_completion_days'").run();
    database.prepare("DELETE FROM app_settings WHERE key IN ('shop_address', 'shop_phone', 'gst_number', 'receipt_footer', 'device_id', 'default_completion_days')").run();
    expect((await repository.getSettings()).default_completion_days).toBe(2);
    database.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('default_completion_days', '-1', 'bad-value')").run();

    const defaults = await repository.getSettings();
    expect(defaults.shop_name).toBe('Smart Laundry');
    expect(defaults.order_prefix).toBe('LA');
    expect(defaults.default_completion_days).toBe(2);
    expect(defaults.device_id).toBeTruthy();
    database.prepare("UPDATE app_settings SET value = '1.5' WHERE key = 'default_completion_days'").run();
    expect((await repository.getSettings()).default_completion_days).toBe(2);

    const saved = await repository.saveSettings({ shop_phone: '555-0100' }, user.id);
    expect(saved.shop_phone).toBe('555-0100');
    expect((await repository.getSettings()).shop_address).toBe('');
    expect(database.prepare("SELECT value FROM app_settings WHERE key = 'shop_phone'").get()).toEqual({ value: '555-0100' });
    expect(database.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE entity_type = 'settings'").get()).toEqual({ count: 1 });

    const batchesBeforeEmptyPatch = calls.filter(call => call.command === 'local_batch').length;
    await expect(repository.saveSettings({}, user.id)).resolves.toMatchObject({ shop_phone: '555-0100' });
    expect(calls.filter(call => call.command === 'local_batch')).toHaveLength(batchesBeforeEmptyPatch);
    await expect(repository.saveSettings({ default_completion_days: 1.5 }, user.id)).rejects.toThrow('non-negative integer');
    await expect(repository.saveSettings({ default_completion_days: -1 }, user.id)).rejects.toThrow('non-negative integer');
    await expect(repository.saveSettings({ default_completion_days: '2' } as never, user.id)).rejects.toThrow('non-negative integer');
    await expect(repository.saveSettings({ device_id: 'replacement' } as never, user.id)).rejects.toThrow('Unsupported shop setting');
    await expect(repository.saveSettings({ shop_name: 7 } as never, user.id)).rejects.toThrow('must be a string');

    const orderWithDefaultPrefix = await repository.createOrder({
      customer_name: 'Asha', customer_phone: '555-0101', order_type: 'piece', items: baseOrderItems(),
    }, user.id);
    expect(orderWithDefaultPrefix.order_number).toMatch(/^LA-\d{4}-00001$/);
  });

  it('creates, updates, and lists services with validated values and atomic audit rows', async () => {
    const { repository, user } = await createRepository();
    const service = await repository.createService({ name: '  Wash and Fold ', price_per_piece: 12.5, price_per_kg: 70 }, user.id);
    expect(service).toMatchObject({ name: 'Wash and Fold', active: true, price_per_piece: 12.5, price_per_kg: 70 });
    expect(await repository.listServices()).toHaveLength(1);

    await repository.updateService(service.id, { active: false, description: '  Gentle wash  ', price_per_piece: 0 }, user.id);
    expect(await repository.listServices()).toHaveLength(0);
    expect(await repository.listServices(true)).toMatchObject([{ active: false, description: 'Gentle wash' }]);
    await repository.updateService(service.id, { active: true, description: null, price_per_kg: null }, user.id);
    expect(await repository.listServices()).toHaveLength(1);
    expect(await repository.listServices(true)).toMatchObject([{ active: true, description: null, price_per_piece: 0, price_per_kg: null }]);
    await repository.updateService(service.id, {}, user.id);
    await expect(repository.updateService(service.id, { name: '' }, user.id)).rejects.toThrow('name is required');
    await expect(repository.updateService(service.id, { name: 3 } as never, user.id)).rejects.toThrow('must be a string');
    await expect(repository.createService({ name: ' ', price_per_piece: 3 }, user.id)).rejects.toThrow('name is required');
    await expect(repository.createService({ name: 'Invalid', price_per_kg: Number.NaN }, user.id)).rejects.toThrow('finite, non-negative');
    await expect(repository.updateService(service.id, { price_per_kg: -1 }, user.id)).rejects.toThrow('finite, non-negative');
    await expect(repository.updateService(service.id, { price_per_kg: 'many' } as never, user.id))
      .rejects.toThrow('must be a number or null');
    await expect(repository.updateService(service.id, { active: 1 } as never, user.id)).rejects.toThrow('boolean');
    await expect(repository.updateService(service.id, { label: 'bad' } as never, user.id)).rejects.toThrow('Unsupported service field');
    await expect(repository.updateService('missing-service', { name: 'Changed' }, user.id)).rejects.toThrow('Service not found');
    expect(database.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE entity_type = 'service'").get()).toEqual({ count: 3 });
    const plainService = await repository.createService({ name: 'Pressing', description: 'Steam', category: 'pressing' }, user.id);
    expect(plainService).toMatchObject({ description: 'Steam', category: 'pressing', price_per_piece: null, price_per_kg: null });
  });

  it('checks customer primary and alternate phone numbers in the insert batch', async () => {
    const { repository, user } = await createRepository();
    const customer = await repository.createCustomer({
      name: 'Asha', phone: '555-0101', alternate_phone: '555-0102', customer_type: 'student',
      address: '  Street 1  ', notes: '  Ask for pickup  ',
    }, user.id);
    expect(customer.customer_code).toMatch(/^C-[0-9A-F-]{36}$/);
    expect(customer).toMatchObject({ address: 'Street 1', notes: 'Ask for pickup' });
    await expect(repository.createCustomer({ name: ' ', phone: '555-0190' }, user.id)).rejects.toThrow('name and phone are required');
    await expect(repository.createCustomer({ name: 'No phone', phone: ' ' }, user.id)).rejects.toThrow('name and phone are required');
    expect(await repository.listCustomers('555-0102')).toMatchObject([{ id: customer.id }]);
    expect(await repository.listCustomers(customer.customer_code)).toMatchObject([{ id: customer.id }]);

    await expect(repository.createCustomer({ name: 'Duplicate primary', phone: '555-0102' }, user.id))
      .rejects.toThrow('phone number already exists');
    await expect(repository.createCustomer({ name: 'Duplicate alternate', phone: '555-0111', alternate_phone: '555-0101' }, user.id))
      .rejects.toThrow('phone number already exists');
    await expect(repository.createCustomer({ name: 'Invalid type', phone: '555-0199', customer_type: 'vip' as never }, user.id))
      .rejects.toThrow('Unsupported customer type');
    const basicCustomer = await repository.createCustomer({ name: 'Ben', phone: '555-0103' }, user.id);
    expect(basicCustomer).toMatchObject({ customer_type: 'regular', alternate_phone: null, address: null, notes: null });
    expect(database.prepare('SELECT COUNT(*) AS count FROM customers').get()).toEqual({ count: 2 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE entity_type = 'customer'").get()).toEqual({ count: 2 });
    expect(calls.filter(call => call.command === 'local_batch')).toHaveLength(5);
    expect(await repository.listCustomers()).toHaveLength(2);
  });

  it('creates a complete order in one batch and derives its number and payment status in SQLite', async () => {
    const { repository, user } = await createRepository();
    const customer = await repository.createCustomer({ name: 'Asha', phone: '555-0101' }, user.id);
    const order = await repository.createOrder({
      customer_name: 'Asha',
      customer_phone: '555-0101',
      customer_id: customer.id,
      order_type: 'combined',
      expected_ready_at: '2026-11-03',
      special_instructions: '  Separate whites  ',
      damage_notes: '  Torn cuff  ',
      internal_notes: '  Call first  ',
      items: [
        { item_name: 'Shirt', service_name: 'Wash', service_type: 'piece', quantity: 2, weight_kg: 0, rate: 50 },
        { item_name: 'Blanket', service_name: 'Wash', service_type: 'weight', quantity: 0, weight_kg: 1, rate: 100 },
      ],
      payment: { amount: 50, method: 'cash' },
    }, user.id);

    expect(order.order_number).toMatch(/^LA-\d{4}-00001$/);
    expect(order).toMatchObject({
      customer_id: customer.id,
      order_type: 'combined', subtotal: 200, total_amount: 200, payment_status: 'partially_paid',
      expected_ready_at: new Date(2026, 10, 3, 23, 59, 59, 999).toISOString(),
      special_instructions: 'Separate whites', damage_notes: 'Torn cuff', internal_notes: 'Call first',
    });
    expect(calls.filter(call => call.command === 'local_batch')).toHaveLength(3);
    const saved = await repository.getOrder(order.id);
    expect(saved).toMatchObject({
      order_number: order.order_number,
      items: [{ item_name: 'Shirt', line_total: 100 }, { item_name: 'Blanket', line_total: 100 }],
      payments: [{ amount: 50, method: 'cash' }],
      paid_amount: 50,
    });
    expect(await repository.listOrders(order.order_number)).toMatchObject([{ id: order.id, paid_amount: 50 }]);
    expect(await repository.listOrders('', 'received')).toHaveLength(1);
    expect(await repository.listOrders('', 'ready')).toHaveLength(0);
    await expect(repository.getOrder('missing-order')).resolves.toBeNull();

    const sequenceBeforeSecondOrder = database.prepare('SELECT next_number FROM order_sequences').get() as { next_number: number };
    expect(sequenceBeforeSecondOrder.next_number).toBe(2);
    const zeroTotal = await repository.createOrder({
      customer_name: 'Asha',
      customer_phone: '555-0101',
      order_type: 'piece',
      expected_ready_at: '',
      items: [{ item_name: 'Free bag', service_name: 'Free service', service_type: 'piece', quantity: 1, weight_kg: 0, rate: 0 }],
      payment: { amount: 0, method: 'cash' },
    }, user.id);
    expect(zeroTotal.order_number).toMatch(/^LA-\d{4}-00002$/);
    expect(zeroTotal.payment_status).toBe('paid');
    const defaultReadyOrder = await repository.createOrder({
      customer_name: 'Asha', customer_phone: '555-0101', order_type: 'piece', items: baseOrderItems(),
    }, user.id);
    const createdAt = new Date(defaultReadyOrder.received_at);
    expect(defaultReadyOrder.expected_ready_at).toBe(new Date(
      createdAt.getFullYear(), createdAt.getMonth(), createdAt.getDate() + 2, 23, 59, 59, 999,
    ).toISOString());
    const timestampReadyOrder = await repository.createOrder({
      customer_name: 'Asha', customer_phone: '555-0101', order_type: 'piece', items: baseOrderItems(),
      expected_ready_at: '2026-11-04T17:00:00-08:00',
    }, user.id);
    expect(timestampReadyOrder.expected_ready_at).toBe('2026-11-05T01:00:00.000Z');
    await expect(repository.listOrders('', 'all')).resolves.toHaveLength(4);
    await expect(repository.listOrders('', 'invalid' as never)).rejects.toThrow('Unsupported order status');
    await expect(repository.createOrder({
      customer_name: '', customer_phone: '555-0101', order_type: 'piece', items: baseOrderItems(),
    }, user.id)).rejects.toThrow('Customer name and phone are required');
    await expect(repository.createOrder({
      customer_name: 'Asha', customer_phone: '', order_type: 'piece', items: baseOrderItems(),
    }, user.id)).rejects.toThrow('Customer name and phone are required');
    await expect(repository.createOrder({
      customer_name: 'Asha', customer_phone: '555-0101', order_type: 'piece', items: null as never,
    }, user.id)).rejects.toThrow('at least one');
    await expect(repository.createOrder({
      customer_name: 'Asha', customer_phone: '555-0101', order_type: 'piece',
      items: [{ ...baseOrderItems()[0], service_type: 'wrong' as never }],
    }, user.id)).rejects.toThrow('Unsupported service type');
    await expect(repository.createOrder({
      customer_name: 'Asha', customer_phone: '555-0101', order_type: 'weight',
      items: [{ ...baseOrderItems()[0], service_type: 'weight', quantity: 0, weight_kg: 0 }],
    }, user.id)).rejects.toThrow('weight greater than zero');
    await expect(repository.createOrder({
      customer_name: 'Asha', customer_phone: '555-0101', order_type: 'piece',
      items: [{ ...baseOrderItems()[0], item_name: ' ' }],
    }, user.id)).rejects.toThrow('item name and service name');
    await expect(repository.createOrder({
      customer_name: 'Asha', customer_phone: '555-0101', order_type: 'piece', items: baseOrderItems(),
      expected_ready_at: '2026-02-30',
    }, user.id)).rejects.toThrow('valid calendar date');
    await expect(repository.createOrder({
      customer_name: 'Asha', customer_phone: '555-0101', order_type: 'piece', items: baseOrderItems(),
      expected_ready_at: 'not a timestamp',
    }, user.id)).rejects.toThrow('expected ready date is invalid');
  });

  it('rejects empty, zero-dimension, and invalid-number orders before writing', async () => {
    const { repository, user } = await createRepository();
    const base: CreateOrderInput = {
      customer_name: 'Asha', customer_phone: '555-0101', order_type: 'piece',
      items: [{ item_name: 'Shirt', service_name: 'Wash', service_type: 'piece', quantity: 1, weight_kg: 0, rate: 50 }],
    };
    const batchesBefore = calls.filter(call => call.command === 'local_batch').length;
    await expect(repository.createOrder({ ...base, items: [] }, user.id)).rejects.toThrow('at least one');
    await expect(repository.createOrder({ ...base, items: null as never }, user.id)).rejects.toThrow('at least one');
    await expect(repository.createOrder({ ...base, items: [{ ...base.items[0], quantity: 0 }] }, user.id))
      .rejects.toThrow('quantity greater than zero');
    await expect(repository.createOrder({ ...base, items: [{ ...base.items[0], weight_kg: Number.POSITIVE_INFINITY }] }, user.id))
      .rejects.toThrow('finite, non-negative');
    await expect(repository.createOrder({ ...base, discount_value: Number.NaN }, user.id))
      .rejects.toThrow('finite, non-negative');
    await expect(repository.createOrder({ ...base, payment: { amount: -1, method: 'cash' } }, user.id))
      .rejects.toThrow('finite, non-negative');
    await expect(repository.createOrder({ ...base, payment: { amount: 1, method: 'wire' as never } }, user.id))
      .rejects.toThrow('Unsupported payment method');
    await expect(repository.createOrder({ ...base, items: [{ ...base.items[0], service_type: 'combined', quantity: 0 }] }, user.id))
      .rejects.toThrow('quantity or weight greater than zero');
    expect(calls.filter(call => call.command === 'local_batch')).toHaveLength(batchesBefore);
    expect(database.prepare('SELECT COUNT(*) AS count FROM orders').get()).toEqual({ count: 0 });
  });

  it('does not retry a committed mutation when the native response omits its result row', async () => {
    const { repository, user } = await createRepository();
    dropNextBatchResult = true;

    await expect(repository.createOrder({
      customer_name: 'Asha', customer_phone: '555-0101', order_type: 'piece', items: baseOrderItems(),
    }, user.id)).rejects.toThrow('created order could not be read');

    expect(database.prepare('SELECT COUNT(*) AS count FROM orders').get()).toEqual({ count: 1 });
    expect(calls.filter(call => call.command === 'local_batch')).toHaveLength(2);
  });

  it('records real status transitions once and updates payment state in each payment batch', async () => {
    const { repository, user } = await createRepository();
    const order = await repository.createOrder({
      customer_name: 'Asha', customer_phone: '555-0101', order_type: 'piece',
      items: [{ item_name: 'Shirt', service_name: 'Wash', service_type: 'piece', quantity: 1, weight_kg: 0, rate: 100 }],
      payment: { amount: 20, method: 'cash' },
    }, user.id);
    await repository.setOrderStatus(order.id, 'washing', user.id, 'Started');
    const historyAfterChange = database.prepare('SELECT previous_status, new_status FROM order_status_history WHERE order_id = ? ORDER BY changed_at').all(order.id);
    expect(historyAfterChange).toContainEqual({ previous_status: 'received', new_status: 'washing' });
    const auditCount = Number((database.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'status_changed'").get() as CountRow).count);
    await repository.setOrderStatus(order.id, 'washing', user.id, 'Repeated');
    expect(database.prepare('SELECT COUNT(*) AS count FROM order_status_history WHERE order_id = ?').get(order.id))
      .toEqual({ count: 2 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'status_changed'").get())
      .toEqual({ count: auditCount });
    await repository.setOrderStatus(order.id, 'ready', user.id);
    await expect(repository.setOrderStatus('missing-order', 'ready', user.id)).rejects.toThrow('Order not found');
    await expect(repository.setOrderStatus(order.id, 'invalid' as never, user.id)).rejects.toThrow('Unsupported order status');

    await repository.addPayment(order.id, { amount: 80, method: 'upi', reference_number: 'R-1' }, user.id);
    expect((await repository.getOrder(order.id))?.payment_status).toBe('paid');
    await expect(repository.addPayment(order.id, { amount: 0, method: 'cash' }, user.id)).rejects.toThrow('greater than zero');
    await expect(repository.addPayment(order.id, { amount: Number.NaN, method: 'cash' }, user.id)).rejects.toThrow('finite');
    await expect(repository.addPayment(order.id, { amount: 1, method: 'invalid' as never }, user.id)).rejects.toThrow('Unsupported payment method');
    await expect(repository.addPayment('missing-order', { amount: 10, method: 'cash' }, user.id)).rejects.toThrow('Order not found');

    const orderPayments = await repository.getOrder(order.id);
    const initialPayment = orderPayments?.payments?.find(payment => payment.amount === 20);
    expect(initialPayment).toBeDefined();
    await repository.voidPayment(initialPayment!.id, 'Refunded', user.id);
    expect((await repository.getOrder(order.id))?.payment_status).toBe('partially_paid');
    await expect(repository.voidPayment(initialPayment!.id, 'Duplicate void', user.id))
      .rejects.toThrow('not found or already voided');
    const remainingPayment = orderPayments?.payments?.find(payment => payment.amount === 80);
    expect(remainingPayment).toBeDefined();
    await repository.voidPayment(remainingPayment!.id, '', user.id);
    expect((await repository.getOrder(order.id))?.payment_status).toBe('unpaid');
  });

  it('rounds fractional payments to cents across order, payment, void, and balance totals', async () => {
    const { repository, user } = await createRepository();
    const order = await repository.createOrder({
      customer_name: 'Asha', customer_phone: '555-0101', order_type: 'piece',
      items: [{ item_name: 'Shirt', service_name: 'Wash', service_type: 'piece', quantity: 1, weight_kg: 0, rate: 0.3 }],
      payment: { amount: 0.1, method: 'cash' },
    }, user.id);
    expect(order.payment_status).toBe('partially_paid');
    expect((await repository.getOrder(order.id))?.paid_amount).toBe(0.1);

    await repository.addPayment(order.id, { amount: 0.2, method: 'upi' }, user.id);
    let paidOrder = await repository.getOrder(order.id);
    expect(paidOrder).toMatchObject({ payment_status: 'paid', paid_amount: 0.3 });
    expect((await repository.listOrders()).find(candidate => candidate.id === order.id)?.paid_amount).toBe(0.3);
    expect((await repository.getDashboardSummary(new Date(order.received_at))).outstanding).toBe(0);
    const receivedDate = new Date(order.received_at);
    const reportDay = `${receivedDate.getFullYear()}-${String(receivedDate.getMonth() + 1).padStart(2, '0')}-${String(receivedDate.getDate()).padStart(2, '0')}`;
    expect((await repository.getReport(reportDay, reportDay)).outstanding).toBe(0);

    const firstPayment = paidOrder?.payments?.find(payment => payment.amount === 0.1);
    const secondPayment = paidOrder?.payments?.find(payment => payment.amount === 0.2);
    expect(firstPayment).toBeDefined();
    expect(secondPayment).toBeDefined();
    await repository.voidPayment(firstPayment!.id, 'Correct split', user.id);
    paidOrder = await repository.getOrder(order.id);
    expect(paidOrder).toMatchObject({ payment_status: 'partially_paid', paid_amount: 0.2 });
    expect((await repository.getDashboardSummary(new Date(order.received_at))).outstanding).toBe(0.1);
    expect((await repository.getReport(reportDay, reportDay)).outstanding).toBe(0.1);

    await repository.voidPayment(secondPayment!.id, 'Refund', user.id);
    expect(await repository.getOrder(order.id)).toMatchObject({ payment_status: 'unpaid', paid_amount: 0 });
    await expect(repository.addPayment(order.id, { amount: 0.001, method: 'cash' }, user.id))
      .rejects.toThrow('at least one cent');
    await expect(repository.createOrder({
      customer_name: 'Asha', customer_phone: '555-0101', order_type: 'piece',
      items: baseOrderItems(), payment: { amount: 0.001, method: 'cash' },
    }, user.id)).rejects.toThrow('at least one cent');
  });

  it('rolls back the order sequence and every earlier write after a late batch failure', async () => {
    const { repository, user } = await createRepository();
    database.exec(`CREATE TRIGGER fail_order_audit BEFORE INSERT ON audit_log
      WHEN NEW.entity_type = 'order' BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END;`);

    await expect(repository.createOrder({
      customer_name: 'Asha', customer_phone: '555-0101', order_type: 'piece',
      items: baseOrderItems(), payment: { amount: 10, method: 'cash' },
    }, user.id)).rejects.toThrow('forced audit failure');

    expect(database.prepare('SELECT COUNT(*) AS count FROM orders').get()).toEqual({ count: 0 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM order_items').get()).toEqual({ count: 0 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM order_status_history').get()).toEqual({ count: 0 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM payments').get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE entity_type = 'order'").get()).toEqual({ count: 0 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM order_sequences').get()).toEqual({ count: 0 });

    database.exec('DROP TRIGGER fail_order_audit');
    const nextOrder = await repository.createOrder({
      customer_name: 'Asha', customer_phone: '555-0101', order_type: 'piece', items: baseOrderItems(),
    }, user.id);
    expect(nextOrder.order_number).toMatch(/^LA-\d{4}-00001$/);
  });

  it('validates expenses, inventory changes, and machine capacity while auditing successful writes', async () => {
    const { repository, user } = await createRepository();
    await repository.createExpense({
      expense_date: '2026-10-06', category: 'electricity', description: null,
      amount: 350, payment_method: 'cash', notes: null,
    }, user.id);
    await repository.createExpense({
      expense_date: '2026-10-05', category: 'supplies', description: 'Paper bags',
      amount: 20, payment_method: 'upi', notes: 'Invoice 5',
    }, user.id);
    expect(await repository.listExpenses('2026-10-06', '2026-10-06')).toHaveLength(1);
    expect(await repository.listExpenses()).toHaveLength(2);
    expect(await repository.listExpenses('2026-10-06')).toHaveLength(1);
    expect(await repository.listExpenses(undefined, '2026-10-05')).toHaveLength(1);
    await expect(repository.createExpense({
      expense_date: '2026-10-06', category: 'rent', description: null, amount: 0,
      payment_method: 'cash', notes: null,
    }, user.id)).rejects.toThrow('greater than zero');
    await expect(repository.createExpense({
      expense_date: '2026-10-06', category: 'rent', description: null, amount: Number.NaN,
      payment_method: 'cash', notes: null,
    }, user.id)).rejects.toThrow('finite');
    await expect(repository.createExpense({
      expense_date: '2026-10-06', category: 'rent', description: null, amount: 5,
      payment_method: 'credit', notes: null,
    }, user.id)).rejects.toThrow('Credit is not a supported expense');
    await expect(repository.createExpense({
      expense_date: '2026-10-06', category: ' ', description: null, amount: 5,
      payment_method: 'cash', notes: null,
    }, user.id)).rejects.toThrow('category is required');

    await repository.createInventoryItem({ name: 'Detergent', unit: 'kg', minimum_quantity: 2, purchase_cost: 40 }, user.id);
    await repository.createInventoryItem({ name: 'Packaging', unit: 'roll', minimum_quantity: 0, notes: 'Keep dry' }, user.id);
    const [inventory] = await repository.listInventory();
    expect(inventory).toMatchObject({ name: 'Detergent', current_quantity: 0, minimum_quantity: 2 });
    await expect(repository.createInventoryItem({ name: ' ', unit: 'L', minimum_quantity: 0 }, user.id))
      .rejects.toThrow('name and unit are required');
    await expect(repository.createInventoryItem({ name: 'Bleach', unit: ' ', minimum_quantity: 0 }, user.id))
      .rejects.toThrow('name and unit are required');
    await expect(repository.createInventoryItem({ name: 'Bleach', unit: 'L', minimum_quantity: -1 }, user.id))
      .rejects.toThrow('finite, non-negative');
    await expect(repository.createInventoryItem({ name: 'Bleach', unit: 'L', minimum_quantity: 0, purchase_cost: Number.NaN }, user.id))
      .rejects.toThrow('finite, non-negative');
    await repository.adjustInventory(inventory.id, 5, 'stock_in', 'Delivery', user.id);
    await repository.adjustInventory(inventory.id, -2, 'stock_out', 'Used', user.id);
    expect((await repository.listInventory())[0].current_quantity).toBe(3);
    await expect(repository.adjustInventory(inventory.id, -4, 'stock_out', 'Too much', user.id))
      .rejects.toThrow('Stock cannot become negative');
    await expect(repository.adjustInventory(inventory.id, 1, 'stock_out', 'Wrong direction', user.id))
      .rejects.toThrow('direction');
    await expect(repository.adjustInventory(inventory.id, 0, 'adjustment', '', user.id)).rejects.toThrow('must not be zero');
    await expect(repository.adjustInventory(inventory.id, Number.POSITIVE_INFINITY, 'adjustment', '', user.id)).rejects.toThrow('finite');
    await expect(repository.adjustInventory(inventory.id, 1, 'invalid' as never, '', user.id)).rejects.toThrow('Unsupported inventory transaction type');
    await expect(repository.adjustInventory('missing-item', -1, 'stock_out', '', user.id)).rejects.toThrow('Inventory item not found');
    expect(database.prepare('SELECT COUNT(*) AS count FROM inventory_transactions').get()).toEqual({ count: 2 });

    await repository.createMachine({
      name: 'Washer 1', machine_type: 'washer', capacity: '10 kg', purchase_date: null,
      last_maintenance_date: null, next_maintenance_date: '2026-10-10', notes: null,
    }, user.id);
    await repository.createMachine({
      name: 'Dryer 1', machine_type: 'dryer', capacity: null, purchase_date: null,
      last_maintenance_date: null, next_maintenance_date: null, notes: 'Service soon',
    }, user.id);
    await repository.createMachine({
      name: 'Press 1', machine_type: 'press', capacity: 'Large', purchase_date: '2024-01-01',
      last_maintenance_date: '2026-09-01', next_maintenance_date: null, notes: null,
    }, user.id);
    expect(await repository.listMachines()).toHaveLength(3);
    await expect(repository.createMachine({
      name: 'Bad capacity', machine_type: 'washer', capacity: '-3 kg', purchase_date: null,
      last_maintenance_date: null, next_maintenance_date: null, notes: null,
    }, user.id)).rejects.toThrow('finite, non-negative');
    await expect(repository.createMachine({
      name: 'Infinite capacity', machine_type: 'washer', capacity: 'Infinity', purchase_date: null,
      last_maintenance_date: null, next_maintenance_date: null, notes: null,
    }, user.id)).rejects.toThrow('finite, non-negative');
    await expect(repository.createMachine({
      name: 'NaN capacity', machine_type: 'washer', capacity: 'NaN', purchase_date: null,
      last_maintenance_date: null, next_maintenance_date: null, notes: null,
    }, user.id)).rejects.toThrow('finite.');
    await expect(repository.createMachine({
      name: '', machine_type: 'washer', capacity: null, purchase_date: null,
      last_maintenance_date: null, next_maintenance_date: null, notes: null,
    }, user.id)).rejects.toThrow('name and type are required');
    expect(database.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE entity_type IN ('expense', 'inventory_item', 'machine')").get())
      .toEqual({ count: 9 });
  });

  it('uses one local-calendar snapshot for dashboard and report totals across a DST midnight', async () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      const { repository, user } = await createRepository();
      const reportDate = '2025-03-09';
      const referenceDate = new Date(2025, 2, 9, 12);
      const dayStart = new Date(2025, 2, 9).toISOString();
      const nextDayStart = new Date(2025, 2, 10).toISOString();
      expect(nextDayStart).not.toBe(new Date(Date.parse(dayStart) + 86400000).toISOString());

      seedOrder(user, { id: 'before-local-midnight', receivedAt: new Date(Date.parse(dayStart) - 1).toISOString(), status: 'cancelled', totalAmount: 111 });
      seedOrder(user, { id: 'local-midnight', receivedAt: dayStart, status: 'washing', totalAmount: 200, expectedReadyAt: '2025-03-08T12:00:00.000Z' });
      seedItem('local-midnight', { id: 'piece-at-midnight', type: 'piece', quantity: 2, weight: 0, lineTotal: 200 });
      seedPayment(user, 'local-midnight', 'paid-at-midnight', 25, dayStart);
      seedOrder(user, { id: 'last-local-millisecond', receivedAt: new Date(Date.parse(nextDayStart) - 1).toISOString(), status: 'ready', totalAmount: 300 });
      seedItem('last-local-millisecond', { id: 'weight-before-next-midnight', type: 'weight', quantity: 0, weight: 4, lineTotal: 300 });
      seedPayment(user, 'last-local-millisecond', 'paid-before-next-midnight', 50, new Date(Date.parse(nextDayStart) - 1).toISOString());
      seedOrder(user, { id: 'next-local-midnight', receivedAt: nextDayStart, status: 'cancelled', totalAmount: 400 });
      await repository.createExpense({
        expense_date: reportDate, category: 'electricity', description: null,
        amount: 25, payment_method: 'cash', notes: null,
      }, user.id);

      const readBatchesBefore = calls.filter(call => call.command === 'local_read_batch').length;
      const dashboard = await repository.getDashboardSummary(referenceDate);
      expect(dashboard).toMatchObject({
        orders_today: 2,
        pieces_today: 2,
        weight_today: 4,
        sales_today: 500,
        collected_today: 75,
        in_process: 1,
        ready: 1,
        overdue: 1,
      });
      expect(calls.filter(call => call.command === 'local_read_batch')).toHaveLength(readBatchesBefore + 1);

      const report = await repository.getReport(reportDate, reportDate);
      expect(report).toMatchObject({
        orders_today: 2,
        pieces_today: 2,
        weight_today: 4,
        sales_today: 500,
        collected_today: 75,
        outstanding: 425,
        completed_orders: 1,
        expenses: 25,
        estimated_profit: 475,
        average_order_value: 250,
      });
      expect(calls.filter(call => call.command === 'local_read_batch')).toHaveLength(readBatchesBefore + 2);
      await expect(repository.getReport('2025-03-10', '2025-03-09')).rejects.toThrow('on or before');
      await expect(repository.getReport('2025-02-30', '2025-03-09')).rejects.toThrow('valid calendar date');
      await expect(repository.getReport('03/09/2025', '2025-03-09')).rejects.toThrow('YYYY-MM-DD');
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
  });

  it('returns complete zero summaries for an empty local database', async () => {
    const { repository } = await createRepository();
    await expect(repository.getDashboardSummary(new Date(2025, 0, 1))).resolves.toEqual({
      orders_today: 0,
      pieces_today: 0,
      weight_today: 0,
      sales_today: 0,
      collected_today: 0,
      outstanding: 0,
      in_process: 0,
      ready: 0,
      overdue: 0,
    });
    await expect(repository.getReport('2025-01-01', '2025-01-01')).resolves.toEqual({
      orders_today: 0,
      pieces_today: 0,
      weight_today: 0,
      sales_today: 0,
      collected_today: 0,
      outstanding: 0,
      in_process: 0,
      ready: 0,
      overdue: 0,
      completed_orders: 0,
      expenses: 0,
      estimated_profit: 0,
      average_order_value: 0,
    });
  });
});
