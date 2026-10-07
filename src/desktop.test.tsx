// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Root } from 'react-dom/client';
import { act, cleanup, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  startLocalFirstApp: vi.fn(),
  root: undefined as unknown,
}));

vi.mock('@/lib/localFirst/startup', () => ({ startLocalFirstApp: mocks.startLocalFirstApp }));
vi.mock('react-dom/client', async importOriginal => {
  const actual = await importOriginal<typeof import('react-dom/client')>();
  return {
    ...actual,
    createRoot: (container: Parameters<typeof actual.createRoot>[0], options?: Parameters<typeof actual.createRoot>[1]) => {
      const root = actual.createRoot(container, options);
      mocks.root = root;
      return root;
    },
  };
});

beforeEach(() => {
  vi.resetModules();
  mocks.startLocalFirstApp.mockReset();
  mocks.startLocalFirstApp.mockResolvedValue({ hasLocalUser: false });
  mocks.root = undefined;
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(async () => {
  const root = mocks.root as Root | undefined;
  if (root) await act(async () => root.unmount());
  cleanup();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('desktop entry point', () => {
  it('fails clearly when the desktop document has no app root', async () => {
    document.body.innerHTML = '';

    await expect(import('./desktop')).rejects.toThrow('The desktop app root element is missing.');
    expect(mocks.startLocalFirstApp).not.toHaveBeenCalled();
  });

  it('mounts the local setup screen into the desktop document root', async () => {
    await import('./desktop');

    expect(await screen.findByRole('heading', { name: 'Set up Smart Laundry' })).toBeTruthy();
    expect(mocks.startLocalFirstApp).toHaveBeenCalled();
  });
});
