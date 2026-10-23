import type { SalesBucket, SeriesPoint } from '@/lib/localFirst/insights';
import { bucketLabel, bucketTick } from '@/lib/localFirst/salesRange';
import { EmptyState, money } from './ui';

const WIDTH = 720;
const HEIGHT = 260;
const PAD = { left: 64, right: 16, top: 16, bottom: 34 };
const MAX_TICKS = 8;
const UNIT: Record<SalesBucket, string> = { hour: 'hours', day: 'days', month: 'months' };

/** Round a top value up to 1, 2 or 5 times a power of ten so the axis labels stay readable. */
const niceMax = (value: number): number => {
  const power = 10 ** Math.floor(Math.log10(value));
  const fraction = value / power;
  if (fraction <= 1) return power;
  if (fraction <= 2) return 2 * power;
  return (fraction <= 5 ? 5 : 10) * power;
};

/**
 * The value drawn on the plot. A net below zero (refunds larger than collections) is drawn on the baseline,
 * so it cannot sit under the axis labels. The true value still shows in the hover titles and the hidden table.
 */
const plotted = (minor: number): number => Math.max(0, minor);

/** Axis label such as "₹1.2K": whole rupees, compact. */
const axisMoney = (minor: number): string =>
  `₹${new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(minor / 100)}`;

/** Money taken in a bucket, less anything handed back. */
const collectedOf = (point: SeriesPoint): number => point.collectedMinor - point.refundedMinor;

/**
 * Bars for what was billed and a line for the money collected, one slot per bucket.
 * Hand-rolled SVG: the figure announces a one-line summary to screen readers and carries the same numbers
 * in a visually hidden table, and each bar has a hover title.
 */
export const SalesChart = ({ points, bucket, title }: { points: SeriesPoint[]; bucket: SalesBucket; title: string }) => {
  const collected = points.map(collectedOf);
  const peak = Math.max(0, ...points.map((point, index) => Math.max(plotted(point.netBilledMinor), plotted(collected[index]))));
  if (peak === 0) return <EmptyState>No sales or payments in this period.</EmptyState>;

  const top = niceMax(peak);
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const slot = plotWidth / points.length;
  const barWidth = Math.min(slot * 0.62, 44);
  const x = (index: number): number => PAD.left + slot * (index + 0.5);
  const y = (minor: number): number => PAD.top + plotHeight * (1 - minor / top);
  const tickEvery = Math.ceil(points.length / MAX_TICKS);
  const billedTotal = points.reduce((sum, point) => sum + point.netBilledMinor, 0);
  const collectedTotal = collected.reduce((sum, minor) => sum + minor, 0);
  const best = points.reduce((winner, point) => (point.netBilledMinor > winner.netBilledMinor ? point : winner), points[0]);
  const summary = `${title}. Billed ${money(billedTotal)} and collected ${money(collectedTotal)} `
    + `over ${points.length} ${UNIT[bucket]}. Highest billing ${money(best.netBilledMinor)} on ${bucketLabel(best.bucket, bucket)}.`;
  const collectedLine = points.map((_, index) => `${x(index)},${y(plotted(collected[index]))}`).join(' ');

  return (
    <figure className="counter-chart">
      <svg role="img" aria-label={summary} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="counter-chart-svg">
        {[0, 0.5, 1].map(fraction => (
          <g key={fraction}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(top * fraction)} y2={y(top * fraction)} className="counter-chart-grid" />
            <text x={PAD.left - 8} y={y(top * fraction) + 4} textAnchor="end" className="counter-chart-axis">{axisMoney(top * fraction)}</text>
          </g>
        ))}
        {points.map((point, index) => (
          <rect key={point.bucket} x={x(index) - barWidth / 2} y={y(point.netBilledMinor)} width={barWidth}
            height={PAD.top + plotHeight - y(point.netBilledMinor)} rx={3} className="counter-chart-bar">
            <title>{`${bucketLabel(point.bucket, bucket)}: billed ${money(point.netBilledMinor)}, collected ${money(collected[index])}`}</title>
          </rect>
        ))}
        <polyline points={collectedLine} className="counter-chart-line" fill="none" />
        {points.map((point, index) => <circle key={point.bucket} cx={x(index)} cy={y(plotted(collected[index]))} r={3} className="counter-chart-dot" />)}
        {points.map((point, index) => index % tickEvery === 0 && (
          <text key={point.bucket} x={x(index)} y={HEIGHT - 12} textAnchor="middle" className="counter-chart-axis">{bucketTick(point.bucket, bucket)}</text>
        ))}
      </svg>
      <figcaption className="counter-chart-legend">
        <span><i className="counter-chart-key bar" />Billed</span>
        <span><i className="counter-chart-key line" />Collected</span>
      </figcaption>
      <table className="counter-visually-hidden">
        <caption>{title}</caption>
        <thead><tr><th scope="col">Period</th><th scope="col">Orders</th><th scope="col">Billed</th><th scope="col">Collected</th></tr></thead>
        <tbody>
          {points.map((point, index) => (
            <tr key={point.bucket}>
              <th scope="row">{bucketLabel(point.bucket, bucket)}</th><td>{point.orders}</td>
              <td>{money(point.netBilledMinor)}</td><td>{money(collected[index])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
};
