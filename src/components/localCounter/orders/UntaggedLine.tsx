import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { UntaggedLine as UntaggedLineGroup } from '@/lib/localFirst/orders/pieceGroups';

export interface UntaggedLineProps { line: UntaggedLineGroup; count: number; onCount(count: number): void }

/** One garment and service with no tag. The cashier counts how many are checked; the count never leaves 0..line size. */
export const UntaggedLine = ({ line, count, onCount }: UntaggedLineProps) => {
  const size = line.pieces.length;
  const name = `${line.garment} · ${line.service}`;
  const setCount = (next: number) => onCount(Math.min(size, Math.max(0, next)));
  return (
    <div role="group" aria-label={name} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <span className="font-medium">{name}</span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" className="counter-touch" aria-label="Fewer" onClick={() => setCount(count - 1)}>
          <Minus />
        </Button>
        <span className="min-w-[4rem] text-center text-sm tabular-nums">{`${count} / ${size}`}</span>
        <Button variant="outline" size="icon" className="counter-touch" aria-label="More" onClick={() => setCount(count + 1)}>
          <Plus />
        </Button>
        <Button variant="outline" size="sm" className="counter-touch" onClick={() => setCount(size)}>All</Button>
      </div>
    </div>
  );
};
