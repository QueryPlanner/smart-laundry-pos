import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Loader2, Printer, XCircle, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CounterJobState, CounterPiece, CounterPrintJob } from '@/lib/localFirst/counter';
import { JOB_STATE_LABEL, unresolvedFirst } from './printJobState';

const JOB_STATE_ICON: Record<CounterJobState, LucideIcon> = {
  pending: Clock,
  submitting: Loader2,
  submitted: CheckCircle2,
  failed: XCircle,
  uncertain: AlertTriangle,
};

/** Colour plus an icon and words, so the state is never conveyed by colour alone. */
export const PrintJobState = ({ state }: { state: CounterJobState }) => {
  const Icon = JOB_STATE_ICON[state];
  return <span className={`counter-job-state ${state}`}><Icon aria-hidden="true" />{JOB_STATE_LABEL[state]}</span>;
};

const UNCERTAIN_TAGS_ON_ORDER_PAGE = 'Some tags may already be printed. To avoid duplicates, use Reprint selected tags below to print only the missing tags.';
const UNCERTAIN_TAGS_IN_QUEUE = 'Some tags may already be printed. To avoid duplicates, open the order and use Reprint selected tags to print only the missing tags.';

const istFormat = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

interface PrintProgressProps {
  orderNumber: string;
  promisedAt: string;
  jobs: CounterPrintJob[];
  pieces: CounterPiece[];
  selected: string[];
  onSelected: (ids: string[]) => void;
  reprintBusy: boolean;
  onReprintBill: () => void;
  onReprintTags: () => void;
  onRetry: (job: CounterPrintJob) => void;
  onResume: (job: CounterPrintJob) => void;
  /** Back to the order's page. */
  onBack: () => void;
}

/** Print state of one order, with targeted reprints. */
export const PrintProgress = ({ orderNumber, promisedAt, jobs, pieces, selected, onSelected, reprintBusy, onReprintBill, onReprintTags, onRetry, onResume, onBack }: PrintProgressProps) => {
  const [confirming, setConfirming] = useState<string | null>(null);
  // Only tagged pieces have a tag to reprint; plain ironing gets none.
  const taggedPieces = pieces.filter(piece => piece.tagged);
  return (
    <section className="counter-panel counter-status-page">
      <div><Button variant="outline" onClick={onBack}>← Order</Button></div>
      <h1>{orderNumber} · Print progress</h1>
      <p>Ready by {istFormat.format(new Date(promisedAt))} IST</p>
      {jobs.map(job => (
        <div key={job.id} className="counter-job">
          <Printer />
          <strong>{job.kind === 'bill' ? 'Canon customer bill' : 'TSC garment tags'}</strong>
          <PrintJobState state={job.state} />
          {job.lastError && <p>{job.lastError}</p>}
          {job.state === 'pending' && <Button onClick={() => onResume(job)}>Resume {job.kind}</Button>}
          {job.state === 'failed' && <Button onClick={() => onRetry(job)}>Retry {job.kind === 'bill' ? 'bill' : 'tags'}</Button>}
          {job.state === 'uncertain' && (confirming === job.id
            ? (
              <div className="counter-uncertain-confirm" role="alert">
                <p>{job.kind === 'tags' ? UNCERTAIN_TAGS_ON_ORDER_PAGE : 'This job may already have printed. Check the printer output first; reprinting can create a duplicate.'}</p>
                <Button onClick={() => { setConfirming(null); onRetry(job); }}>Confirm reprint of {job.kind}</Button>
                <Button variant="outline" onClick={() => setConfirming(null)}>Cancel</Button>
              </div>
            )
            : <Button variant="outline" onClick={() => setConfirming(job.id)}>Review uncertain {job.kind} job</Button>)}
        </div>
      ))}
      <div className="counter-targeted-reprint">
        <h2>Reprint saved output</h2>
        <Button variant="outline" disabled={reprintBusy} onClick={onReprintBill}>Reprint customer bill</Button>
        {taggedPieces.length === 0 ? <p>No tags needed for this order.</p> : <>
        <p>Select only the physical pieces that need replacement tags. IDs and saved garment/service details are reused.</p>
        <div className="counter-piece-list">
          {taggedPieces.map(piece => (
            <label key={piece.id}>
              <input
                type="checkbox"
                checked={selected.includes(piece.shortId)}
                onChange={event => onSelected(event.target.checked ? [...selected, piece.shortId] : selected.filter(id => id !== piece.shortId))}
              />
              <span><strong>{piece.shortId}</strong> · {piece.garment} / {piece.service}</span>
              <small>{piece.position}/{piece.total}</small>
            </label>
          ))}
        </div>
        <Button disabled={reprintBusy || selected.length === 0} onClick={onReprintTags}>Reprint selected tags ({selected.length})</Button>
        </>}
      </div>
    </section>
  );
};

interface PrintQueueProps {
  jobs: CounterPrintJob[];
  onRefresh: () => void;
  onOpenOrder: (orderId: string) => void;
  onRetry: (job: CounterPrintJob) => void;
  onResume: (job: CounterPrintJob) => void;
}

/** Every saved print job of every order, unresolved ones first. */
export const PrintQueue = ({ jobs, onRefresh, onOpenOrder, onRetry, onResume }: PrintQueueProps) => {
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <section className="counter-panel counter-status-page">
      <div className="counter-admin-heading">
        <h1>Saved print queue</h1>
        <Button variant="outline" onClick={onRefresh}>Refresh queue</Button>
      </div>
      <p>Pending output remains saved across app restarts. Resume or retry each printer job independently.</p>
      {jobs.length === 0
        ? <p>No saved print jobs.</p>
        : unresolvedFirst(jobs).map(job => (
          <article className="counter-job" key={job.id}>
            <div>
              <strong>{job.orderNumber} · {job.kind === 'bill' ? 'Canon bill' : 'TSC tags'}</strong>
              <PrintJobState state={job.state} />
              {job.lastError && <p>{job.lastError}</p>}
            </div>
            <Button variant="outline" onClick={() => onOpenOrder(job.orderId)}>Open order</Button>
            {job.state === 'pending' && <Button onClick={() => onResume(job)}>Resume this job</Button>}
            {job.state === 'failed' && <Button onClick={() => onRetry(job)}>Retry this job</Button>}
            {job.state === 'uncertain' && (confirming === job.id
              ? (
                <div role="alert">
                  <p>{job.kind === 'tags' ? UNCERTAIN_TAGS_IN_QUEUE : 'Check the printer first; confirm only if you need another copy.'}</p>
                  <Button onClick={() => { setConfirming(null); onRetry(job); }}>Confirm reprint</Button>
                  <Button variant="outline" onClick={() => setConfirming(null)}>Cancel</Button>
                </div>
              )
              : <Button variant="outline" onClick={() => setConfirming(job.id)}>Review uncertain job</Button>)}
          </article>
        ))}
    </section>
  );
};
