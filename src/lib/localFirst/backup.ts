import { invoke } from '@tauri-apps/api/core';
import { assertLocalDatabaseRuntime } from './db';

export const backupDatabase = async (): Promise<string> => {
  assertLocalDatabaseRuntime();
  return invoke<string>('backup_database');
};

export const restoreDatabase = async (sourcePath: string): Promise<string> => {
  assertLocalDatabaseRuntime();
  if (!sourcePath.trim()) throw new Error('Choose a backup file to restore.');
  return invoke<string>('restore_database', { sourcePath });
};
