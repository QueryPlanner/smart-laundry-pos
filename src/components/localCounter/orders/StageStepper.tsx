import { useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CounterProcessingStatus } from '@/lib/localFirst/counter';
import { nextStage, skipsStages, STAGES, stageLabel } from '@/lib/localFirst/orders/orderMoney';

export interface StageStepperProps { status: string; busy: boolean; onMove(status: CounterProcessingStatus): void }

const skipWording = (stages: number): string => `Skip ${stages} ${stages === 1 ? 'stage' : 'stages'}? This cannot be undone.`;

/**
 * The eight processing stages, with finished ones marked Done and the current one announced as the current step.
 * Moving over stages that would be skipped asks for confirmation first, because nobody records them.
 * A cancelled order has no stages to show; the parent shows its banner instead.
 */
export const StageStepper = ({ status, busy, onMove }: StageStepperProps) => {
  const [skipTo, setSkipTo] = useState<CounterProcessingStatus | null>(null);
  if (status === 'cancelled') return null;

  const currentIndex = (STAGES as readonly string[]).indexOf(status);
  const next = nextStage(status);
  const markReady = next !== null && next !== 'ready';

  const request = (target: CounterProcessingStatus) => {
    if (skipsStages(status, target)) setSkipTo(target);
    else onMove(target);
  };

  return (
    <section className="counter-stepper-panel" aria-label="Processing stage">
      <ol className="counter-stepper">
        {STAGES.map((stage, index) => (
          <li key={stage} aria-current={index === currentIndex ? 'step' : undefined}>
            <span>{stageLabel(stage)}</span>
            {index < currentIndex && <span className="counter-stage-done"><Check aria-hidden="true" />Done</span>}
          </li>
        ))}
      </ol>
      {skipTo !== null
        ? <div role="group" aria-label="Confirm skip">
          <p>{skipWording(STAGES.indexOf(skipTo) - currentIndex - 1)}</p>
          <Button disabled={busy} onClick={() => { onMove(skipTo); setSkipTo(null); }}>Confirm</Button>
          <Button variant="outline" onClick={() => setSkipTo(null)}>Keep</Button>
        </div>
        : <div className="counter-stepper-actions">
          {next !== null && <Button className="counter-touch" disabled={busy} onClick={() => request(next)}>{`Move to ${stageLabel(next)}`}</Button>}
          {markReady && <Button variant="outline" className="counter-touch" disabled={busy} onClick={() => request('ready')}>Mark ready now</Button>}
        </div>}
    </section>
  );
};
