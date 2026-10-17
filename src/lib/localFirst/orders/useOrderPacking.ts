import { useRef, useState } from 'react';
import type { CounterSavedOrder } from '../counter';
import { getCounterOrder, matchOrderPieces, updateCounterOrderStatus } from '../counter';
import { checkedCount, pickupPieceIds, splitPieces } from './pieceGroups';

/**
 * The packing checklist for one open order. Ticks are session-local: they start from the packing
 * check saved on the order and are only written to the database when the cashier saves.
 */

/** The ticks that belong to one order. `orderId` says which order they were derived for. */
interface PackingTicks {
  orderId: string | null;
  checkedTaggedIds: string[];
  untaggedCounts: Record<string, number>;
}

export interface OrderPackingOptions {
  order: CounterSavedOrder | null;
  onOrder(order: CounterSavedOrder): void;
  onError(error: unknown): void;
  onNotice(message: string): void;
}

export interface OrderPacking {
  checkedTaggedIds: string[];
  setCheckedTaggedIds(ids: string[]): void;
  untaggedCounts: Record<string, number>;
  setUntaggedCounts(counts: Record<string, number>): void;
  canSave: boolean;
  saving: boolean;
  save(): Promise<void>;
}

const orderIdOf = (order: CounterSavedOrder | null): string | null => order?.orderId ?? null;

/** Ticks as saved on the order: tagged pieces that were packing-matched, and per untagged line the matched count. */
function ticksFromOrder(order: CounterSavedOrder | null): PackingTicks {
  if (!order) return { orderId: null, checkedTaggedIds: [], untaggedCounts: {} };
  const { tagged, untaggedLines } = splitPieces(order.pieces);
  return {
    orderId: order.orderId,
    checkedTaggedIds: tagged.filter(piece => piece.packingMatched).map(piece => piece.id),
    untaggedCounts: Object.fromEntries(untaggedLines.map(line => [line.key, line.pieces.filter(piece => piece.packingMatched).length])),
  };
}

export const useOrderPacking = (o: OrderPackingOptions): OrderPacking => {
  const { order, onOrder, onError, onNotice } = o;
  const [ticks, setTicks] = useState<PackingTicks>(() => ticksFromOrder(order));
  const running = useRef(false);
  const [saving, setSaving] = useState(false);

  // A different order re-derives the ticks. The same order refreshed after a save keeps the cashier's ticks.
  if (ticks.orderId !== orderIdOf(order)) setTicks(ticksFromOrder(order));

  const setCheckedTaggedIds = (checkedTaggedIds: string[]) => setTicks(current => ({ ...current, checkedTaggedIds }));
  const setUntaggedCounts = (untaggedCounts: Record<string, number>) => setTicks(current => ({ ...current, untaggedCounts }));

  const allChecked = order !== null && checkedCount(order.pieces, ticks.checkedTaggedIds, ticks.untaggedCounts) === order.pieces.length;
  const canSave = order !== null && order.status !== 'cancelled' && order.status !== 'collected' && allChecked;

  /**
   * Saves the packing check. The match is recorded first; the order is marked Ready only when every
   * piece matched, so a partial match never moves the order on.
   */
  const save = async (): Promise<void> => {
    if (!order || !canSave || running.current) return;
    running.current = true;
    setSaving(true);
    try {
      const pieceIds = pickupPieceIds(order.pieces, ticks.checkedTaggedIds, ticks.untaggedCounts);
      const result = await matchOrderPieces(order.orderId, 'packing', pieceIds);
      if (!result.complete) throw new Error('Not every piece matched. Check the pieces and save again.');
      if (order.status !== 'ready') await updateCounterOrderStatus(order.orderId, 'ready');
      const fresh = await getCounterOrder(order.orderId);
      if (!fresh) throw new Error('The order could not be reloaded. Open it again to check its status.');
      onOrder(fresh);
      onNotice('Packing checked. Order is ready for pickup.');
    } catch (error) {
      onError(error);
    } finally {
      running.current = false;
      setSaving(false);
    }
  };

  return {
    checkedTaggedIds: ticks.checkedTaggedIds,
    setCheckedTaggedIds,
    untaggedCounts: ticks.untaggedCounts,
    setUntaggedCounts,
    canSave,
    saving,
    save,
  };
};
