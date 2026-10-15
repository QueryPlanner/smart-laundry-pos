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
export interface CounterBootstrap { setupRequired: boolean; authenticated: boolean; account: CounterAccount | null; accounts: CounterAccount[] }
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
  lines: CounterQuoteLine[]; subtotalMinor: number; totalMinor: number;
  pieceCount: number; promisedAt: string; catalogueVersion: string;
}
export interface CounterSaveInput extends CounterOrderInput {
  idempotencyKey: string;
  payment?: { amountMinor: number; method: CounterPaymentMethod; reference?: string };
}
export interface CounterPiece {
  id: string; shortId: string; garmentId: string; garment: string; service: string;
  position: number; total: number; matched: boolean;
}
export interface CounterPrintJob { id: string; kind: CounterJobKind; state: CounterJobState; printerId: string | null; osJobId: string | null; lastError: string | null }
export interface CounterSavedOrder {
  orderId: string; orderNumber: string; receivedAt: string; promisedAt: string;
  totalMinor: number; paidMinor: number; balanceMinor: number;
  pieces: CounterPiece[]; printJobs: CounterPrintJob[];
}
export interface PieceMatchResult {
  matchedCount: number; expectedCount: number; missingIds: string[];
  duplicateIds: string[]; wrongOrderIds: string[]; complete: boolean;
}
export interface NativePrinter { id: string; name: string; isDefault: boolean; isAvailable: boolean }
export interface PrinterProfiles { billPrinterId: string; tagPrinterId: string }
export interface CounterStaffInput { fullName: string; pin: string }

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
export const quoteCounterOrder = (input: CounterOrderInput): Promise<CounterQuote> => call('counter_quote_order', { input });
export const saveCounterOrder = (input: CounterSaveInput): Promise<CounterSavedOrder> => call('counter_save_order', { input });
export const getOrderPieces = (orderId: string): Promise<CounterPiece[]> => call('counter_get_order_pieces', { orderId });
export const matchOrderPieces = (orderId: string, pieceIds: string[]): Promise<PieceMatchResult> =>
  call('counter_match_order_pieces', { orderId, pieceIds });
export const enumeratePrinters = (): Promise<NativePrinter[]> => call('counter_enumerate_printers');
export const setPrinterProfiles = (profiles: PrinterProfiles): Promise<void> => call('counter_set_printer_profiles', { profiles });
export const getPrinterProfiles = (): Promise<PrinterProfiles | null> => call('counter_get_printer_profiles');
export const listPrintJobs = (orderId?: string): Promise<CounterPrintJob[]> => call('counter_list_print_jobs', { orderId });
export const dispatchPrintJobs = (orderId: string): Promise<CounterPrintJob[]> =>
  call('counter_dispatch_print_jobs', { orderId });
export const retryPrintJob = (jobId: string, confirmUncertain: boolean): Promise<CounterPrintJob> =>
  call('counter_retry_print_job', { jobId, confirmUncertain });
