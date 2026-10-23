// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ServiceList } from './ServiceList';
import type { CounterService } from '@/lib/localFirst/counter';

const api = vi.hoisted(() => ({ addCounterService: vi.fn(), setCounterServiceActive: vi.fn() }));
vi.mock('@/lib/localFirst/counter', () => api);

const services: CounterService[] = [
  { id: 'iron', key: 'iron', name: 'Iron', active: true },
  { id: 'steam', key: 'custom_1', name: 'Steam press', active: false },
];
const setup = (list = services) => {
  const props = { services: list, onChanged: vi.fn().mockResolvedValue(undefined), onError: vi.fn(), onNotice: vi.fn() };
  render(<ServiceList {...props} />);
  return props;
};
const row = (name: string) => within(screen.getByText(name).closest('li') as HTMLElement);
beforeEach(() => { vi.clearAllMocks(); api.addCounterService.mockResolvedValue(undefined); api.setCounterServiceActive.mockResolvedValue(undefined); });
afterEach(cleanup);

describe('ServiceList', () => {
  it('lists every service and marks the removed ones', () => {
    setup();
    expect(row('Iron').getByRole('button', { name: 'Remove' })).toBeTruthy();
    expect(row('Steam press').getByText('· removed')).toBeTruthy();
    expect(row('Steam press').getByRole('button', { name: 'Bring back' })).toBeTruthy();
  });

  it('never offers to remove the last service', () => {
    setup();
    expect((row('Iron').getByRole('button', { name: 'Remove' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('removes and brings back a service, then reloads the rate card', async () => {
    const props = setup([...services, { id: 'wash', key: 'wash', name: 'Wash + Press', active: true }]);
    fireEvent.click(row('Wash + Press').getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith('Wash + Press removed. Past bills keep it.'));
    expect(api.setCounterServiceActive).toHaveBeenCalledWith('wash', false);
    fireEvent.click(row('Steam press').getByRole('button', { name: 'Bring back' }));
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith('Steam press is back.'));
    expect(api.setCounterServiceActive).toHaveBeenCalledWith('steam', true);
    expect(props.onChanged).toHaveBeenCalledTimes(2);
  });

  it('adds a service and clears the box, and needs a name first', async () => {
    const props = setup();
    const add = screen.getByRole('button', { name: 'Add service' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('New service'), { target: { value: 'Steam iron' } });
    fireEvent.click(add);
    await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith('Service added. Give it a price on the garments it is for.'));
    expect(api.addCounterService).toHaveBeenCalledWith('Steam iron');
    expect((screen.getByLabelText('New service') as HTMLInputElement).value).toBe('');
  });

  it('reports a refusal and keeps the name', async () => {
    api.addCounterService.mockRejectedValue(new Error('A service with this name already exists.'));
    const props = setup();
    fireEvent.change(screen.getByLabelText('New service'), { target: { value: 'Iron' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add service' }));
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'A service with this name already exists.' })));
    expect((screen.getByLabelText('New service') as HTMLInputElement).value).toBe('Iron');
    expect(props.onChanged).not.toHaveBeenCalled();
  });
});
