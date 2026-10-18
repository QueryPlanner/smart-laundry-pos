import { useEffect, useRef, useState } from 'react';
import { cancelCounterOrder, requestCounterOrderTrash, trashCounterOrder, updateCounterOrderStatus } from '@/lib/localFirst/counter';
import type { CounterProcessingStatus, CounterSavedOrder } from '@/lib/localFirst/counter';
import { rupees, stageLabel } from '@/lib/localFirst/orders/orderMoney';
import { useOrderHandover } from '@/lib/localFirst/orders/useOrderHandover';
import { useOrderMoney } from '@/lib/localFirst/orders/useOrderMoney';
import { useOrderPacking } from '@/lib/localFirst/orders/useOrderPacking';
import { HandoverPage } from './HandoverPage';
import { MoneyPanel } from './MoneyPanel';
import { OrderDetailPage } from './OrderDetailPage';
import { PackingCheckCard } from './PackingCheckCard';

export type OrderView = 'detail' | 'handover';

export interface OrderWorkspaceProps {
  order: CounterSavedOrder;
  view: OrderView;
  isAdmin: boolean;
  /** Where Back on the detail page goes, as words: "Orders", "Dashboard" ... */
  backLabel: string;
  onBack(): void;
  onView(view: OrderView): void;
  /** Replace the open order with a fresher copy. */
  onOrder(order: CounterSavedOrder): void;
  onError(error: unknown): void;
  onNotice(message: string): void;
  onReprintBill(): void;
  onReprintTags(): void;
  onOpenPrints(): void;
  /** The hand-over is done and the cashier asked for the next order. */
  onFinished(): void;
}

/** The packing check only means something while the garments are being finished. */
const PACKING_STAGES = ['ironing', 'quality_check', 'packing'];

/**
 * One open order: the detail page and the hand-over page share the same payment, ticks and keys, so they
 * live together here. The parent owns navigation and the order itself.
 */
export const OrderWorkspace = ({
  order, view, isAdmin, backLabel, onBack, onView, onOrder, onError, onNotice, onReprintBill, onReprintTags, onOpenPrints, onFinished,
}: OrderWorkspaceProps) => {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const money = useOrderMoney({ order, onOrder, onError, onNotice });
  const handover = useOrderHandover({
    order, money: { receive: money.receive }, onOrder, onError, onNotice,
    paymentMethod: money.form.method, reference: money.form.reference,
  });
  const packing = useOrderPacking({ order, onOrder, onError, onNotice });

  // A different order was opened: its payment form, ticks and request keys start fresh.
  const resets = useRef({ money: money.reset, handover: handover.reset });
  resets.current = { money: money.reset, handover: handover.reset };
  useEffect(() => {
    resets.current.money();
    resets.current.handover();
  }, [order.orderId]);

  /** One stage change or cancel at a time. */
  const run = async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try { await action(); } finally { running.current = false; setBusy(false); }
  };

  const moveStage = (status: CounterProcessingStatus) => run(async () => {
    try {
      const result = await updateCounterOrderStatus(order.orderId, status);
      onOrder(result);
      onNotice(`Order ${result.orderNumber} moved to ${stageLabel(status).toLowerCase()}.`);
    } catch (error) { onError(error); }
  });

  const cancel = (reason: string) => run(async () => {
    try {
      const result = await cancelCounterOrder(order.orderId, reason);
      onOrder(result);
      onNotice(result.refundDueMinor > 0 ? `Order cancelled. Hand back ${rupees(result.refundDueMinor)}.` : 'Order cancelled.');
    } catch (error) { onError(error); }
  });

  const trash = () => run(async () => {
    try {
      await trashCounterOrder(order.orderId);
      onNotice(`Order ${order.orderNumber} moved to the trash.`);
      onBack();
    } catch (error) { onError(error); }
  });

  const requestTrash = (reason: string) => run(async () => {
    try {
      await requestCounterOrderTrash(order.orderId, reason);
      onNotice(`Order ${order.orderNumber} was sent to the owner to be trashed. It still counts in sales until they approve.`);
    } catch (error) { onError(error); }
  });

  const customer = { name: order.customerName, phone: order.customerPhone };

  if (view === 'handover') {
    return (
      <HandoverPage
        order={order} customer={customer} busy={busy || handover.busy} error={handover.error}
        backLabel="Order" onBack={() => onView('detail')}
        checkedTaggedIds={handover.checkedTaggedIds} onCheckedTagged={handover.setCheckedTaggedIds}
        untaggedCounts={handover.untaggedCounts} onUntaggedCounts={handover.setUntaggedCounts}
        moneySlot={<MoneyPanel order={order} form={money.form} compact />}
        receivedNote={handover.receivedNote}
        onAction={kind => void handover.perform(kind)}
        done={handover.done} onNext={onFinished}
      />
    );
  }

  const packingSlot = PACKING_STAGES.includes(order.status) ? (
    <PackingCheckCard
      pieces={order.pieces}
      checkedTaggedIds={packing.checkedTaggedIds} onCheckedTagged={packing.setCheckedTaggedIds}
      untaggedCounts={packing.untaggedCounts} onUntaggedCounts={packing.setUntaggedCounts}
      canSave={packing.canSave} saving={packing.saving} onSave={() => void packing.save()}
    />
  ) : null;

  return (
    <OrderDetailPage
      order={order} customer={customer} isAdmin={isAdmin} busy={busy}
      backLabel={backLabel} onBack={onBack}
      onMoveStage={status => void moveStage(status)} onHandover={() => onView('handover')}
      money={money.form} packingSlot={packingSlot}
      onCancel={reason => void cancel(reason)}
      onTrash={() => void trash()}
      onRequestTrash={reason => void requestTrash(reason)}
      onReprintBill={onReprintBill} onReprintTags={onReprintTags} onOpenPrints={onOpenPrints}
    />
  );
};
