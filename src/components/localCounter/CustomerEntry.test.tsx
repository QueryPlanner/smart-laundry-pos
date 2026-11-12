// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CounterCustomerMatch } from '@/lib/localFirst/counter';
import { CustomerEntry } from './CustomerEntry';
import { blankCustomer, type CustomerDraft } from './customerDraft';

const matches: CounterCustomerMatch[] = [
  { id: 'c-1', name: 'Rita Joshi', phone: '9876543210', address: null },
  { id: 'c-2', name: 'Rita Joshi', phone: '9000000000', address: '12 MG Road' },
];

const Harness = ({ search, initial = blankCustomer }: { search: (query: string) => Promise<CounterCustomerMatch[]>; initial?: CustomerDraft }) => {
  const [customer, setCustomer] = useState<CustomerDraft>(initial);
  return <>
    <CustomerEntry customer={customer} onChange={setCustomer} search={search} />
    <output data-testid="draft">{JSON.stringify(customer)}</output>
  </>;
};
const draft = (): CustomerDraft => JSON.parse(screen.getByTestId('draft').textContent || '{}');
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

describe('CustomerEntry', () => {
  it('shows Name, Mobile number and an optional Address with the Customers limits', () => {
    render(<Harness search={vi.fn()} />);
    expect(field('Name').maxLength).toBe(100);
    expect(field('Mobile number').maxLength).toBe(20);
    expect(field('Address (optional)').maxLength).toBe(300);
    const labels = screen.getAllByText(/^(Name|Mobile number|Address \(optional\))$/).map(node => node.textContent);
    expect(labels).toEqual(['Name', 'Mobile number', 'Address (optional)']);
  });

  it('looks up by mobile, shows name and mobile, and fills the saved customer on selection', async () => {
    const search = vi.fn().mockResolvedValue(matches);
    render(<Harness search={search} />);
    fireEvent.change(field('Mobile number'), { target: { value: '9000' } });
    await waitFor(() => expect(search).toHaveBeenCalledWith('9000'));
    const options = await screen.findAllByRole('option');
    expect(options[1].textContent).toBe('Rita Joshi9000000000');
    fireEvent.click(options[1]);
    expect(draft()).toMatchObject({ name: 'Rita Joshi', phone: '9000000000', address: '12 MG Road', customerId: 'c-2', addressLocked: true });
    expect(field('Address (optional)').readOnly).toBe(true);
    expect(screen.getByText('This is the saved address. Correct it on the Customers screen.')).toBeTruthy();
    // A selected customer needs no lookup until the name or mobile is edited; the mobile wins.
    fireEvent.change(field('Name'), { target: { value: 'Rita J' } });
    await waitFor(() => expect(search).toHaveBeenLastCalledWith('9000000000'));
  });

  it('looks up by name, requires a pick even when one name matches, and allows a shared mobile', async () => {
    const search = vi.fn().mockResolvedValue([matches[0]]);
    render(<Harness search={search} />);
    fireEvent.change(field('Name'), { target: { value: 'Rita' } });
    await waitFor(() => expect(search).toHaveBeenCalledWith('Rita'));
    const option = await screen.findByRole('option');
    expect(draft().customerId).toBeUndefined();
    fireEvent.click(option);
    expect(draft()).toMatchObject({ customerId: 'c-1', phone: '9876543210', address: '' });
    expect(field('Address (optional)').readOnly).toBe(false);
  });

  it('clears the selected identity when the name or mobile is edited', async () => {
    const search = vi.fn().mockResolvedValue(matches);
    render(<Harness search={search} />);
    fireEvent.change(field('Mobile number'), { target: { value: '9000' } });
    fireEvent.click((await screen.findAllByRole('option'))[1]);
    expect(draft().customerId).toBe('c-2');

    fireEvent.change(field('Name'), { target: { value: 'Rita J' } });
    expect(draft()).toMatchObject({ name: 'Rita J', addressLocked: false });
    expect(draft().customerId).toBeUndefined();
    expect(field('Address (optional)').readOnly).toBe(false);

    fireEvent.click((await screen.findAllByRole('option'))[1]);
    expect(draft().customerId).toBe('c-2');
    fireEvent.change(field('Mobile number'), { target: { value: '9000000001' } });
    expect(draft()).toMatchObject({ phone: '9000000001', addressLocked: false });
    expect(draft().customerId).toBeUndefined();
  });

  it('keeps the selected identity while an empty address is filled in', async () => {
    const search = vi.fn().mockResolvedValue([matches[0]]);
    render(<Harness search={search} />);
    fireEvent.change(field('Name'), { target: { value: 'Rita' } });
    fireEvent.click(await screen.findByRole('option'));
    fireEvent.change(field('Address (optional)'), { target: { value: '  ' } });
    expect(draft()).toMatchObject({ customerId: 'c-1', address: '  ' });
  });

  it('allows manual entry when the lookup fails, and does not search short text', async () => {
    const search = vi.fn()
      .mockRejectedValueOnce(new Error('lookup down'))
      .mockRejectedValueOnce('still down')
      .mockRejectedValueOnce(undefined);
    render(<Harness search={search} />);
    fireEvent.change(field('Name'), { target: { value: 'R' } });
    fireEvent.change(field('Mobile number'), { target: { value: '98' } });
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(search).not.toHaveBeenCalled();

    fireEvent.change(field('Name'), { target: { value: 'Rita' } });
    await waitFor(() => expect(search).toHaveBeenCalledWith('Rita'));
    expect(await screen.findByText('Customer lookup unavailable; enter details manually.')).toBeTruthy();
    // A failure that is not an Error object, or is missing, is still reported the same way.
    fireEvent.change(field('Name'), { target: { value: 'Ritaa' } });
    await waitFor(() => expect(search).toHaveBeenLastCalledWith('Ritaa'));
    fireEvent.change(field('Name'), { target: { value: 'Ritaaa' } });
    await waitFor(() => expect(search).toHaveBeenLastCalledWith('Ritaaa'));
    fireEvent.change(field('Mobile number'), { target: { value: '9876543210' } });
    expect(draft()).toMatchObject({ name: 'Ritaaa', phone: '9876543210' });
    expect(draft().customerId).toBeUndefined();
  });

  it('ignores a lookup that finishes after the screen has gone', async () => {
    let finish: (rows: CounterCustomerMatch[]) => void = () => undefined;
    const search = vi.fn().mockReturnValue(new Promise<CounterCustomerMatch[]>(resolve => { finish = resolve; }));
    const { unmount } = render(<Harness search={search} />);
    fireEvent.change(field('Name'), { target: { value: 'Rita' } });
    await waitFor(() => expect(search).toHaveBeenCalledWith('Rita'));
    unmount();
    finish(matches);
    await Promise.resolve();
    expect(screen.queryByTestId('draft')).toBeNull();
  });
});
