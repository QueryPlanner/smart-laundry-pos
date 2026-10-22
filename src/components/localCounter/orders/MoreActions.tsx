import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { money } from '../ui';

const REASON_MIN = 3;
const REASON_MAX = 200;

export interface MoreActionsProps {
  status: string;
  /** Pieces with a tag. Zero means there is nothing to reprint. */
  taggedCount: number;
  paidMinor: number;
  isAdmin: boolean;
  busy: boolean;
  onReprintTags(): void;
  onOpenPrints(): void;
  onCancel(reason: string): void;
  onTrash(): void;
  /** Staff only: ask an administrator to trash this bill (for example one added by mistake). */
  onRequestTrash(reason: string): void;
}

/**
 * Less-used actions behind a disclosure: tag reprints, the print status screen, and admin-only cancel.
 * Cancel is hidden once an order is collected or cancelled; staff see a hint to ask an admin instead.
 */
export const MoreActions = ({ status, taggedCount, paidMinor, isAdmin, busy, onReprintTags, onOpenPrints, onCancel, onTrash, onRequestTrash }: MoreActionsProps) => {
  const [open, setOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [trashing, setTrashing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [trashReason, setTrashReason] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState('');
  const regionId = useId();
  const canCancel = status !== 'collected' && status !== 'cancelled';

  // Closing the disclosure also drops any half-written cancel reason.
  const toggle = () => {
    setOpen(!open);
    setCancelling(false);
    setTrashing(false);
    setAsking(false);
    setTrashReason('');
    setReason('');
    setProblem('');
  };
  const keep = () => {
    setCancelling(false);
    setReason('');
    setProblem('');
  };
  const confirm = () => {
    const trimmed = reason.trim();
    if (trimmed.length < REASON_MIN || trimmed.length > REASON_MAX) {
      setProblem(`Enter a reason of ${REASON_MIN} to ${REASON_MAX} characters.`);
      return;
    }
    setProblem('');
    onCancel(trimmed);
  };
  const sendTrashRequest = () => {
    const trimmed = trashReason.trim();
    if (trimmed.length < REASON_MIN || trimmed.length > REASON_MAX) {
      setProblem(`Enter a reason of ${REASON_MIN} to ${REASON_MAX} characters.`);
      return;
    }
    setProblem('');
    onRequestTrash(trimmed);
  };
  const confirmLabel = paidMinor > 0 ? `Refund ${money(paidMinor)} to the customer` : 'Confirm cancel order';

  return (
    <div className="counter-more-actions">
      <Button variant="outline" aria-expanded={open} aria-controls={regionId} onClick={toggle}>More actions</Button>
      {open && (
        <div id={regionId} role="region" aria-label="More actions" className="counter-more-panel">
          {taggedCount > 0
            ? <Button variant="outline" disabled={busy} onClick={onReprintTags}>Reprint tags</Button>
            : <p>No tags needed</p>}
          <Button variant="outline" disabled={busy} onClick={onOpenPrints}>Print status</Button>
          {canCancel && (!isAdmin
            ? <p>Ask an admin to cancel this order.</p>
            : cancelling
              ? <div role="group" aria-label="Cancel this order">
                <p>Cancelling voids every payment recorded on this order. This cannot be undone.</p>
                <Label htmlFor="cancel-reason">Reason for cancelling</Label>
                <Textarea id="cancel-reason" value={reason} onChange={event => { setReason(event.target.value); setProblem(''); }} />
                {problem && <p role="alert">{problem}</p>}
                <Button variant="destructive" disabled={busy} onClick={confirm}>{confirmLabel}</Button>
                <Button variant="outline" disabled={busy} onClick={keep}>Keep order</Button>
              </div>
              : <Button variant="outline" disabled={busy} onClick={() => setCancelling(true)}>Cancel order</Button>)}
          {isAdmin && (trashing
            ? <div role="group" aria-label="Move this order to the trash">
              <p>The order will no longer count in sales or the dashboard. Nothing is deleted.</p>
              <Button variant="destructive" disabled={busy} onClick={onTrash}>Confirm move to trash</Button>
              <Button variant="outline" disabled={busy} onClick={() => setTrashing(false)}>Keep order</Button>
            </div>
            : <Button variant="outline" disabled={busy} onClick={() => setTrashing(true)}>Move to trash</Button>)}
          {!isAdmin && (asking
            ? <div role="group" aria-label="Mark this bill for the trash">
              <p>Use this for a bill added by mistake. The owner reviews it; until then the bill still counts in sales.</p>
              <Label htmlFor="trash-reason">Why should this bill be trashed?</Label>
              <Textarea id="trash-reason" value={trashReason} onChange={event => { setTrashReason(event.target.value); setProblem(''); }} />
              {problem && <p role="alert">{problem}</p>}
              <Button variant="destructive" disabled={busy} onClick={sendTrashRequest}>Send to the owner</Button>
              <Button variant="outline" disabled={busy} onClick={() => { setAsking(false); setTrashReason(''); setProblem(''); }}>Keep bill</Button>
            </div>
            : <Button variant="outline" disabled={busy} onClick={() => setAsking(true)}>Mark for trash</Button>)}
        </div>
      )}
    </div>
  );
};
