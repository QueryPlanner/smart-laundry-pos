// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { SalesChart } from './SalesChart';
import { pointOf } from './insightFixtures';
import { money } from './ui';

afterEach(cleanup);

/** The text of each cell and header in a table row, in order. */
const cellsOf = (row: Element): string[] => [...row.querySelectorAll('th, td')].map(cell => cell.textContent ?? '');

describe('SalesChart', () => {
  it('says there is nothing to chart instead of drawing flat bars', () => {
    render(<SalesChart points={[pointOf('2026-03-05', 0), pointOf('2026-03-06', 0)]} bucket="day" title="Daily sales" />);
    expect(screen.getByText('No sales or payments in this period.')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('also handles a graph with no points at all', () => {
    render(<SalesChart points={[]} bucket="day" title="Daily sales" />);
    expect(screen.getByText('No sales or payments in this period.')).toBeTruthy();
  });

  it('announces the billed and collected totals and carries every number in a hidden table', () => {
    const points = [
      pointOf('2026-03-05', 10000, { advanceCollectedMinor: 6000, balanceCollectedMinor: 2000, balanceRefundedMinor: 500 }),
      pointOf('2026-03-06', 30000, { balanceCollectedMinor: 25000, advanceRefundedMinor: 1000 }),
      pointOf('2026-03-07', 0),
    ];
    render(<SalesChart points={points} bucket="day" title="Sales for the last 3 days" />);
    const chart = screen.getByRole('img');
    const label = chart.getAttribute('aria-label') ?? '';
    expect(label).toContain(`Sales for the last 3 days. Billed ${money(40000)} and collected ${money(31500)} over 3 days`);
    expect(label).toContain(`Highest billing ${money(30000)} on 6 Mar`);
    const table = screen.getByRole('table', { hidden: true });
    expect(within(table).getByText('Sales for the last 3 days')).toBeTruthy();
    const rows = within(table).getAllByRole('row', { hidden: true });
    expect(rows).toHaveLength(4);
    expect(cellsOf(rows[0])).toEqual(['Period', 'Orders', 'Billed', 'Collected']);
    expect(cellsOf(rows[1])).toEqual(['5 Mar', '1', money(10000), money(7500)]);
    expect(cellsOf(rows[2])).toEqual(['6 Mar', '1', money(30000), money(24000)]);
    expect(cellsOf(rows[3])).toEqual(['7 Mar', '0', money(0), money(0)]);
  });

  it('draws the billed bars and the collected line with its dots and hover titles', () => {
    const points = [
      pointOf('2026-03-05', 10000, { balanceCollectedMinor: 8000 }),
      pointOf('2026-03-06', 30000, { balanceCollectedMinor: 25000 }),
    ];
    render(<SalesChart points={points} bucket="day" title="Daily sales" />);
    const chart = screen.getByRole('img');
    expect(chart.querySelectorAll('rect.counter-chart-bar')).toHaveLength(2);
    expect(chart.querySelectorAll('circle')).toHaveLength(2);
    expect(chart.querySelectorAll('polyline')).toHaveLength(1);
    expect(chart.querySelector('rect.counter-chart-bar title')?.textContent).toBe(`5 Mar: billed ${money(10000)}, collected ${money(8000)}`);
    expect(chart.closest('figure')?.querySelector('figcaption')?.textContent).toBe('BilledCollected');
  });

  it('draws a chart from money collected alone and sizes the axis to it', () => {
    const points = [pointOf('2026-03-05', 0, { balanceCollectedMinor: 7000 }), pointOf('2026-03-06', 0, { balanceCollectedMinor: 3000 })];
    const { container } = render(<SalesChart points={points} bucket="day" title="Collected only" />);
    expect(screen.queryByText('No sales or payments in this period.')).toBeNull();
    expect([...container.querySelectorAll('svg text')].map(node => node.textContent)).toContain('₹100');
  });

  it('keeps a negative net point on the baseline while the table shows the negative amount', () => {
    // Refunds of 80 exceed the 60 collected that day, so the net is -20.
    const points = [pointOf('2026-03-05', 10000, { advanceCollectedMinor: 6000, advanceRefundedMinor: 8000 })];
    render(<SalesChart points={points} bucket="day" title="Refund day" />);
    const chart = screen.getByRole('img');
    // The plot area ends at PAD.top (16) + plotHeight (260 - 16 - 34 = 210) = 226.
    const baselineY = '226';
    expect((chart.querySelector('polyline')?.getAttribute('points') ?? '').split(',')[1]).toBe(baselineY);
    expect(chart.querySelector('circle')?.getAttribute('cy')).toBe(baselineY);
    const rows = within(screen.getByRole('table', { hidden: true })).getAllByRole('row', { hidden: true });
    expect(cellsOf(rows[1])).toEqual(['5 Mar', '1', money(10000), money(-2000)]);
  });

  it('does not let a negative net value set the top of the axis', () => {
    // The only positive figure is 10 (advance). A net of -90 must not stretch the axis to 100.
    const points = [
      pointOf('2026-03-05', 0, { advanceCollectedMinor: 1000 }),
      pointOf('2026-03-06', 0, { advanceRefundedMinor: 9000 }),
    ];
    const { container } = render(<SalesChart points={points} bucket="day" title="Refund day" />);
    const labels = [...container.querySelectorAll('svg text')].map(node => node.textContent);
    expect(labels).toContain('₹10');
    expect(labels).not.toContain('₹100');
  });

  it('lets the collected line set the top of the axis when it is the biggest figure', () => {
    const { container } = render(<SalesChart points={[pointOf('2026-03-05', 0, { balanceCollectedMinor: 120000 })]} bucket="day" title="Collected only" />);
    expect([...container.querySelectorAll('svg text')].map(node => node.textContent)).toContain('₹2K');
  });

  it('rounds the axis up to a readable top', () => {
    const axis = (peak: number) => {
      const { container, unmount } = render(<SalesChart points={[pointOf('2026-03-05', peak)]} bucket="day" title="t" />);
      const labels = [...container.querySelectorAll('svg text')].map(node => node.textContent);
      unmount();
      return labels;
    };
    expect(axis(10000)).toContain('₹100');
    expect(axis(20000)).toContain('₹200');
    expect(axis(30000)).toContain('₹500');
    expect(axis(70000)).toContain('₹1K');
    expect(axis(1200000)).toContain('₹20K');
  });

  it('thins the axis labels on a long graph and names hours and months', () => {
    const hours = Array.from({ length: 24 }, (_, hour) => pointOf(`2026-03-05T${String(hour).padStart(2, '0')}:00`, 1000 * (hour + 1)));
    const { container, unmount } = render(<SalesChart points={hours} bucket="hour" title="Hourly sales" />);
    const ticks = [...container.querySelectorAll('svg text')].map(node => node.textContent).filter(text => /[ap]m$/.test(text ?? ''));
    expect(ticks).toHaveLength(8);
    expect(ticks[0]).toBe('12 am');
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('over 24 hours');
    unmount();
    render(<SalesChart points={[pointOf('2026-01', 5000), pointOf('2026-02', 9000)]} bucket="month" title="Monthly sales" />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('over 2 months');
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('on Feb 2026');
  });
});
