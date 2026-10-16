// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { SalesChart } from './SalesChart';
import type { SeriesPoint } from '@/lib/localFirst/insights';
import { money } from './ui';

afterEach(cleanup);

const point = (bucket: string, billed: number, collected = 0, refunded = 0, orders = 1): SeriesPoint => ({
  bucket, orders, pieces: orders, grossMinor: billed, discountMinor: 0, netBilledMinor: billed, collectedMinor: collected, refundedMinor: refunded,
});

describe('SalesChart', () => {
  it('says there is nothing to chart instead of drawing flat bars', () => {
    render(<SalesChart points={[point('2026-03-05', 0), point('2026-03-06', 0)]} bucket="day" title="Daily sales" />);
    expect(screen.getByText('No sales or payments in this period.')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('also handles a graph with no points at all', () => {
    render(<SalesChart points={[]} bucket="day" title="Daily sales" />);
    expect(screen.getByText('No sales or payments in this period.')).toBeTruthy();
  });

  it('announces a summary and carries every number in a hidden table', () => {
    const points = [point('2026-03-05', 10000, 8000, 0, 2), point('2026-03-06', 30000, 25000, 5000, 3), point('2026-03-07', 0)];
    render(<SalesChart points={points} bucket="day" title="Sales for the last 3 days" />);
    const chart = screen.getByRole('img');
    const label = chart.getAttribute('aria-label') ?? '';
    expect(label).toContain('Sales for the last 3 days');
    expect(label).toContain(`Billed ${money(40000)} and collected ${money(33000)} over 3 days`);
    expect(label).toContain(`Highest billing ${money(30000)} on 6 Mar`);
    const table = screen.getByRole('table', { hidden: true });
    expect(within(table).getByText('Sales for the last 3 days')).toBeTruthy();
    const rows = within(table).getAllByRole('row', { hidden: true });
    expect(rows).toHaveLength(4);
    expect(rows[2].textContent).toContain('6 Mar');
    expect(rows[2].textContent).toContain(money(5000));
    expect(chart.querySelectorAll('rect')).toHaveLength(3);
    expect(chart.querySelectorAll('circle')).toHaveLength(3);
    expect(chart.querySelector('rect title')?.textContent).toBe(`5 Mar: billed ${money(10000)}, collected ${money(8000)}`);
    expect(chart.closest('figure')?.querySelector('figcaption')?.textContent).toBe('BilledCollected');
  });

  it('rounds the axis up to a readable top', () => {
    const axis = (peak: number) => {
      const { container, unmount } = render(<SalesChart points={[point('2026-03-05', peak)]} bucket="day" title="t" />);
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
    const hours = Array.from({ length: 24 }, (_, hour) => point(`2026-03-05T${String(hour).padStart(2, '0')}:00`, 1000 * (hour + 1)));
    const { container, unmount } = render(<SalesChart points={hours} bucket="hour" title="Hourly sales" />);
    const ticks = [...container.querySelectorAll('svg text')].map(node => node.textContent).filter(text => /[ap]m$/.test(text ?? ''));
    expect(ticks).toHaveLength(8);
    expect(ticks[0]).toBe('12 am');
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('over 24 hours');
    unmount();
    render(<SalesChart points={[point('2026-01', 5000), point('2026-02', 9000)]} bucket="month" title="Monthly sales" />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('over 2 months');
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('on Feb 2026');
  });
});
