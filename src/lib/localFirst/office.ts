import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from './runtime';
import type { CounterOrderSummary, CounterPaymentMethod } from './counter';

const call = <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  if (!isTauriRuntime()) throw new Error('The local counter is available only in the Tauri runtime.');
  return invoke<T>(command, args);
};

/**
 * Back-office records: customers, expenses, inventory, machines. Staff and administrators may read,
 * create and edit; only an administrator may delete (every `delete*` needs a 3 to 200 character
 * reason, which is kept in the audit trail). The native side enforces all of this.
 */

export type CustomerType = 'regular' | 'student' | 'hostel' | 'other';
export type ExpensePaymentMethod = CounterPaymentMethod;
export type StockTransactionType = 'stock_in' | 'stock_out' | 'adjustment';

export interface OfficeCustomerFields {
  name: string; phone: string; alternatePhone?: string; address?: string;
  customerType?: CustomerType; notes?: string;
}
export interface OfficeCustomer {
  id: string; customerCode: string; name: string; phone: string; alternatePhone: string | null;
  address: string | null; customerType: CustomerType; notes: string | null; createdAt: string;
  /** Every order, cancelled ones included. */
  orderCount: number;
  /** Paise billed; cancelled orders are not billed. */
  billedMinor: number;
  lastOrderAt: string | null;
  /** The owner has set an automatic discount for this customer. */
  hasDiscountRule: boolean;
}
export interface OfficeCustomerDetail { customer: OfficeCustomer; recentOrders: CounterOrderSummary[] }

export interface OfficeExpenseFilter {
  /** First day included, `YYYY-MM-DD` in shop time. */
  from?: string;
  /** Last day included, `YYYY-MM-DD` in shop time. */
  to?: string;
  category?: string;
  limit?: number;
}
export interface OfficeExpenseInput {
  expenseDate: string; category: string; description?: string; amountMinor: number;
  paymentMethod: ExpensePaymentMethod; notes?: string;
}
export interface OfficeExpense {
  id: string; expenseDate: string; category: string; description: string | null; amountMinor: number;
  paymentMethod: ExpensePaymentMethod; notes: string | null; createdBy: string; createdByName: string | null; createdAt: string;
}
export interface OfficeExpenseList { items: OfficeExpense[]; totalMinor: number; matching: number; categories: string[] }

export interface OfficeInventoryItemInput {
  name: string; unit: string; minimumQuantity: number; openingQuantity?: number;
  purchaseCostMinor?: number; notes?: string;
}
export interface OfficeStockAdjustment {
  itemId: string; transactionType: StockTransactionType;
  /** Positive for stock_in, negative for stock_out, either sign for an adjustment. */
  changeQuantity: number; reason: string;
}
export interface OfficeInventoryItem {
  id: string; name: string; unit: string; currentQuantity: number; minimumQuantity: number;
  purchaseCostMinor: number | null; notes: string | null; updatedAt: string; lowStock: boolean;
}

export interface OfficeMachineInput {
  name: string; machineType: string; capacity?: string; purchaseDate?: string;
  lastMaintenanceDate?: string; nextMaintenanceDate?: string; notes?: string;
}
export interface OfficeMachine {
  id: string; name: string; machineType: string; capacity: string | null; purchaseDate: string | null;
  lastMaintenanceDate: string | null; nextMaintenanceDate: string | null; notes: string | null;
  /** The next maintenance date is today (shop time) or earlier. */
  maintenanceDue: boolean;
}

export const listOfficeCustomers = (search = '', offset = 0, limit = 50): Promise<OfficeCustomer[]> =>
  call('counter_list_customers', { search, offset, limit });
export const getOfficeCustomer = (customerId: string): Promise<OfficeCustomerDetail | null> =>
  call('counter_get_customer', { customerId });
export const createOfficeCustomer = (input: OfficeCustomerFields): Promise<OfficeCustomer> =>
  call('counter_create_customer', { input });
export const updateOfficeCustomer = (customerId: string, input: OfficeCustomerFields): Promise<OfficeCustomer> =>
  call('counter_update_customer', { customerId, input });
/** Administrator only; refused when the customer has any order. */
export const deleteOfficeCustomer = (customerId: string, reason: string): Promise<void> =>
  call('counter_delete_customer', { customerId, reason });

export const listOfficeExpenses = (filter: OfficeExpenseFilter = {}): Promise<OfficeExpenseList> =>
  call('counter_list_expenses', { filter });
export const createOfficeExpense = (input: OfficeExpenseInput): Promise<OfficeExpense> =>
  call('counter_create_expense', { input });
/** Administrator only. */
export const deleteOfficeExpense = (expenseId: string, reason: string): Promise<void> =>
  call('counter_delete_expense', { expenseId, reason });

export const listOfficeInventory = (): Promise<OfficeInventoryItem[]> => call('counter_list_inventory');
export const createOfficeInventoryItem = (input: OfficeInventoryItemInput): Promise<OfficeInventoryItem> =>
  call('counter_create_inventory_item', { input });
export const adjustOfficeInventory = (input: OfficeStockAdjustment): Promise<OfficeInventoryItem> =>
  call('counter_adjust_inventory', { input });
/** Administrator only. */
export const deleteOfficeInventoryItem = (itemId: string, reason: string): Promise<void> =>
  call('counter_delete_inventory_item', { itemId, reason });

export const listOfficeMachines = (): Promise<OfficeMachine[]> => call('counter_list_machines');
export const createOfficeMachine = (input: OfficeMachineInput): Promise<OfficeMachine> =>
  call('counter_create_machine', { input });
/** Replaces the machine's details, including its maintenance record. */
export const updateOfficeMachine = (machineId: string, input: OfficeMachineInput): Promise<OfficeMachine> =>
  call('counter_update_machine', { machineId, input });
/** Administrator only. */
export const deleteOfficeMachine = (machineId: string, reason: string): Promise<void> =>
  call('counter_delete_machine', { machineId, reason });
