import { useEffect, useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { Button } from '@/components/ui/button';
import {
  dailyReportFileName, exportDailyReportCsv, getDailyReport, SCREEN_ROW_LIMIT,
  type DailyReport,
} from '@/lib/localFirst/dailyReport';
import { EmptyState, PageHeader, money } from './ui';
import type { SectionProps } from './sections';

const COLUMNS = [
  'Shop date', 'Bill number', 'Billed today', 'Cash received', 'UPI received', 'Other received', 'Refunds', 'Net received',
];

/**
 * The whole shop's day in IST: one row per bill with activity, the money split by how it was
 * received and refunds shown separately. Any signed-in operator sees every staff member's work.
 * The screen shows the first rows; Export CSV writes the whole snapshot through the save dialog.
 */
export const DailyReportPage = ({ onError, onNotice }: SectionProps) => {
  const [report, setReport] = useState<DailyReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    void getDailyReport().then(fresh => { if (live) setReport(fresh); }).catch(error => { if (live) onError(error); });
    return () => { live = false; };
  }, [tick, onError]);

  const exportCsv = async () => {
    setBusy(true);
    try {
      // Read the current shop day before choosing a file: a page left open overnight must not
      // export yesterday's rows under today's name.
      const fresh = await getDailyReport();
      setReport(fresh);
      const path = await save({
        title: 'Save the daily report',
        defaultPath: dailyReportFileName(fresh.shopDate),
        filters: [{ name: 'CSV (Excel)', extensions: ['csv'] }],
      });
      if (!path) return;
      const saved = await exportDailyReportCsv(path);
      setReport(saved);
      onNotice(`Saved ${path}.`);
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };

  const shown = report ? report.rows.slice(0, SCREEN_ROW_LIMIT) : [];
  return (
    <section className="counter-page">
      <PageHeader
        title="Daily report"
        subtitle="All staff's qualifying activity for the current shop day (IST)."
        actions={report && <>
          <Button variant="outline" onClick={() => setTick(current => current + 1)}>Refresh</Button>
          <Button disabled={busy} onClick={() => void exportCsv()}>Export CSV</Button>
        </>}
      />

      {!report ? <p>Loading...</p> : (
        <>
          <p className="counter-table-note">Shop date: <strong>{report.shopDate}</strong></p>
          {report.rows.length > SCREEN_ROW_LIMIT && (
            <p className="counter-table-note">
              Showing the first {SCREEN_ROW_LIMIT} of {report.rows.length} bills. Export CSV saves every bill.
            </p>
          )}
          <div className="counter-panel counter-table-wrap">
            <table className="counter-table">
              <thead>
                <tr>{COLUMNS.map(column => <th key={column} scope="col" className={column === 'Shop date' || column === 'Bill number' ? undefined : 'num'}>{column}</th>)}</tr>
              </thead>
              <tbody>
                {shown.length === 0
                  ? <tr><td colSpan={COLUMNS.length}><EmptyState>No activity on this shop day.</EmptyState></td></tr>
                  : shown.map(row => (
                    <tr key={row.billNumber}>
                      <td>{report.shopDate}</td>
                      <td>{row.billNumber}</td>
                      <td className="num">{money(row.billedMinor)}</td>
                      <td className="num">{money(row.cashMinor)}</td>
                      <td className="num">{money(row.upiMinor)}</td>
                      <td className="num">{money(row.otherMinor)}</td>
                      <td className="num">{money(row.refundedMinor)}</td>
                      <td className="num">{money(row.netMinor)}</td>
                    </tr>
                  ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">{report.shopDate}</th>
                  <th scope="row">TOTAL</th>
                  <td className="num">{money(report.totals.billedMinor)}</td>
                  <td className="num">{money(report.totals.cashMinor)}</td>
                  <td className="num">{money(report.totals.upiMinor)}</td>
                  <td className="num">{money(report.totals.otherMinor)}</td>
                  <td className="num">{money(report.totals.refundedMinor)}</td>
                  <td className="num">{money(report.totals.netMinor)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </section>
  );
};
