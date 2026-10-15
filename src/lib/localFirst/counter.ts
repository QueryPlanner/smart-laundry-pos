import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from './runtime';

const call = <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  if (!isTauriRuntime()) throw new Error('The local counter is available only in the Tauri runtime.');
  return invoke<T>(command, args);
};

export type CounterRole = 'admin' | 'staff';
export type CounterServiceKey = 'wash' | 'iron' | 'wash_iron' | 'dry_clean';
export type CounterJobKind = 'bill' | 'tags';
export type CounterJobState = 'pending' | 'submitting' | 'submitted' | 'failed' | 'uncertain';
export type CounterPaymentMethod = 'cash' | 'upi' | 'card' | 'bank_transfer' | 'other';

export interface CounterAccount { id: string; fullName: string; role: CounterRole; active: boolean }
export interface CounterBootstrap { setupRequired: boolean; authenticated: boolean; account: CounterAccount | null; accounts: CounterAccount[]; warning: string | null }
export interface CounterGarment {
  id: string; key: string; nameEn: string; nameMr: string; category: string;
  imageKey: string; billingUnit: 'piece' | 'pair'; active: boolean;
}
export interface CounterService { id: string; key: CounterServiceKey; name: string; active: boolean }
export interface CounterRate {
  garmentId: string; serviceId: string; priceMinor: number | null;
  configured: boolean; available: boolean; version: number;
}
export interface CounterCatalogue { garments: CounterGarment[]; services: CounterService[]; rates: CounterRate[] }
export interface CounterCustomer { name: string; phone: string; customerId?: string }
export interface CounterOrderLineInput { garmentId: string; serviceId: string; quantity: number }
export interface CounterOrderInput { customer: CounterCustomer; items: CounterOrderLineInput[] }
export interface CounterQuoteLine {
  garmentId: string; serviceId: string; garment: string; service: string;
  quantity: number; unitPriceMinor: number; lineTotalMinor: number; rateVersion: number;
}
export interface CounterQuote {
  lines: CounterQuoteLine[]; subtotalMinor: number; discountPercentBp: number; discountMinor: number; totalMinor: number;
  pieceCount: number; promisedAt: string; catalogueVersion: string;
}
export interface CounterSaveInput extends CounterOrderInput {
  reviewedQuote: CounterQuote;
  idempotencyKey: string;
  payment?: { amountMinor: number; method: CounterPaymentMethod; reference?: string };
}
export interface CounterPiece {
  id: string; shortId: string; garmentId: string; garment: string; service: string;
  position: number; total: number; matched: boolean; packingMatched: boolean; collectionMatched: boolean;
}
export interface CounterPrintJob { id: string; kind: CounterJobKind; state: CounterJobState; printerId: string | null; osJobId: string | null; lastError: string | null; orderId: string; orderNumber: string }
export interface CounterSavedOrder {
  orderId: string; orderNumber: string; receivedAt: string; promisedAt: string; status: string;
  totalMinor: number; paidMinor: number; balanceMinor: number;
  pieces: CounterPiece[]; printJobs: CounterPrintJob[];
}
export interface CounterOrderSummary { id: string; orderNumber: string; customerName: string; customerPhone: string; status: string; receivedAt: string; promisedAt: string | null; totalMinor: number; paidMinor: number; balanceMinor: number; pieceCount: number }
export interface CounterRecordPaymentInput { amountMinor: number; method: CounterPaymentMethod; reference?: string; idempotencyKey: string }
export type CounterMatchStage = 'packing' | 'collection';
export type CounterProcessingStatus = 'washing' | 'drying' | 'ironing' | 'quality_check' | 'packing' | 'ready';
export interface PieceMatchResult {
  matchedCount: number; expectedCount: number; missingIds: string[];
  duplicateIds: string[]; wrongOrderIds: string[]; complete: boolean;
}
export interface NativePrinter { id: string; name: string; isDefault: boolean; isAvailable: boolean }
export interface PrinterProfiles { billPrinterId: string; tagPrinterId: string }
export interface CounterBackupSettings { folder: string; mirrorDir: string | null; mirrorStatus: string | null; lastBackupAt: string | null }
export interface CounterStaffInput { fullName: string; pin: string }
export interface CounterDiscountRule {
  id: string; scope: 'all' | 'customer'; customerId: string | null; customerName: string | null;
  customerPhone: string | null; percentBp: number; label: string; active: boolean;
}

export const getCounterBootstrap = (): Promise<CounterBootstrap> => call('counter_bootstrap');
export const setupCounterAdmin = (input: CounterStaffInput): Promise<CounterAccount> => call('counter_setup_admin', { input });
export const loginCounter = (userId: string, pin: string): Promise<CounterAccount> =>
  call('counter_login', { userId, pin });
export const lockCounter = (): Promise<void> => call('counter_lock');
export const logoutCounter = lockCounter;
export const listCounterStaff = (): Promise<CounterAccount[]> => call('counter_list_staff');
export const createCounterStaff = (input: CounterStaffInput): Promise<CounterAccount> => call('counter_create_staff', { input });
export const setCounterStaffActive = (userId: string, active: boolean): Promise<void> =>
  call('counter_set_staff_active', { userId, active });
export const resetCounterStaffPin = (userId: string, pin: string): Promise<void> =>
  call('counter_reset_staff_pin', { userId, pin });
export const getCounterCatalogue = (): Promise<CounterCatalogue> => call('counter_get_catalogue');
export const searchCounterCustomers = (phone: string): Promise<Array<{id: string; name: string; phone: string}>> => call('counter_search_customers', { phone });
export const setCounterRate = (garmentId: string, serviceId: string, priceMinor: number | null, available: boolean): Promise<void> =>
  call('counter_set_rate', { garmentId, serviceId, priceMinor, available });
export const listCounterDiscounts = (): Promise<CounterDiscountRule[]> => call('counter_list_discounts');
/** `customerId` null sets the shop-wide rule; otherwise that customer's own rule. Admin only. */
export const setCounterDiscount = (customerId: string | null, percentBp: number, active: boolean, label: string): Promise<void> =>
  call('counter_set_discount', { customerId, percentBp, active, label });
export const getCounterBackupSettings = (): Promise<CounterBackupSettings> => call('counter_backup_settings');
/** A blank or null directory clears the second backup folder. Admin only. */
export const setCounterBackupMirror = (directory: string | null): Promise<void> => call('counter_set_backup_mirror', { directory });
export const runCounterBackup = (): Promise<CounterBackupSettings> => call('counter_backup_now');
export const quoteCounterOrder = (input: CounterOrderInput): Promise<CounterQuote> => call('counter_quote_order', { input });
export const saveCounterOrder = (input: CounterSaveInput): Promise<CounterSavedOrder> => call('counter_save_order', { input });
export const getOrderPieces = (orderId: string): Promise<CounterPiece[]> => call('counter_get_order_pieces', { orderId });
export const matchOrderPieces = (orderId: string, stage: CounterMatchStage, pieceIds: string[]): Promise<PieceMatchResult> =>
  call('counter_match_order_pieces', { orderId, stage, pieceIds });
export const searchCounterOrders = (query: string, offset = 0, limit = 50): Promise<CounterOrderSummary[]> => call('counter_search_orders', { query, offset, limit });
export const getCounterOrder = (orderId: string): Promise<CounterSavedOrder | null> => call('counter_get_order', { orderId });
export const recordCounterPayment = (orderId: string, input: CounterRecordPaymentInput): Promise<CounterSavedOrder> => call('counter_record_payment', { orderId, input });
export const updateCounterOrderStatus = (orderId: string, status: CounterProcessingStatus): Promise<CounterSavedOrder> => call('counter_update_order_status', { orderId, status });
export const collectCounterOrder = (orderId: string, pieceIds: string[], requestId: string): Promise<CounterSavedOrder> => call('counter_collect_order', { orderId, pieceIds, requestId });
/** Admin only. Voids every payment on the order and marks it cancelled; `reason` must be 3 to 200 characters. */
export const cancelCounterOrder = (orderId: string, reason: string): Promise<CounterSavedOrder> => call('counter_cancel_order', { orderId, reason });
export const enumeratePrinters = (): Promise<NativePrinter[]> => call('counter_enumerate_printers');
export const setPrinterProfiles = (profiles: PrinterProfiles): Promise<void> => call('counter_set_printer_profiles', { profiles });
export const getPrinterProfiles = (): Promise<PrinterProfiles | null> => call('counter_get_printer_profiles');
export const listPrintJobs = (orderId?: string): Promise<CounterPrintJob[]> => call('counter_list_print_jobs', { orderId });
export const dispatchPrintJobs = (orderId: string): Promise<CounterPrintJob[]> =>
  call('counter_dispatch_print_jobs', { orderId });
export const dispatchPrintJob = (jobId: string): Promise<CounterPrintJob> => call('counter_dispatch_print_job', { jobId });
export const retryPrintJob = (jobId: string, confirmUncertain: boolean): Promise<CounterPrintJob> =>
  call('counter_retry_print_job', { jobId, confirmUncertain });

export const reprintCounterOutput = (orderId: string, kind: CounterJobKind, pieceIds: string[], requestId: string): Promise<CounterPrintJob> =>
  call('counter_reprint_output', { orderId, kind, pieceIds, requestId });
