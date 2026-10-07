import { getLocalDatabaseInfo, localBatch, localReadBatch, localSelect } from './db';
import type { LocalDatabaseInfo, SqlBatchStatement, SqlQuery, SqlValue } from './db';
import { calculateLineTotal, calculateOrderTotals, getOrderType, roundMoney } from './domain';
import { createSalt, hashPin, verifyPin } from './security';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  type CreateOrderInput,
  type Customer,
  type CustomerType,
  type DashboardSummary,
  type DiscountType,
  type Expense,
  type InventoryItem,
  type LocalOrder,
  type LocalUser,
  type Machine,
  type OrderItem,
  type OrderStatus,
  type Payment,
  type PaymentMethod,
  type ReportSummary,
  type Service,
  type ShopSettings,
} from './types';

interface CountRow {
  count: number;
}

interface SettingRow {
  key: string;
  value: string;
}

const now = (): string => new Date().toISOString();
const id = (): string => crypto.randomUUID();

const DEFAULT_SETTINGS: ShopSettings = {
  shop_name: 'Smart Laundry',
  shop_address: '',
  shop_phone: '',
  gst_number: '',
  receipt_footer: 'Thank you for choosing us.',
  order_prefix: 'LA',
  default_completion_days: 2,
  device_id: '',
};

const EDITABLE_SETTING_KEYS = [
  'shop_name',
  'shop_address',
  'shop_phone',
  'gst_number',
  'receipt_footer',
  'order_prefix',
  'default_completion_days',
] as const;

type EditableSettingKey = typeof EDITABLE_SETTING_KEYS[number];

const mapSettings = (rows: SettingRow[]): ShopSettings => {
  const values = rows.reduce<Record<string, string>>((result, row) => {
    result[row.key] = row.value;
    return result;
  }, {});
  const completionDays = Number(values.default_completion_days ?? DEFAULT_SETTINGS.default_completion_days);

  return {
    shop_name: values.shop_name || DEFAULT_SETTINGS.shop_name,
    shop_address: values.shop_address ?? DEFAULT_SETTINGS.shop_address,
    shop_phone: values.shop_phone ?? DEFAULT_SETTINGS.shop_phone,
    gst_number: values.gst_number ?? DEFAULT_SETTINGS.gst_number,
    receipt_footer: values.receipt_footer ?? DEFAULT_SETTINGS.receipt_footer,
    order_prefix: values.order_prefix || DEFAULT_SETTINGS.order_prefix,
    default_completion_days: Number.isSafeInteger(completionDays) && completionDays >= 0
      ? completionDays
      : DEFAULT_SETTINGS.default_completion_days,
    device_id: values.device_id || id(),
  };
};

const toBoolean = (value: number): boolean => value === 1;

const parseLocalDate = (value: string, label: string): Date => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`${label} must use YYYY-MM-DD format.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error(`${label} must be a valid calendar date.`);
  }
  return date;
};

const localDayStart = (date: Date): Date => (
  new Date(date.getFullYear(), date.getMonth(), date.getDate())
);

const localDateString = (date: Date): string => (
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
);

const localDateRange = (from: string, to: string): {
  start: string;
  endExclusive: string;
  endDateExclusive: string;
} => {
  const startDate = parseLocalDate(from, 'The report start date');
  const endDate = parseLocalDate(to, 'The report end date');
  if (startDate > endDate) throw new Error('The report start date must be on or before the end date.');
  const endExclusiveDate = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() + 1);
  return {
    start: localDayStart(startDate).toISOString(),
    endExclusive: localDayStart(endExclusiveDate).toISOString(),
    endDateExclusive: localDateString(endExclusiveDate),
  };
};

const resolveExpectedReadyAt = (value: string | undefined, completionDays: number, timestamp: string): string => {
  let readyAt: Date;
  if (value === undefined || value === '') {
    const createdAt = new Date(timestamp);
    readyAt = new Date(
      createdAt.getFullYear(), createdAt.getMonth(), createdAt.getDate() + completionDays,
      23, 59, 59, 999,
    );
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    readyAt = parseLocalDate(value, 'The expected ready date');
    readyAt.setHours(23, 59, 59, 999);
  } else {
    readyAt = new Date(value);
    if (!Number.isFinite(readyAt.getTime())) throw new Error('The expected ready date is invalid.');
  }
  return readyAt.toISOString();
};

const assertFiniteNonNegative = (label: string, value: number): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite, non-negative number.`);
  }
};

const assertPositive = (label: string, value: number): void => {
  assertFiniteNonNegative(label, value);
  if (value <= 0) throw new RangeError(`${label} must be greater than zero.`);
};

const assertPaymentMethod = (method: string): void => {
  if (!(PAYMENT_METHODS as readonly string[]).includes(method)) {
    throw new TypeError('Unsupported payment method.');
  }
};

const assertOrderStatus = (status: string): void => {
  if (!(ORDER_STATUSES as readonly string[]).includes(status)) {
    throw new TypeError('Unsupported order status.');
  }
};

const assertServiceType = (serviceType: string): void => {
  if (!['piece', 'weight', 'combined'].includes(serviceType)) {
    throw new TypeError('Unsupported service type.');
  }
};

const assertSettingPatch = (settings: Partial<ShopSettings>): void => {
  for (const [key, value] of Object.entries(settings)) {
    if (!(EDITABLE_SETTING_KEYS as readonly string[]).includes(key)) {
      throw new TypeError(`Unsupported shop setting: ${key}.`);
    }
    if (key === 'default_completion_days') {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new RangeError('Default completion days must be a non-negative integer.');
      }
    } else if (typeof value !== 'string') {
      throw new TypeError(`${key} must be a string.`);
    }
  }
};

const paymentStatusUpdate = (
  orderIdExpression: string,
  orderIdValues: SqlValue[],
  timestamp: string,
): SqlBatchStatement => {
  const paidCents = `SELECT COALESCE(SUM(CAST(ROUND(amount * 100) AS INTEGER)), 0) FROM payments
    WHERE order_id = ${orderIdExpression} AND voided_at IS NULL`;
  const totalCents = 'CAST(ROUND(total_amount * 100) AS INTEGER)';
  return {
    sql: `UPDATE orders SET payment_status = CASE
            WHEN (${paidCents}) > ${totalCents} THEN 'overpaid'
            WHEN (${paidCents}) = ${totalCents} THEN 'paid'
            WHEN (${paidCents}) <= 0 THEN 'unpaid'
            ELSE 'partially_paid' END,
          updated_at = ?, version = version + 1
          WHERE id = ${orderIdExpression}`,
    values: [...orderIdValues, ...orderIdValues, ...orderIdValues, timestamp, ...orderIdValues],
    expectedRows: 1,
    error: 'Order not found.',
  };
};

const auditStatement = (
  entityType: string,
  entityId: string,
  action: string,
  details: unknown,
  userId: string,
  timestamp: string,
): SqlBatchStatement => ({
  sql: `INSERT INTO audit_log (id, entity_type, entity_id, action, details_json, user_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
  values: [id(), entityType, entityId, action, JSON.stringify(details), userId, timestamp],
  expectedRows: 1,
});

export class LocalLaundryRepository {
  async initialize(): Promise<LocalDatabaseInfo> {
    const info = await getLocalDatabaseInfo();
    if (info.error) throw new Error(info.error);
    return info;
  }

  async hasLocalUser(): Promise<boolean> {
    const rows = await localSelect<CountRow>('SELECT COUNT(*) AS count FROM local_users');
    return Number(rows[0]?.count || 0) > 0;
  }

  async createAdmin(fullName: string, pin: string): Promise<LocalUser> {
    const trimmedName = fullName.trim();
    if (!trimmedName) throw new Error('Enter the administrator name.');
    if (!/^\d{4,8}$/.test(pin)) throw new Error('PIN must contain 4 to 8 digits.');

    const timestamp = now();
    const user: LocalUser = {
      id: id(),
      full_name: trimmedName,
      role: 'admin',
      created_at: timestamp,
      updated_at: timestamp,
    };
    const salt = createSalt();
    const pinHash = await hashPin(pin, salt);

    await localBatch([
      {
        sql: `INSERT INTO local_users (id, full_name, pin_hash, pin_salt, role, created_at, updated_at)
              SELECT ?, ?, ?, ?, 'admin', ?, ? WHERE NOT EXISTS (SELECT 1 FROM local_users)`,
        values: [user.id, user.full_name, pinHash, salt, user.created_at, user.updated_at],
        expectedRows: 1,
        error: 'The local administrator is already configured.',
      },
    ]);
    return user;
  }

  async authenticate(pin: string): Promise<LocalUser | null> {
    const users = await localSelect<LocalUser & { pin_hash: string; pin_salt: string }>(
      'SELECT id, full_name, role, created_at, updated_at, pin_hash, pin_salt FROM local_users LIMIT 1',
    );
    const user = users[0];
    if (!user || !(await verifyPin(pin, user.pin_salt, user.pin_hash))) return null;

    return {
      id: user.id,
      full_name: user.full_name,
      role: 'admin',
      created_at: user.created_at,
      updated_at: user.updated_at,
    };
  }

  async getSettings(): Promise<ShopSettings> {
    const rows = await localSelect<SettingRow>('SELECT key, value FROM app_settings');
    return mapSettings(rows);
  }

  async saveSettings(settings: Partial<ShopSettings>, userId: string): Promise<ShopSettings> {
    assertSettingPatch(settings);
    const current = await this.getSettings();
    const next = { ...current, ...settings };
    const entries = Object.entries(settings) as [EditableSettingKey, string | number][];
    if (entries.length === 0) return current;

    const timestamp = now();
    const statements: SqlBatchStatement[] = entries.map(([key, value]) => ({
      sql: `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      values: [key, String(value), timestamp],
      expectedRows: 1,
    }));
    statements.push(auditStatement('settings', 'app_settings', 'updated', settings, userId, timestamp));
    await localBatch(statements);
    return next;
  }

  async listServices(includeInactive = false): Promise<Service[]> {
    const activeFilter = includeInactive ? '' : 'WHERE active = 1';
    const rows = await localSelect<Omit<Service, 'active'> & { active: number }>(
      `SELECT id, name, description, category, price_per_piece, price_per_kg, active, created_at, updated_at
       FROM services ${activeFilter} ORDER BY name`,
    );
    return rows.map(row => ({ ...row, active: toBoolean(row.active) }));
  }

  async createService(input: {
    name: string;
    description?: string;
    category?: string;
    price_per_piece?: number;
    price_per_kg?: number;
  }, userId: string): Promise<Service> {
    const name = input.name.trim();
    if (!name) throw new Error('Service name is required.');
    if (input.price_per_piece != null) assertFiniteNonNegative('Price per piece', input.price_per_piece);
    if (input.price_per_kg != null) assertFiniteNonNegative('Price per kg', input.price_per_kg);
    const timestamp = now();
    const service: Service = {
      id: id(),
      name,
      description: input.description?.trim() || null,
      category: input.category?.trim() || 'laundry',
      price_per_piece: input.price_per_piece ?? null,
      price_per_kg: input.price_per_kg ?? null,
      active: true,
      created_at: timestamp,
      updated_at: timestamp,
    };
    const settings = await this.getSettings();

    await localBatch([
      {
        sql: `INSERT INTO services
              (id, name, description, category, price_per_piece, price_per_kg, active, created_at, updated_at, origin_device_id)
              VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        values: [service.id, service.name, service.description, service.category, service.price_per_piece,
          service.price_per_kg, timestamp, timestamp, settings.device_id],
        expectedRows: 1,
      },
      auditStatement('service', service.id, 'created', service, userId, timestamp),
    ]);
    return service;
  }

  async updateService(
    idToUpdate: string,
    input: Partial<Omit<Service, 'id' | 'created_at' | 'updated_at'>>,
    userId: string,
  ): Promise<void> {
    const fields: string[] = [];
    const values: SqlValue[] = [];
    for (const [key, rawValue] of Object.entries(input)) {
      if (key === 'active') {
        if (typeof rawValue !== 'boolean') throw new TypeError('Service active state must be a boolean.');
        fields.push('active = ?');
        values.push(rawValue ? 1 : 0);
      } else if (key === 'name' || key === 'description' || key === 'category') {
        if (rawValue !== null && typeof rawValue !== 'string') throw new TypeError(`Service ${key} must be a string.`);
        const text = typeof rawValue === 'string' ? rawValue.trim() : null;
        if (key === 'name' && !text) throw new Error('Service name is required.');
        fields.push(`${key} = ?`);
        values.push(text || null);
      } else if (key === 'price_per_piece' || key === 'price_per_kg') {
        if (rawValue != null) {
          if (typeof rawValue !== 'number') throw new TypeError(`${key} must be a number or null.`);
          assertFiniteNonNegative(key, rawValue);
        }
        fields.push(`${key} = ?`);
        values.push(rawValue == null ? null : rawValue as number);
      } else {
        throw new TypeError(`Unsupported service field: ${key}.`);
      }
    }
    if (fields.length === 0) return;
    const timestamp = now();
    fields.push('updated_at = ?', 'version = version + 1');
    values.push(timestamp, idToUpdate);
    await localBatch([
      {
        sql: `UPDATE services SET ${fields.join(', ')} WHERE id = ?`,
        values,
        expectedRows: 1,
        error: 'Service not found.',
      },
      auditStatement('service', idToUpdate, 'updated', input, userId, timestamp),
    ]);
  }

  async listCustomers(search = ''): Promise<Customer[]> {
    const trimmed = search.trim();
    if (!trimmed) return localSelect<Customer>('SELECT * FROM customers ORDER BY name');
    const pattern = `%${trimmed}%`;
    return localSelect<Customer>(
      `SELECT * FROM customers
       WHERE name LIKE ? OR phone LIKE ? OR alternate_phone LIKE ? OR customer_code LIKE ?
       ORDER BY name`,
      [pattern, pattern, pattern, pattern],
    );
  }

  async createCustomer(input: {
    name: string;
    phone: string;
    alternate_phone?: string;
    address?: string;
    customer_type?: CustomerType;
    notes?: string;
  }, userId: string): Promise<Customer> {
    const name = input.name.trim();
    const phone = input.phone.trim();
    const alternatePhone = input.alternate_phone?.trim() || null;
    if (!name || !phone) throw new Error('Customer name and phone are required.');
    const customerType = input.customer_type || 'regular';
    if (!['regular', 'student', 'hostel', 'other'].includes(customerType)) {
      throw new TypeError('Unsupported customer type.');
    }
    const timestamp = now();
    const customerId = id();
    const customer: Customer = {
      id: customerId,
      customer_code: `C-${id().toUpperCase()}`,
      name,
      phone,
      alternate_phone: alternatePhone,
      address: input.address?.trim() || null,
      customer_type: customerType,
      notes: input.notes?.trim() || null,
      created_at: timestamp,
      updated_at: timestamp,
    };
    const settings = await this.getSettings();

    await localBatch([
      {
        sql: `INSERT INTO customers
              (id, customer_code, name, phone, alternate_phone, address, customer_type, notes,
               created_at, updated_at, origin_device_id)
              SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
              WHERE NOT EXISTS (
                SELECT 1 FROM customers existing
                WHERE existing.phone = ?
                   OR existing.alternate_phone = ?
                   OR (? IS NOT NULL AND (existing.phone = ? OR existing.alternate_phone = ?))
              )`,
        values: [customer.id, customer.customer_code, customer.name, customer.phone, customer.alternate_phone,
          customer.address, customer.customer_type, customer.notes, timestamp, timestamp, settings.device_id,
          phone, phone, alternatePhone, alternatePhone, alternatePhone],
        expectedRows: 1,
        error: 'A customer with this phone number already exists.',
      },
      auditStatement('customer', customer.id, 'created', customer, userId, timestamp),
    ]);
    return customer;
  }

  async createOrder(input: CreateOrderInput, userId: string): Promise<LocalOrder> {
    if (!input.customer_name.trim() || !input.customer_phone.trim()) {
      throw new Error('Customer name and phone are required.');
    }
    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new Error('Add at least one order item.');
    }

    for (const item of input.items) {
      assertServiceType(item.service_type);
      assertFiniteNonNegative('Quantity', item.quantity);
      assertFiniteNonNegative('Weight', item.weight_kg);
      assertFiniteNonNegative('Rate', item.rate);
      if (item.service_type === 'piece' && item.quantity <= 0) {
        throw new RangeError('Piece orders require a quantity greater than zero.');
      }
      if (item.service_type === 'weight' && item.weight_kg <= 0) {
        throw new RangeError('Weight orders require a weight greater than zero.');
      }
      if (item.service_type === 'combined' && item.quantity <= 0 && item.weight_kg <= 0) {
        throw new RangeError('Combined orders require a quantity or weight greater than zero.');
      }
      if (!item.item_name.trim() || !item.service_name.trim()) {
        throw new Error('Each order item needs an item name and service name.');
      }
    }

    const discountType: DiscountType = input.discount_type || 'fixed';
    const discountValue = input.discount_value ?? 0;
    assertFiniteNonNegative('Discount amount', discountValue);
    const totals = calculateOrderTotals(input.items, discountType, discountValue);
    let payment = input.payment;
    if (payment) {
      assertFiniteNonNegative('Payment amount', input.payment.amount);
      assertPaymentMethod(input.payment.method);
      if (input.payment.amount > 0) {
        const roundedAmount = roundMoney(input.payment.amount);
        if (roundedAmount <= 0) throw new RangeError('Payment amount must be at least one cent.');
        payment = { ...input.payment, amount: roundedAmount };
      }
    }
    const orderType = getOrderType(input.items);
    const settings = await this.getSettings();
    const timestamp = now();
    const orderId = id();
    const year = new Date(timestamp).getFullYear();
    const expectedReady = resolveExpectedReadyAt(input.expected_ready_at, settings.default_completion_days, timestamp);
    const statements: SqlBatchStatement[] = [
      {
        sql: `INSERT INTO order_sequences (year, next_number) VALUES (?, 2)
              ON CONFLICT(year) DO UPDATE SET next_number = order_sequences.next_number + 1`,
        values: [year],
        expectedRows: 1,
      },
      {
        sql: `INSERT INTO orders
              (id, order_number, customer_id, customer_name, customer_phone, order_type, received_at, expected_ready_at,
               status, subtotal, discount_type, discount_value, discount_amount, total_amount, payment_status,
               special_instructions, damage_notes, internal_notes, created_by, created_at, updated_at, origin_device_id)
              SELECT ?, ? || '-' || CAST(? AS INTEGER) || '-' || printf('%05d', next_number - 1), ?, ?, ?, ?, ?, ?, 'received',
                     ?, ?, ?, ?, ?, 'unpaid', ?, ?, ?, ?, ?, ?, ?
              FROM order_sequences WHERE year = ?`,
        values: [orderId, settings.order_prefix, year, input.customer_id || null,
          input.customer_name.trim(), input.customer_phone.trim(), orderType, timestamp, expectedReady,
          totals.subtotal, discountType, discountValue, totals.discountAmount, totals.totalAmount,
          input.special_instructions?.trim() || null, input.damage_notes?.trim() || null,
          input.internal_notes?.trim() || null, userId, timestamp, timestamp, settings.device_id, year],
        expectedRows: 1,
        error: 'The order sequence could not be allocated.',
      },
    ];

    for (const item of input.items) {
      statements.push({
        sql: `INSERT INTO order_items
              (id, order_id, service_id, item_name, service_name, service_type, quantity, weight_kg, rate, line_total, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        values: [id(), orderId, item.service_id || null, item.item_name.trim(), item.service_name.trim(),
          item.service_type, item.quantity, item.weight_kg, item.rate, calculateLineTotal(item), timestamp],
        expectedRows: 1,
      });
    }
    statements.push({
      sql: `INSERT INTO order_status_history (id, order_id, previous_status, new_status, changed_at, changed_by)
            VALUES (?, ?, NULL, 'received', ?, ?)`,
      values: [id(), orderId, timestamp, userId],
      expectedRows: 1,
    });
    if (payment && payment.amount > 0) {
      statements.push(this.insertPaymentStatement(orderId, payment, userId, timestamp, settings.device_id));
    }
    statements.push(paymentStatusUpdate('?', [orderId], timestamp));
    statements.push(auditStatement('order', orderId, 'created', { orderNumberYear: year, totals }, userId, timestamp));
    statements.push({
      sql: 'SELECT * FROM orders WHERE id = ?',
      values: [orderId],
      mode: 'select',
      expectedRows: 1,
      error: 'The created order could not be read.',
    });

    const results = await localBatch(statements);
    const orderRow = results[results.length - 1]?.rows?.[0];
    if (!orderRow) throw new Error('The created order could not be read.');
    return orderRow as unknown as LocalOrder;
  }

  async listOrders(search = '', status: OrderStatus | 'all' = 'all'): Promise<LocalOrder[]> {
    assertOrderStatusOrAll(status);
    const clauses: string[] = [];
    const values: SqlValue[] = [];
    if (search.trim()) {
      clauses.push('(o.order_number LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ?)');
      const pattern = `%${search.trim()}%`;
      values.push(pattern, pattern, pattern);
    }
    if (status !== 'all') {
      clauses.push('o.status = ?');
      values.push(status);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return localSelect<LocalOrder>(
      `SELECT o.*, COALESCE(SUM(CASE WHEN p.voided_at IS NULL THEN CAST(ROUND(p.amount * 100) AS INTEGER) ELSE 0 END), 0) / 100.0 AS paid_amount
       FROM orders o LEFT JOIN payments p ON p.order_id = o.id
       ${where} GROUP BY o.id ORDER BY o.received_at DESC`,
      values,
    );
  }

  async getOrder(orderId: string): Promise<LocalOrder | null> {
    const [orders, items, payments] = await localReadBatch<LocalOrder | OrderItem | Payment>([
      { sql: 'SELECT * FROM orders WHERE id = ?', values: [orderId] },
      { sql: 'SELECT id, service_id, item_name, service_name, service_type, quantity, weight_kg, rate, line_total FROM order_items WHERE order_id = ? ORDER BY created_at', values: [orderId] },
      { sql: 'SELECT * FROM payments WHERE order_id = ? ORDER BY recorded_at', values: [orderId] },
    ]);
    const order = orders[0] as LocalOrder | undefined;
    if (!order) return null;
    order.items = items as OrderItem[];
    order.payments = payments as Payment[];
    order.paid_amount = roundMoney(order.payments
      .filter(payment => !payment.voided_at)
      .reduce((sum, payment) => sum + payment.amount, 0));
    return order;
  }

  async setOrderStatus(orderId: string, status: OrderStatus, userId: string, notes?: string): Promise<void> {
    assertOrderStatus(status);
    const timestamp = now();
    const historyId = id();
    const details = JSON.stringify({ next: status, notes });
    await localBatch([
      {
        sql: 'SELECT id FROM orders WHERE id = ?',
        values: [orderId],
        mode: 'select',
        expectedRows: 1,
        error: 'Order not found.',
      },
      {
        sql: `INSERT INTO order_status_history
              (id, order_id, previous_status, new_status, changed_at, changed_by, notes)
              SELECT ?, id, status, ?, ?, ?, ? FROM orders WHERE id = ? AND status <> ?`,
        values: [historyId, status, timestamp, userId, notes || null, orderId, status],
      },
      {
        sql: 'UPDATE orders SET status = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status <> ?',
        values: [status, timestamp, orderId, status],
      },
      {
        sql: `INSERT INTO audit_log (id, entity_type, entity_id, action, details_json, user_id, created_at)
              SELECT ?, 'order', ?, 'status_changed', ?, ?, ?
              WHERE EXISTS (SELECT 1 FROM order_status_history WHERE id = ?)`,
        values: [id(), orderId, details, userId, timestamp, historyId],
      },
    ]);
  }

  async addPayment(
    orderId: string,
    input: { amount: number; method: PaymentMethod; reference_number?: string; notes?: string },
    userId: string,
  ): Promise<void> {
    assertPositive('Payment amount', input.amount);
    assertPaymentMethod(input.method);
    const amount = roundMoney(input.amount);
    if (amount <= 0) throw new RangeError('Payment amount must be at least one cent.');
    const payment = { ...input, amount };
    const settings = await this.getSettings();
    const timestamp = now();
    await localBatch([
      {
        sql: 'SELECT id FROM orders WHERE id = ?',
        values: [orderId],
        mode: 'select',
        expectedRows: 1,
        error: 'Order not found.',
      },
      this.insertPaymentStatement(orderId, payment, userId, timestamp, settings.device_id),
      paymentStatusUpdate('?', [orderId], timestamp),
      auditStatement('payment', orderId, 'added', payment, userId, timestamp),
    ]);
  }

  async voidPayment(paymentId: string, reason: string, userId: string): Promise<void> {
    const timestamp = now();
    const orderIdExpression = '(SELECT order_id FROM payments WHERE id = ?)';
    const details = { reason };
    await localBatch([
      {
        sql: 'SELECT order_id FROM payments WHERE id = ? AND voided_at IS NULL',
        values: [paymentId],
        mode: 'select',
        expectedRows: 1,
        error: 'Payment not found or already voided.',
      },
      {
        sql: `UPDATE payments SET voided_at = ?, voided_by = ?, void_reason = ?, updated_at = ?, version = version + 1
              WHERE id = ? AND voided_at IS NULL`,
        values: [timestamp, userId, reason.trim() || 'Voided by administrator', timestamp, paymentId],
        expectedRows: 1,
        error: 'Payment not found or already voided.',
      },
      paymentStatusUpdate(orderIdExpression, [paymentId], timestamp),
      auditStatement('payment', paymentId, 'voided', details, userId, timestamp),
    ]);
  }

  async listExpenses(from?: string, to?: string): Promise<Expense[]> {
    const clauses: string[] = [];
    const values: SqlValue[] = [];
    if (from) { clauses.push('expense_date >= ?'); values.push(from); }
    if (to) { clauses.push('expense_date <= ?'); values.push(to); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return localSelect<Expense>(`SELECT * FROM expenses ${where} ORDER BY expense_date DESC, created_at DESC`, values);
  }

  async createExpense(input: Omit<Expense, 'id' | 'created_at'>, userId: string): Promise<void> {
    assertPositive('Expense amount', input.amount);
    if (!input.category.trim()) throw new Error('Expense category is required.');
    assertExpensePaymentMethod(input.payment_method);
    const timestamp = now();
    const expenseId = id();
    const settings = await this.getSettings();
    await localBatch([
      {
        sql: `INSERT INTO expenses
              (id, expense_date, category, description, amount, payment_method, notes,
               created_by, created_at, updated_at, origin_device_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        values: [expenseId, input.expense_date, input.category.trim(), input.description || null,
          input.amount, input.payment_method, input.notes || null, userId, timestamp, timestamp, settings.device_id],
        expectedRows: 1,
      },
      auditStatement('expense', expenseId, 'created', input, userId, timestamp),
    ]);
  }

  async listInventory(): Promise<InventoryItem[]> {
    return localSelect<InventoryItem>('SELECT * FROM inventory_items ORDER BY name');
  }

  async createInventoryItem(
    input: { name: string; unit: string; minimum_quantity: number; purchase_cost?: number; notes?: string },
    userId: string,
  ): Promise<void> {
    const name = input.name.trim();
    const unit = input.unit.trim();
    if (!name || !unit) throw new Error('Inventory item name and unit are required.');
    assertFiniteNonNegative('Minimum quantity', input.minimum_quantity);
    if (input.purchase_cost != null) assertFiniteNonNegative('Purchase cost', input.purchase_cost);
    const timestamp = now();
    const itemId = id();
    const settings = await this.getSettings();
    await localBatch([
      {
        sql: `INSERT INTO inventory_items
              (id, name, current_quantity, unit, minimum_quantity, purchase_cost, notes,
               created_at, updated_at, origin_device_id)
              VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
        values: [itemId, name, unit, input.minimum_quantity, input.purchase_cost ?? null,
          input.notes?.trim() || null, timestamp, timestamp, settings.device_id],
        expectedRows: 1,
      },
      auditStatement('inventory_item', itemId, 'created', input, userId, timestamp),
    ]);
  }

  async adjustInventory(
    itemId: string,
    changeQuantity: number,
    transactionType: 'stock_in' | 'stock_out' | 'adjustment',
    reason: string,
    userId: string,
  ): Promise<void> {
    if (!Number.isFinite(changeQuantity)) throw new RangeError('Stock change must be finite.');
    if (changeQuantity === 0) throw new Error('Stock change must not be zero.');
    if (!['stock_in', 'stock_out', 'adjustment'].includes(transactionType)) {
      throw new TypeError('Unsupported inventory transaction type.');
    }
    if ((transactionType === 'stock_in' && changeQuantity < 0)
      || (transactionType === 'stock_out' && changeQuantity > 0)) {
      throw new Error('Stock change direction does not match the transaction type.');
    }
    const timestamp = now();
    await localBatch([
      {
        sql: 'SELECT current_quantity FROM inventory_items WHERE id = ?',
        values: [itemId],
        mode: 'select',
        expectedRows: 1,
        error: 'Inventory item not found.',
      },
      {
        sql: `UPDATE inventory_items SET current_quantity = current_quantity + ?, updated_at = ?, version = version + 1
              WHERE id = ? AND current_quantity + ? >= 0`,
        values: [changeQuantity, timestamp, itemId, changeQuantity],
        expectedRows: 1,
        error: 'Stock cannot become negative.',
      },
      {
        sql: `INSERT INTO inventory_transactions
              (id, inventory_item_id, change_quantity, transaction_type, reason, created_by, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        values: [id(), itemId, changeQuantity, transactionType, reason.trim() || null, userId, timestamp],
        expectedRows: 1,
      },
      auditStatement('inventory_item', itemId, 'adjusted', { changeQuantity, transactionType, reason }, userId, timestamp),
    ]);
  }

  async listMachines(): Promise<Machine[]> {
    return localSelect<Machine>(`SELECT * FROM machines
      ORDER BY COALESCE(next_maintenance_date, '9999-12-31'), name`);
  }

  async createMachine(input: Omit<Machine, 'id' | 'created_at' | 'updated_at'>, userId: string): Promise<void> {
    const name = input.name.trim();
    const machineType = input.machine_type.trim();
    if (!name || !machineType) throw new Error('Machine name and type are required.');
    const capacity = input.capacity?.trim() || null;
    if (capacity) {
      const numericCapacity = Number.parseFloat(capacity);
      if (!Number.isNaN(numericCapacity)) assertFiniteNonNegative('Machine capacity', numericCapacity);
      else if (/^[+-]?(?:nan|infinity)/i.test(capacity)) throw new RangeError('Machine capacity must be finite.');
    }
    const timestamp = now();
    const machineId = id();
    const settings = await this.getSettings();
    await localBatch([
      {
        sql: `INSERT INTO machines
              (id, name, machine_type, capacity, purchase_date, last_maintenance_date,
               next_maintenance_date, notes, created_at, updated_at, origin_device_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        values: [machineId, name, machineType, capacity, input.purchase_date || null,
          input.last_maintenance_date || null, input.next_maintenance_date || null,
          input.notes?.trim() || null, timestamp, timestamp, settings.device_id],
        expectedRows: 1,
      },
      auditStatement('machine', machineId, 'created', input, userId, timestamp),
    ]);
  }

  async getDashboardSummary(referenceDate = new Date()): Promise<DashboardSummary> {
    const todayStart = localDayStart(referenceDate).toISOString();
    const tomorrowStart = new Date(
      referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate() + 1,
    ).toISOString();
    const dateValues: SqlValue[] = [todayStart, tomorrowStart];
    const results = await localReadBatch([
      {
        sql: `SELECT COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS sales FROM orders
              WHERE received_at >= ? AND received_at < ? AND status <> 'cancelled'`,
        values: dateValues,
      },
      {
        sql: `SELECT COALESCE(SUM(CASE WHEN oi.service_type IN ('piece', 'combined') THEN oi.quantity ELSE 0 END), 0) AS pieces,
                     COALESCE(SUM(CASE WHEN oi.service_type IN ('weight', 'combined') THEN oi.weight_kg ELSE 0 END), 0) AS weight
              FROM order_items oi JOIN orders o ON o.id = oi.order_id
              WHERE o.received_at >= ? AND o.received_at < ? AND o.status <> 'cancelled'`,
        values: dateValues,
      },
      {
        sql: `SELECT COALESCE(SUM(CAST(ROUND(p.amount * 100) AS INTEGER)), 0) / 100.0 AS amount FROM payments p
              WHERE p.recorded_at >= ? AND p.recorded_at < ? AND p.voided_at IS NULL`,
        values: dateValues,
      },
      {
        sql: `SELECT COALESCE(SUM(CASE WHEN CAST(ROUND(o.total_amount * 100) AS INTEGER) > COALESCE(p.paid_cents, 0)
                THEN CAST(ROUND(o.total_amount * 100) AS INTEGER) - COALESCE(p.paid_cents, 0) ELSE 0 END), 0) / 100.0 AS amount
              FROM orders o LEFT JOIN (
                SELECT order_id, SUM(CASE WHEN voided_at IS NULL THEN CAST(ROUND(amount * 100) AS INTEGER) ELSE 0 END) AS paid_cents
                FROM payments GROUP BY order_id
              ) p ON p.order_id = o.id
              WHERE o.status NOT IN ('cancelled', 'collected')`,
        values: [],
      },
      {
        sql: `SELECT status, COUNT(*) AS count FROM orders
              WHERE status IN ('washing', 'drying', 'ironing', 'quality_check', 'packing') GROUP BY status`,
        values: [],
      },
      { sql: "SELECT COUNT(*) AS count FROM orders WHERE status = 'ready'", values: [] },
      {
        sql: `SELECT COUNT(*) AS count FROM orders
              WHERE expected_ready_at < ? AND status NOT IN ('collected', 'cancelled', 'ready')`,
        values: [new Date().toISOString()],
      },
    ]);
    const orders = results[0] as Array<{ count: number; sales: number }>;
    const pieces = results[1] as Array<{ pieces: number; weight: number }>;
    const collected = results[2] as Array<{ amount: number }>;
    const outstanding = results[3] as Array<{ amount: number }>;
    const statusRows = results[4] as Array<{ status: OrderStatus; count: number }>;
    const ready = results[5] as unknown as CountRow[];
    const overdue = results[6] as unknown as CountRow[];

    return {
      orders_today: Number(orders[0]?.count || 0),
      pieces_today: Number(pieces[0]?.pieces || 0),
      weight_today: Number(pieces[0]?.weight || 0),
      sales_today: Number(orders[0]?.sales || 0),
      collected_today: Number(collected[0]?.amount || 0),
      outstanding: Number(outstanding[0]?.amount || 0),
      in_process: statusRows.reduce((sum, row) => sum + Number(row.count), 0),
      ready: Number(ready[0]?.count || 0),
      overdue: Number(overdue[0]?.count || 0),
    };
  }

  async getReport(from: string, to: string): Promise<ReportSummary> {
    const range = localDateRange(from, to);
    const rangeStart = range.start;
    const rangeEnd = range.endExclusive;
    const rangeValues: SqlValue[] = [rangeStart, rangeEnd];
    const results = await localReadBatch([
      {
        sql: `SELECT COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS revenue FROM orders
              WHERE received_at >= ? AND received_at < ? AND status <> 'cancelled'`,
        values: rangeValues,
      },
      {
        sql: `SELECT COALESCE(SUM(CASE WHEN oi.service_type IN ('piece', 'combined') THEN oi.quantity ELSE 0 END), 0) AS pieces,
                     COALESCE(SUM(CASE WHEN oi.service_type IN ('weight', 'combined') THEN oi.weight_kg ELSE 0 END), 0) AS weight
              FROM order_items oi JOIN orders o ON o.id = oi.order_id
              WHERE o.received_at >= ? AND o.received_at < ? AND o.status <> 'cancelled'`,
        values: rangeValues,
      },
      {
        sql: `SELECT COALESCE(SUM(CAST(ROUND(amount * 100) AS INTEGER)), 0) / 100.0 AS amount FROM payments
              WHERE recorded_at >= ? AND recorded_at < ? AND voided_at IS NULL`,
        values: rangeValues,
      },
      {
        sql: `SELECT COALESCE(SUM(CASE WHEN CAST(ROUND(o.total_amount * 100) AS INTEGER) > COALESCE(p.paid_cents, 0)
                THEN CAST(ROUND(o.total_amount * 100) AS INTEGER) - COALESCE(p.paid_cents, 0) ELSE 0 END), 0) / 100.0 AS amount
              FROM orders o LEFT JOIN (
                SELECT order_id, SUM(CASE WHEN voided_at IS NULL THEN CAST(ROUND(amount * 100) AS INTEGER) ELSE 0 END) AS paid_cents
                FROM payments GROUP BY order_id
              ) p ON p.order_id = o.id
              WHERE o.received_at >= ? AND o.received_at < ? AND o.status NOT IN ('cancelled', 'collected')`,
        values: rangeValues,
      },
      {
        sql: `SELECT status, COUNT(*) AS count FROM orders
              WHERE received_at >= ? AND received_at < ?
                AND status IN ('washing', 'drying', 'ironing', 'quality_check', 'packing') GROUP BY status`,
        values: rangeValues,
      },
      {
        sql: `SELECT COUNT(*) AS count FROM orders
              WHERE received_at >= ? AND received_at < ? AND status = 'ready'`,
        values: rangeValues,
      },
      {
        sql: `SELECT COUNT(*) AS count FROM orders
              WHERE received_at >= ? AND received_at < ? AND expected_ready_at < ?
                AND status NOT IN ('collected', 'cancelled', 'ready')`,
        values: [...rangeValues, new Date().toISOString()],
      },
      {
        sql: `SELECT COUNT(*) AS count FROM orders
              WHERE received_at >= ? AND received_at < ? AND status IN ('ready', 'collected')`,
        values: rangeValues,
      },
      {
        sql: 'SELECT COALESCE(SUM(amount), 0) AS amount FROM expenses WHERE expense_date >= ? AND expense_date < ?',
        values: [from, range.endDateExclusive],
      },
    ]);
    const orders = results[0] as Array<{ count: number; revenue: number }>;
    const pieces = results[1] as Array<{ pieces: number; weight: number }>;
    const collected = results[2] as Array<{ amount: number }>;
    const outstanding = results[3] as Array<{ amount: number }>;
    const statusRows = results[4] as Array<{ status: OrderStatus; count: number }>;
    const ready = results[5] as unknown as CountRow[];
    const overdue = results[6] as unknown as CountRow[];
    const completed = results[7] as unknown as CountRow[];
    const expenses = results[8] as Array<{ amount: number }>;
    const totalExpenses = Number(expenses[0]?.amount || 0);
    const totalOrders = Number(orders[0]?.count || 0);
    const revenue = Number(orders[0]?.revenue || 0);

    return {
      orders_today: totalOrders,
      pieces_today: Number(pieces[0]?.pieces || 0),
      weight_today: Number(pieces[0]?.weight || 0),
      sales_today: revenue,
      collected_today: Number(collected[0]?.amount || 0),
      outstanding: Number(outstanding[0]?.amount || 0),
      in_process: statusRows.reduce((sum, row) => sum + Number(row.count), 0),
      ready: Number(ready[0]?.count || 0),
      overdue: Number(overdue[0]?.count || 0),
      completed_orders: Number(completed[0]?.count || 0),
      expenses: totalExpenses,
      estimated_profit: revenue - totalExpenses,
      average_order_value: totalOrders ? revenue / totalOrders : 0,
    };
  }

  private insertPaymentStatement(
    orderId: string,
    input: { amount: number; method: PaymentMethod; reference_number?: string; notes?: string },
    userId: string,
    timestamp: string,
    deviceId: string,
  ): SqlBatchStatement {
    return {
      sql: `INSERT INTO payments
            (id, order_id, amount, method, reference_number, notes, recorded_at, recorded_by,
             created_at, updated_at, origin_device_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      values: [id(), orderId, input.amount, input.method, input.reference_number || null,
        input.notes || null, timestamp, userId, timestamp, timestamp, deviceId],
      expectedRows: 1,
    };
  }
}

const assertOrderStatusOrAll = (status: OrderStatus | 'all'): void => {
  if (status !== 'all') assertOrderStatus(status);
};

const assertExpensePaymentMethod = (method: string): void => {
  assertPaymentMethod(method);
  if (method === 'credit') throw new TypeError('Credit is not a supported expense payment method.');
};

export const localLaundryRepository = new LocalLaundryRepository();
