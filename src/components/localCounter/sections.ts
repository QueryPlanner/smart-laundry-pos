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

export interface NavGroup {
  label: string;
  sections: ReadonlyArray<{ id: SectionId; label: string }>;
}

/** The navigation as the shell lays it out, in order. Roles that may not open a section never see it. */
export const NAV_GROUPS: ReadonlyArray<NavGroup> = [
  { label: 'Counter', sections: [{ id: 'order', label: 'New order' }, { id: 'orders', label: 'Orders / Pickup' }, { id: 'queue', label: 'Print queue' }] },
  { label: 'Insights', sections: [{ id: 'dashboard', label: 'Dashboard' }, { id: 'sales', label: 'Sales' }] },
  { label: 'Shop', sections: [{ id: 'customers', label: 'Customers' }, { id: 'expenses', label: 'Expenses' }, { id: 'inventory', label: 'Inventory' }, { id: 'machines', label: 'Machines' }] },
  { label: 'Admin', sections: [{ id: 'admin', label: 'Admin' }, { id: 'settings', label: 'Shop settings' }] },
];

/** The groups (and the sections inside them) the given role may open; empty groups are dropped. */
export const visibleNavGroups = (role: CounterAccount['role']): NavGroup[] =>
  NAV_GROUPS
    .map(group => ({ ...group, sections: group.sections.filter(section => canOpen(section.id, role)) }))
    .filter(group => group.sections.length > 0);
