import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from './runtime';

export type SqlValue = string | number | null;
export type DatabaseRow = Record<string, unknown>;

export interface LocalDatabaseInfo {
  path: string;
  restorePending: boolean;
  error?: string;
  warning?: string;
}

export interface SqlQuery {
  sql: string;
  values: SqlValue[];
}

export interface SqlBatchStatement extends SqlQuery {
  expectedRows?: number;
  error?: string;
  mode?: 'execute' | 'select';
}

export interface SqlExecutionResult {
  rowsAffected: number;
  lastInsertId: number | null;
  rows?: DatabaseRow[];
}

const assertTauriRuntime = (): void => {
  if (!isTauriRuntime()) {
    throw new Error('The local SQLite database is available only in the Tauri runtime.');
  }
};

const validateSqlValues = (sql: string, values: SqlValue[]): void => {
  if (typeof sql !== 'string' || sql.trim().length === 0) {
    throw new TypeError('A SQL statement is required.');
  }
  if (!Array.isArray(values)) {
    throw new TypeError('SQL values must be an array.');
  }
  for (const value of values) {
    if (value !== null && typeof value !== 'string'
      && !(typeof value === 'number' && Number.isFinite(value))) {
      throw new TypeError('SQL values must be finite numbers, strings, or null.');
    }
  }
};

export const assertLocalDatabaseRuntime = (): void => {
  assertTauriRuntime();
};

export const getLocalDatabaseInfo = async (): Promise<LocalDatabaseInfo> => {
  assertTauriRuntime();
  const info = await invoke<LocalDatabaseInfo>('local_database_info');
  if (!info || typeof info.path !== 'string' || info.path.length === 0
    || typeof info.restorePending !== 'boolean'
    || (info.error !== undefined && typeof info.error !== 'string')
    || (info.warning !== undefined && typeof info.warning !== 'string')) {
    throw new TypeError('The native database returned invalid database information.');
  }
  return info;
};

export const localSelect = async <T = DatabaseRow>(
  query: string,
  values: SqlValue[] = [],
): Promise<T[]> => {
  assertTauriRuntime();
  validateSqlValues(query, values);
  return invoke<T[]>('local_select', { query, values });
};

export const localReadBatch = async <T = DatabaseRow>(
  statements: SqlQuery[],
): Promise<T[][]> => {
  assertTauriRuntime();
  statements.forEach(statement => validateSqlValues(statement.sql, statement.values));
  return invoke<T[][]>('local_read_batch', { statements });
};

export const localBatch = async (
  statements: SqlBatchStatement[],
): Promise<SqlExecutionResult[]> => {
  assertTauriRuntime();
  statements.forEach(statement => validateSqlValues(statement.sql, statement.values));
  return invoke<SqlExecutionResult[]>('local_batch', { statements });
};
