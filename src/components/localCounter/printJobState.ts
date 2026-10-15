import type { CounterJobState, CounterPrintJob } from '@/lib/localFirst/counter';

/** What staff read instead of the raw job state. */
export const JOB_STATE_LABEL: Record<CounterJobState, string> = {
  pending: 'Waiting to print',
  submitting: 'Sending to printer…',
  submitted: 'Sent to printer',
  failed: 'Failed',
  uncertain: 'Check the printer',
};

/** Jobs that still need attention come first; the order inside each group is kept. */
export const unresolvedFirst = (jobs: CounterPrintJob[]): CounterPrintJob[] => {
  const settled = (job: CounterPrintJob) => (job.state === 'submitted' ? 1 : 0);
  return [...jobs].sort((a, b) => settled(a) - settled(b));
};
