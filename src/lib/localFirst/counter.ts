import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from './runtime';

const call = <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  if (!isTauriRuntime()) throw new Error('The local counter is available only in the Tauri runtime.');
  return invoke<T>(command, args);
};

export type CounterRole = 'admin' | 'staff';
/**
 * `wash_iron` is the "Starch" service since schema v6, and `wash` is shown as "Wash + Press" since v8 (their
 * keys could not be changed). `wash_only` is "Wash only".
 */
/** The built-in services, plus `custom_<id>` for those the administrator adds. */
export type CounterServiceKey = 'wash' | 'iron' | 'wash_iron' | 'dry_clean' | 'wash_only' | `custom_${string}`;
export type CounterJobKind = 'bill' | 'tags';
export type CounterJobState = 'pending' | 'submitting' | 'submitted' | 'failed' | 'uncertain';
export type CounterPaymentMethod = 'cash' | 'upi' | 'card' | 'bank_transfer' | 'other';
export type CounterPaymentStatus = 'unpaid' | 'partially_paid' | 'paid' | 'overpaid';
export type CounterPaymentKind = 'advance' | 'settlement';

export interface CounterAccount { id: string; fullName: string; role: CounterRole; active: boolean }
export interface CounterBootstrap { setupRequired: boolean; authenticated: boolean; account: CounterAccount | null; accounts: CounterAccount[]; warning: string | null; restorePending: boolean }
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
export interface CounterOrderLineInput {
  garmentId: string; serviceId: string; quantity: number;
  /** A price for this bill only, in paise per piece. Omit to charge the rate card. */
  unitPriceOverrideMinor?: number;
}
export interface CounterOrderInput {
  customer: CounterCustomer; items: CounterOrderLineInput[];
  /** An extra discount for this bill only, in paise, on top of any automatic one. Any signed-in user may give one. */
  manualDiscountMinor?: number;
}
export interface CounterQuoteLine {
  garmentId: string; serviceId: string; garment: string; service: string;
  quantity: number; unitPriceMinor: number; listPriceMinor: number; lineTotalMinor: number; rateVersion: number; serviceKey: CounterServiceKey;
}
export interface CounterQuote {
  lines: CounterQuoteLine[]; subtotalMinor: number;
  /** The automatic discount's percentage (basis points); 0 when there is none. */
  discountPercentBp: number;
  /** Everything taken off: the automatic discount plus `manualDiscountMinor`. */
  discountMinor: number;
  /** The part of `discountMinor` given by hand for this bill. */
  manualDiscountMinor: number;
  totalMinor: number;
  pieceCount: number; promisedAt: string; catalogueVersion: string;
}
export interface CounterSaveInput extends CounterOrderInput {
  reviewedQuote: CounterQuote;
  idempotencyKey: string;
  /** An advance: `0 < amountMinor <= totalMinor`. Omit when nothing is received at save time. */
  payment?: { amountMinor: number; method: CounterPaymentMethod; reference?: string };
}
export interface CounterPiece {
  id: string; shortId: string; garmentId: string; garment: string; service: string;
  position: number; total: number; matched: boolean; packingMatched: boolean; collectionMatched: boolean;
  tagged: boolean;
}
export interface CounterPayment {
  id: string; at: string; method: CounterPaymentMethod; amountMinor: number;
  reference: string | null; kind: CounterPaymentKind; voided: boolean;
}
export interface CounterPrintJob { id: string; kind: CounterJobKind; state: CounterJobState; printerId: string | null; osJobId: string | null; lastError: string | null; orderId: string; orderNumber: string }
export interface CounterSavedOrder {
  orderId: string; orderNumber: string; customerName: string; customerPhone: string;
  receivedAt: string; promisedAt: string; status: string;
  totalMinor: number; paidMinor: number; balanceMinor: number;
  paymentStatus: CounterPaymentStatus; collectedAt: string | null;
  /** > 0 only on a cancelled order that had payments. */
  refundDueMinor: number;
  /** Oldest first; includes voided payments. */
  payments: CounterPayment[];
  /** The bill lines, each with how many of its pieces the customer has taken. */
  lines: CounterOrderLine[];
  pieces: CounterPiece[]; printJobs: CounterPrintJob[];
}
export interface CounterOrderLine {
  itemId: string; garment: string; service: string; quantity: number;
  unitPriceMinor: number; lineTotalMinor: number; pieceCount: number; handedOverCount: number;
}
export interface CounterOrderSummary {
  id: string; orderNumber: string; customerName: string; customerPhone: string; status: string;
  receivedAt: string; promisedAt: string | null; totalMinor: number; paidMinor: number; balanceMinor: number;
  pieceCount: number; paymentStatus: CounterPaymentStatus; overdue: boolean; untaggedCount: number;
  /** Why this order matched the search text, or null when it matched the filter alone. */
  matchReason: string | null;
  /** The lines in short: "3 Shirt · Iron, 1 Saree · Dry Clean". */
  itemsText: string;
  /** Pieces already with the customer; some but not all means part collected. */
  handedOverCount: number;
}
export interface CounterRecordPaymentInput { amountMinor: number; method: CounterPaymentMethod; reference?: string; idempotencyKey: string }
/** The ready-made lists of the Orders screen, each with a count. */
export type CounterOrderSegment = 'all' | 'open' | 'collected' | 'ready' | 'balance_due' | 'overdue' | 'in_process' | 'today';
/** What the native search filters by: a list above, or every order received on one shop day (`day:2026-10-17`). */
export type CounterOrderFilter = CounterOrderSegment | `day:${string}`;
export interface CounterQueueCounts {
  ready: number; balanceDue: number; overdue: number; inProcess: number; today: number; all: number;
  balanceDueMinor: number; open: number; collected: number;
}
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
/** Admin only. Adds a garment with no rates; it can be sold only for the services priced on the rate card. */
/** Adds a garment, shown with one of the bundled pictures (`picture` is its key) or its first letter. */
export const addCounterGarment = (name: string, picture?: string): Promise<void> =>
  call('counter_add_garment', { name, picture: picture ?? null });
/** Adds a service (a section of the counter), or brings back a removed one with the same name. */
export const addCounterService = (name: string): Promise<void> => call('counter_add_service', { name });
/** Removes a service from the counter (past orders keep it) or brings it back. */
export const setCounterServiceActive = (serviceId: string, active: boolean): Promise<void> =>
  call('counter_set_service_active', { serviceId, active });
/** Admin only. Hides the order from lists, sales and the dashboard. Nothing is deleted. */
export const trashCounterOrder = (orderId: string): Promise<void> => call('counter_trash_order', { orderId });
/** A bill staff marked for the trash, waiting for an administrator. */
export interface CounterTrashRequest {
  orderId: string; orderNumber: string; customerName: string; totalMinor: number;
  reason: string; requestedAt: string; requestedBy: string;
}
/** Any signed-in user. Marks a bill (for example one added by mistake) for the trash; it still counts in sales until an administrator approves. */
export const requestCounterOrderTrash = (orderId: string, reason: string): Promise<void> => call('counter_request_order_trash', { orderId, reason });
/** Admin only. Bills staff marked for the trash, oldest first. */
export const listCounterTrashRequests = (): Promise<CounterTrashRequest[]> => call('counter_list_trash_requests');
/** An order in the trash, for the Trash page. */
export interface CounterTrashedOrder {
  orderId: string; orderNumber: string; customerName: string; customerPhone: string; status: string;
  totalMinor: number; receivedAt: string; trashedAt: string; trashedBy: string;
  /** Why staff asked for it to be trashed; empty when nobody did. */
  reason: string;
}
/** Admin only. Orders in the trash, newest first. */
export const listCounterTrashedOrders = (): Promise<CounterTrashedOrder[]> => call('counter_list_trashed_orders');
/** Admin only. Takes an order out of the trash: lists, sales and customer totals count it again. */
export const restoreCounterOrder = (orderId: string): Promise<void> => call('counter_restore_order', { orderId });
/** What "Clear all orders" removed, and the backup written just before that still holds it. */
export interface CounterClearedOrders { orders: number; customers: number; backupPath: string }
/** The word an administrator types to confirm "Clear all orders" (the native side checks it too). */
export const CLEAR_ORDERS_CONFIRMATION = 'CLEAR';
/** Removes every order and customer after a verified backup. Administrator only. */
export const clearCounterOrders = (confirmation: string): Promise<CounterClearedOrders> =>
  call('counter_clear_all_orders', { confirmation });
/** Admin only. Keeps the bill and clears the request. */
export const dismissCounterTrashRequest = (orderId: string): Promise<void> => call('counter_dismiss_trash_request', { orderId });
export const listCounterDiscounts = (): Promise<CounterDiscountRule[]> => call('counter_list_discounts');
/** `customerId` null sets the shop-wide rule; otherwise that customer's own rule. Admin only. */
export const setCounterDiscount = (customerId: string | null, percentBp: number, active: boolean, label: string): Promise<void> =>
  call('counter_set_discount', { customerId, percentBp, active, label });
export const getCounterBackupSettings = (): Promise<CounterBackupSettings> => call('counter_backup_settings');
/** A blank or null directory clears the second backup folder. Admin only. */
export const setCounterBackupMirror = (directory: string | null): Promise<void> => call('counter_set_backup_mirror', { directory });
export const runCounterBackup = (): Promise<CounterBackupSettings> => call('counter_backup_now');
/**
 * Admin only. Stages the chosen backup file to replace the database the next time the app starts;
 * the native side saves a safety copy first and blocks every write until the restart.
 */
export const restoreCounterBackup = (sourcePath: string): Promise<string> => call('counter_restore_backup', { sourcePath });
export const quoteCounterOrder = (input: CounterOrderInput): Promise<CounterQuote> => call('counter_quote_order', { input });
export const saveCounterOrder = (input: CounterSaveInput): Promise<CounterSavedOrder> => call('counter_save_order', { input });
/** One line of text on a previewed bill page. Positions are points from the page's top left. */
export interface BillPreviewLine { text: string; sizePt: number; bold: boolean; xPt: number; yPt: number }
export interface BillPreviewRule { x1Pt: number; x2Pt: number; yPt: number }
export interface BillPreviewPage { rules: BillPreviewRule[]; lines: BillPreviewLine[] }
/** A bill laid out for the screen with the same layout the printer uses (text widths are approximate). */
export interface BillPreviewData { widthPt: number; heightPt: number; pages: BillPreviewPage[] }
/** The bill of an order still being taken, with the advance typed so far. Stores nothing. */
export const previewCounterDraftBill = (input: CounterOrderInput): Promise<BillPreviewData> =>
  call('counter_preview_draft_bill', { input });
/** The bill of a saved order as a reprint would print it now. */
export const previewCounterOrderBill = (orderId: string): Promise<BillPreviewData> => call('counter_preview_order_bill', { orderId });
export const getOrderPieces = (orderId: string): Promise<CounterPiece[]> => call('counter_get_order_pieces', { orderId });
export const matchOrderPieces = (orderId: string, stage: CounterMatchStage, pieceIds: string[]): Promise<PieceMatchResult> =>
  call('counter_match_order_pieces', { orderId, stage, pieceIds });
export const searchCounterOrders = (query: string, offset = 0, limit = 50, filter: CounterOrderFilter = 'all'): Promise<CounterOrderSummary[]> =>
  call('counter_search_orders', { query, offset, limit, filter });
/** Counts for each order list segment, with no search text. */
export const getCounterOrderQueueCounts = (): Promise<CounterQueueCounts> => call('counter_order_queue_counts');
export const getCounterOrder = (orderId: string): Promise<CounterSavedOrder | null> => call('counter_get_order', { orderId });
export const recordCounterPayment = (orderId: string, input: CounterRecordPaymentInput): Promise<CounterSavedOrder> => call('counter_record_payment', { orderId, input });
export const updateCounterOrderStatus = (orderId: string, status: CounterProcessingStatus): Promise<CounterSavedOrder> => call('counter_update_order_status', { orderId, status });
/**
 * When `payment` is present it is recorded as a settlement in the same transaction as the collection,
 * so either both happen or neither.
 */
/** Hands the pieces of these bill lines to the customer. The last ones need the bill paid. */
export const handOverCounterItems = (orderId: string, itemIds: string[]): Promise<CounterSavedOrder> =>
  call('counter_hand_over_items', { orderId, itemIds });
export const collectCounterOrder = (orderId: string, pieceIds: string[], requestId: string, payment?: CounterRecordPaymentInput): Promise<CounterSavedOrder> =>
  call('counter_collect_order', { orderId, pieceIds, requestId, payment });
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
