// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LocalFirstApp } from './LocalFirstApp';

const api = vi.hoisted(() => ({ getCounterBootstrap: vi.fn() }));
vi.mock('@/lib/localFirst/counter', () => api);

afterEach(cleanup);

describe('LocalFirstApp', () => {
  it('is the counter workspace itself: first run asks for the administrator account', async () => {
    api.getCounterBootstrap.mockResolvedValue({ setupRequired: true, authenticated: false, account: null, accounts: [] });
    render(<LocalFirstApp />);
    expect(await screen.findByRole('heading', { name: 'Set up Smart Laundry' })).toBeTruthy();
  });

  it('offers no separate legacy workspace to switch to', async () => {
    api.getCounterBootstrap.mockResolvedValue({ setupRequired: false, authenticated: false, account: null, accounts: [] });
    render(<LocalFirstApp />);
    expect(await screen.findByText('Choose your name and enter your PIN.')).toBeTruthy();
    expect(screen.queryByText(/admin workspace/i)).toBeNull();
  });
});
