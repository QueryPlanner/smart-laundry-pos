import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const REASON_MIN = 3;
const REASON_MAX = 200;

interface CancelOrderProps {
  busy: boolean;
  /** Resolves when the attempt is over. On success the parent stops showing this component. */
  onCancel: (reason: string) => Promise<void>;
}

/** Admin-only "cancel this order": a reason is written down and a second, explicit tap confirms. */
export const CancelOrder = ({ busy, onCancel }: CancelOrderProps) => {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonProblem, setReasonProblem] = useState('');

  if (!open) return <Button variant="outline" onClick={() => setOpen(true)}>Cancel order</Button>;

  const confirm = async () => {
    const trimmed = reason.trim();
    if (trimmed.length < REASON_MIN || trimmed.length > REASON_MAX) {
      setReasonProblem(`Enter a reason of ${REASON_MIN} to ${REASON_MAX} characters.`);
      return;
    }
    setReasonProblem('');
    await onCancel(trimmed);
  };
  const keepOrder = () => { setOpen(false); setReason(''); setReasonProblem(''); };

  return (
    <div className="counter-cancel-order" role="group" aria-label="Cancel this order">
      <p>Cancelling voids every payment recorded on this order. This cannot be undone.</p>
      <Label htmlFor="cancel-reason">Reason for cancelling
        <Input id="cancel-reason" value={reason} onChange={event => { setReason(event.target.value); setReasonProblem(''); }} />
      </Label>
      {reasonProblem && <p role="alert">{reasonProblem}</p>}
      <Button disabled={busy} onClick={() => void confirm()}>Confirm cancel order</Button>
      <Button variant="outline" disabled={busy} onClick={keepOrder}>Keep order</Button>
    </div>
  );
};
