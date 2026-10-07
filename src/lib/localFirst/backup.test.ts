import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { backupDatabase, restoreDatabase } from './backup';

describe('native database backup commands', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    invoke.mockReset();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('requests a native backup and returns its saved path', async () => {
    invoke.mockResolvedValue('/app/backups/laundry.db');

    await expect(backupDatabase()).resolves.toBe('/app/backups/laundry.db');
    expect(invoke).toHaveBeenCalledExactlyOnceWith('backup_database');
  });

  it('stages the exact selected path through the native restore command', async () => {
    invoke.mockResolvedValue('Restore will apply after restart.');
    const sourcePath = '/Users/shop/Backups/laundry copy.db';

    await expect(restoreDatabase(sourcePath)).resolves.toBe('Restore will apply after restart.');
    expect(invoke).toHaveBeenCalledExactlyOnceWith('restore_database', { sourcePath });
  });

  it('rejects an empty restore path and blocks browser storage commands', async () => {
    await expect(restoreDatabase('   ')).rejects.toThrow('Choose a backup file');
    expect(invoke).not.toHaveBeenCalled();

    vi.stubGlobal('window', {});
    await expect(backupDatabase()).rejects.toThrow('only in the Tauri runtime');
    await expect(restoreDatabase('/backup.db')).rejects.toThrow('only in the Tauri runtime');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('propagates native backup and restore failures', async () => {
    const nativeError = new Error('Backup directory is unavailable.');
    invoke.mockRejectedValue(nativeError);

    await expect(backupDatabase()).rejects.toBe(nativeError);
    await expect(restoreDatabase('/backup.db')).rejects.toBe(nativeError);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
