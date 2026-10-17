import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { CounterSavedOrder } from '@/lib/localFirst/counter';
import { handoverBlockers, handoverCta, rupees, type HandoverCtaKind } from '@/lib/localFirst/orders/orderMoney';
import { checkedCount } from '@/lib/localFirst/orders/pieceGroups';
import { PieceChecklist } from './PieceChecklist';
import { ReadinessPanel } from './ReadinessPanel';

export type HandoverAction = 'receive' | 'receive_and_handover' | 'handover' | 'mark_ready';

/** The primary button's action for each enabled CTA kind. The other kinds are disabled and have none. */
const ACTION_FOR_CTA: Partial<Record<HandoverCtaKind, HandoverAction>> = {
  receive: 'receive',
  receive_and_handover: 'receive_and_handover',
  handover: 'handover',
};

export interface HandoverPageProps {
  order: CounterSavedOrder; busy: boolean; error: string;
  backLabel: string; onBack(): void;
  checkedTaggedIds: string[]; onCheckedTagged(ids: string[]): void;
  untaggedCounts: Record<string, number>; onUntaggedCounts(counts: Record<string, number>): void;
  /** The money panel, supplied by the parent. Shown only when money is due or a payment was just received. */
  moneySlot: ReactNode;
  /** A status line such as "₹700.00 received". Empty when there is none. */
  receivedNote: string;
  onAction(kind: HandoverAction): void;
  done: boolean; onNext(): void;
  /** The customer for the heading, when the parent has it. */
  customer?: { name: string; phone: string };
}

/**
 * The pickup and hand-over screen. Garments are ticked here (by tag or by hand), money is taken if
 * due, and one sticky button states the next step.
 */
export const HandoverPage = ({
  order, busy, error, backLabel, onBack, checkedTaggedIds, onCheckedTagged, untaggedCounts, onUntaggedCounts,
  moneySlot, receivedNote, onAction, done, onNext, customer,
}: HandoverPageProps) => {
  if (done) {
    return (
      <section className="counter-status-page flex flex-col items-center gap-4 text-center">
        <h1>{`Handed over ✓ ${order.orderNumber}`}</h1>
        <Button size="lg" className="counter-touch" onClick={onNext}>Next order</Button>
      </section>
    );
  }

  const totalPieces = order.pieces.length;
  const checkedPieces = checkedCount(order.pieces, checkedTaggedIds, untaggedCounts);
  const handover = { status: order.status, totalMinor: order.totalMinor, balanceMinor: order.balanceMinor, totalPieces, checkedPieces };
  const cta = handoverCta(handover);
  const blockers = handoverBlockers(handover);
  const action = ACTION_FOR_CTA[cta.kind];
  const showMoney = order.balanceMinor > 0 || receivedNote !== '';
  const showMarkReady = cta.kind === 'not_ready' && order.status !== 'cancelled';

  return (
    <div className="counter-status-page flex flex-col gap-4 pb-6">
      <div>
        <Button variant="outline" onClick={onBack}>{`← ${backLabel}`}</Button>
      </div>
      <header className="flex flex-col gap-1">
        <h1>{order.orderNumber}</h1>
        {customer && <p className="text-sm text-muted-foreground">{`${customer.name} · ${customer.phone}`}</p>}
      </header>
      <ol className="flex flex-wrap gap-2 text-sm font-medium">
        <li className="rounded-full border px-3 py-1">{`1 Garments ${checkedPieces}/${totalPieces}`}</li>
        <li className="rounded-full border px-3 py-1">{order.balanceMinor > 0 ? `2 Balance ${rupees(order.balanceMinor)}` : '2 Balance paid'}</li>
        <li className="rounded-full border px-3 py-1">3 Hand over</li>
      </ol>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="counter-panel">
          <PieceChecklist
            mode="pickup" pieces={order.pieces}
            checkedTaggedIds={checkedTaggedIds} onCheckedTagged={onCheckedTagged}
            untaggedCounts={untaggedCounts} onUntaggedCounts={onUntaggedCounts}
          />
        </div>
        <div className="flex flex-col gap-4">
          {receivedNote && <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm font-medium text-emerald-800">{receivedNote}</p>}
          {showMoney && moneySlot}
          <ReadinessPanel blockers={blockers} ready={blockers.length === 0} />
        </div>
      </div>
      <div className="sticky bottom-0 z-10 flex flex-col gap-2 border-t bg-background p-4 shadow-medium">
        {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          {showMarkReady && (
            <Button variant="outline" className="counter-touch" disabled={busy} onClick={() => onAction('mark_ready')}>{'Mark ready now & continue'}</Button>
          )}
          <Button size="lg" className="counter-touch" disabled={cta.disabled || busy || !action} onClick={() => action && onAction(action)}>
            {cta.label}
          </Button>
        </div>
      </div>
    </div>
  );
};
