import { CheckCircle2, Circle } from 'lucide-react';

export interface ReadinessPanelProps { blockers: string[]; ready: boolean }

/** What still stops hand-over, as unchecked items, or a confirmation that nothing does. Blockers come from `handoverBlockers`. */
export const ReadinessPanel = ({ blockers, ready }: ReadinessPanelProps) => (
  <section className="counter-panel flex flex-col gap-3">
    <h2 className="counter-section-label">Before hand-over</h2>
    {ready ? (
      <p role="status" className="flex items-center gap-2 font-semibold text-emerald-700">
        <CheckCircle2 aria-hidden="true" />Everything is ready
      </p>
    ) : (
      <ul className="flex flex-col gap-2 text-sm font-medium text-amber-800">
        {blockers.map(blocker => (
          <li key={blocker} className="flex items-center gap-2">
            <Circle aria-hidden="true" />{blocker}
          </li>
        ))}
      </ul>
    )}
  </section>
);
