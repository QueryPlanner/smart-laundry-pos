import { describe, expect, it } from 'vitest';
import { transactionOf } from '@/components/localCounter/insightFixtures';
import { reportFileName, reportRange, reportTotals } from './dailyReport';

describe('daily report helpers', () => {
  it('turns days into a whole-day period, both days included', () => {
    expect(reportRange('2026-10-26', '2026-10-26')).toEqual({ from: '2026-10-26T00:00', to: '2026-10-27T00:00' });
    expect(reportRange('2026-10-01', '2026-10-31')).toEqual({ from: '2026-10-01T00:00', to: '2026-11-01T00:00' });
    expect(reportRange('2026-10-27', '2026-10-26')).toBeNull();
    expect(reportRange('', '2026-10-26')).toBeNull();
    expect(reportRange('2026-10-26', '')).toBeNull();
  });

  it('adds up received, refunded and kept money, by mode, largest first', () => {
    const totals = reportTotals([
      transactionOf({ id: 'a', amountMinor: 68600, method: 'cash' }),
      transactionOf({ id: 'b', amountMinor: 32300, method: 'upi' }),
      transactionOf({ id: 'c', amountMinor: 6900, method: 'cash' }),
      transactionOf({ id: 'c', kind: 'refund', amountMinor: 6900, method: 'cash' }),
      transactionOf({ id: 'd', amountMinor: 32300, method: 'card' }),
    ]);
    expect(totals).toEqual({
      receivedMinor: 140100, refundedMinor: 6900, netMinor: 133200, payments: 4,
      byMethod: [{ method: 'cash', netMinor: 68600 }, { method: 'card', netMinor: 32300 }, { method: 'upi', netMinor: 32300 }],
    });
    expect(reportTotals([])).toEqual({ receivedMinor: 0, refundedMinor: 0, netMinor: 0, payments: 0, byMethod: [] });
  });

  it('suggests a file name for one day or a period', () => {
    expect(reportFileName('2026-10-26', '2026-10-26')).toBe('sales-2026-10-26.csv');
    expect(reportFileName('2026-10-01', '2026-10-26')).toBe('sales-2026-10-01-to-2026-10-26.csv');
  });
});
