// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { SegmentBar } from './SegmentBar';
import { countsOf } from './listFixtures';

const renderBar = (overrides: Partial<React.ComponentProps<typeof SegmentBar>> = {}) => {
  const props = { segment: 'all' as const, counts: countsOf(), onSegment: vi.fn(), ...overrides };
  render(<SegmentBar {...props} />);
  return props;
};
const group = () => screen.getByRole('group', { name: 'Order filters' });

afterEach(cleanup);

describe('SegmentBar', () => {
  it('lists the six filters in order, each with its count', () => {
    renderBar();
    const buttons = within(group()).getAllByRole('button');
    expect(buttons.map(button => button.textContent)).toEqual(['Ready 2', 'Balance due 4', 'Overdue 1', 'In process 3', 'Today 5', 'All 12']);
  });

  it('shows only the labels while the counts are not known yet', () => {
    renderBar({ counts: null });
    expect(screen.getByRole('button', { name: 'Ready' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Balance due' })).toBeTruthy();
    expect(screen.queryByText('12')).toBeNull();
  });

  it('marks only the current segment as pressed', () => {
    renderBar({ segment: 'overdue' });
    expect(screen.getByRole('button', { name: 'Overdue 1' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Ready 2' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'All 12' }).getAttribute('aria-pressed')).toBe('false');
  });

  it.each([
    ['Ready 2', 'ready'],
    ['Balance due 4', 'balance_due'],
    ['Overdue 1', 'overdue'],
    ['In process 3', 'in_process'],
    ['Today 5', 'today'],
    ['All 12', 'all'],
  ])('%s picks the %s filter', (name, filter) => {
    const props = renderBar({ segment: filter === 'all' ? 'ready' : 'all' });
    fireEvent.click(screen.getByRole('button', { name }));
    expect(props.onSegment).toHaveBeenCalledWith(filter);
  });
});
