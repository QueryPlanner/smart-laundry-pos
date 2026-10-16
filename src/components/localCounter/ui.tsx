import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Shared building blocks for every screen of the counter workspace, so the dashboard,
 * back-office pages and order flow share one look. Styling lives in `index.css` under
 * the `counter-page` / `counter-stat` / `counter-table` / `counter-filters` classes.
 */

const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

/** Formats whole paise as rupees, e.g. 123456 → "₹1,234.56". */
// eslint-disable-next-line react-refresh/only-export-components -- a pure helper shared by every page
export const money = (minor: number): string => rupees.format(minor / 100);

/** "1 piece" / "3 pieces": regular plurals only. */
// eslint-disable-next-line react-refresh/only-export-components -- a pure helper shared by every page
export const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

export const PageHeader = ({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) => (
  <div className="counter-page-head">
    <div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
    {actions && <div className="counter-page-actions">{actions}</div>}
  </div>
);

export type StatTone = 'neutral' | 'good' | 'warn' | 'bad';

export const StatCard = ({ label, value, hint, tone = 'neutral' }: { label: string; value: ReactNode; hint?: string; tone?: StatTone }) => (
  <div className={`counter-stat ${tone}`}>
    <span className="counter-section-label">{label}</span>
    <strong>{value}</strong>
    {hint && <small>{hint}</small>}
  </div>
);

export const EmptyState = ({ children }: { children: ReactNode }) => <p className="counter-empty-state">{children}</p>;

/** A labelled form control: pass the input (or select) as the child. */
export const FormField = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <label className="counter-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
);

const REASON_MIN = 3;
const REASON_MAX = 200;

/**
 * Admin-only "delete this record": the reason is written to the audit trail and a second,
 * explicit tap confirms. The native command still checks the role, so showing this to a
 * non-admin would only ever produce an error; callers render it for admins only.
 */
export const ConfirmDelete = ({ what, busy = false, onConfirm }: { what: string; busy?: boolean; onConfirm: (reason: string) => Promise<void> }) => {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState('');
  const [working, setWorking] = useState(false);
  if (!open) return <Button variant="outline" size="sm" className="counter-danger-button" onClick={() => setOpen(true)}>Delete</Button>;
  const confirm = async () => {
    const trimmed = reason.trim();
    if (trimmed.length < REASON_MIN || trimmed.length > REASON_MAX) {
      setProblem(`Enter a reason of ${REASON_MIN} to ${REASON_MAX} characters.`);
      return;
    }
    setProblem('');
    // A second tap while the first delete is still running would only report "not found".
    setWorking(true);
    try { await onConfirm(trimmed); } finally { setWorking(false); }
  };
  return (
    <div className="counter-confirm-delete" role="group" aria-label={`Delete ${what}`}>
      <p>Delete {what}? This is recorded in the audit trail.</p>
      <Label>Reason<Input value={reason} maxLength={REASON_MAX} onChange={event => setReason(event.target.value)} /></Label>
      {problem && <p role="alert">{problem}</p>}
      <div className="counter-confirm-actions">
        <Button variant="destructive" size="sm" disabled={busy || working} onClick={() => void confirm()}>Confirm delete</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => { setOpen(false); setReason(''); setProblem(''); }}>Keep</Button>
      </div>
    </div>
  );
};
