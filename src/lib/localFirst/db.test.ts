import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import {
  getLocalDatabaseInfo,
  localBatch,
  localReadBatch,
  localSelect,
} from './db';
import type { SqlValue } from './db';

describe('native SQLite IPC adapter', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    invoke.mockReset();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('loads and validates native database information, including initialization errors', async () => {
    const info = {
      path: '/app/data/laundry.db',
      restorePending: true,
      error: 'Migration failed.',
      warning: 'The staged restore was rejected.',
    };
    invoke.mockResolvedValue(info);

    await expect(getLocalDatabaseInfo()).resolves.toEqual(info);
    expect(invoke).toHaveBeenCalledWith('local_database_info');

    invoke.mockResolvedValueOnce({ path: '/app/data/laundry.db', restorePending: 'false' });
    await expect(getLocalDatabaseInfo()).rejects.toThrow('invalid database information');

    invoke.mockResolvedValueOnce({ path: '/app/data/laundry.db', restorePending: false });
    await expect(getLocalDatabaseInfo()).resolves.toEqual({
      path: '/app/data/laundry.db',
      restorePending: false,
    });

    invoke.mockResolvedValueOnce({ path: '/app/data/laundry.db', restorePending: false, warning: null });
    await expect(getLocalDatabaseInfo()).rejects.toThrow('invalid database information');
  });

  it('forwards one parameterized read and returns its JSON rows', async () => {
    const rows = [{ id: 'order-1', total_amount: 75 }];
    invoke.mockResolvedValue(rows);

    await expect(localSelect<{ id: string; total_amount: number }>(
      'SELECT id, total_amount FROM orders WHERE id = ?',
      ['order-1'],
    )).resolves.toEqual(rows);
    expect(invoke).toHaveBeenCalledWith('local_select', {
      query: 'SELECT id, total_amount FROM orders WHERE id = ?',
      values: ['order-1'],
    });
  });

  it('forwards a grouped read as one snapshot request, including an empty batch', async () => {
    const rows = [[{ count: 3 }], [{ total: 99 }]];
    invoke.mockResolvedValueOnce(rows).mockResolvedValueOnce([]);

    await expect(localReadBatch([
      { sql: 'SELECT COUNT(*) AS count FROM orders', values: [] },
      { sql: 'SELECT SUM(total_amount) AS total FROM orders', values: [] },
    ])).resolves.toEqual(rows);
    expect(invoke).toHaveBeenNthCalledWith(1, 'local_read_batch', {
      statements: [
        { sql: 'SELECT COUNT(*) AS count FROM orders', values: [] },
        { sql: 'SELECT SUM(total_amount) AS total FROM orders', values: [] },
      ],
    });

    await expect(localReadBatch([])).resolves.toEqual([]);
    expect(invoke).toHaveBeenNthCalledWith(2, 'local_read_batch', { statements: [] });
  });

  it('forwards conditional writes and select-mode results as one native batch', async () => {
    const result = [
      { rowsAffected: 1, lastInsertId: null },
      { rowsAffected: 1, lastInsertId: null, rows: [{ id: 'order-1' }] },
    ];
    const statements = [
      { sql: 'UPDATE orders SET status = ? WHERE id = ?', values: ['ready', 'order-1'], expectedRows: 1, error: 'Order not found.' },
      { sql: 'SELECT * FROM orders WHERE id = ?', values: ['order-1'], expectedRows: 1, mode: 'select' as const },
    ];
    invoke.mockResolvedValue(result);

    await expect(localBatch(statements)).resolves.toEqual(result);
    expect(invoke).toHaveBeenCalledWith('local_batch', { statements });
  });

  it('blocks browser use and malformed bindings before IPC', async () => {
    vi.stubGlobal('window', {});
    await expect(localSelect('SELECT 1')).rejects.toThrow('only in the Tauri runtime');

    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    await expect(localSelect('  ', [])).rejects.toThrow('SQL statement is required');
    await expect(localSelect('SELECT ?', [Number.NaN])).rejects.toThrow('finite numbers');
    await expect(localReadBatch([{ sql: 'SELECT ?', values: [Number.POSITIVE_INFINITY] }]))
      .rejects.toThrow('finite numbers');
    await expect(localBatch([{ sql: '', values: [] }])).rejects.toThrow('SQL statement is required');
    await expect(localSelect('SELECT 1', {} as SqlValue[])).rejects.toThrow('values must be an array');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('surfaces native query and initialization failures without retrying', async () => {
    const nativeError = new Error('Native database is unavailable.');
    invoke.mockRejectedValue(nativeError);

    await expect(localBatch([{ sql: 'INSERT INTO orders DEFAULT VALUES', values: [] }]))
      .rejects.toBe(nativeError);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
