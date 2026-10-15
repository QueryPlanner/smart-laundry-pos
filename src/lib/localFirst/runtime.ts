export type RuntimeMode = 'tauri-local' | 'browser-legacy';

export const isTauriRuntime = (): boolean => {
  if (typeof window === 'undefined') return false;

  return '__TAURI_INTERNALS__' in window;
};

export const getRuntimeMode = (): RuntimeMode => (
  isTauriRuntime() ? 'tauri-local' : 'browser-legacy'
);
