import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRuntimeMode, isTauriRuntime } from './runtime';

describe('local-first runtime detection', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('selects browser mode when there is no window or no Tauri marker', () => {
    vi.stubGlobal('window', undefined);
    expect(isTauriRuntime()).toBe(false);
    expect(getRuntimeMode()).toBe('browser-legacy');

    vi.stubGlobal('window', {});
    expect(isTauriRuntime()).toBe(false);
    expect(getRuntimeMode()).toBe('browser-legacy');
  });

  it('selects local mode when the Tauri runtime marker exists', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    expect(isTauriRuntime()).toBe(true);
    expect(getRuntimeMode()).toBe('tauri-local');
  });
});
