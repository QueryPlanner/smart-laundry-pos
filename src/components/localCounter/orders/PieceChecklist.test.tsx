// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PieceChecklist } from './PieceChecklist';
import { checklistPieces, piece, UNTAGGED_SHIRT_IRON } from './handoverFixtures';

type Props = ComponentProps<typeof PieceChecklist>;
const props = (overrides: Partial<Props> = {}): Props => ({
  mode: 'pickup', pieces: checklistPieces(), checkedTaggedIds: [], onCheckedTagged: vi.fn(),
  untaggedCounts: {}, onUntaggedCounts: vi.fn(), ...overrides,
});
const scanInput = () => screen.getByLabelText('Type a tag ID and press Enter') as HTMLInputElement;
const scan = (text: string) => {
  fireEvent.change(scanInput(), { target: { value: text } });
  fireEvent.keyDown(scanInput(), { key: 'Enter' });
};
const checkbox = (name: RegExp) => screen.getByRole('checkbox', { name }) as HTMLInputElement;
afterEach(cleanup);

describe('PieceChecklist tag scanning', () => {
  it('ticks the piece for a valid tag, clears the input and keeps focus in pickup mode', () => {
    const p = props({ checkedTaggedIds: ['p1'] });
    render(<PieceChecklist {...p} />);
    scan('2610170001-2');
    expect(p.onCheckedTagged).toHaveBeenCalledWith(['p1', 'p2']);
    expect(scanInput().value).toBe('');
    expect(document.activeElement).toBe(scanInput());
  });

  it('accepts a position typed alone, with or without a leading minus', () => {
    const p = props();
    render(<PieceChecklist {...p} />);
    scan('2');
    scan('-1');
    expect(vi.mocked(p.onCheckedTagged).mock.calls).toEqual([[['p2']], [['p1']]]);
  });

  it('says Already checked for a tag that is already ticked, and ticks nothing', () => {
    const p = props({ checkedTaggedIds: ['p1'] });
    render(<PieceChecklist {...p} />);
    scan('2610170001-1');
    expect(screen.getByRole('alert').textContent).toBe('Already checked');
    expect(p.onCheckedTagged).not.toHaveBeenCalled();
    expect(scanInput().value).toBe('');
  });

  it('says No such tag on this bill for an unknown tag', () => {
    const p = props();
    render(<PieceChecklist {...p} />);
    scan('2610179999-1');
    expect(screen.getByRole('alert').textContent).toBe('No such tag on this bill');
    expect(p.onCheckedTagged).not.toHaveBeenCalled();
    expect(scanInput().value).toBe('');
  });

  it('treats the position of an untagged piece as no such tag', () => {
    const p = props();
    render(<PieceChecklist {...p} />);
    scan('3');
    expect(screen.getByRole('alert').textContent).toBe('No such tag on this bill');
    expect(p.onCheckedTagged).not.toHaveBeenCalled();
  });

  it('does not guess a position that two tagged pieces share', () => {
    const p = props({ pieces: [piece({ id: 'a', shortId: '2610170001-1', position: 1 }), piece({ id: 'b', shortId: '2610170002-1', position: 1 })] });
    render(<PieceChecklist {...p} />);
    scan('1');
    expect(screen.getByRole('alert').textContent).toBe('No such tag on this bill');
    expect(p.onCheckedTagged).not.toHaveBeenCalled();
  });

  it('does nothing for an empty or blank input', () => {
    const p = props();
    render(<PieceChecklist {...p} />);
    scan('');
    scan('   ');
    expect(p.onCheckedTagged).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('scans only on Enter and leaves the typed text alone for other keys', () => {
    const p = props();
    render(<PieceChecklist {...p} />);
    fireEvent.change(scanInput(), { target: { value: '2610170001-2' } });
    fireEvent.keyDown(scanInput(), { key: 'a' });
    expect(p.onCheckedTagged).not.toHaveBeenCalled();
    expect(scanInput().value).toBe('2610170001-2');
  });

  it('clears an earlier problem once a valid tag is scanned', () => {
    const p = props();
    render(<PieceChecklist {...p} />);
    scan('nope');
    expect(screen.getByRole('alert')).toBeTruthy();
    scan('2610170001-1');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('PieceChecklist rows and copy', () => {
  it('shows pickup copy and focuses the tag input in pickup mode', () => {
    render(<PieceChecklist {...props({ mode: 'pickup' })} />);
    expect(screen.getByText('Check each garment with the customer')).toBeTruthy();
    expect(document.activeElement).toBe(scanInput());
  });

  it('shows packing copy and leaves the tag input unfocused in packing mode', () => {
    render(<PieceChecklist {...props({ mode: 'packing' })} />);
    expect(screen.getByText('Check each garment as it is packed')).toBeTruthy();
    expect(document.activeElement).not.toBe(scanInput());
  });

  it('names each tagged row by its short id, garment and service', () => {
    render(<PieceChecklist {...props()} />);
    expect(checkbox(/2610170001-2 Trouser · Dry clean/)).toBeTruthy();
  });

  it('ticks a piece on and unticks a ticked piece', () => {
    const p = props({ checkedTaggedIds: ['p1'] });
    render(<PieceChecklist {...p} />);
    fireEvent.click(checkbox(/2610170001-2/));
    fireEvent.click(checkbox(/2610170001-1/));
    expect(vi.mocked(p.onCheckedTagged).mock.calls).toEqual([[['p1', 'p2']], [[]]]);
  });

  it('marks a ticked row with the word checked', () => {
    render(<PieceChecklist {...props({ checkedTaggedIds: ['p1'] })} />);
    expect(checkbox(/2610170001-1/).closest('label')?.textContent).toContain('checked');
    expect(checkbox(/2610170001-2/).closest('label')?.textContent).not.toContain('checked');
  });

  it('ticks every tagged piece and every untagged piece with Tick all', () => {
    const p = props();
    render(<PieceChecklist {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tick all' }));
    expect(p.onCheckedTagged).toHaveBeenCalledWith(['p1', 'p2']);
    expect(p.onUntaggedCounts).toHaveBeenCalledWith({ [UNTAGGED_SHIRT_IRON]: 2 });
  });

  it('summarises how many pieces are checked across tags and untagged counts', () => {
    const { unmount } = render(<PieceChecklist {...props()} />);
    expect(screen.getByText('0 of 4 checked')).toBeTruthy();
    unmount();
    render(<PieceChecklist {...props({ checkedTaggedIds: ['p1'], untaggedCounts: { [UNTAGGED_SHIRT_IRON]: 1 } })} />);
    expect(screen.getByText('2 of 4 checked')).toBeTruthy();
  });
});

describe('PieceChecklist untagged garments', () => {
  it('lists each untagged garment line with its count and passes the new count up', () => {
    const p = props({ untaggedCounts: { [UNTAGGED_SHIRT_IRON]: 1 } });
    render(<PieceChecklist {...p} />);
    const line = within(screen.getByRole('group', { name: 'Shirt · Iron' }));
    expect(line.getByText('1 / 2')).toBeTruthy();
    fireEvent.click(line.getByRole('button', { name: 'More' }));
    expect(p.onUntaggedCounts).toHaveBeenCalledWith({ [UNTAGGED_SHIRT_IRON]: 2 });
  });

  it('treats a line with no count yet as zero checked', () => {
    const p = props();
    render(<PieceChecklist {...p} />);
    fireEvent.click(within(screen.getByRole('group', { name: 'Shirt · Iron' })).getByRole('button', { name: 'More' }));
    expect(p.onUntaggedCounts).toHaveBeenCalledWith({ [UNTAGGED_SHIRT_IRON]: 1 });
  });

  it('omits the untagged section when every piece has a tag', () => {
    render(<PieceChecklist {...props({ pieces: [piece({ id: 'p1', shortId: '2610170001-1' })] })} />);
    expect(screen.queryByText('Without a tag')).toBeNull();
  });

  it('shows the untagged section when there are untagged pieces', () => {
    render(<PieceChecklist {...props()} />);
    expect(screen.getByText('Without a tag')).toBeTruthy();
  });
});
