import { Button } from '@/components/ui/button';
import type { CounterPiece } from '@/lib/localFirst/counter';
import { PieceChecklist } from './PieceChecklist';

export interface PackingCheckCardProps {
  pieces: CounterPiece[]; checkedTaggedIds: string[]; onCheckedTagged(ids: string[]): void;
  untaggedCounts: Record<string, number>; onUntaggedCounts(counts: Record<string, number>): void;
  canSave: boolean; saving: boolean; onSave(): void;
}

/** The packing check on the order detail page. Saving records what was packed and marks the order ready. */
export const PackingCheckCard = ({ pieces, checkedTaggedIds, onCheckedTagged, untaggedCounts, onUntaggedCounts, canSave, saving, onSave }: PackingCheckCardProps) => (
  <section className="counter-panel flex flex-col gap-4">
    <h2 className="text-lg font-semibold">Packing check</h2>
    <PieceChecklist
      mode="packing" pieces={pieces}
      checkedTaggedIds={checkedTaggedIds} onCheckedTagged={onCheckedTagged}
      untaggedCounts={untaggedCounts} onUntaggedCounts={onUntaggedCounts}
    />
    <Button className="counter-touch" disabled={!canSave || saving} onClick={onSave}>{'Save check & mark Ready'}</Button>
  </section>
);
