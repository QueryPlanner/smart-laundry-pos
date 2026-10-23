// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfirmDelete, count, EmptyState, FormField, PageHeader, StatCard, money } from './ui';
import { SECTION_ROLES, canOpen, type SectionId } from './sections';

afterEach(cleanup);

describe('counter workspace UI kit', () => {
  it('pluralises counts', () => {
    expect([count(0, 'order'), count(1, 'order'), count(2, 'piece')]).toEqual(['0 orders', '1 order', '2 pieces']);
  });

  it('formats paise as Indian rupees', () => {
    expect(money(123456)).toBe('₹1,234.56');
    expect(money(0)).toBe('₹0.00');
  });

  it('renders headers, stat cards, empty states and fields', () => {
    render(<>
      <PageHeader title="Sales" subtitle="Today" actions={<button>Export</button>} />
      <PageHeader title="Plain" />
      <StatCard label="Orders" value={4} hint="since 9 am" tone="good" />
      <StatCard label="Ready" value={1} />
      <EmptyState>Nothing yet</EmptyState>
      <FormField label="Name" hint="As on the bill"><input /></FormField>
    </>);
    expect(screen.getByRole('heading', { name: 'Sales' })).toBeTruthy();
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy();
    expect(screen.getByText('since 9 am')).toBeTruthy();
    expect(screen.getByText('Nothing yet')).toBeTruthy();
    expect(screen.getByLabelText(/Name/)).toBeTruthy();
    expect(screen.getByText('As on the bill')).toBeTruthy();
  });

  it('asks for a reason, rejects a short one, and confirms with the trimmed reason', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<ConfirmDelete what="expense Soap" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: ' x ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    expect((await screen.findByRole('alert')).textContent).toContain('3 to 200');
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: '  duplicate entry ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('duplicate entry'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ignores a second confirm tap while the first delete is still running', async () => {
    let finish: () => void = () => undefined;
    const onConfirm = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<ConfirmDelete what="expense Soap" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'duplicate entry' } });
    const confirmButton = screen.getByRole('button', { name: 'Confirm delete' }) as HTMLButtonElement;
    fireEvent.click(confirmButton);
    await waitFor(() => expect(confirmButton.disabled).toBe(true));
    fireEvent.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(confirmButton.disabled).toBe(false));
  });

  it('can be dismissed without deleting, and disables actions while busy', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(<ConfirmDelete what="machine" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    rerender(<ConfirmDelete what="machine" busy onConfirm={onConfirm} />);
    expect((screen.getByRole('button', { name: 'Confirm delete' }) as HTMLButtonElement).disabled).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('section access table', () => {
  it('keeps prices, staff, printers, backups, shop settings and the trash admin-only and the rest open', () => {
    const adminOnly: SectionId[] = ['admin', 'settings', 'trash'];
    for (const id of Object.keys(SECTION_ROLES) as SectionId[]) {
      expect(canOpen(id, 'admin')).toBe(true);
      expect(canOpen(id, 'staff')).toBe(!adminOnly.includes(id));
    }
  });
});
