import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  getSalesSeries, getSalesSummary, listSalesOrders, listSalesStaff, listSalesTransactions, netByKind,
  type SalesBucket, type SalesFilter, type SalesOrderRow, type SalesOrderStatus, type SalesPage as Page,
  type SalesPaymentMethod, type SalesSeries, type SalesStaffOption, type SalesSummary, type SalesTransaction,
} from '@/lib/localFirst/insights';
import {
  allowedBuckets, autoBucket, formatLocal, formatShopDateTime, joinLocal, methodText, presetRange, rangeProblem,
  splitLocal, statusText, type LocalRange, type SalesPreset,
} from '@/lib/localFirst/salesRange';
import { EmptyState, FormField, PageHeader, StatCard, count, money } from './ui';
import { OrderLink, StatusBadge } from './InsightParts';
import { SalesChart } from './SalesChart';
import type { SectionProps } from './sections';

const PAGE_SIZE = 25;
const PRESETS: Array<{ id: SalesPreset; label: string }> = [
  { id: 'today', label: 'Today' }, { id: 'yesterday', label: 'Yesterday' }, { id: 'last7', label: 'Last 7 days' },
  { id: 'month', label: 'This month' }, { id: 'custom', label: 'Custom' },
];
const METHODS: SalesPaymentMethod[] = ['cash', 'upi', 'card', 'bank_transfer', 'other'];
/** The status chips group the five working stages into one. */
const STATUS_GROUPS: Array<{ id: string; label: string; statuses: SalesOrderStatus[] }> = [
  { id: 'received', label: 'Received', statuses: ['received'] },
  { id: 'process', label: 'In process', statuses: ['washing', 'drying', 'ironing', 'quality_check', 'packing'] },
  { id: 'ready', label: 'Ready', statuses: ['ready'] },
  { id: 'collected', label: 'Collected', statuses: ['collected'] },
];
const BUCKET_LABEL: Record<SalesBucket, string> = { hour: 'Hourly', day: 'Daily', month: 'Monthly' };

type Tab = 'orders' | 'transactions';
/** The four date and time inputs, kept as typed so a half-edited value never corrupts the other edge. */
interface Edges { fromDate: string; fromTime: string; toDate: string; toTime: string }
const edgesOf = (range: LocalRange): Edges => ({
  fromDate: splitLocal(range.from).date, fromTime: splitLocal(range.from).time,
  toDate: splitLocal(range.to).date, toTime: splitLocal(range.to).time,
});

const toggled = <T,>(list: T[], value: T): T[] => (list.includes(value) ? list.filter(item => item !== value) : [...list, value]);

const Pager = ({ offset, total, onPage }: { offset: number; total: number; onPage: (offset: number) => void }) => (
  <div className="counter-pager">
    <span>{`Showing ${offset + 1} to ${Math.min(offset + PAGE_SIZE, total)} of ${total}`}</span>
    <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - PAGE_SIZE))}>Previous</Button>
    <Button variant="outline" size="sm" disabled={offset + PAGE_SIZE >= total} onClick={() => onPage(offset + PAGE_SIZE)}>Next</Button>
  </div>
);

const Breakdown = ({ title, empty, rows }: { title: string; empty: string; rows: Array<{ key: string; name: string; detail: string; value: string }> }) => (
  <section className="counter-panel" aria-label={title}>
    <span className="counter-section-label">{title}</span>
    {rows.length === 0 ? <EmptyState>{empty}</EmptyState> : (
      <table className="counter-table">
        <tbody>
          {rows.map(row => (
            <tr key={row.key}><td>{row.name}<span className="counter-cell-note">{row.detail}</span></td><td className="num">{row.value}</td></tr>
          ))}
        </tbody>
      </table>
    )}
  </section>
);

/**
 * Sales query for staff and administrators alike: pick a period and filters, see the figures,
 * the graph, the orders and every payment and refund behind them.
 */
export const SalesPage = ({ onError, onOpenOrder }: SectionProps) => {
  const [preset, setPreset] = useState<SalesPreset>('today');
  const [edges, setEdges] = useState<Edges>(() => edgesOf(presetRange('today', new Date())));
  const [methods, setMethods] = useState<SalesPaymentMethod[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [staffId, setStaffId] = useState('');
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [discountedOnly, setDiscountedOnly] = useState(false);
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [tick, setTick] = useState(0);
  const [bucketChoice, setBucketChoice] = useState<SalesBucket | null>(null);
  const [tab, setTab] = useState<Tab>('orders');
  const [offset, setOffset] = useState(0);
  const [staff, setStaff] = useState<SalesStaffOption[]>([]);
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [series, setSeries] = useState<SalesSeries | null>(null);
  const [orders, setOrders] = useState<Page<SalesOrderRow> | null>(null);
  const [transactions, setTransactions] = useState<Page<SalesTransaction> | null>(null);

  const range = useMemo<LocalRange>(
    () => ({ from: joinLocal(edges.fromDate, edges.fromTime), to: joinLocal(edges.toDate, edges.toTime) }),
    [edges],
  );
  const problem = rangeProblem(range);
  const buckets = problem ? [] : allowedBuckets(range);
  const bucket = bucketChoice && buckets.includes(bucketChoice) ? bucketChoice : autoBucket(range);

  const filter = useMemo<SalesFilter>(() => ({
    from: range.from,
    to: range.to,
    paymentMethods: methods,
    statuses: STATUS_GROUPS.filter(group => groups.includes(group.id)).flatMap(group => group.statuses),
    staffId: staffId || undefined,
    search: search || undefined,
    discountedOnly,
    includeCancelled,
  }), [range, methods, groups, staffId, search, discountedOnly, includeCancelled]);

  useEffect(() => {
    let live = true;
    void listSalesStaff().then(options => { if (live) setStaff(options); }).catch(error => { if (live) onError(error); });
    return () => { live = false; };
  }, [onError]);

  useEffect(() => {
    if (problem) return undefined;
    let live = true;
    void Promise.all([getSalesSummary(filter), getSalesSeries(filter, bucket)]).then(([nextSummary, nextSeries]) => {
      if (live) { setSummary(nextSummary); setSeries(nextSeries); }
    }).catch(error => { if (live) onError(error); });
    return () => { live = false; };
  }, [filter, bucket, problem, tick, onError]);

  useEffect(() => {
    if (problem) return undefined;
    let live = true;
    const load = tab === 'orders'
      ? listSalesOrders(filter, offset, PAGE_SIZE).then(page => { if (live) setOrders(page); })
      : listSalesTransactions(filter, offset, PAGE_SIZE).then(page => { if (live) setTransactions(page); });
    void load.catch(error => { if (live) onError(error); });
    return () => { live = false; };
  }, [filter, tab, offset, problem, tick, onError]);

  /** Any change to the question starts the answer again from the first page. */
  const ask = (change: () => void) => { change(); setOffset(0); };
  const choosePreset = (next: SalesPreset) => ask(() => {
    setPreset(next);
    if (next !== 'custom') setEdges(edgesOf(presetRange(next, new Date())));
  });
  const editEdge = (edge: keyof Edges, value: string) => ask(() => setEdges({ ...edges, [edge]: value }));
  /** Re-run the question; a preset like Today is re-read so a page left open overnight moves on. */
  const refresh = () => {
    if (preset !== 'custom') setEdges(edgesOf(presetRange(preset, new Date())));
    setTick(current => current + 1);
  };
  const submitSearch = (event: FormEvent) => { event.preventDefault(); ask(() => setSearch(searchText.trim())); };

  const active = summary && series && !problem;
  return (
    <section className="counter-page">
      <PageHeader title="Sales" subtitle="Staff and administrators see the same figures." actions={<Button variant="outline" onClick={refresh}>Refresh</Button>} />

      <section className="counter-panel counter-filter-bar" aria-label="Sales filters">
        <div className="counter-chips" role="group" aria-label="Period">
          {PRESETS.map(item => (
            <button key={item.id} type="button" className={preset === item.id ? 'selected' : ''} aria-pressed={preset === item.id} onClick={() => choosePreset(item.id)}>{item.label}</button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="counter-filters">
            <FormField label="From date"><input type="date" value={edges.fromDate} onChange={event => editEdge('fromDate', event.target.value)} /></FormField>
            <FormField label="From time"><input type="time" value={edges.fromTime} onChange={event => editEdge('fromTime', event.target.value)} /></FormField>
            <FormField label="To date" hint="Up to, not including"><input type="date" value={edges.toDate} onChange={event => editEdge('toDate', event.target.value)} /></FormField>
            <FormField label="To time"><input type="time" value={edges.toTime} onChange={event => editEdge('toTime', event.target.value)} /></FormField>
          </div>
        )}
        {problem
          ? <p role="alert" className="counter-form-problem">{problem}</p>
          : <p className="counter-table-note">Period: {formatLocal(range.from)} up to, not including, {formatLocal(range.to)} (shop time).</p>}

        <div className="counter-filters">
          <div className="counter-field">
            <span>Payment method</span>
            <div className="counter-chips" role="group" aria-label="Payment method">
              {METHODS.map(method => (
                <button key={method} type="button" className={methods.includes(method) ? 'selected' : ''} aria-pressed={methods.includes(method)} onClick={() => ask(() => setMethods(toggled(methods, method)))}>{methodText(method)}</button>
              ))}
            </div>
          </div>
          <div className="counter-field">
            <span>Order status</span>
            <div className="counter-chips" role="group" aria-label="Order status">
              {STATUS_GROUPS.map(group => (
                <button key={group.id} type="button" className={groups.includes(group.id) ? 'selected' : ''} aria-pressed={groups.includes(group.id)} onClick={() => ask(() => setGroups(toggled(groups, group.id)))}>{group.label}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="counter-filters">
          <FormField label="Staff" hint="Orders by who created them; money by who took the payment.">
            <select value={staffId} onChange={event => ask(() => setStaffId(event.target.value))}>
              <option value="">All staff</option>
              {staff.map(person => <option key={person.id} value={person.id}>{person.fullName}</option>)}
            </select>
          </FormField>
          <form className="counter-filters" onSubmit={submitSearch}>
            <FormField label="Search" hint="Bill number, customer name or phone">
              <input type="search" value={searchText} maxLength={100} onChange={event => setSearchText(event.target.value)} />
            </FormField>
            <Button type="submit" variant="outline">Search</Button>
          </form>
          <label className="counter-check"><input type="checkbox" checked={discountedOnly} onChange={event => ask(() => setDiscountedOnly(event.target.checked))} />Discounted orders only</label>
          <label className="counter-check"><input type="checkbox" checked={includeCancelled} onChange={event => ask(() => setIncludeCancelled(event.target.checked))} />Include cancelled orders</label>
        </div>
      </section>

      {active && (
        <>
          <div className="counter-stats">
            <StatCard label="Orders" value={summary.orders} hint={count(summary.pieces, 'piece')} />
            <StatCard label="Before discount" value={money(summary.grossMinor)} />
            <StatCard label="Discounts" value={money(summary.discountMinor)} />
            <StatCard label="Billed" value={money(summary.netBilledMinor)} hint={`Average ${money(summary.averageOrderMinor)} per order`} />
            <StatCard label="Advance collected" value={money(netByKind(summary).advanceMinor)} hint="Taken when booked, after refunds" />
            <StatCard label="Balance received" value={money(netByKind(summary).balanceMinor)} hint="Taken at pickup, after refunds" />
            <StatCard label="Collected" value={money(summary.collectedMinor)} hint="Payments taken" />
            <StatCard label="Refunded" value={money(summary.refundedMinor)} hint="Handed back" tone={summary.refundedMinor > 0 ? 'warn' : 'neutral'} />
            <StatCard label="Net collected" value={money(summary.netCollectedMinor)} tone="good" />
            <StatCard label="Cancelled" value={summary.cancelledCount} hint={`${money(summary.cancelledMinor)} worth`} />
            <StatCard label="Expenses" value={money(summary.expensesMinor)} hint="By day of the expense" />
            <StatCard
              label="Profit"
              value={summary.profitMinor === null ? '—' : money(summary.profitMinor)}
              hint={summary.profitMinor === null ? 'Not shown while filters are on' : 'Net collected minus expenses'}
              tone={summary.profitMinor !== null && summary.profitMinor < 0 ? 'bad' : 'neutral'}
            />
          </div>
          <ul className="counter-hints">
            <li>Billed counts orders created in the period; cancelled orders are left out unless you include them. Collected counts payments taken in the period, and a refund counts on the day the money was handed back.</li>
            <li>Advance is the part paid when the order is booked; balance is what is paid at or after pickup.</li>
            <li>The staff filter follows who created each order, but for money it follows who took the payment.</li>
            <li>Expenses are kept by day, so any expense dated on a day the period touches is included.</li>
          </ul>

          <section className="counter-panel">
            <div className="counter-chart-head">
              <h2 className="counter-subhead">Sales graph</h2>
              <div className="counter-chips" role="group" aria-label="Graph detail">
                {buckets.map(option => (
                  <button key={option} type="button" className={bucket === option ? 'selected' : ''} aria-pressed={bucket === option} onClick={() => setBucketChoice(option)}>{BUCKET_LABEL[option]}</button>
                ))}
              </div>
            </div>
            <SalesChart points={series.points} bucket={series.bucket} title={`${BUCKET_LABEL[series.bucket]} sales`} />
          </section>

          <div className="counter-breakdowns">
            <Breakdown
              title="By payment method" empty="No payments."
              rows={summary.byMethod.map(item => ({
                key: item.method, name: methodText(item.method), detail: count(item.payments, 'payment'),
                value: item.refundedMinor > 0 ? `${money(item.collectedMinor)} (${money(item.refundedMinor)} back)` : money(item.collectedMinor),
              }))}
            />
            <Breakdown
              title="By staff" empty="No staff activity."
              rows={summary.byStaff.map(item => ({
                key: item.staffId, name: item.name ?? 'Former account', detail: `${count(item.orders, 'order')}, ${money(item.netBilledMinor)} billed`,
                value: money(item.collectedMinor - item.refundedMinor),
              }))}
            />
            <Breakdown
              title="By service" empty="No orders."
              rows={summary.byService.map(item => ({ key: item.service, name: item.service, detail: `${count(item.pieces, 'piece')}, before discount`, value: money(item.amountMinor) }))}
            />
            <Breakdown
              title="By order status" empty="No orders."
              rows={summary.byStatus.map(item => ({ key: item.status, name: statusText(item.status), detail: count(item.orders, 'order'), value: money(item.netBilledMinor) }))}
            />
          </div>
        </>
      )}

      <section className="counter-panel">
        <div className="counter-tabs" role="tablist" aria-label="Sales detail">
          <button type="button" role="tab" aria-selected={tab === 'orders'} className={tab === 'orders' ? 'selected' : ''} onClick={() => ask(() => setTab('orders'))}>Orders</button>
          <button type="button" role="tab" aria-selected={tab === 'transactions'} className={tab === 'transactions' ? 'selected' : ''} onClick={() => ask(() => setTab('transactions'))}>Transactions</button>
        </div>
        {!problem && tab === 'orders' && orders && (orders.total === 0 ? <EmptyState>No orders match.</EmptyState> : (
          <>
            <div className="counter-table-wrap">
              <table className="counter-table">
                <thead><tr><th>Bill</th><th>Created</th><th>Customer</th><th>Status</th><th className="num">Pieces</th><th className="num">Total</th><th className="num">Paid</th><th className="num">Balance</th><th>Paid by</th><th>Created by</th></tr></thead>
                <tbody>
                  {orders.items.map(order => (
                    <tr key={order.id}>
                      <td><OrderLink id={order.id} number={order.orderNumber} onOpen={onOpenOrder} /></td>
                      <td>{formatShopDateTime(order.receivedAt)}</td>
                      <td>{order.customerName}<span className="counter-cell-note">{order.customerPhone}</span></td>
                      <td>
                        <StatusBadge status={order.status} />
                        {order.cancelledAt && <span className="counter-cell-note">Cancelled {formatShopDateTime(order.cancelledAt)}</span>}
                      </td>
                      <td className="num">{order.pieceCount}</td>
                      <td className="num">{money(order.totalMinor)}{order.discountMinor > 0 && <span className="counter-cell-note">{money(order.discountMinor)} off</span>}</td>
                      <td className="num">{money(order.paidMinor)}</td>
                      <td className="num">{money(order.balanceMinor)}</td>
                      <td>{order.methods.length === 0 ? '—' : order.methods.map(methodText).join(', ')}</td>
                      <td>{order.staffName ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager offset={offset} total={orders.total} onPage={setOffset} />
          </>
        ))}
        {!problem && tab === 'transactions' && transactions && (transactions.total === 0 ? <EmptyState>No payments or refunds match.</EmptyState> : (
          <>
            <div className="counter-table-wrap">
              <table className="counter-table">
                <thead><tr><th>When</th><th>Type</th><th>Bill</th><th>Customer</th><th>Method</th><th className="num">Amount</th><th>Taken by</th></tr></thead>
                <tbody>
                  {transactions.items.map(item => (
                    <tr key={`${item.id}-${item.kind}`}>
                      <td>{formatShopDateTime(item.at)}</td>
                      <td><span className={`counter-badge ${item.kind === 'refund' ? 'bad' : 'good'}`}>{item.kind === 'refund' ? 'Refund' : 'Payment'}</span></td>
                      <td><OrderLink id={item.orderId} number={item.orderNumber} onOpen={onOpenOrder} /></td>
                      <td>{item.customerName}<span className="counter-cell-note">{item.customerPhone}</span></td>
                      <td>{methodText(item.method)}{item.reference && <span className="counter-cell-note">Ref {item.reference}</span>}</td>
                      <td className="num">
                        {item.kind === 'refund' ? `−${money(item.amountMinor)}` : money(item.amountMinor)}
                        {item.kind === 'refund' && <span className="counter-cell-note">By {item.voidedByName ?? 'unknown'}{item.voidReason ? `: ${item.voidReason}` : ''}</span>}
                      </td>
                      <td>{item.staffName ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager offset={offset} total={transactions.total} onPage={setOffset} />
          </>
        ))}
      </section>
    </section>
  );
};
