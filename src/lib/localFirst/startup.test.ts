import { beforeEach, describe, expect, it, vi } from 'vitest';

const { initialize, hasLocalUser, backupDatabase } = vi.hoisted(() => ({
  initialize: vi.fn(),
  hasLocalUser: vi.fn(),
  backupDatabase: vi.fn(),
}));

vi.mock('./repository', () => ({
  localLaundryRepository: { initialize, hasLocalUser },
}));

vi.mock('./backup', () => ({ backupDatabase }));

describe('local-first app startup', () => {
  const databaseInfo = { path: '/app/data/laundry.db', restorePending: false };

  beforeEach(() => {
    vi.resetModules();
    initialize.mockReset();
    hasLocalUser.mockReset();
    backupDatabase.mockReset();
    initialize.mockResolvedValue(databaseInfo);
  });

  it.each([
    ['without a native warning', undefined],
    ['alongside a native warning', 'The staged restore was rejected.'],
  ])('shares concurrent startup and reports a backup failure %s', async (_case, initializationWarning) => {
    let finishInitialization = () => {};
    initialize.mockImplementation(() => new Promise(resolve => {
      finishInitialization = () => resolve({
        ...databaseInfo,
        ...(initializationWarning === undefined ? {} : { warning: initializationWarning }),
      });
    }));
    hasLocalUser.mockResolvedValue(true);
    const backupError = new Error('Backup folder is unavailable.');
    backupDatabase.mockRejectedValue(backupError);

    const { startLocalFirstApp } = await import('./startup');
    const firstStart = startLocalFirstApp();
    const strictModeStart = startLocalFirstApp();

    expect(initialize).toHaveBeenCalledTimes(1);
    finishInitialization();

    const [firstResult, strictModeResult] = await Promise.all([firstStart, strictModeStart]);
    expect(firstResult).toEqual({
      hasLocalUser: true,
      ...(initializationWarning === undefined ? {} : { initializationWarning }),
      backupError,
    });
    expect(strictModeResult).toEqual(firstResult);
    expect(hasLocalUser).toHaveBeenCalledTimes(1);
    expect(backupDatabase).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['without a native warning', undefined],
    ['with a native warning', 'The staged restore was rejected.'],
  ])('reuses a successful existing-user startup after it settles %s', async (_case, warning) => {
    initialize.mockResolvedValue({
      ...databaseInfo,
      ...(warning === undefined ? {} : { warning }),
    });
    hasLocalUser.mockResolvedValue(true);
    backupDatabase.mockResolvedValue('/local-backups/laundry.db');

    const { startLocalFirstApp } = await import('./startup');
    const firstResult = await startLocalFirstApp();
    const remountedResult = await startLocalFirstApp();

    expect(firstResult).toEqual({
      hasLocalUser: true,
      ...(warning === undefined ? {} : { initializationWarning: warning }),
    });
    expect(remountedResult).toEqual(firstResult);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(hasLocalUser).toHaveBeenCalledTimes(1);
    expect(backupDatabase).toHaveBeenCalledTimes(1);
  });

  it('skips the startup backup when local setup is still required', async () => {
    initialize.mockResolvedValue({ ...databaseInfo, warning: 'The staged restore was rejected.' });
    hasLocalUser.mockResolvedValue(false);

    const { startLocalFirstApp } = await import('./startup');
    await expect(startLocalFirstApp()).resolves.toEqual({
      hasLocalUser: false,
      initializationWarning: 'The staged restore was rejected.',
    });

    expect(backupDatabase).not.toHaveBeenCalled();
  });

  it.each(['database initialization', 'local user lookup'])('propagates a %s error and retries startup', async failureStage => {
    const startupError = new Error(`${failureStage} failed.`);
    hasLocalUser.mockResolvedValue(false);
    if (failureStage === 'database initialization') initialize.mockRejectedValueOnce(startupError);
    else hasLocalUser.mockRejectedValueOnce(startupError);

    const { startLocalFirstApp } = await import('./startup');
    await expect(startLocalFirstApp()).rejects.toBe(startupError);
    await expect(startLocalFirstApp()).resolves.toEqual({ hasLocalUser: false });

    expect(initialize).toHaveBeenCalledTimes(2);
    expect(hasLocalUser).toHaveBeenCalledTimes(failureStage === 'database initialization' ? 1 : 2);
    expect(backupDatabase).not.toHaveBeenCalled();
  });
});
