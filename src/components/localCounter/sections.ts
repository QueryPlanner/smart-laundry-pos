import type { CounterAccount } from '@/lib/localFirst/counter';

/** Props every workspace section receives from the shell. */
export interface SectionProps {
  account: CounterAccount;
  /** Surface a failure in the shell's error banner. */
  onError: (error: unknown) => void;
  /** Surface a success message in the shell's notice banner. */
  onNotice: (message: string) => void;
  /** Jump to the Orders / Pickup detail for an order. */
  onOpenOrder: (orderId: string) => void;
}

export type SectionId =
  | 'order' | 'orders' | 'queue' | 'dashboard' | 'sales' | 'customers'
  | 'expenses' | 'inventory' | 'machines' | 'admin' | 'settings';

/**
 * Which roles may open each section. The native commands enforce the same rules; this table
 * only decides what the navigation shows. Prices, discounts, staff, printers, backups, shop
 * settings and every delete are admin-only; everything else is open to staff and admin.
 */
export const SECTION_ROLES: Record<SectionId, ReadonlyArray<CounterAccount['role']>> = {
  order: ['staff', 'admin'],
  orders: ['staff', 'admin'],
  queue: ['staff', 'admin'],
  dashboard: ['staff', 'admin'],
  sales: ['staff', 'admin'],
  customers: ['staff', 'admin'],
  expenses: ['staff', 'admin'],
  inventory: ['staff', 'admin'],
  machines: ['staff', 'admin'],
  admin: ['admin'],
  settings: ['admin'],
};

export const canOpen = (section: SectionId, role: CounterAccount['role']): boolean =>
  SECTION_ROLES[section].includes(role);
