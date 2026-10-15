import { backupDatabase } from './backup';
import { localLaundryRepository } from './repository';

export type LocalFirstStartupResult = {
  hasLocalUser: boolean;
  initializationWarning?: string;
  backupError?: unknown;
};

let startupPromise: Promise<LocalFirstStartupResult> | undefined;

const bootstrapLocalFirstApp = async (): Promise<LocalFirstStartupResult> => {
  const databaseInfo = await localLaundryRepository.initialize();
  const hasLocalUser = await localLaundryRepository.hasLocalUser();
  const initializationWarning = databaseInfo.warning;

  if (!hasLocalUser) {
    return initializationWarning === undefined
      ? { hasLocalUser }
      : { hasLocalUser, initializationWarning };
  }

  try {
    await backupDatabase();
    return initializationWarning === undefined
      ? { hasLocalUser }
      : { hasLocalUser, initializationWarning };
  } catch (backupError) {
    return initializationWarning === undefined
      ? { hasLocalUser, backupError }
      : { hasLocalUser, initializationWarning, backupError };
  }
};

export const startLocalFirstApp = (): Promise<LocalFirstStartupResult> => {
  if (!startupPromise) {
    startupPromise = bootstrapLocalFirstApp().catch(initializationError => {
      startupPromise = undefined;
      throw initializationError;
    });
  }

  return startupPromise;
};
