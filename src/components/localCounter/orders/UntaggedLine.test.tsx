// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { UntaggedLine } from './UntaggedLine';
import { checklistPieces } from './handoverFixtures';
import { splitPieces } from '@/lib/localFirst/orders/pieceGroups';

/** The untagged shirt-and-iron line of the fixture bill: two pieces. */
const line = splitPieces(checklistPieces()).untaggedLines[0];

/** Renders the line at `count` and returns the spy that receives the new count. */
const renderLine = (count: number) => {
  const onCount = vi.fn();
  render(<UntaggedLine line={line} count={count} onCount={onCount} />);
  return onCount;
};
const control = (name: string) => screen.getByRole('button', { name });
afterEach(cleanup);

describe('UntaggedLine', () => {
  it('names the line by garment and service and shows checked of total', () => {
    renderLine(1);
    expect(screen.getByRole('group', { name: 'Shirt · Iron' })).toBeTruthy();
    expect(screen.getByText('1 / 2')).toBeTruthy();
  });

  it('counts one more with More and one fewer with Fewer', () => {
    const onCount = renderLine(1);
    fireEvent.click(control('More'));
    fireEvent.click(control('Fewer'));
    expect(onCount.mock.calls).toEqual([[2], [0]]);
  });

  it('checks every piece in the line with All', () => {
    const onCount = renderLine(0);
    fireEvent.click(control('All'));
    expect(onCount).toHaveBeenCalledWith(2);
  });

  it('does not count below zero', () => {
    const onCount = renderLine(0);
    fireEvent.click(control('Fewer'));
    expect(onCount).toHaveBeenCalledWith(0);
  });

  it('does not count above the size of the line', () => {
    const onCount = renderLine(2);
    fireEvent.click(control('More'));
    expect(onCount).toHaveBeenCalledWith(2);
  });
});
