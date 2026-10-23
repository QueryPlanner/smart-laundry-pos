// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ClearOrders } from './ClearOrders';

const api = vi.hoisted(() => ({ clearCounterOrders: vi.fn(), CLEAR_ORDERS_CONFIRMATION: 'CLEAR' }));
vi.mock('@/lib/localFirst/counter', () => api);

const setup = () => { const onError = vi.fn(); const onNotice = vi.fn(); render(<ClearOrders onError={onError} onNotice={onNotice} />); return { onError, onNotice }; };
const removeButton = () => screen.getByRole('button', { name: 'Remove every order and customer' }) as HTMLButtonElement;
beforeEach(() => { vi.clearAllMocks(); api.clearCounterOrders.mockResolvedValue({ orders: 4, customers: 3, backupPath: 'C:\\b.db' }); });
afterEach(cleanup);

describe('ClearOrders', () => {
  it('only enables the remove button once the word is typed', () => {
    setup();
    expect(screen.queryByLabelText('Type CLEAR to confirm')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all orders…' }));
    expect(removeButton().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Type CLEAR to confirm'), { target: { value: 'clear' } });
    expect(removeButton().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Type CLEAR to confirm'), { target: { value: ' CLEAR ' } });
    expect(removeButton().disabled).toBe(false);
  });

  it('clears, closes the form and says where the backup is', async () => {
    const { onNotice } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all orders…' }));
    fireEvent.change(screen.getByLabelText('Type CLEAR to confirm'), { target: { value: 'CLEAR' } });
    fireEvent.click(removeButton());
    expect(screen.getByRole('button', { name: 'Clearing…' })).toBeTruthy();
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('Removed 4 orders and 3 customers. A backup from just before is saved at C:\\b.db.'));
    expect(api.clearCounterOrders).toHaveBeenCalledWith('CLEAR');
    expect(screen.queryByLabelText('Type CLEAR to confirm')).toBeNull();
  });

  it('keeps the form open and reports an error', async () => {
    api.clearCounterOrders.mockRejectedValue(new Error('backup failed'));
    const { onError, onNotice } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all orders…' }));
    fireEvent.change(screen.getByLabelText('Type CLEAR to confirm'), { target: { value: 'CLEAR' } });
    fireEvent.click(removeButton());
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'backup failed' })));
    expect(onNotice).not.toHaveBeenCalled();
    expect(removeButton().disabled).toBe(false);
  });

  it('cancels without clearing and forgets the typed word', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all orders…' }));
    fireEvent.change(screen.getByLabelText('Type CLEAR to confirm'), { target: { value: 'CLEAR' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep everything' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear all orders…' }));
    expect((screen.getByLabelText('Type CLEAR to confirm') as HTMLInputElement).value).toBe('');
    expect(api.clearCounterOrders).not.toHaveBeenCalled();
  });
});
