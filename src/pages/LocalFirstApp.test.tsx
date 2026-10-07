// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LocalFirstApp } from './LocalFirstApp';
import type {
  Customer,
  DashboardSummary,
  Expense,
  InventoryItem,
  LocalOrder,
  LocalUser,
  Machine,
  ReportSummary,
  Service,
  ShopSettings,
} from '@/lib/localFirst/types';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  startLocalFirstApp: vi.fn(),
  confirm: vi.fn(),
  open: vi.fn(),
  backupDatabase: vi.fn(),
  restoreDatabase: vi.fn(),
  repository: {
    createAdmin: vi.fn(),
    authenticate: vi.fn(),
    getDashboardSummary: vi.fn(),
    listOrders: vi.fn(),
    listCustomers: vi.fn(),
    listServices: vi.fn(),
    listExpenses: vi.fn(),
    listInventory: vi.fn(),
    listMachines: vi.fn(),
    getSettings: vi.fn(),
    createOrder: vi.fn(),
    getOrder: vi.fn(),
    setOrderStatus: vi.fn(),
    createCustomer: vi.fn(),
    createService: vi.fn(),
    addPayment: vi.fn(),
    createExpense: vi.fn(),
    createInventoryItem: vi.fn(),
    adjustInventory: vi.fn(),
    createMachine: vi.fn(),
    getReport: vi.fn(),
    saveSettings: vi.fn(),
  },
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@/lib/localFirst/startup', () => ({ startLocalFirstApp: mocks.startLocalFirstApp }));
vi.mock('@/lib/localFirst/repository', () => ({ localLaundryRepository: mocks.repository }));
vi.mock('@/lib/localFirst/backup', () => ({
  backupDatabase: mocks.backupDatabase,
  restoreDatabase: mocks.restoreDatabase,
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: mocks.confirm, open: mocks.open }));

const repository = mocks.repository;

const admin: LocalUser = {
  id: 'user-1',
  full_name: 'Riley Patel',
  role: 'admin',
  created_at: '2026-10-01T08:00:00.000Z',
  updated_at: '2026-10-01T08:00:00.000Z',
};

const customer: Customer = {
  id: 'customer-1',
  customer_code: 'C-00001',
  name: 'Morgan Lee',
  phone: '555-0101',
  alternate_phone: null,
  address: null,
  customer_type: 'regular',
  notes: null,
  created_at: '2026-10-02T08:00:00.000Z',
  updated_at: '2026-10-02T08:00:00.000Z',
};

const pieceService: Service = {
  id: 'service-piece',
  name: 'Shirt wash',
  description: null,
  category: 'wash',
  price_per_piece: 12,
  price_per_kg: null,
  active: true,
  created_at: '2026-10-02T08:00:00.000Z',
  updated_at: '2026-10-02T08:00:00.000Z',
};

const weightService: Service = {
  id: 'service-weight',
  name: 'Blanket wash',
  description: null,
  category: 'wash',
  price_per_piece: null,
  price_per_kg: 20,
  active: true,
  created_at: '2026-10-02T08:00:00.000Z',
  updated_at: '2026-10-02T08:00:00.000Z',
};

const settings: ShopSettings = {
  shop_name: 'River Laundry',
  shop_address: '12 Lake Road',
  shop_phone: '555-0199',
  gst_number: 'GST-123',
  receipt_footer: 'Thank you for choosing us.',
  order_prefix: 'RL',
  default_completion_days: 2,
  device_id: 'device-local-42',
};

const baseOrder: LocalOrder = {
  id: 'order-1',
  order_number: 'RL-2026-00001',
  customer_id: customer.id,
  customer_name: customer.name,
  customer_phone: customer.phone,
  order_type: 'weight',
  received_at: '2026-10-03T10:00:00.000Z',
  expected_ready_at: '2026-10-05T12:30:00.000Z',
  status: 'ready',
  subtotal: 74,
  discount_type: 'fixed',
  discount_value: 0,
  discount_amount: 0,
  total_amount: 74,
  payment_status: 'partially_paid',
  special_instructions: 'Treat stains separately.',
  damage_notes: null,
  internal_notes: null,
  created_at: '2026-10-03T10:00:00.000Z',
  updated_at: '2026-10-03T10:00:00.000Z',
  paid_amount: 25,
  items: [
    {
      id: 'item-piece',
      item_name: 'Shirt',
      service_id: pieceService.id,
      service_name: pieceService.name,
      service_type: 'piece',
      quantity: 2,
      weight_kg: 0,
      rate: 12,
      line_total: 24,
    },
    {
      id: 'item-1',
      item_name: 'Blanket',
      service_id: weightService.id,
      service_name: weightService.name,
      service_type: 'weight',
      quantity: 1,
      weight_kg: 2.5,
      rate: 20,
      line_total: 50,
    },
  ],
  payments: [
    {
      id: 'payment-1',
      order_id: 'order-1',
      amount: 25,
      method: 'upi',
      reference_number: 'UPI-9',
      notes: null,
      recorded_at: '2026-10-03T10:05:00.000Z',
      recorded_by: admin.id,
      voided_at: null,
      void_reason: null,
    },
    {
      id: 'payment-voided',
      order_id: 'order-1',
      amount: 5,
      method: 'cash',
      reference_number: null,
      notes: null,
      recorded_at: '2026-10-03T10:06:00.000Z',
      recorded_by: admin.id,
      voided_at: '2026-10-03T10:07:00.000Z',
      void_reason: 'Entered against the wrong order.',
    },
  ],
};

const emptyReceiptOrder: LocalOrder = {
  ...baseOrder,
  id: 'order-empty',
  order_number: 'RL-2026-00002',
  expected_ready_at: null,
  special_instructions: null,
  items: undefined,
  payments: undefined,
  paid_amount: 0,
};

const unpaidOrder: LocalOrder = {
  ...baseOrder,
  id: 'order-unpaid',
  order_number: 'RL-2026-UNPAID',
  payment_status: 'unpaid',
  paid_amount: undefined,
};

const dashboard: DashboardSummary = {
  orders_today: 2,
  pieces_today: 3,
  weight_today: 2.5,
  sales_today: 90,
  collected_today: 40,
  outstanding: 50,
  in_process: 1,
  ready: 1,
  overdue: 0,
};

const report: ReportSummary = {
  ...dashboard,
  expenses: 10,
  estimated_profit: 80,
  completed_orders: 1,
  average_order_value: 45,
};

const expense: Expense = {
  id: 'expense-1',
  expense_date: '2026-10-01',
  category: 'electricity',
  description: 'October bill',
  amount: 25,
  payment_method: 'cash',
  notes: null,
  created_at: '2026-10-01T08:00:00.000Z',
};

const inventoryItem: InventoryItem = {
  id: 'inventory-1',
  name: 'Detergent',
  current_quantity: 5,
  unit: 'bottle',
  minimum_quantity: 2,
  purchase_cost: null,
  notes: null,
  created_at: '2026-10-01T08:00:00.000Z',
  updated_at: '2026-10-01T08:00:00.000Z',
};

const lowStockItem: InventoryItem = {
  ...inventoryItem,
  id: 'inventory-low',
  name: 'Softener',
  current_quantity: 1,
};

const machine: Machine = {
  id: 'machine-1',
  name: 'Washer A',
  machine_type: 'washing machine',
  capacity: '10 kg',
  purchase_date: null,
  last_maintenance_date: null,
  next_maintenance_date: '2026-11-01',
  notes: null,
  created_at: '2026-10-01T08:00:00.000Z',
  updated_at: '2026-10-01T08:00:00.000Z',
};

const unscheduledMachine: Machine = {
  ...machine,
  id: 'machine-unscheduled',
  name: 'Iron press',
  machine_type: 'iron',
  capacity: null,
  next_maintenance_date: null,
};

const fill = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

const fillAt = (label: string, index: number, value: string) => {
  fireEvent.change(screen.getAllByLabelText(label)[index], { target: { value } });
};

const navigate = (label: string) => {
  fireEvent.click(screen.getAllByRole('button', { name: label })[0]);
};

const enterWorkspace = async (startupResult: Record<string, unknown> = { hasLocalUser: true }) => {
  mocks.startLocalFirstApp.mockResolvedValueOnce(startupResult);
  render(<LocalFirstApp />);
  await screen.findByRole('heading', { name: 'Unlock Smart Laundry' });
  fill('PIN', '1234');
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
  await screen.findByRole('heading', { name: 'Dashboard' });
};

const completeOrderForm = async (serviceType: 'piece' | 'weight' | 'combined') => {
  await enterWorkspace();
  navigate('Orders');
  fill('Customer name', 'Sam Customer');
  fill('Mobile number', '555-0202');
  fill('Item name', 'Coat');
  fill('Billing type', serviceType);
  fill('Weight (kg)', '2');
  fill('Rate', '5');
  fireEvent.click(screen.getByRole('button', { name: 'Save order' }));
  await waitFor(() => expect(repository.createOrder).toHaveBeenCalledTimes(1));
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

beforeEach(() => {
  for (const mock of Object.values(repository)) mock.mockReset();
  mocks.invoke.mockReset();
  mocks.startLocalFirstApp.mockReset();
  mocks.confirm.mockReset();
  mocks.open.mockReset();
  mocks.backupDatabase.mockReset();
  mocks.restoreDatabase.mockReset();

  mocks.startLocalFirstApp.mockResolvedValue({ hasLocalUser: true });
  mocks.confirm.mockResolvedValue(true);
  mocks.invoke.mockResolvedValue(undefined);
  mocks.open.mockResolvedValue(null);
  mocks.backupDatabase.mockResolvedValue('/local/backups/latest.db');
  mocks.restoreDatabase.mockResolvedValue('Restore will apply after restart.');
  repository.createAdmin.mockResolvedValue(admin);
  repository.authenticate.mockResolvedValue(admin);
  repository.getDashboardSummary.mockResolvedValue(dashboard);
  repository.listOrders.mockResolvedValue([]);
  repository.listCustomers.mockResolvedValue([customer]);
  repository.listServices.mockResolvedValue([pieceService, weightService]);
  repository.listExpenses.mockResolvedValue([expense]);
  repository.listInventory.mockResolvedValue([inventoryItem, lowStockItem]);
  repository.listMachines.mockResolvedValue([machine, unscheduledMachine]);
  repository.getSettings.mockResolvedValue(settings);
  repository.createOrder.mockResolvedValue({ id: 'order-created' });
  repository.getOrder.mockImplementation(async id => id === emptyReceiptOrder.id ? emptyReceiptOrder : baseOrder);
  repository.setOrderStatus.mockResolvedValue(undefined);
  repository.createCustomer.mockResolvedValue({ id: 'customer-created' });
  repository.createService.mockResolvedValue({ id: 'service-created' });
  repository.addPayment.mockResolvedValue({ id: 'payment-created' });
  repository.createExpense.mockResolvedValue({ id: 'expense-created' });
  repository.createInventoryItem.mockResolvedValue({ id: 'inventory-created' });
  repository.adjustInventory.mockResolvedValue(undefined);
  repository.createMachine.mockResolvedValue({ id: 'machine-created' });
  repository.getReport.mockResolvedValue(report);
  repository.saveSettings.mockResolvedValue(undefined);

  vi.spyOn(window, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('LocalFirstApp startup and account access', () => {
  it('shows setup warnings, rejects mismatched PINs, reports create errors, and creates the local account', async () => {
    mocks.startLocalFirstApp.mockResolvedValueOnce({
      hasLocalUser: false,
      initializationWarning: 'The staged restore could not be applied.',
    });
    repository.createAdmin.mockRejectedValueOnce('PIN must contain 4 to 8 digits.');
    render(<LocalFirstApp />);

    await screen.findByRole('heading', { name: 'Set up Smart Laundry' });
    expect(screen.getByRole('alert').textContent).toContain('The staged restore could not be applied.');
    fill('Administrator name', 'Riley Patel');
    fill('PIN', '1234');
    fill('Confirm PIN', '0000');
    fireEvent.click(screen.getByRole('button', { name: 'Create local account' }));
    expect(await screen.findByText('The PINs do not match.')).toBeTruthy();
    expect(repository.createAdmin).not.toHaveBeenCalled();

    fill('Confirm PIN', '1234');
    fireEvent.click(screen.getByRole('button', { name: 'Create local account' }));
    expect(await screen.findByText('PIN must contain 4 to 8 digits.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create local account' }));
    await screen.findByRole('heading', { name: 'Dashboard' });
    expect(repository.createAdmin).toHaveBeenCalledWith('Riley Patel', '1234');
  });

  it('shows the opening state, renders object errors, and exposes no workspace before login', async () => {
    let rejectStartup!: (reason: unknown) => void;
    mocks.startLocalFirstApp.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectStartup = reject;
    }));
    render(<LocalFirstApp />);
    expect(screen.getByText('Opening local database...')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Orders' })).toBeNull();

    await act(async () => rejectStartup({ message: 'Database could not open.' }));
    expect(await screen.findByText('Database could not open.')).toBeTruthy();
  });

  it('uses a safe fallback when startup rejects a value that cannot be serialized', async () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    mocks.startLocalFirstApp.mockRejectedValueOnce(circular);
    render(<LocalFirstApp />);
    expect(await screen.findByText('Something went wrong.')).toBeTruthy();
  });

  it('reports a wrong PIN and authentication failure, retains startup warnings, and locks back to login', async () => {
    mocks.startLocalFirstApp.mockResolvedValueOnce({
      hasLocalUser: true,
      initializationWarning: 'A staged restore was rejected.',
      backupError: new Error('The automatic backup failed.'),
    });
    repository.authenticate
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce({ message: 'Secure storage is unavailable.' })
      .mockResolvedValue(admin)
      .mockResolvedValueOnce(admin);
    render(<LocalFirstApp />);
    await screen.findByRole('heading', { name: 'Unlock Smart Laundry' });
    expect(screen.queryByRole('button', { name: 'Orders' })).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('A staged restore was rejected.');
    expect(screen.getByRole('alert').textContent).toContain('The automatic backup failed.');

    fill('PIN', '0000');
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText('Incorrect PIN.')).toBeTruthy();
    fill('PIN', '1234');
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText('Secure storage is unavailable.')).toBeTruthy();
    fill('PIN', '1234');
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await screen.findByRole('heading', { name: 'Dashboard' });
    expect(screen.getByRole('alert').textContent).toContain('The automatic backup failed.');

    fireEvent.click(screen.getByRole('button', { name: 'Lock app' }));
    await screen.findByRole('heading', { name: 'Unlock Smart Laundry' });
    fill('PIN', '1234');
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await screen.findByRole('heading', { name: 'Dashboard' });
  });

  it('sends only one authentication request while the unlock check is pending', async () => {
    const authentication = deferred<LocalUser | null>();
    repository.authenticate.mockReturnValue(authentication.promise);
    mocks.startLocalFirstApp.mockResolvedValueOnce({ hasLocalUser: true });
    render(<LocalFirstApp />);
    await screen.findByRole('heading', { name: 'Unlock Smart Laundry' });
    fill('PIN', '1234');
    const form = screen.getByRole('button', { name: 'Unlock' }).closest('form');
    if (!form) throw new Error('Unlock form was not found.');
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(repository.authenticate).toHaveBeenCalledTimes(1);
    await act(async () => authentication.resolve(admin));
    await screen.findByRole('heading', { name: 'Dashboard' });
  });
});

describe('LocalFirstApp dashboard and orders', () => {
  it('shows today totals and overdue work, then opens the order section', async () => {
    repository.getDashboardSummary.mockResolvedValue({ ...dashboard, overdue: 2 });
    await enterWorkspace();
    expect(screen.getByText('2 order(s) are overdue.')).toBeTruthy();
    expect(screen.getByText('₹90.00')).toBeTruthy();
    expect(screen.getByText('2.50 kg')).toBeTruthy();
    expect(screen.getByText('No orders yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View all' }));
    await screen.findByRole('heading', { name: 'Orders' });
    expect(screen.getByRole('button', { name: 'Hide new order' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide new order' }));
    expect(screen.queryByRole('heading', { name: 'New order' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'New order' }));
    expect(screen.getByRole('heading', { name: 'New order' })).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Customers' })[1]);
    await screen.findByRole('heading', { name: 'Customers' });
  });

  it('creates a mixed piece and weight order with a percentage discount and a partial payment', async () => {
    await enterWorkspace();
    navigate('Orders');
    fill('Rate', '-1');
    expect(screen.getByRole('alert').textContent).toContain('Rate must be non-negative.');
    expect(screen.getByRole('button', { name: 'Save order' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Existing customer'), { target: { value: customer.id } });
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: pieceService.id } });
    fill('Quantity', '2');
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    fireEvent.change(screen.getAllByLabelText('Service')[1], { target: { value: weightService.id } });
    fireEvent.change(screen.getAllByLabelText('Billing type')[1], { target: { value: 'weight' } });
    fireEvent.change(screen.getAllByLabelText('Billing type')[1], { target: { value: 'piece' } });
    fireEvent.change(screen.getAllByLabelText('Billing type')[1], { target: { value: 'weight' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add item' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[2]);
    fireEvent.change(screen.getAllByLabelText('Service')[1], { target: { value: '' } });
    fireEvent.change(screen.getAllByLabelText('Service')[1], { target: { value: weightService.id } });
    fillAt('Weight (kg)', 1, '2.5');
    fill('Discount amount', '7.333');
    fireEvent.change(screen.getByLabelText('Discount type'), { target: { value: 'percentage' } });
    fill('Payment received', '-1');
    expect(screen.getByRole('alert').textContent).toContain('Paid amount must be non-negative.');
    expect(screen.getByRole('button', { name: 'Save order' }).hasAttribute('disabled')).toBe(true);
    fill('Payment received', '30');
    fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'upi' } });
    fill('Instructions', 'Keep the blanket separate.');
    fill('Existing damage or stains', 'Coffee mark');
    fill('Internal notes', 'Call on arrival.');
    fill('Expected ready date', '2026-10-19');

    expect(screen.getByText(/Subtotal:/).textContent).toContain('₹74.00');
    expect(screen.getByText(/Subtotal:/).textContent).toContain('₹68.57');
    fireEvent.click(screen.getByRole('button', { name: 'Save order' }));
    await waitFor(() => expect(repository.createOrder).toHaveBeenCalledTimes(1));
    expect(repository.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      customer_id: customer.id,
      customer_name: customer.name,
      customer_phone: customer.phone,
      expected_ready_at: expect.any(String),
      order_type: 'combined',
      items: [
        expect.objectContaining({ item_name: pieceService.name, service_id: pieceService.id, service_type: 'piece', quantity: 2, rate: 12 }),
        expect.objectContaining({ item_name: weightService.name, service_id: weightService.id, service_type: 'weight', weight_kg: 2.5, rate: 20 }),
      ],
      discount_type: 'percentage',
      discount_value: 7.333,
      payment: { amount: 30, method: 'upi' },
      special_instructions: 'Keep the blanket separate.',
      damage_notes: 'Coffee mark',
      internal_notes: 'Call on arrival.',
    }), admin.id);
    expect((screen.getByLabelText('Customer name') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Payment received') as HTMLInputElement).value).toBe('0');
    expect(screen.getByText('Order saved locally.')).toBeTruthy();
  });

  it.each([
    ['piece', 'piece'],
    ['weight', 'weight'],
    ['combined', 'combined'],
  ] as const)('maps a %s billing selection to the saved order type', async (billingType, expectedOrderType) => {
    await completeOrderForm(billingType);
    expect(repository.createOrder).toHaveBeenCalledWith(expect.objectContaining({ order_type: expectedOrderType }), admin.id);
  });

  it('matches a manually entered phone to an existing customer', async () => {
    await enterWorkspace();
    navigate('Orders');
    fill('Customer name', customer.name);
    fill('Mobile number', customer.phone);
    fill('Item name', 'Scarf');
    fireEvent.click(screen.getByRole('button', { name: 'Save order' }));
    await waitFor(() => expect(repository.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ customer_id: customer.id, customer_phone: customer.phone }),
      admin.id,
    ));
  });

  it('prevents duplicate order creation while the first save is pending', async () => {
    const save = deferred<{ id: string }>();
    repository.createOrder.mockReturnValue(save.promise);
    await enterWorkspace();
    navigate('Orders');
    fill('Customer name', 'Alex Smith');
    fill('Mobile number', '555-0203');
    fill('Item name', 'Jacket');
    const form = screen.getByRole('button', { name: 'Save order' }).closest('form');
    if (!form) throw new Error('Order form was not found.');
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(repository.createOrder).toHaveBeenCalledTimes(1));
    await act(async () => save.resolve({ id: 'order-delayed' }));
    await screen.findByText('Order saved locally.');
    expect(repository.createOrder).toHaveBeenCalledTimes(1);
  });

  it('filters orders by customer search and status, and updates a selected order status', async () => {
    const secondOrder: LocalOrder = { ...baseOrder, id: 'order-2', order_number: 'RL-2026-00002', customer_name: 'Jamie Park', customer_phone: '555-0102', status: 'received' };
    repository.listOrders.mockResolvedValue([baseOrder, secondOrder]);
    await enterWorkspace();
    navigate('Orders');
    fill('Search orders by order number, customer, or phone', 'Morgan');
    expect(screen.getByText(baseOrder.order_number)).toBeTruthy();
    expect(screen.queryByText(secondOrder.order_number)).toBeNull();
    fireEvent.change(screen.getByLabelText('Filter orders by status'), { target: { value: 'ready' } });
    expect(screen.getByText(baseOrder.order_number)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Filter orders by status'), { target: { value: 'received' } });
    expect(screen.getByText('No orders found.')).toBeTruthy();

    fill('Search orders by order number, customer, or phone', '');
    fireEvent.change(screen.getByLabelText('Filter orders by status'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText(`Status for order ${baseOrder.order_number}`), { target: { value: 'ironing' } });
    await waitFor(() => expect(repository.setOrderStatus).toHaveBeenCalledWith(baseOrder.id, 'ironing', admin.id));
    expect(screen.getByText('Order status updated.')).toBeTruthy();
  });

  it('sends the native print command after preparing the receipt and clears it after print ends', async () => {
    repository.listOrders.mockResolvedValue([baseOrder, emptyReceiptOrder]);
    repository.getSettings.mockResolvedValue({ ...settings, shop_name: '', shop_address: '', shop_phone: '' });
    const raf = (callback: FrameRequestCallback) => {
      queueMicrotask(() => callback(0));
      return 1;
    };
    Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, value: raf });
    Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, value: vi.fn() });
    await enterWorkspace();
    expect(screen.getByText('Smart Laundry')).toBeTruthy();
    navigate('Orders');
    fireEvent.click(screen.getByRole('button', { name: `Print order ${baseOrder.order_number}` }));
    expect(await screen.findByText('Treat stains separately.')).toBeTruthy();
    expect(screen.queryByText('No payment recorded')).toBeNull();
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    expect(mocks.invoke).toHaveBeenLastCalledWith('plugin:webview|print');
    expect(screen.getByText('Treat stains separately.')).toBeTruthy();
    fireEvent(window, new Event('afterprint'));
    await waitFor(() => expect(screen.queryByText('Treat stains separately.')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: `Print order ${emptyReceiptOrder.order_number}` }));
    expect(await screen.findByText('No payment recorded')).toBeTruthy();
    expect(screen.getAllByText('₹0.00').length).toBeGreaterThanOrEqual(3);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
    expect(mocks.invoke).toHaveBeenLastCalledWith('plugin:webview|print');
    expect(screen.getByText('No payment recorded')).toBeTruthy();
    fireEvent(window, new Event('afterprint'));
    await waitFor(() => expect(screen.queryByText('No payment recorded')).toBeNull());
  });

  it('shows native print failures and releases the print action for a retry', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('The print dialog could not open.'));
    repository.listOrders.mockResolvedValue([baseOrder]);
    const raf = (callback: FrameRequestCallback) => {
      queueMicrotask(() => callback(0));
      return 1;
    };
    Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, value: raf });
    Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, value: vi.fn() });
    await enterWorkspace();
    navigate('Orders');

    fireEvent.click(screen.getByRole('button', { name: `Print order ${baseOrder.order_number}` }));
    expect(await screen.findByText('The print dialog could not open.')).toBeTruthy();
    expect(screen.queryByText('Treat stains separately.')).toBeNull();
    expect(screen.getByRole('button', { name: `Print order ${baseOrder.order_number}` }).hasAttribute('disabled')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: `Print order ${baseOrder.order_number}` }));
    expect(await screen.findByText('Treat stains separately.')).toBeTruthy();
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
    fireEvent(window, new Event('afterprint'));
    await waitFor(() => expect(screen.queryByText('Treat stains separately.')).toBeNull());
  });

  it('blocks duplicate print requests while the native command is pending', async () => {
    const printRequest = deferred<void>();
    mocks.invoke.mockReturnValueOnce(printRequest.promise);
    repository.listOrders.mockResolvedValue([baseOrder, emptyReceiptOrder]);
    const raf = (callback: FrameRequestCallback) => {
      queueMicrotask(() => callback(0));
      return 1;
    };
    Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, value: raf });
    Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, value: vi.fn() });
    await enterWorkspace();
    navigate('Orders');

    const firstPrintButton = screen.getByRole('button', { name: `Print order ${baseOrder.order_number}` });
    const secondPrintButton = screen.getByRole('button', { name: `Print order ${emptyReceiptOrder.order_number}` });
    act(() => {
      firstPrintButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      secondPrintButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    expect(repository.getOrder).toHaveBeenCalledTimes(1);
    expect(firstPrintButton.hasAttribute('disabled')).toBe(true);
    expect(secondPrintButton.hasAttribute('disabled')).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);

    await act(async () => printRequest.resolve());
    await waitFor(() => expect(firstPrintButton.hasAttribute('disabled')).toBe(false));
    fireEvent(window, new Event('afterprint'));
    await waitFor(() => expect(screen.queryByText('Treat stains separately.')).toBeNull());
  });

  it('cancels a receipt lookup when the user leaves the order section', async () => {
    const lookup = deferred<LocalOrder | null>();
    repository.getOrder.mockReturnValueOnce(lookup.promise);
    repository.listOrders.mockResolvedValue([baseOrder]);
    const raf = (callback: FrameRequestCallback) => {
      queueMicrotask(() => callback(0));
      return 1;
    };
    Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, value: raf });
    Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, value: vi.fn() });
    await enterWorkspace();
    navigate('Orders');

    fireEvent.click(screen.getByRole('button', { name: `Print order ${baseOrder.order_number}` }));
    await waitFor(() => expect(repository.getOrder).toHaveBeenCalledWith(baseOrder.id));
    navigate('Customers');
    await screen.findByRole('heading', { name: 'Customers' });
    await act(async () => lookup.resolve(baseOrder));
    expect(mocks.invoke).not.toHaveBeenCalled();

    navigate('Orders');
    fireEvent.click(screen.getByRole('button', { name: `Print order ${baseOrder.order_number}` }));
    expect(await screen.findByText('Treat stains separately.')).toBeTruthy();
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    fireEvent(window, new Event('afterprint'));
    await waitFor(() => expect(screen.queryByText('Treat stains separately.')).toBeNull());
  });

  it('cancels a scheduled print when navigation happens before native dispatch', async () => {
    repository.listOrders.mockResolvedValue([baseOrder]);
    let scheduledPrint: FrameRequestCallback | undefined;
    const cancelFrame = vi.fn();
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        scheduledPrint = callback;
        return 7;
      },
    });
    Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, value: cancelFrame });
    await enterWorkspace();
    navigate('Orders');

    fireEvent.click(screen.getByRole('button', { name: `Print order ${baseOrder.order_number}` }));
    expect(await screen.findByText('Treat stains separately.')).toBeTruthy();
    expect(scheduledPrint).toBeTypeOf('function');
    expect(mocks.invoke).not.toHaveBeenCalled();
    navigate('Customers');
    await screen.findByRole('heading', { name: 'Customers' });
    expect(cancelFrame).toHaveBeenCalledWith(7);
    expect(screen.queryByText('Treat stains separately.')).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();

    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        queueMicrotask(() => callback(0));
        return 8;
      },
    });
    navigate('Orders');
    fireEvent.click(screen.getByRole('button', { name: `Print order ${baseOrder.order_number}` }));
    expect(await screen.findByText('Treat stains separately.')).toBeTruthy();
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    fireEvent(window, new Event('afterprint'));
    await waitFor(() => expect(screen.queryByText('Treat stains separately.')).toBeNull());
  });

  it('grants the main desktop webview permission to invoke native printing', () => {
    const capability = JSON.parse(readFileSync(join(process.cwd(), 'src-tauri/capabilities/default.json'), 'utf8')) as {
      permissions: string[];
      windows: string[];
    };

    expect(capability.windows).toContain('main');
    expect(capability.permissions).toContain('core:webview:allow-print');
  });

  it('reports refresh and order lookup errors in the workspace', async () => {
    await enterWorkspace();
    repository.getDashboardSummary.mockRejectedValueOnce({ message: 'Local database is busy.' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Local database is busy.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Local database is busy.')).toBeNull();

    repository.listOrders.mockResolvedValue([baseOrder]);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(repository.listOrders).toHaveBeenCalledTimes(2));
    navigate('Orders');
    repository.getOrder.mockRejectedValueOnce(new Error('The receipt could not be loaded.'));
    fireEvent.click(screen.getByRole('button', { name: `Print order ${baseOrder.order_number}` }));
    expect(await screen.findByText('The receipt could not be loaded.')).toBeTruthy();
    repository.getOrder.mockResolvedValueOnce(null);
    fireEvent.click(screen.getByRole('button', { name: `Print order ${baseOrder.order_number}` }));
    expect(await screen.findByText('Order not found.')).toBeTruthy();
  });
});

describe('LocalFirstApp workspace forms', () => {
  it('submits customer details and formats a missing address', async () => {
    await enterWorkspace();
    navigate('Customers');
    fill('Name', 'Jordan Rivera');
    fill('Mobile', '555-0303');
    fill('Alternate mobile', '555-0404');
    fill('Customer type', 'hostel');
    fill('Address', '8 Market Street');
    fill('Notes', 'Pickup after 5 PM');
    fireEvent.click(screen.getByRole('button', { name: 'Save customer' }));
    await waitFor(() => expect(repository.createCustomer).toHaveBeenCalledWith({
      name: 'Jordan Rivera',
      phone: '555-0303',
      alternate_phone: '555-0404',
      customer_type: 'hostel',
      address: '8 Market Street',
      notes: 'Pickup after 5 PM',
    }, admin.id));
    expect(screen.getByText('Customer saved locally.')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('saves piece and weight service prices and displays the service state', async () => {
    repository.listServices.mockResolvedValue([
      pieceService,
      weightService,
      { ...weightService, id: 'service-inactive', name: 'Starching', active: false },
    ]);
    await enterWorkspace();
    navigate('Services');
    fill('Service name', 'Pressing');
    fill('Price per kg', '15');
    fireEvent.click(screen.getByRole('button', { name: 'Save service' }));
    await waitFor(() => expect(repository.createService).toHaveBeenCalledWith({
      name: 'Pressing',
      price_per_piece: undefined,
      price_per_kg: 15,
    }, admin.id));
    expect(screen.getByText('Services and pricing')).toBeTruthy();
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(screen.getByText('Inactive')).toBeTruthy();

    fill('Service name', 'Shirt folding');
    fill('Price per piece', '8');
    fireEvent.click(screen.getByRole('button', { name: 'Save service' }));
    await waitFor(() => expect(repository.createService).toHaveBeenCalledTimes(2));
    expect(repository.createService).toHaveBeenLastCalledWith({
      name: 'Shirt folding',
      price_per_piece: 8,
      price_per_kg: undefined,
    }, admin.id);
  });

  it('records a payment against an unpaid balance', async () => {
    repository.listOrders.mockResolvedValue([
      baseOrder,
      unpaidOrder,
      { ...baseOrder, id: 'paid', order_number: 'RL-2026-PAID', payment_status: 'paid' },
    ]);
    await enterWorkspace();
    navigate('Payments');
    expect(screen.getByText('₹0.00 paid')).toBeTruthy();
    fill('Amount', '25');
    const form = screen.getByRole('button', { name: 'Add payment' }).closest('form');
    if (!form) throw new Error('Payment form was not found.');
    fireEvent.submit(form);
    expect(repository.addPayment).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Order'), { target: { value: baseOrder.id } });
    fireEvent.change(screen.getByLabelText('Method'), { target: { value: 'upi' } });
    fill('Reference number', 'UPI-88');
    fireEvent.click(screen.getByRole('button', { name: 'Add payment' }));
    await waitFor(() => expect(repository.addPayment).toHaveBeenCalledWith(baseOrder.id, {
      amount: 25,
      method: 'upi',
      reference_number: 'UPI-88',
    }, admin.id));
    expect(screen.queryByText('RL-2026-PAID')).toBeNull();
  });

  it('records an expense and keeps the displayed expense history', async () => {
    repository.listExpenses.mockResolvedValue([expense, { ...expense, id: 'expense-no-description', description: null }]);
    await enterWorkspace();
    navigate('Expenses');
    fill('Amount', '48.25');
    fill('Description', 'Laundry detergent');
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'water' } });
    fill('Payment method', 'bank_transfer');
    fill('Notes', 'Monthly supply');
    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }));
    await waitFor(() => expect(repository.createExpense).toHaveBeenCalledWith(expect.objectContaining({
      category: 'water',
      description: 'Laundry detergent',
      amount: 48.25,
      payment_method: 'bank_transfer',
      notes: 'Monthly supply',
    }), admin.id));
    expect(screen.getByText('October bill')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('adds stock, reports a rejected negative adjustment, and records accepted stock changes', async () => {
    await enterWorkspace();
    navigate('Inventory');
    fill('Item name', 'Bleach');
    fill('Unit', 'litre');
    fill('Minimum quantity', '3');
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(repository.createInventoryItem).toHaveBeenCalledWith({
      name: 'Bleach',
      unit: 'litre',
      minimum_quantity: 3,
    }, admin.id));
    expect(screen.getByText('Low stock')).toBeTruthy();
    expect(screen.getByText('Healthy')).toBeTruthy();

    fill('Change quantity', '1');
    fireEvent.click(screen.getByRole('button', { name: 'Save adjustment' }));
    expect(repository.adjustInventory).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Item'), { target: { value: inventoryItem.id } });
    fill('Change quantity', '-10');
    fill('Reason', 'Attempted oversell');
    repository.adjustInventory.mockRejectedValueOnce(new Error('Stock cannot become negative.'));
    fireEvent.click(screen.getByRole('button', { name: 'Save adjustment' }));
    expect(await screen.findByText('Stock cannot become negative.')).toBeTruthy();
    expect((screen.getByLabelText('Change quantity') as HTMLInputElement).value).toBe('-10');

    fill('Change quantity', '4');
    fireEvent.click(screen.getByRole('button', { name: 'Save adjustment' }));
    await waitFor(() => expect(repository.adjustInventory).toHaveBeenCalledWith(inventoryItem.id, 4, 'stock_in', 'Attempted oversell', admin.id));
    fill('Change quantity', '-1');
    fill('Reason', 'Stock count correction');
    fireEvent.click(screen.getByRole('button', { name: 'Save adjustment' }));
    await waitFor(() => expect(repository.adjustInventory).toHaveBeenCalledWith(inventoryItem.id, -1, 'stock_out', 'Stock count correction', admin.id));
  });

  it('saves a machine and lists its maintenance date', async () => {
    await enterWorkspace();
    navigate('Machines');
    fill('Machine name', 'Dryer B');
    fill('Type', 'dryer');
    fill('Capacity', '8 kg');
    fill('Next maintenance', '2026-11-15');
    fill('Notes', 'Check belt');
    fireEvent.click(screen.getByRole('button', { name: 'Save machine' }));
    await waitFor(() => expect(repository.createMachine).toHaveBeenCalledWith({
      name: 'Dryer B',
      machine_type: 'dryer',
      capacity: '8 kg',
      purchase_date: null,
      last_maintenance_date: null,
      next_maintenance_date: '2026-11-15',
      notes: 'Check belt',
    }, admin.id));
    expect(screen.getByText('Washer A')).toBeTruthy();
    expect(screen.getByText('Not scheduled')).toBeTruthy();

    fill('Machine name', 'Iron A');
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'iron' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save machine' }));
    await waitFor(() => expect(repository.createMachine).toHaveBeenCalledTimes(2));
    expect(repository.createMachine).toHaveBeenLastCalledWith({
      name: 'Iron A',
      machine_type: 'iron',
      capacity: '',
      purchase_date: null,
      last_maintenance_date: null,
      next_maintenance_date: null,
      notes: '',
    }, admin.id);
  });

  it('shows report totals after success and the repository error after failure', async () => {
    repository.getReport.mockResolvedValueOnce(report).mockRejectedValueOnce('Report data is unavailable.');
    await enterWorkspace();
    navigate('Reports');
    fill('From', '2026-10-01');
    fill('To', '2026-10-06');
    fireEvent.click(screen.getByRole('button', { name: 'Generate report' }));
    await screen.findByText('Estimated profit');
    expect(repository.getReport).toHaveBeenCalledWith('2026-10-01', '2026-10-06');
    expect(screen.getByText('₹80.00')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Generate report' }));
    expect(await screen.findByText('Report data is unavailable.')).toBeTruthy();
  });
});

describe('LocalFirstApp settings and recovery', () => {
  it('saves editable shop settings without sending the immutable device id', async () => {
    await enterWorkspace();
    navigate('Settings');
    expect(screen.queryByLabelText(/device id/i)).toBeNull();
    fill('Shop name', 'Northside Laundry');
    fill('Phone', '555-0999');
    fill('Address', '78 North Street');
    fill('GST number', 'GST-7788');
    fill('Order prefix', 'NL');
    fill('Default completion days', '3');
    fill('Receipt footer', 'Come back soon.');
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(repository.saveSettings).toHaveBeenCalledWith({
      shop_name: 'Northside Laundry',
      shop_address: '78 North Street',
      shop_phone: '555-0999',
      gst_number: 'GST-7788',
      receipt_footer: 'Come back soon.',
      order_prefix: 'NL',
      default_completion_days: 3,
    }, admin.id));
    expect(screen.getByText('Settings saved locally.')).toBeTruthy();
  });

  it('reports backup success and backup failure to the user', async () => {
    await enterWorkspace();
    navigate('Settings');
    fireEvent.click(screen.getByRole('button', { name: 'Backup now' }));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Backup created at /local/backups/latest.db'));
    mocks.backupDatabase.mockRejectedValueOnce({ reason: 'disk full' });
    fireEvent.click(screen.getByRole('button', { name: 'Backup now' }));
    await waitFor(() => expect(window.alert).toHaveBeenLastCalledWith('{"reason":"disk full"}'));
  });

  it('uses native restore confirmation and handles cancel, dialog errors, and restore errors', async () => {
    await enterWorkspace();
    navigate('Settings');

    mocks.open.mockResolvedValueOnce(null);
    fireEvent.click(screen.getByRole('button', { name: 'Restore backup' }));
    await waitFor(() => expect(mocks.open).toHaveBeenCalledTimes(1));
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.restoreDatabase).not.toHaveBeenCalled();

    mocks.open.mockResolvedValueOnce(['/tmp/one.db', '/tmp/two.db']);
    fireEvent.click(screen.getByRole('button', { name: 'Restore backup' }));
    await waitFor(() => expect(mocks.open).toHaveBeenCalledTimes(2));
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.restoreDatabase).not.toHaveBeenCalled();

    mocks.open.mockResolvedValueOnce('/tmp/declined.db');
    mocks.confirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Restore backup' }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    expect(mocks.confirm).toHaveBeenCalledWith(
      'This backup will replace the current database the next time Smart Laundry opens. The app will first save a safety backup. Smart Laundry will block changes until it restarts.',
      { title: 'Restore backup', kind: 'warning', okLabel: 'Stage restore', cancelLabel: 'Cancel' },
    );
    expect(mocks.restoreDatabase).not.toHaveBeenCalled();
    expect(screen.queryByText(/A backup restore is staged/)).toBeNull();

    mocks.open.mockResolvedValueOnce('/tmp/confirmation-error.db');
    mocks.confirm.mockRejectedValueOnce(new Error('The confirmation dialog could not open.'));
    fireEvent.click(screen.getByRole('button', { name: 'Restore backup' }));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('The confirmation dialog could not open.'));
    expect(mocks.restoreDatabase).not.toHaveBeenCalled();
    expect(screen.queryByText(/A backup restore is staged/)).toBeNull();

    mocks.open.mockResolvedValueOnce('/tmp/rejected.db');
    mocks.restoreDatabase.mockRejectedValueOnce(new Error('The selected database is invalid.'));
    fireEvent.click(screen.getByRole('button', { name: 'Restore backup' }));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('The selected database is invalid.'));
    expect(screen.queryByText(/A backup restore is staged/)).toBeNull();
    expect(repository.saveSettings).not.toHaveBeenCalled();
  });

  it('stages a confirmed restore and blocks every visible write until the app restarts', async () => {
    await enterWorkspace();
    navigate('Settings');
    mocks.open.mockResolvedValueOnce('/tmp/verified-backup.db');
    mocks.confirm.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Restore backup' }));
    await waitFor(() => expect(mocks.restoreDatabase).toHaveBeenCalledWith('/tmp/verified-backup.db'));
    expect(mocks.confirm).toHaveBeenCalledWith(
      'This backup will replace the current database the next time Smart Laundry opens. The app will first save a safety backup. Smart Laundry will block changes until it restarts.',
      { title: 'Restore backup', kind: 'warning', okLabel: 'Stage restore', cancelLabel: 'Cancel' },
    );
    expect(await screen.findByText(/A backup restore is staged/)).toBeTruthy();
    expect(window.alert).toHaveBeenCalledWith('Restore will apply after restart.');

    fill('Shop name', 'Should not save');
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('A restore is staged. Close and reopen the app before writing.')).toBeTruthy();
    expect(repository.saveSettings).not.toHaveBeenCalled();

    repository.listOrders.mockResolvedValue([baseOrder]);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(repository.listOrders).toHaveBeenCalledTimes(2));

    navigate('Orders');
    fill('Customer name', 'Taylor Customer');
    fill('Mobile number', '555-0991');
    fill('Item name', 'Coat');
    fireEvent.click(screen.getByRole('button', { name: 'Save order' }));
    fireEvent.change(screen.getByLabelText(`Status for order ${baseOrder.order_number}`), { target: { value: 'ironing' } });

    navigate('Customers');
    fill('Name', 'Taylor Customer');
    fill('Mobile', '555-0991');
    fireEvent.click(screen.getByRole('button', { name: 'Save customer' }));

    navigate('Services');
    fill('Service name', 'Coat pressing');
    fireEvent.click(screen.getByRole('button', { name: 'Save service' }));

    navigate('Payments');
    fireEvent.change(screen.getByLabelText('Order'), { target: { value: baseOrder.id } });
    fill('Amount', '10');
    fireEvent.click(screen.getByRole('button', { name: 'Add payment' }));

    navigate('Expenses');
    fill('Amount', '10');
    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }));

    navigate('Inventory');
    fill('Item name', 'Bleach');
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    fireEvent.change(screen.getByLabelText('Item'), { target: { value: inventoryItem.id } });
    fill('Change quantity', '-1');
    fireEvent.click(screen.getByRole('button', { name: 'Save adjustment' }));

    navigate('Machines');
    fill('Machine name', 'Dryer C');
    fireEvent.click(screen.getByRole('button', { name: 'Save machine' }));

    expect(repository.createOrder).not.toHaveBeenCalled();
    expect(repository.setOrderStatus).not.toHaveBeenCalled();
    expect(repository.createCustomer).not.toHaveBeenCalled();
    expect(repository.createService).not.toHaveBeenCalled();
    expect(repository.addPayment).not.toHaveBeenCalled();
    expect(repository.createExpense).not.toHaveBeenCalled();
    expect(repository.createInventoryItem).not.toHaveBeenCalled();
    expect(repository.adjustInventory).not.toHaveBeenCalled();
    expect(repository.createMachine).not.toHaveBeenCalled();
  });
});
