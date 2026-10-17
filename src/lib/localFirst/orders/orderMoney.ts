import type { CounterProcessingStatus } from '../counter';

/**
 * Pure rules behind the Orders / Pickup screen: what money state an order is in, which stage it can
 * move to, and what the hand-over button and its blockers say. Money is integer paise.
 */

/** Processing stages in the order a garment goes through them. `cancelled` is not a stage. */
export const STAGES = ['received', 'washing', 'drying', 'ironing', 'quality_check', 'packing', 'ready', 'collected'] as const;

const READY_INDEX = STAGES.indexOf('ready');

const STAGE_LABELS = new Map<string, string>([
  ['received', 'Received'],
  ['washing', 'Washing'],
  ['drying', 'Drying'],
  ['ironing', 'Ironing'],
  ['quality_check', 'Quality check'],
  ['packing', 'Packing'],
  ['ready', 'Ready for pickup'],
  ['collected', 'Collected'],
  ['cancelled', 'Cancelled'],
]);

/** Same output as `money` in `components/localCounter/ui.tsx` (en-IN, INR). */
const RUPEES = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

export interface OrderMoneyInput { status: string; totalMinor: number; balanceMinor: number }
export interface HandoverInput extends OrderMoneyInput { totalPieces: number; checkedPieces: number }

export type MoneyState = 'cancelled' | 'no_charge' | 'paid' | 'balance_due';
export type RowActionKind = 'receive_and_handover' | 'handover' | 'open' | 'view';
export interface RowAction { kind: RowActionKind; label: string }
export type HandoverCtaKind = 'not_ready' | 'receive' | 'receive_and_handover' | 'check_more' | 'handover' | 'done';
export interface HandoverCta { kind: HandoverCtaKind; label: string; disabled: boolean }

export const rupees = (minor: number): string => RUPEES.format(minor / 100);

/** Plain English label for a status. Unknown values only get their underscores replaced. */
export function stageLabel(status: string): string {
  return STAGE_LABELS.get(status) ?? status.replace(/_/g, ' ');
}

export function moneyState(order: OrderMoneyInput): MoneyState {
  if (order.status === 'cancelled') return 'cancelled';
  if (order.totalMinor === 0) return 'no_charge';
  if (order.balanceMinor > 0) return 'balance_due';
  return 'paid';
}

/** The stages an order can still be moved to by hand: every later stage up to and including `ready`. */
export function moveableStages(status: string): CounterProcessingStatus[] {
  const from = (STAGES as readonly string[]).indexOf(status);
  if (from < 0 || from >= READY_INDEX) return [];
  // Every stage strictly after `received` and up to `ready` is a processing status.
  return STAGES.slice(from + 1, READY_INDEX + 1) as CounterProcessingStatus[];
}

export function nextStage(status: string): CounterProcessingStatus | null {
  return moveableStages(status)[0] ?? null;
}

/** True when `to` is two or more stages after `from`, so the stages between them are skipped. */
export function skipsStages(from: string, to: string): boolean {
  const fromIndex = (STAGES as readonly string[]).indexOf(from);
  const toIndex = (STAGES as readonly string[]).indexOf(to);
  return fromIndex >= 0 && toIndex - fromIndex >= 2;
}

/** The single button shown on an order row in the list. */
export function rowAction(order: OrderMoneyInput): RowAction {
  if (order.status === 'collected' || order.status === 'cancelled') return { kind: 'view', label: 'View' };
  if (order.status === 'ready' && order.balanceMinor > 0) {
    return { kind: 'receive_and_handover', label: `Receive ${rupees(order.balanceMinor)} & hand over` };
  }
  if (order.status === 'ready') return { kind: 'handover', label: 'Hand over' };
  return { kind: 'open', label: 'Open' };
}

/** The hand-over button in the order's pickup panel. */
export function handoverCta(order: HandoverInput): HandoverCta {
  if (order.status === 'collected') return { kind: 'done', label: 'Handed over', disabled: true };
  if (order.status === 'cancelled') return { kind: 'not_ready', label: 'Order is cancelled', disabled: true };
  if (order.status !== 'ready') return { kind: 'not_ready', label: `Order is ${stageLabel(order.status)}`, disabled: true };

  const owes = order.balanceMinor > 0;
  const unchecked = uncheckedCount(order);
  if (owes && unchecked > 0) return { kind: 'receive', label: `Receive ${rupees(order.balanceMinor)}`, disabled: false };
  if (owes) return { kind: 'receive_and_handover', label: `Receive ${rupees(order.balanceMinor)} & hand over`, disabled: false };
  if (unchecked > 0) return { kind: 'check_more', label: `Check ${unchecked} more ${garments(unchecked)}`, disabled: true };
  return { kind: 'handover', label: 'Hand over order', disabled: false };
}

/** Why hand-over is blocked, in the order the cashier must resolve them. Empty when nothing blocks. */
export function handoverBlockers(order: HandoverInput): string[] {
  if (order.status === 'collected') return ['Already handed over'];
  // A cancelled order's balance is not money to receive, so it is the only blocker shown.
  if (order.status === 'cancelled') return ['Order is cancelled'];

  const blockers: string[] = [];
  if (order.status !== 'ready') blockers.push(`Order is ${stageLabel(order.status)}, not ready yet`);
  if (order.balanceMinor > 0) blockers.push(`${rupees(order.balanceMinor)} still to receive`);
  const unchecked = uncheckedCount(order);
  if (unchecked > 0) blockers.push(`${unchecked} ${garments(unchecked)} not checked`);
  return blockers;
}

function uncheckedCount(order: Pick<HandoverInput, 'totalPieces' | 'checkedPieces'>): number {
  return Math.max(0, order.totalPieces - order.checkedPieces);
}

function garments(n: number): string {
  return n === 1 ? 'garment' : 'garments';
}
