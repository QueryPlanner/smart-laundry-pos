import { useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CounterPiece } from '@/lib/localFirst/counter';
import { checkedCount, resolveScan, splitPieces } from '@/lib/localFirst/orders/pieceGroups';
import { FormField } from '../ui';
import { UntaggedLine } from './UntaggedLine';

export interface PieceChecklistProps {
  mode: 'packing' | 'pickup'; pieces: CounterPiece[];
  checkedTaggedIds: string[]; onCheckedTagged(ids: string[]): void;
  untaggedCounts: Record<string, number>; onUntaggedCounts(counts: Record<string, number>): void;
}

const COPY: Record<PieceChecklistProps['mode'], string> = {
  pickup: 'Check each garment with the customer',
  packing: 'Check each garment as it is packed',
};

/**
 * The garment checklist for packing and for hand-over. Tagged pieces are ticked one by one, by typing
 * a tag ID (or a position) and pressing Enter, or by ticking the row. Untagged pieces are counted per line.
 */
export const PieceChecklist = ({ mode, pieces, checkedTaggedIds, onCheckedTagged, untaggedCounts, onUntaggedCounts }: PieceChecklistProps) => {
  const [typed, setTyped] = useState('');
  const [problem, setProblem] = useState('');
  const { tagged, untaggedLines } = splitPieces(pieces);
  const ticked = new Set(checkedTaggedIds);
  const checkedTotal = checkedCount(pieces, checkedTaggedIds, untaggedCounts);

  const scan = () => {
    const result = resolveScan(typed, tagged, checkedTaggedIds);
    if (result.kind === 'empty') return;
    setTyped('');
    if (result.kind === 'ok') {
      setProblem('');
      onCheckedTagged([...checkedTaggedIds, result.piece.id]);
      return;
    }
    setProblem(result.kind === 'duplicate' ? 'Already checked' : 'No such tag on this bill');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    scan();
  };

  const setTaggedTicked = (id: string, on: boolean) =>
    onCheckedTagged(on ? [...checkedTaggedIds, id] : checkedTaggedIds.filter(checkedId => checkedId !== id));

  const tickAll = () => {
    onCheckedTagged(tagged.map(piece => piece.id));
    onUntaggedCounts(Object.fromEntries(untaggedLines.map(line => [line.key, line.pieces.length])));
  };

  const setLineCount = (key: string, count: number) => onUntaggedCounts({ ...untaggedCounts, [key]: count });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{COPY[mode]}</p>
      <FormField label="Type a tag ID and press Enter">
        <Input value={typed} autoFocus={mode === 'pickup'} autoComplete="off" onChange={event => setTyped(event.target.value)} onKeyDown={onKeyDown} />
      </FormField>
      {problem && <p role="alert" className="text-sm font-medium text-destructive">{problem}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-semibold">{`${checkedTotal} of ${pieces.length} checked`}</p>
        <Button variant="outline" size="sm" className="counter-touch" onClick={tickAll}>Tick all</Button>
      </div>
      <div className="counter-piece-list">
        {tagged.map(piece => (
          <label key={piece.id}>
            <input type="checkbox" checked={ticked.has(piece.id)} onChange={event => setTaggedTicked(piece.id, event.target.checked)} />
            <span><strong>{piece.shortId}</strong> {piece.garment} · {piece.service}</span>
            {ticked.has(piece.id) && <small>checked</small>}
          </label>
        ))}
      </div>
      {untaggedLines.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="counter-section-label">Without a tag</h3>
          {untaggedLines.map(line => (
            <UntaggedLine key={line.key} line={line} count={untaggedCounts[line.key] ?? 0} onCount={count => setLineCount(line.key, count)} />
          ))}
        </section>
      )}
    </div>
  );
};
