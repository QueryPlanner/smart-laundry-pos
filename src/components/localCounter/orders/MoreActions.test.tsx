// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MoreActions, type MoreActionsProps } from './MoreActions';

const handlers = () => ({ onReprintBill: vi.fn(), onReprintTags: vi.fn(), onOpenPrints: vi.fn(), onCancel: vi.fn(), onTrash: vi.fn(), onRequestTrash: vi.fn() });
const renderActions = (over: Partial<MoreActionsProps> = {}) => {
  const callbacks = handlers();
  const props: MoreActionsProps = { status: 'ready', taggedCount: 2, paidMinor: 0, isAdmin: true, busy: false, ...callbacks, ...over };
  const result = render(<MoreActions {...props} />);
  return { ...callbacks, ...result };
};
const button = (name: string) => screen.queryByRole('button', { name }) as HTMLButtonElement | null;
const openDisclosure = () => fireEvent.click(button('More actions') as HTMLButtonElement);
const openCancelForm = () => {
  openDisclosure();
  fireEvent.click(button('Cancel order') as HTMLButtonElement);
};
const reasonBox = () => screen.getByLabelText('Reason for cancelling') as HTMLTextAreaElement;

afterEach(cleanup);

describe('MoreActions trash', () => {
  const openTrash = () => { openDisclosure(); fireEvent.click(button('Move to trash') as HTMLButtonElement); };

  it('moves the order to the trash only after the admin confirms, whatever its status', () => {
    const { onTrash } = renderActions({ status: 'collected' });
    openTrash();
    expect(onTrash).not.toHaveBeenCalled();
    expect(screen.getByText(/Nothing is deleted/)).not.toBeNull();
    fireEvent.click(button('Confirm move to trash') as HTMLButtonElement);
    expect(onTrash).toHaveBeenCalledTimes(1);
  });

  it('keeps the order when the admin backs out, and closing the panel resets the prompt', () => {
    const { onTrash } = renderActions();
    openTrash();
    fireEvent.click(button('Keep order') as HTMLButtonElement);
    expect(onTrash).not.toHaveBeenCalled();
    expect(button('Move to trash')).not.toBeNull();
    fireEvent.click(button('Move to trash') as HTMLButtonElement);
    openDisclosure();
    openDisclosure();
    expect(button('Confirm move to trash')).toBeNull();
  });

  it('is not offered to staff', () => {
    renderActions({ isAdmin: false });
    openDisclosure();
    expect(button('Move to trash')).toBeNull();
  });
});

describe('MoreActions mark for trash (staff)', () => {
  const openForm = () => { openDisclosure(); fireEvent.click(button('Mark for trash') as HTMLButtonElement); };
  const reasonField = () => screen.getByLabelText('Why should this bill be trashed?') as HTMLTextAreaElement;

  it('is offered to staff only', () => {
    renderActions({ isAdmin: false });
    openDisclosure();
    expect(button('Mark for trash')).not.toBeNull();
    cleanup();
    renderActions({ isAdmin: true });
    openDisclosure();
    expect(button('Mark for trash')).toBeNull();
  });

  it('needs a reason, then sends the trimmed reason to the owner', () => {
    const { onRequestTrash } = renderActions({ isAdmin: false });
    openForm();
    expect(screen.getByText(/still counts in sales/)).not.toBeNull();
    fireEvent.click(button('Send to the owner') as HTMLButtonElement);
    expect(screen.getByRole('alert').textContent).toMatch(/3 to 200 characters/);
    expect(onRequestTrash).not.toHaveBeenCalled();
    fireEvent.change(reasonField(), { target: { value: '  Added twice by mistake  ' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(button('Send to the owner') as HTMLButtonElement);
    expect(onRequestTrash).toHaveBeenCalledExactlyOnceWith('Added twice by mistake');
  });

  it('keeps the bill and drops a half-written reason when staff back out or close the panel', () => {
    const { onRequestTrash } = renderActions({ isAdmin: false });
    openForm();
    fireEvent.change(reasonField(), { target: { value: 'typo' } });
    fireEvent.click(button('Keep bill') as HTMLButtonElement);
    expect(button('Mark for trash')).not.toBeNull();
    fireEvent.click(button('Mark for trash') as HTMLButtonElement);
    expect(reasonField().value).toBe('');
    openDisclosure();
    openDisclosure();
    expect(button('Send to the owner')).toBeNull();
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
});

describe('MoreActions disclosure', () => {
  it('stays closed until opened, and closes again when the same button is pressed', () => {
    renderActions();
    const toggle = button('More actions') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('region', { name: 'More actions' })).toBeNull();
    openDisclosure();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('region', { name: 'More actions' })).toBeTruthy();
    openDisclosure();
    expect(screen.queryByRole('region', { name: 'More actions' })).toBeNull();
  });

  it('closing the disclosure drops a half-written cancel reason', () => {
    renderActions();
    openCancelForm();
    fireEvent.change(reasonBox(), { target: { value: 'Duplicate bill' } });
    openDisclosure();
    openDisclosure();
    fireEvent.click(button('Cancel order') as HTMLButtonElement);
    expect(reasonBox().value).toBe('');
  });
});

describe('MoreActions reprints and print status', () => {
  it('calls back for the bill, the tags and the print status', () => {
    const { onReprintBill, onReprintTags, onOpenPrints } = renderActions();
    openDisclosure();
    fireEvent.click(button('Reprint bill') as HTMLButtonElement);
    fireEvent.click(button('Reprint tags') as HTMLButtonElement);
    fireEvent.click(button('Print status') as HTMLButtonElement);
    expect(onReprintBill).toHaveBeenCalledOnce();
    expect(onReprintTags).toHaveBeenCalledOnce();
    expect(onOpenPrints).toHaveBeenCalledOnce();
  });

  it('says no tags are needed instead of offering a tag reprint when no piece has a tag', () => {
    renderActions({ taggedCount: 0 });
    openDisclosure();
    expect(screen.getByText('No tags needed')).toBeTruthy();
    expect(button('Reprint tags')).toBeNull();
    expect(button('Reprint bill')).not.toBeNull();
  });

  it('disables the reprints and the status link while the order is busy', () => {
    renderActions({ busy: true });
    openDisclosure();
    expect((button('Reprint bill') as HTMLButtonElement).disabled).toBe(true);
    expect((button('Reprint tags') as HTMLButtonElement).disabled).toBe(true);
    expect((button('Print status') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('MoreActions admin cancel', () => {
  it('refuses a reason shorter than 3 or longer than 200 characters and does not cancel', () => {
    const { onCancel } = renderActions();
    openCancelForm();
    fireEvent.click(button('Confirm cancel order') as HTMLButtonElement);
    expect(screen.getByRole('alert').textContent).toBe('Enter a reason of 3 to 200 characters.');
    fireEvent.change(reasonBox(), { target: { value: '  ab  ' } });
    fireEvent.click(button('Confirm cancel order') as HTMLButtonElement);
    expect(screen.getByRole('alert').textContent).toBe('Enter a reason of 3 to 200 characters.');
    fireEvent.change(reasonBox(), { target: { value: 'x'.repeat(201) } });
    fireEvent.click(button('Confirm cancel order') as HTMLButtonElement);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels with the trimmed reason once it is long enough', () => {
    const { onCancel } = renderActions();
    openCancelForm();
    fireEvent.change(reasonBox(), { target: { value: '  Customer changed plans  ' } });
    fireEvent.click(button('Confirm cancel order') as HTMLButtonElement);
    expect(onCancel).toHaveBeenCalledWith('Customer changed plans');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('states the refund in the confirm button when money was paid', () => {
    renderActions({ paidMinor: 1500 });
    openCancelForm();
    expect(button('Refund ₹15.00 to the customer')).not.toBeNull();
    expect(button('Confirm cancel order')).toBeNull();
  });

  it('keeps the order and clears the reason when the cancel is not confirmed', () => {
    const { onCancel } = renderActions();
    openCancelForm();
    fireEvent.change(reasonBox(), { target: { value: 'Duplicate' } });
    fireEvent.click(button('Keep order') as HTMLButtonElement);
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Reason for cancelling')).toBeNull();
    fireEvent.click(button('Cancel order') as HTMLButtonElement);
    expect(reasonBox().value).toBe('');
  });

  it('disables the cancel confirmation while busy', () => {
    const { rerender } = renderActions();
    openCancelForm();
    rerender(<MoreActions status="ready" taggedCount={2} paidMinor={0} isAdmin busy onReprintBill={vi.fn()} onReprintTags={vi.fn()} onOpenPrints={vi.fn()} onCancel={vi.fn()} onTrash={vi.fn()} />);
    expect((button('Confirm cancel order') as HTMLButtonElement).disabled).toBe(true);
  });

  it('gives staff a hint to ask an admin instead of a cancel control', () => {
    renderActions({ isAdmin: false });
    openDisclosure();
    expect(screen.getByText('Ask an admin to cancel this order.')).toBeTruthy();
    expect(button('Cancel order')).toBeNull();
  });

  it('is not offered at all once an order is collected, with no hint for staff either', () => {
    renderActions({ status: 'collected' });
    openDisclosure();
    expect(button('Cancel order')).toBeNull();
    expect(screen.queryByText('Ask an admin to cancel this order.')).toBeNull();
  });

  it('is not offered once an order is already cancelled', () => {
    renderActions({ status: 'cancelled', isAdmin: false });
    openDisclosure();
    expect(screen.queryByText('Ask an admin to cancel this order.')).toBeNull();
    expect(button('Cancel order')).toBeNull();
  });
});
