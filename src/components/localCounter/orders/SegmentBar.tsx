import type { CounterQueueCounts } from '@/lib/localFirst/counter';
import type { OrderSegment } from '@/lib/localFirst/orders/useOrderList';

export interface SegmentBarProps {
  segment: OrderSegment;
  counts: CounterQueueCounts | null;
  onSegment(segment: OrderSegment): void;
}

const SEGMENTS: { filter: OrderSegment; label: string; countOf?: (counts: CounterQueueCounts) => number }[] = [
  { filter: 'ready', label: 'Ready', countOf: counts => counts.ready },
  { filter: 'balance_due', label: 'Balance due', countOf: counts => counts.balanceDue },
  { filter: 'overdue', label: 'Overdue', countOf: counts => counts.overdue },
  { filter: 'in_process', label: 'In process', countOf: counts => counts.inProcess },
  { filter: 'today', label: 'Today', countOf: counts => counts.today },
  { filter: 'all', label: 'All', countOf: counts => counts.all },
  { filter: 'day', label: 'Pick a day' },
];

/** The order-list filters. Each button shows its count once the counts are known. */
export const SegmentBar = ({ segment, counts, onSegment }: SegmentBarProps) => (
  <div className="counter-segments" role="group" aria-label="Order filters">
    {SEGMENTS.map(item => {
      const selected = item.filter === segment;
      return (
        <button key={item.filter} type="button" className={`counter-touch ${selected ? 'selected' : ''}`.trim()} aria-pressed={selected} onClick={() => onSegment(item.filter)}>
          <span>{item.label}</span>{counts && item.countOf && <>{' '}<span className="counter-segment-count">{item.countOf(counts)}</span></>}
        </button>
      );
    })}
  </div>
);
