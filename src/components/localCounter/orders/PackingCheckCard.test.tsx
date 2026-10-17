// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PackingCheckCard } from './PackingCheckCard';
import { checklistPieces, UNTAGGED_SHIRT_IRON } from './handoverFixtures';

type Props = ComponentProps<typeof PackingCheckCard>;
const props = (overrides: Partial<Props> = {}): Props => ({
  pieces: checklistPieces(), checkedTaggedIds: [], onCheckedTagged: vi.fn(),
  untaggedCounts: {}, onUntaggedCounts: vi.fn(), canSave: true, saving: false, onSave: vi.fn(), ...overrides,
});
const saveButton = () => screen.getByRole('button', { name: 'Save check & mark Ready' }) as HTMLButtonElement;
afterEach(cleanup);

describe('PackingCheckCard', () => {
  it('shows the packing check heading and packing copy', () => {
    render(<PackingCheckCard {...props()} />);
    expect(screen.getByRole('heading', { name: 'Packing check' })).toBeTruthy();
    expect(screen.getByText('Check each garment as it is packed')).toBeTruthy();
  });

  it('enables saving when the check can be saved', () => {
    const p = props();
    render(<PackingCheckCard {...p} />);
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    expect(p.onSave).toHaveBeenCalledOnce();
  });

  it('disables saving until every piece is checked', () => {
    const p = props({ canSave: false });
    render(<PackingCheckCard {...p} />);
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(saveButton());
    expect(p.onSave).not.toHaveBeenCalled();
  });

  it('disables saving while a save is in progress', () => {
    render(<PackingCheckCard {...props({ saving: true })} />);
    expect(saveButton().disabled).toBe(true);
  });

  it('passes ticks through to the checklist', () => {
    const p = props();
    render(<PackingCheckCard {...p} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /2610170001-1/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Tick all' }));
    expect(vi.mocked(p.onCheckedTagged).mock.calls).toEqual([[['p1']], [['p1', 'p2']]]);
    expect(p.onUntaggedCounts).toHaveBeenCalledWith({ [UNTAGGED_SHIRT_IRON]: 2 });
  });
});
