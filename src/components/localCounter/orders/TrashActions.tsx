import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const REASON_MIN = 3;
const REASON_MAX = 200;

export interface TrashActionsProps {
  isAdmin: boolean;
  busy: boolean;
  /** Admin: move the order to the trash. */
  onTrash(): void;
  /** Staff: ask the owner to trash the order, with the reason. */
  onRequestTrash(reason: string): void;
}

/**
 * The trash control of one order, always in view. An administrator moves the order to the trash after
 * one confirmation (it can be restored from the Trash page). Staff cannot trash anything: they mark the
 * bill with a reason and the owner decides.
 */
export const TrashActions = ({ isAdmin, busy, onTrash, onRequestTrash }: TrashActionsProps) => {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState('');

  const close = () => {
    setOpen(false);
    setReason('');
    setProblem('');
  };
  const send = () => {
    const trimmed = reason.trim();
    if (trimmed.length < REASON_MIN || trimmed.length > REASON_MAX) {
      setProblem(`Enter a reason of ${REASON_MIN} to ${REASON_MAX} characters.`);
      return;
    }
    setProblem('');
    onRequestTrash(trimmed);
  };

  if (!open) {
    return <Button variant="outline" className="counter-touch" disabled={busy} onClick={() => setOpen(true)}>{isAdmin ? 'Move to trash' : 'Mark for trash'}</Button>;
  }
  if (isAdmin) {
    return (
      <div role="group" aria-label="Move this order to the trash" className="counter-trash-confirm">
        <p>The order will no longer count in sales or the dashboard. Nothing is deleted, and you can restore it from the Trash page.</p>
        <Button variant="destructive" className="counter-touch" disabled={busy} onClick={onTrash}>Confirm move to trash</Button>
        <Button variant="outline" className="counter-touch" disabled={busy} onClick={close}>Keep order</Button>
      </div>
    );
  }
  return (
    <div role="group" aria-label="Mark this bill for the trash" className="counter-trash-confirm">
      <p>Use this for a bill added by mistake. The owner reviews it; until then the bill still counts in sales.</p>
      <Label htmlFor="trash-reason">Why should this bill be trashed?</Label>
      <Textarea id="trash-reason" value={reason} onChange={event => { setReason(event.target.value); setProblem(''); }} />
      {problem && <p role="alert">{problem}</p>}
      <Button variant="destructive" className="counter-touch" disabled={busy} onClick={send}>Send to the owner</Button>
      <Button variant="outline" className="counter-touch" disabled={busy} onClick={close}>Keep bill</Button>
    </div>
  );
};
