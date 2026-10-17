import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  getDashboardOverview, getSalesSeries, netByKind, type AttentionOrder, type DashboardOverview, type SalesSeries,
} from '@/lib/localFirst/insights';
import { formatDay, formatShopDateTime, lastDaysRange } from '@/lib/localFirst/salesRange';
import { EmptyState, PageHeader, StatCard, count, money } from './ui';
import { OrderLink, StatusBadge } from './InsightParts';
import { SalesChart } from './SalesChart';
import type { SectionProps } from './sections';

const GRAPH_DAYS = 14;
const dayText = (days: number): string => (days === 1 ? '1 day' : `${days} days`);
/** What is still owed on an order: the balance in rupees, or "Paid". Text, so it never relies on colour. */
const toPayText = (order: AttentionOrder): string => (order.balanceMinor > 0 ? money(order.balanceMinor) : 'Paid');

const AttentionTable = ({ orders, onOpenOrder, ready }: { orders: AttentionOrder[]; onOpenOrder: (id: string) => void; ready: boolean }) => (
  <div className="counter-table-wrap">
    <table className="counter-table">
      <thead>
        <tr>
          <th>Bill</th><th>Customer</th><th>{ready ? 'Waiting' : 'Stage'}</th>
          {!ready && <th>Promised</th>}
          <th className="num">To pay</th>
        </tr>
      </thead>
      <tbody>
        {orders.map(order => (
          <tr key={order.id}>
            <td><OrderLink id={order.id} number={order.orderNumber} onOpen={onOpenOrder} /></td>
            <td>{order.customerName}<span className="counter-cell-note">{order.pieceCount} pieces</span></td>
            <td>{ready ? dayText(order.daysWaiting) : <StatusBadge status={order.status} />}</td>
            {!ready && (
              <td>{formatShopDateTime(order.promisedAt)}{order.overdue && <span className="counter-badge bad counter-inline-badge">Overdue</span>}</td>
            )}
            <td className="num">{toPayText(order)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/** Today at a glance: the day's and month's figures, a 14-day graph, what needs attention, recent orders. */
export const DashboardPage = ({ onError, onOpenOrder }: SectionProps) => {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [series, setSeries] = useState<SalesSeries | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    void (async () => {
      const loaded = await getDashboardOverview();
      const graph = await getSalesSeries(lastDaysRange(loaded.todayDate, GRAPH_DAYS), 'day');
      if (live) { setOverview(loaded); setSeries(graph); }
    })().catch(error => { if (live) onError(error); });
    return () => { live = false; };
  }, [tick, onError]);

  if (!overview || !series) return <section className="counter-page"><PageHeader title="Dashboard" subtitle="Loading..." /></section>;

  const { today, monthToDate, queue, receivable, readyWaiting, inProcess } = overview;
  const profit = monthToDate.profitMinor ?? monthToDate.netCollectedMinor - monthToDate.expensesMinor;
  const todayKinds = netByKind(today);
  const monthKinds = netByKind(monthToDate);
  const owed = receivable.minor > 0;
  return (
    <section className="counter-page">
      <PageHeader
        title="Dashboard"
        subtitle={`Figures for today, ${formatDay(overview.todayDate)}, and the month so far.`}
        actions={<Button variant="outline" onClick={() => setTick(current => current + 1)}>Refresh</Button>}
      />

      <h2 className="counter-subhead">Today</h2>
      <div className="counter-stats">
        <StatCard label="Orders" value={today.orders} hint={`${today.pieces} pieces`} />
        <StatCard label="Billed" value={money(today.netBilledMinor)} hint={today.discountMinor > 0 ? `${money(today.discountMinor)} discount given` : undefined} />
        <StatCard label="Advance collected" value={money(todayKinds.advanceMinor)} hint="Taken when the order was booked" />
        <StatCard label="Balance received" value={money(todayKinds.balanceMinor)} hint="Taken at or after pickup" />
        <StatCard label="Collected" value={money(today.netCollectedMinor)} hint={today.refundedMinor > 0 ? `After ${money(today.refundedMinor)} refunded` : undefined} tone="good" />
        <StatCard
          label="To collect"
          value={money(receivable.minor)}
          hint={owed ? `${count(receivable.orders, 'order')} with a balance` : 'Nothing owed'}
          tone={owed ? 'warn' : 'neutral'}
        />
        <StatCard label="Ready to collect" value={queue.ready} hint="Waiting at the counter" tone={queue.ready > 0 ? 'good' : 'neutral'} />
        <StatCard label="In process" value={queue.received + queue.inProcess} hint={`${queue.received} not started`} />
        <StatCard label="Low stock" value={overview.lowStockCount} hint="Inventory items at or below minimum" tone={overview.lowStockCount > 0 ? 'warn' : 'neutral'} />
      </div>

      <h2 className="counter-subhead">This month</h2>
      <div className="counter-stats">
        <StatCard label="Orders" value={monthToDate.orders} hint={`${monthToDate.pieces} pieces`} />
        <StatCard label="Billed" value={money(monthToDate.netBilledMinor)} />
        <StatCard label="Advance collected" value={money(monthKinds.advanceMinor)} />
        <StatCard label="Balance received" value={money(monthKinds.balanceMinor)} />
        <StatCard label="Collected" value={money(monthToDate.netCollectedMinor)} tone="good" />
        <StatCard label="Expenses" value={money(monthToDate.expensesMinor)} />
        <StatCard
          label="Profit"
          value={money(profit)}
          hint="Collected minus expenses"
          tone={profit < 0 ? 'bad' : 'good'}
        />
      </div>

      <section className="counter-panel">
        <h2 className="counter-subhead">Last {GRAPH_DAYS} days</h2>
        <SalesChart points={series.points} bucket="day" title={`Sales for the last ${GRAPH_DAYS} days`} />
      </section>

      <div className="counter-columns">
        <section className="counter-panel">
          <h2 className="counter-subhead">Ready and waiting over 2 days</h2>
          {readyWaiting.orders.length === 0
            ? <EmptyState>Nothing has been waiting for pickup for more than 2 days.</EmptyState>
            : <AttentionTable orders={readyWaiting.orders} onOpenOrder={onOpenOrder} ready />}
          {readyWaiting.total > readyWaiting.orders.length && (
            <p className="counter-table-note">Showing {readyWaiting.orders.length} of {readyWaiting.total}.</p>
          )}
        </section>
        <section className="counter-panel">
          <h2 className="counter-subhead">In process</h2>
          {inProcess.orders.length === 0
            ? <EmptyState>No orders are being processed.</EmptyState>
            : <AttentionTable orders={inProcess.orders} onOpenOrder={onOpenOrder} ready={false} />}
          {inProcess.total > inProcess.orders.length && (
            <p className="counter-table-note">Showing {inProcess.orders.length} of {inProcess.total}, soonest promise first.</p>
          )}
        </section>
      </div>

      <section className="counter-panel">
        <h2 className="counter-subhead">Recent orders</h2>
        {overview.recentOrders.length === 0 ? <EmptyState>No orders yet.</EmptyState> : (
          <div className="counter-table-wrap">
            <table className="counter-table">
              <thead><tr><th>Bill</th><th>Created</th><th>Customer</th><th>Status</th><th className="num">Total</th></tr></thead>
              <tbody>
                {overview.recentOrders.map(order => (
                  <tr key={order.id}>
                    <td><OrderLink id={order.id} number={order.orderNumber} onOpen={onOpenOrder} /></td>
                    <td>{formatShopDateTime(order.receivedAt)}</td>
                    <td>{order.customerName}<span className="counter-cell-note">{order.customerPhone}</span></td>
                    <td><StatusBadge status={order.status} /></td>
                    <td className="num">{money(order.totalMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
};
