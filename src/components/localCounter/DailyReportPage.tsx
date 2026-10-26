import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { Button } from '@/components/ui/button';
import {
  exportSalesCsv, listSalesStaff, listSalesTransactions,
  type SalesFilter, type SalesPaymentMethod, type SalesStaffOption, type SalesTransaction,
} from '@/lib/localFirst/insights';
import { REPORT_SCREEN_ROWS, reportFileName, reportRange, reportTotals } from '@/lib/localFirst/dailyReport';
import { formatShopDateTime, methodText, shopDateOf } from '@/lib/localFirst/salesRange';
import { EmptyState, FormField, PageHeader, StatCard, money } from './ui';
import { OrderLink } from './InsightParts';
import type { SectionProps } from './sections';

const METHODS: SalesPaymentMethod[] = ['cash', 'upi', 'card', 'bank_transfer', 'other'];
const PAGE = 100;

/**
 * Every payment taken (and every refund) over chosen days, one row each with the order and the
 * customer, like the shop's old daily sales sheet. It can be printed or exported to a CSV file
 * that opens in Excel.
 */
export const DailyReportPage = ({ onError, onNotice, onOpenOrder }: SectionProps) => {
  const today = shopDateOf(new Date());
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [method, setMethod] = useState<SalesPaymentMethod | ''>('');
  const [staffId, setStaffId] = useState('');
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [staff, setStaff] = useState<SalesStaffOption[]>([]);
  const [rows, setRows] = useState<SalesTransaction[] | null>(null);
  const [total, setTotal] = useState(0);
  const [tick, setTick] = useState(0);
  const [exporting, setExporting] = useState(false);

  const filter = useMemo<SalesFilter | null>(() => {
    const range = reportRange(fromDate, toDate);
    return range && {
      from: range.from, to: range.to, paymentMethods: method ? [method] : [], statuses: [],
      staffId: staffId || undefined, search: search || undefined, discountedOnly: false, includeCancelled: false,
    };
  }, [fromDate, toDate, method, staffId, search]);

  useEffect(() => {
    let live = true;
    void listSalesStaff().then(options => { if (live) setStaff(options); }).catch(error => { if (live) onError(error); });
    return () => { live = false; };
  }, [onError]);

  useEffect(() => {
    if (!filter) return undefined;
    let live = true;
    setRows(null);
    const load = async () => {
      const found: SalesTransaction[] = [];
      let matched = 0;
      do {
        const page = await listSalesTransactions(filter, found.length, PAGE);
        matched = page.total;
        found.push(...page.items);
        if (page.items.length < PAGE) break;
      } while (found.length < Math.min(matched, REPORT_SCREEN_ROWS));
      if (live) { setRows(found.slice(0, REPORT_SCREEN_ROWS)); setTotal(matched); }
    };
    void load().catch(error => { if (live) onError(error); });
    return () => { live = false; };
  }, [filter, tick, onError]);

  const exportCsv = async () => {
    // The button is off while the days are wrong, so a filter is always there.
    const current = filter as SalesFilter;
    setExporting(true);
    try {
      const path = await save({ title: 'Save the sales report', defaultPath: reportFileName(fromDate, toDate), filters: [{ name: 'CSV (Excel)', extensions: ['csv'] }] });
      if (path) {
        const written = await exportSalesCsv(current, path);
        onNotice(`Saved ${written} ${written === 1 ? 'row' : 'rows'} to ${path}.`);
      }
    } catch (error) { onError(error); } finally { setExporting(false); }
  };
  const submitSearch = (event: FormEvent) => { event.preventDefault(); setSearch(searchText.trim()); };
  const totals = rows ? reportTotals(rows) : null;

  return (
    <section className="counter-page counter-report">
      <PageHeader
        title="Daily report"
        subtitle="Every payment taken, with its order and customer."
        actions={<>
          <Button variant="outline" onClick={() => setTick(current => current + 1)}>Refresh</Button>
          <Button variant="outline" disabled={!rows || rows.length === 0} onClick={() => window.print()}>Print</Button>
          <Button disabled={!filter || exporting} onClick={() => void exportCsv()}>{exporting ? 'Saving…' : 'Export to Excel (CSV)'}</Button>
        </>}
      />

      <section className="counter-panel counter-filter-bar counter-report-filters" aria-label="Report filters">
        <div className="counter-filters">
          <FormField label="From"><input type="date" value={fromDate} max={toDate} onChange={event => setFromDate(event.target.value)} /></FormField>
          <FormField label="To"><input type="date" value={toDate} min={fromDate} onChange={event => setToDate(event.target.value)} /></FormField>
          <Button type="button" variant="outline" onClick={() => { setFromDate(today); setToDate(today); }}>Today</Button>
          <FormField label="Payment mode">
            <select value={method} onChange={event => setMethod(event.target.value as SalesPaymentMethod | '')}>
              <option value="">All modes</option>
              {METHODS.map(item => <option key={item} value={item}>{methodText(item)}</option>)}
            </select>
          </FormField>
          <FormField label="Taken by">
            <select value={staffId} onChange={event => setStaffId(event.target.value)}>
              <option value="">Everyone</option>
              {staff.map(person => <option key={person.id} value={person.id}>{person.fullName}</option>)}
            </select>
          </FormField>
          <form className="counter-report-search" onSubmit={submitSearch}>
            <FormField label="Customer or bill">
              <input type="search" value={searchText} maxLength={100} placeholder="Name, phone or bill number" onChange={event => setSearchText(event.target.value)} />
            </FormField>
            <Button type="submit" variant="outline">Search</Button>
          </form>
        </div>
        {!filter && <p role="alert" className="counter-form-problem">Choose a From day on or before the To day.</p>}
      </section>

      {filter && <p className="counter-report-period">{fromDate === toDate ? `Payments on ${fromDate}` : `Payments from ${fromDate} to ${toDate}`}{method ? ` · ${methodText(method)}` : ''}{search ? ` · “${search}”` : ''}</p>}

      {totals && (
        <div className="counter-stats">
          <StatCard label="Received" value={money(totals.receivedMinor)} hint={`${totals.payments} ${totals.payments === 1 ? 'payment' : 'payments'}`} tone="good" />
          {totals.refundedMinor > 0 && <StatCard label="Refunded" value={money(totals.refundedMinor)} tone="bad" />}
          <StatCard label="Net" value={money(totals.netMinor)} />
          {totals.byMethod.map(item => <StatCard key={item.method} label={methodText(item.method)} value={money(item.netMinor)} />)}
        </div>
      )}

      {rows && rows.length < total && (
        <p className="counter-table-note">Showing the newest {rows.length} of {total} rows. Export to Excel (CSV) saves every row.</p>
      )}

      {rows && (rows.length === 0 ? <EmptyState>No payments in this period.</EmptyState> : (
        <div className="counter-panel counter-table-wrap">
          <table className="counter-table counter-report-table">
            <thead>
              <tr>
                <th scope="col">Order date</th><th scope="col">Payment date</th><th scope="col">Bill</th><th scope="col">Customer</th>
                <th scope="col">Address</th><th scope="col">Mobile</th><th scope="col" className="num">Amount</th><th scope="col">Mode</th><th scope="col">Taken by</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={`${row.id}-${row.kind}`} className={row.kind === 'refund' ? 'counter-report-refund' : ''}>
                  <td>{formatShopDateTime(row.orderReceivedAt)}</td>
                  <td>{formatShopDateTime(row.at)}</td>
                  <td><OrderLink id={row.orderId} number={row.orderNumber} onOpen={onOpenOrder} /></td>
                  <td>{row.customerName}</td>
                  <td>{row.customerAddress ?? '—'}</td>
                  <td>{row.customerPhone}</td>
                  <td className="num">{row.kind === 'refund' ? `−${money(row.amountMinor)}` : money(row.amountMinor)}
                    {row.kind === 'refund' && <span className="counter-cell-note">Refund by {row.voidedByName ?? 'unknown'}</span>}</td>
                  <td>{methodText(row.method)}{row.reference && <span className="counter-cell-note">{row.reference}</span>}</td>
                  <td>{row.staffName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
            {totals && <tfoot><tr><th scope="row" colSpan={6}>Net</th><td className="num">{money(totals.netMinor)}</td><td colSpan={2} /></tr></tfoot>}
          </table>
        </div>
      ))}
    </section>
  );
};
