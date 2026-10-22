// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MoreActions, type MoreActionsProps } from './MoreActions';

const handlers = () => ({ onReprintTags: vi.fn(), onOpenPrints: vi.fn(), onCancel: vi.fn() });
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
  it('calls back for the tags and the print status', () => {
    const { onReprintTags, onOpenPrints } = renderActions();
    openDisclosure();
    fireEvent.click(button('Reprint tags') as HTMLButtonElement);
    fireEvent.click(button('Print status') as HTMLButtonElement);
    expect(onReprintTags).toHaveBeenCalledOnce();
    expect(onOpenPrints).toHaveBeenCalledOnce();
  });

  it('says no tags are needed instead of offering a tag reprint when no piece has a tag', () => {
    renderActions({ taggedCount: 0 });
    openDisclosure();
    expect(screen.getByText('No tags needed')).toBeTruthy();
    expect(button('Reprint tags')).toBeNull();
    expect(button('Reprint bill')).toBeNull();
  });

  it('disables the tag reprint and the status link while the order is busy', () => {
    renderActions({ busy: true });
    openDisclosure();
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
    rerender(<MoreActions status="ready" taggedCount={2} paidMinor={0} isAdmin busy onReprintTags={vi.fn()} onOpenPrints={vi.fn()} onCancel={vi.fn()} />);
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
