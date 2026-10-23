// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TrashActions, type TrashActionsProps } from './TrashActions';

const renderActions = (over: Partial<TrashActionsProps> = {}) => {
  const callbacks = { onTrash: vi.fn(), onRequestTrash: vi.fn() };
  const props: TrashActionsProps = { isAdmin: true, busy: false, ...callbacks, ...over };
  const result = render(<TrashActions {...props} />);
  return { ...callbacks, ...result, props };
};
const button = (name: string) => screen.queryByRole('button', { name }) as HTMLButtonElement | null;

afterEach(cleanup);

describe('TrashActions for an administrator', () => {
  it('asks once, then moves the order to the trash', () => {
    const { onTrash } = renderActions();
    fireEvent.click(button('Move to trash') as HTMLButtonElement);
    expect(onTrash).not.toHaveBeenCalled();
    expect(screen.getByText(/Nothing is deleted, and you can restore it from the Trash page/)).not.toBeNull();
    fireEvent.click(button('Confirm move to trash') as HTMLButtonElement);
    expect(onTrash).toHaveBeenCalledTimes(1);
  });

  it('keeps the order when the admin backs out, and can start again', () => {
    const { onTrash } = renderActions();
    fireEvent.click(button('Move to trash') as HTMLButtonElement);
    fireEvent.click(button('Keep order') as HTMLButtonElement);
    expect(onTrash).not.toHaveBeenCalled();
    expect(button('Confirm move to trash')).toBeNull();
    fireEvent.click(button('Move to trash') as HTMLButtonElement);
    expect(button('Confirm move to trash')).not.toBeNull();
  });

  it('is not the staff control', () => {
    renderActions();
    expect(button('Mark for trash')).toBeNull();
  });

  it('disables the buttons while the order is busy', () => {
    const { rerender, props } = renderActions();
    fireEvent.click(button('Move to trash') as HTMLButtonElement);
    rerender(<TrashActions {...props} busy />);
    expect(button('Confirm move to trash')?.disabled).toBe(true);
    expect(button('Keep order')?.disabled).toBe(true);
    cleanup();
    renderActions({ busy: true });
    expect(button('Move to trash')?.disabled).toBe(true);
  });
});

describe('TrashActions for staff', () => {
  const openForm = () => fireEvent.click(button('Mark for trash') as HTMLButtonElement);
  const reasonField = () => screen.getByLabelText('Why should this bill be trashed?') as HTMLTextAreaElement;

  it('offers only Mark for trash, never a trash button', () => {
    renderActions({ isAdmin: false });
    expect(button('Mark for trash')).not.toBeNull();
    expect(button('Move to trash')).toBeNull();
  });

  it('needs a reason, then sends the trimmed reason to the owner', () => {
    const { onRequestTrash, onTrash } = renderActions({ isAdmin: false });
    openForm();
    expect(screen.getByText(/still counts in sales/)).not.toBeNull();
    fireEvent.click(button('Send to the owner') as HTMLButtonElement);
    expect(screen.getByRole('alert').textContent).toMatch(/3 to 200 characters/);
    expect(onRequestTrash).not.toHaveBeenCalled();
    fireEvent.change(reasonField(), { target: { value: '  Added twice by mistake  ' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(button('Send to the owner') as HTMLButtonElement);
    expect(onRequestTrash).toHaveBeenCalledExactlyOnceWith('Added twice by mistake');
    expect(onTrash).not.toHaveBeenCalled();
  });

  it('keeps the bill and drops a half-written reason when staff back out', () => {
    const { onRequestTrash } = renderActions({ isAdmin: false });
    openForm();
    fireEvent.change(reasonField(), { target: { value: 'typo' } });
    fireEvent.click(button('Keep bill') as HTMLButtonElement);
    expect(button('Mark for trash')).not.toBeNull();
    openForm();
    expect(reasonField().value).toBe('');
    expect(onRequestTrash).not.toHaveBeenCalled();
  });

  it('refuses a reason that is too long', () => {
    const { onRequestTrash } = renderActions({ isAdmin: false });
    openForm();
    fireEvent.change(reasonField(), { target: { value: 'x'.repeat(201) } });
    fireEvent.click(button('Send to the owner') as HTMLButtonElement);
    expect(screen.getByRole('alert')).not.toBeNull();
    expect(onRequestTrash).not.toHaveBeenCalled();
  });

  it('disables the form buttons while the order is busy', () => {
    const { rerender, props } = renderActions({ isAdmin: false });
    openForm();
    rerender(<TrashActions {...props} busy />);
    expect(button('Send to the owner')?.disabled).toBe(true);
    expect(button('Keep bill')?.disabled).toBe(true);
  });
});
