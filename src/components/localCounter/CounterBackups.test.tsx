// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CounterBackups } from './CounterBackups';
import type { CounterBackupSettings } from '@/lib/localFirst/counter';

const api = vi.hoisted(() => ({ getCounterBackupSettings: vi.fn(), setCounterBackupMirror: vi.fn(), runCounterBackup: vi.fn(), restoreCounterBackup: vi.fn(), clearCounterOrders: vi.fn(), CLEAR_ORDERS_CONFIRMATION: 'CLEAR' }));
const dialog = vi.hoisted(() => ({ open: vi.fn(), confirm: vi.fn() }));
vi.mock('@/lib/localFirst/counter', () => api);
vi.mock('@tauri-apps/plugin-dialog', () => dialog);

const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
const base: CounterBackupSettings = { folder: 'C:\\Data\\backups', mirrorDir: null, mirrorStatus: null, lastBackupAt: recent };
const setup = () => { const onError = vi.fn(); const onNotice = vi.fn(); const onRestoreStaged = vi.fn(); render(<CounterBackups onError={onError} onNotice={onNotice} onRestoreStaged={onRestoreStaged} />); return { onError, onNotice, onRestoreStaged }; };
beforeEach(() => {
  vi.clearAllMocks();
  api.getCounterBackupSettings.mockResolvedValue(base);
  api.runCounterBackup.mockResolvedValue({ ...base, lastBackupAt: new Date().toISOString() });
  api.setCounterBackupMirror.mockResolvedValue(undefined);
  api.restoreCounterBackup.mockResolvedValue('Restore staged. Close and reopen the app to apply it.');
  dialog.open.mockResolvedValue('E:\\Backups\\laundry-1.db');
  dialog.confirm.mockResolvedValue(true);
});
afterEach(cleanup);

describe('CounterBackups', () => {
  it('shows where backups go and a recent backup without a warning', async () => {
    setup();
    await screen.findByText('C:\\Data\\backups');
    expect(screen.getByText(/Last backup:/).getAttribute('role')).toBeNull();
    expect(screen.queryByText(/more than a day ago/)).toBeNull();
  });

  it('warns when the last backup is more than a day old or missing', async () => {
    api.getCounterBackupSettings.mockResolvedValue({ ...base, lastBackupAt: old });
    setup();
    expect((await screen.findByText(/more than a day ago/)).getAttribute('role')).toBe('alert');
    cleanup();
    api.getCounterBackupSettings.mockResolvedValue({ ...base, lastBackupAt: null });
    setup();
    expect((await screen.findByText(/No backup has been recorded yet/)).getAttribute('role')).toBe('alert');
  });

  it('backs up on demand and reports success or failure', async () => {
    const { onNotice, onError } = setup();
    await screen.findByText('C:\\Data\\backups');
    fireEvent.click(screen.getByRole('button', { name: 'Back up now' }));
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('Backup saved.'));
    api.runCounterBackup.mockRejectedValue(new Error('disk full'));
    fireEvent.click(screen.getByRole('button', { name: 'Back up now' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'disk full' })));
    expect((screen.getByRole('button', { name: 'Back up now' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('saves and clears the second backup folder', async () => {
    const { onNotice } = setup();
    await screen.findByText('C:\\Data\\backups');
    fireEvent.change(screen.getByLabelText(/Second backup folder/), { target: { value: 'E:\\Backups' } });
    api.getCounterBackupSettings.mockResolvedValue({ ...base, mirrorDir: 'E:\\Backups', mirrorStatus: 'ok' });
    fireEvent.click(screen.getByRole('button', { name: 'Save second backup folder' }));
    await waitFor(() => expect(api.setCounterBackupMirror).toHaveBeenCalledWith('E:\\Backups'));
    await screen.findByText('The last backup was copied to the second folder.');
    expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('receives every new backup'));
    fireEvent.change(screen.getByLabelText(/Second backup folder/), { target: { value: '  ' } });
    api.getCounterBackupSettings.mockResolvedValue(base);
    fireEvent.click(screen.getByRole('button', { name: 'Save second backup folder' }));
    await waitFor(() => expect(api.setCounterBackupMirror).toHaveBeenLastCalledWith(null));
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('Second backup folder cleared.'));
  });

  it('shows why the second folder failed, and the waiting state', async () => {
    api.getCounterBackupSettings.mockResolvedValue({ ...base, mirrorDir: 'E:\\B', mirrorStatus: 'failed: the second backup folder is not available' });
    setup();
    const failure = await screen.findByText(/The last copy to the second folder failed: the second backup folder is not available/);
    expect(failure.getAttribute('role')).toBe('alert');
    cleanup();
    api.getCounterBackupSettings.mockResolvedValue({ ...base, mirrorDir: 'E:\\B', mirrorStatus: '' });
    setup();
    expect(await screen.findByText('The second folder will receive the next backup.')).toBeTruthy();
  });

  it('reports load and save failures', async () => {
    api.getCounterBackupSettings.mockRejectedValue(new Error('no settings'));
    const { onError } = setup();
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'no settings' })));
    api.setCounterBackupMirror.mockRejectedValue(new Error('not writable'));
    fireEvent.change(screen.getByLabelText(/Second backup folder/), { target: { value: 'E:\\X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save second backup folder' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'not writable' })));
  });

  describe('restore from a backup', () => {
    const restoreButton = () => screen.getByRole('button', { name: /Restore from backup/ });

    it('picks a database file, asks for confirmation that warns about accounts and PINs, then stages it', async () => {
      const { onNotice, onRestoreStaged, onError } = setup();
      await screen.findByText('C:\\Data\\backups');
      fireEvent.click(restoreButton());
      await waitFor(() => expect(onRestoreStaged).toHaveBeenCalledTimes(1));
      expect(dialog.open).toHaveBeenCalledWith(expect.objectContaining({ multiple: false, directory: false, filters: [{ name: 'SQLite database', extensions: ['db'] }] }));
      const [message, options] = dialog.confirm.mock.calls[0];
      expect(message).toMatch(/accounts and PINs/);
      expect(message).toMatch(/deactivated/);
      expect(message).toMatch(/safety copy/);
      expect(options).toEqual(expect.objectContaining({ kind: 'warning', okLabel: 'Stage restore' }));
      expect(api.restoreCounterBackup).toHaveBeenCalledExactlyOnceWith('E:\\Backups\\laundry-1.db');
      expect(onNotice).toHaveBeenCalledWith('Restore staged. Close and reopen the app to apply it.');
      expect(onError).not.toHaveBeenCalled();
      expect((restoreButton() as HTMLButtonElement).disabled).toBe(false);
    });

    it('does nothing when the file chooser is cancelled', async () => {
      dialog.open.mockResolvedValue(null);
      const { onRestoreStaged, onError } = setup();
      await screen.findByText('C:\\Data\\backups');
      fireEvent.click(restoreButton());
      await waitFor(() => expect(dialog.open).toHaveBeenCalled());
      await waitFor(() => expect((restoreButton() as HTMLButtonElement).disabled).toBe(false));
      expect(dialog.confirm).not.toHaveBeenCalled();
      expect(api.restoreCounterBackup).not.toHaveBeenCalled();
      expect(onRestoreStaged).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });

    it('does nothing when the confirmation is declined', async () => {
      dialog.confirm.mockResolvedValue(false);
      const { onRestoreStaged } = setup();
      await screen.findByText('C:\\Data\\backups');
      fireEvent.click(restoreButton());
      await waitFor(() => expect(dialog.confirm).toHaveBeenCalled());
      await waitFor(() => expect((restoreButton() as HTMLButtonElement).disabled).toBe(false));
      expect(api.restoreCounterBackup).not.toHaveBeenCalled();
      expect(onRestoreStaged).not.toHaveBeenCalled();
    });

    it('reports a refused or failed restore and does not mark one as staged', async () => {
      api.restoreCounterBackup.mockRejectedValue(new Error('Administrator access is required to restore a backup.'));
      const { onError, onRestoreStaged } = setup();
      await screen.findByText('C:\\Data\\backups');
      fireEvent.click(restoreButton());
      await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Administrator access') })));
      expect(onRestoreStaged).not.toHaveBeenCalled();
      expect((restoreButton() as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it('refreshes the backup status after all orders are cleared', async () => {
    api.clearCounterOrders.mockResolvedValue({ orders: 3, customers: 2, backupPath: 'C:\\Data\\backups\\b.db' });
    const { onNotice } = setup();
    await screen.findByText('C:\\Data\\backups');
    fireEvent.click(screen.getByRole('button', { name: 'Clear all orders…' }));
    fireEvent.change(screen.getByLabelText('Type CLEAR to confirm'), { target: { value: 'CLEAR' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove every order and customer' }));
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('Removed 3 orders and 2 customers')));
    await waitFor(() => expect(api.getCounterBackupSettings).toHaveBeenCalledTimes(2));
  });

  it('reports a failed refresh after clearing', async () => {
    api.clearCounterOrders.mockResolvedValue({ orders: 0, customers: 0, backupPath: 'b.db' });
    const { onError } = setup();
    await screen.findByText('C:\\Data\\backups');
    api.getCounterBackupSettings.mockRejectedValue(new Error('gone'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear all orders…' }));
    fireEvent.change(screen.getByLabelText('Type CLEAR to confirm'), { target: { value: 'CLEAR' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove every order and customer' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'gone' })));
  });
});
