import type { CounterOrderLine } from '../counter';

/**
 * Pure rules for handing an order over in parts. A customer may take some lines now and the rest later;
 * any part can go unpaid except the last, which needs the whole bill paid. Money is integer paise.
 */

/** Same output as `money` in `components/localCounter/ui.tsx` (en-IN, INR). */
const RUPEES = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
export const rupees = (minor: number): string => RUPEES.format(minor / 100);

export type PickupState = 'waiting' | 'part' | 'collected' | 'cancelled';

const PICKUP_LABELS: Record<PickupState, string> = {
  waiting: 'Not collected',
  part: 'Part collected',
  collected: 'Collected',
  cancelled: 'Cancelled',
};

/** Where an order stands with the customer, from its status and how many pieces have gone. */
export const pickupState = (order: { status: string; pieceCount: number; handedOverCount: number }): PickupState => {
  if (order.status === 'cancelled') return 'cancelled';
  if (order.status === 'collected') return 'collected';
  return order.handedOverCount > 0 && order.handedOverCount < order.pieceCount ? 'part' : 'waiting';
};

export const pickupLabel = (state: PickupState): string => PICKUP_LABELS[state];

/** Pieces of a line still at the shop. */
export const remaining = (line: CounterOrderLine): number => Math.max(0, line.pieceCount - line.handedOverCount);

/** The lines that still have something to hand over: these start ticked on the order page. */
export const waitingLineIds = (lines: CounterOrderLine[]): string[] =>
  lines.filter(line => remaining(line) > 0).map(line => line.itemId);

/** How many pieces leave with the chosen lines. */
export const piecesGoing = (lines: CounterOrderLine[], chosen: string[]): number =>
  lines.filter(line => chosen.includes(line.itemId)).reduce((sum, line) => sum + remaining(line), 0);

/** True when the chosen lines are everything still at the shop, so this hand-over completes the order. */
export const finishesOrder = (lines: CounterOrderLine[], chosen: string[]): boolean => {
  const going = piecesGoing(lines, chosen);
  return going > 0 && going === lines.reduce((sum, line) => sum + remaining(line), 0);
};

/**
 * What the customer should pay for the chosen lines: their share of the bill (any discount is spread
 * over the lines in proportion), never more than the balance. The last hand-over asks for the whole balance.
 */
export const suggestedPaymentMinor = (
  order: { totalMinor: number; balanceMinor: number; lines: CounterOrderLine[] },
  chosen: string[],
): number => {
  if (order.balanceMinor <= 0 || chosen.length === 0) return 0;
  if (finishesOrder(order.lines, chosen)) return order.balanceMinor;
  const subtotal = order.lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
  if (subtotal === 0) return 0;
  const chosenValue = order.lines
    .filter(line => chosen.includes(line.itemId) && line.pieceCount > 0)
    .reduce((sum, line) => sum + (line.lineTotalMinor * remaining(line)) / line.pieceCount, 0);
  return Math.min(order.balanceMinor, Math.round((chosenValue * order.totalMinor) / subtotal));
};
