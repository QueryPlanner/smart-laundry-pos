// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { OrderDetailPage, type OrderDetailPageProps } from './OrderDetailPage';
import { detailMoneyForm, detailOrder, detailPiece, detailProps } from './detailFixtures';

const renderPage = (over: Partial<OrderDetailPageProps> = {}) => {
  const props = detailProps(over);
  return { props, ...render(<OrderDetailPage {...props} />) };
};
const button = (name: string) => screen.queryByRole('button', { name }) as HTMLButtonElement | null;
/** Buttons drawn with the default (primary) variant, which carry the `bg-primary` class. */
const primaryButtons = () => screen.getAllByRole('button').filter(item => item.classList.contains('bg-primary'));

afterEach(cleanup);

describe('OrderDetailPage header', () => {
  it('shows the bill number, customer, status, and received and promised times', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: '202610170001' })).toBeTruthy();
    expect(screen.getByText('Rita Mehta · 9876543210')).toBeTruthy();
    expect(screen.getByText('Ready', { exact: true })).toBeTruthy();
    expect(screen.getByText('Received 15 Oct 2026, 11:30 am · Promised 17 Oct 2026, 5:00 pm')).toBeTruthy();
  });

  it('describes the pieces with the tagged and untagged split when some pieces have no tag', () => {
    renderPage({ order: detailOrder({ pieces: [detailPiece(1), detailPiece(2), detailPiece(3, { tagged: false })] }) });
    expect(screen.getByText('3 pieces (2 tagged, 1 without a tag)')).toBeTruthy();
  });

  it('describes the pieces with just the count when every piece is tagged', () => {
    renderPage({ order: detailOrder({ pieces: [detailPiece(1)] }) });
    expect(screen.getByText('1 piece')).toBeTruthy();
  });

  it('calls back with the back button, labelled with where it goes', () => {
    const { props } = renderPage();
    fireEvent.click(screen.getByRole('button', { name: '← Orders' }));
    expect(props.onBack).toHaveBeenCalledOnce();
  });
});

describe('OrderDetailPage stage and hand-over', () => {
  it('puts the processing stepper, the packing card slot and the next-stage button on an order in progress', () => {
    renderPage({ order: detailOrder({ status: 'washing' }), packingSlot: <p>Packing card here</p> });
    expect(screen.getByRole('region', { name: 'Processing stage' })).toBeTruthy();
    expect(screen.getByText('Packing card here')).toBeTruthy();
    expect(button('Move to Drying')).not.toBeNull();
    expect(screen.getByText('Order is Washing. Mark it ready before hand-over.')).toBeTruthy();
    expect(button('Hand over to customer →')).toBeNull();
  });

  it('offers hand-over on a ready order and moves the order on through the stepper', () => {
    const { props } = renderPage({ order: detailOrder({ status: 'ready' }) });
    fireEvent.click(screen.getByRole('button', { name: 'Hand over to customer →' }));
    expect(props.onHandover).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Mark it ready before hand-over/)).toBeNull();
  });

  it('forwards a stage move from the stepper to the parent', () => {
    const { props } = renderPage({ order: detailOrder({ status: 'washing' }) });
    fireEvent.click(screen.getByRole('button', { name: 'Move to Drying' }));
    expect(props.onMoveStage).toHaveBeenCalledWith('drying');
  });

  it('shows the handover date on a collected order, with no hand-over or cancel controls', () => {
    renderPage({ order: detailOrder({ status: 'collected', collectedAt: '2026-10-17T06:00:00Z', balanceMinor: 0, paidMinor: 4000 }) });
    expect(screen.getByText('Handed over').closest('p')?.textContent?.trim()).toBe('Handed over 17 Oct 2026, 11:30 am');
    expect(button('Hand over to customer →')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(button('Cancel order')).toBeNull();
  });

  it('shows the cancelled banner in place of the stages, with no pickup or payment action left', () => {
    renderPage({ order: detailOrder({ status: 'cancelled', refundDueMinor: 0, balanceMinor: 0 }) });
    expect(screen.getByText('This order was cancelled. No payment or pickup can be recorded for it.')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Processing stage' })).toBeNull();
    expect(button('Hand over to customer →')).toBeNull();
    expect(screen.queryByText(/Mark it ready before hand-over/)).toBeNull();
    expect(screen.queryByText(/Order is /)).toBeNull();
  });

  it('keeps exactly one primary button on screen for an order that is ready', () => {
    renderPage({ order: detailOrder({ status: 'ready', balanceMinor: 4000 }) });
    expect(primaryButtons().map(item => item.textContent)).toEqual(['Hand over to customer →']);
  });

  it('keeps exactly one primary button on screen for an order still in progress', () => {
    renderPage({ order: detailOrder({ status: 'washing' }) });
    expect(primaryButtons().map(item => item.textContent)).toEqual(['Move to Drying']);
  });

  it('disables the hand-over button while busy', () => {
    renderPage({ busy: true });
    expect((button('Hand over to customer →') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('OrderDetailPage money and actions', () => {
  it('shows the payment panel with the receive button for the balance due', () => {
    const { props } = renderPage({ money: detailMoneyForm({ amount: '' }) });
    expect(screen.getByRole('region', { name: 'Payment' })).toBeTruthy();
    expect(screen.getByText('Balance due ₹40.00')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Receive ₹40.00' }));
    expect(props.money.onReceive).toHaveBeenCalledOnce();
  });

  it('wires the admin cancel through the more actions disclosure', () => {
    const { props } = renderPage({ order: detailOrder({ status: 'packing', paidMinor: 1000, balanceMinor: 3000 }) });
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }));
    fireEvent.change(screen.getByLabelText('Reason for cancelling'), { target: { value: 'Wrong bill' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refund ₹10.00 to the customer' }));
    expect(props.onCancel).toHaveBeenCalledWith('Wrong bill');
  });

  it('offers the bill reprint in plain view, and the print status in the disclosure', () => {
    const { props } = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Reprint bill' }));
    expect(props.onReprintBill).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    const panel = screen.getByRole('region', { name: 'More actions' });
    expect(within(panel).queryByRole('button', { name: 'Reprint bill' })).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: 'Print status' }));
    expect(props.onOpenPrints).toHaveBeenCalledOnce();
  });

  it('disables the bill reprint while the order is busy', () => {
    renderPage({ busy: true });
    expect((screen.getByRole('button', { name: 'Reprint bill' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
