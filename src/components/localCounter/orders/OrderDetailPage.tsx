import type { ReactNode } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CounterPaymentMethod, CounterPiece, CounterProcessingStatus, CounterSavedOrder } from '@/lib/localFirst/counter';
import { stageLabel } from '@/lib/localFirst/orders/orderMoney';
import { formatShopDateTime } from '@/lib/localFirst/salesRange';
import { StatusBadge } from '../InsightParts';
import { count } from '../ui';
import { MoneyPanel } from './MoneyPanel';
import { MoreActions } from './MoreActions';
import { StageStepper } from './StageStepper';
import { TrashActions } from './TrashActions';

/** The payment form the parent owns; `MoneyPanel` renders it and reports every change back through these callbacks. */
export interface MoneyForm {
  amount: string; onAmount(value: string): void;          // rupee text; empty means the full balance
  partial: boolean; onPartial(on: boolean): void;         // "Part payment" toggle
  method: CounterPaymentMethod; onMethod(method: CounterPaymentMethod): void;
  reference: string; onReference(value: string): void;
  error: string; onReceive(): void; busy: boolean;
}

export interface OrderDetailPageProps {
  order: CounterSavedOrder;
  /** `CounterSavedOrder` carries no customer, so the parent passes the one it already has from the list. */
  customer: { name: string; phone: string };
  isAdmin: boolean; busy: boolean;
  backLabel: string; onBack(): void;
  onMoveStage(status: CounterProcessingStatus): void;
  onHandover(): void;
  money: MoneyForm;
  packingSlot: ReactNode;                                  // a packing-check card supplied by the parent
  onCancel(reason: string): void;                          // admin only
  onTrash(): void;                                         // admin only
  onRequestTrash(reason: string): void;                    // staff: ask an admin to trash it
  onReprintBill(): void; onReprintTags(): void; onOpenPrints(): void;
  /** Show the bill on screen. */
  onPreviewBill(): void;
}

/** "3 pieces", or "5 pieces (3 tagged, 2 without a tag)" when some pieces have no tag. */
const piecesText = (pieces: CounterPiece[]): string => {
  const tagged = pieces.filter(piece => piece.tagged).length;
  const untagged = pieces.length - tagged;
  const total = count(pieces.length, 'piece');
  return untagged > 0 ? `${total} (${tagged} tagged, ${untagged} without a tag)` : total;
};

/**
 * One order in full: where it is in processing, what is still owed, the hand-over step, and the rarer actions.
 * Pure view: the parent loads the order and handles every callback.
 */
export const OrderDetailPage = ({ order, customer, isAdmin, busy, backLabel, onBack, onMoveStage, onHandover, money, packingSlot, onCancel, onTrash, onRequestTrash, onReprintBill, onReprintTags, onOpenPrints, onPreviewBill }: OrderDetailPageProps) => {
  const cancelled = order.status === 'cancelled';
  const collected = order.status === 'collected';
  const ready = order.status === 'ready';

  return (
    <section className="counter-order-detail" aria-label="Order detail">
      <header className="counter-detail-head">
        <Button variant="outline" className="counter-touch" onClick={onBack}>{`← ${backLabel}`}</Button>
        <div>
          <h1>{order.orderNumber}</h1>
          <p>{`${customer.name} · ${customer.phone}`}</p>
          <div><StatusBadge status={order.status} /></div>
          <p>{piecesText(order.pieces)}</p>
          <div className="counter-detail-actions">
            <Button variant="outline" className="counter-touch" disabled={busy} onClick={onPreviewBill}>Preview bill</Button>
            <Button variant="outline" className="counter-touch" disabled={busy} onClick={onReprintBill}>Reprint bill</Button>
            <TrashActions isAdmin={isAdmin} busy={busy} onTrash={onTrash} onRequestTrash={onRequestTrash} />
          </div>
          <p>{`Received ${formatShopDateTime(order.receivedAt)} · Promised ${formatShopDateTime(order.promisedAt)}`}</p>
        </div>
      </header>

      {cancelled && <div className="counter-cancelled-banner" role="status">
        <strong>Cancelled</strong>
        <p>This order was cancelled. No payment or pickup can be recorded for it.</p>
      </div>}

      <StageStepper status={order.status} busy={busy} onMove={onMoveStage} />
      {packingSlot}

      {ready && <Button className="counter-touch" disabled={busy} onClick={onHandover}>Hand over to customer →</Button>}
      {collected && <p role="status"><CheckCircle2 aria-hidden="true" /> <strong>Handed over</strong> {formatShopDateTime(order.collectedAt)}</p>}
      {!ready && !collected && !cancelled && <p>{`Order is ${stageLabel(order.status)}. Mark it ready before hand-over.`}</p>}

      <MoneyPanel order={order} form={money} />
      <MoreActions
        status={order.status}
        taggedCount={order.pieces.filter(piece => piece.tagged).length}
        paidMinor={order.paidMinor}
        isAdmin={isAdmin}
        busy={busy}
        onReprintTags={onReprintTags}
        onOpenPrints={onOpenPrints}
        onCancel={onCancel}
      />
    </section>
  );
};
