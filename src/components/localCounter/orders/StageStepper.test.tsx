// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { StageStepper } from './StageStepper';

const stageItems = () => screen.getAllByRole('listitem');
const stageLabels = () => stageItems().map(item => item.querySelector('span')?.textContent);
const doneStages = () => stageItems().filter(item => within(item).queryByText('Done') !== null);
const currentStage = () => stageItems().find(item => item.getAttribute('aria-current') === 'step');
const button = (name: string) => screen.queryByRole('button', { name }) as HTMLButtonElement | null;

const renderStepper = (status: string, busy = false) => {
  const onMove = vi.fn();
  const result = render(<StageStepper status={status} busy={busy} onMove={onMove} />);
  return { onMove, ...result };
};

afterEach(cleanup);

describe('StageStepper', () => {
  it('lists all eight stages in order, with nothing marked done before the first stage', () => {
    renderStepper('received');
    expect(stageLabels()).toEqual(['Received', 'Washing', 'Drying', 'Ironing', 'Quality check', 'Packing', 'Ready for pickup', 'Collected']);
    expect(doneStages()).toEqual([]);
    expect(currentStage()?.textContent).toContain('Received');
  });

  it('marks the stages before the current one as Done and the current one as the current step', () => {
    renderStepper('packing');
    expect(doneStages().map(item => item.querySelector('span')?.textContent)).toEqual(['Received', 'Washing', 'Drying', 'Ironing', 'Quality check']);
    expect(currentStage()?.querySelector('span')?.textContent).toBe('Packing');
    expect(stageItems()[6].getAttribute('aria-current')).toBeNull();
    expect(within(stageItems()[6]).queryByText('Done')).toBeNull();
  });

  it('marks every stage Done once the order is collected', () => {
    renderStepper('collected');
    expect(doneStages()).toHaveLength(7);
    expect(currentStage()?.querySelector('span')?.textContent).toBe('Collected');
  });

  it('shows no stages at all for a cancelled order', () => {
    const { container } = renderStepper('cancelled');
    expect(container.childElementCount).toBe(0);
  });

  it('moves to the next stage in one tap when no stage is skipped', () => {
    const { onMove } = renderStepper('washing');
    expect(button('Mark ready now')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Move to Drying' }));
    expect(onMove).toHaveBeenCalledWith('drying');
    expect(screen.queryByRole('group', { name: 'Confirm skip' })).toBeNull();
  });

  it('offers no move buttons for a ready or collected order', () => {
    renderStepper('ready');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    cleanup();
    renderStepper('collected');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('offers Mark ready now only while the order is still before ready', () => {
    renderStepper('packing');
    expect(button('Mark ready now')).toBeNull();
    expect(button('Move to Ready for pickup')).not.toBeNull();
  });

  it('asks before skipping stages and moves only when the skip is confirmed', () => {
    const { onMove } = renderStepper('washing');
    fireEvent.click(screen.getByRole('button', { name: 'Mark ready now' }));
    const confirm = screen.getByRole('group', { name: 'Confirm skip' });
    expect(within(confirm).getByText('Skip 4 stages? This cannot be undone.')).toBeTruthy();
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Confirm' }));
    expect(onMove).toHaveBeenCalledOnce();
    expect(onMove).toHaveBeenCalledWith('ready');
    expect(screen.queryByRole('group', { name: 'Confirm skip' })).toBeNull();
  });

  it('keeps the order where it is when the skip is not confirmed', () => {
    const { onMove } = renderStepper('washing');
    fireEvent.click(screen.getByRole('button', { name: 'Mark ready now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: 'Confirm skip' })).toBeNull();
    expect(button('Move to Drying')).not.toBeNull();
  });

  it('uses the singular wording when exactly one stage would be skipped', () => {
    renderStepper('quality_check');
    fireEvent.click(screen.getByRole('button', { name: 'Mark ready now' }));
    expect(screen.getByText('Skip 1 stage? This cannot be undone.')).toBeTruthy();
  });

  it('disables every button while the order is busy, and the skip confirmation too', () => {
    const { onMove, rerender } = renderStepper('washing', true);
    expect(button('Move to Drying')?.disabled).toBe(true);
    expect(button('Mark ready now')?.disabled).toBe(true);
    rerender(<StageStepper status="washing" busy={false} onMove={onMove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark ready now' }));
    rerender(<StageStepper status="washing" busy onMove={onMove} />);
    expect(button('Confirm')?.disabled).toBe(true);
    expect(onMove).not.toHaveBeenCalled();
  });
});
