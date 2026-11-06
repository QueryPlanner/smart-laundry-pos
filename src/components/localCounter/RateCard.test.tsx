// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CounterCatalogue } from '@/lib/localFirst/counter';
import { RateCard } from './RateCard';

const api = vi.hoisted(() => ({ saveCounterRateCard: vi.fn() }));
vi.mock('@/lib/localFirst/counter', () => api);

const catalogue: CounterCatalogue = {
  garments: [
    { id: 'shirt', key: 'shirt', nameEn: 'Shirt', nameMr: 'शर्ट', category: 'tops', imageKey: 'shirt', billingUnit: 'piece', active: true },
    { id: 'shoe', key: 'shoes', nameEn: 'Shoes', nameMr: '', category: 'foot', imageKey: 'shoes', billingUnit: 'pair', active: true },
    { id: 'old', key: 'old', nameEn: 'Retired', nameMr: '', category: 'x', imageKey: 'x', billingUnit: 'piece', active: false },
  ],
  services: [
    { id: 'wash', key: 'wash', name: 'Wash', active: true },
    { id: 'iron', key: 'iron', name: 'Iron', active: true },
    { id: 'gone', key: 'dry_clean', name: 'Dry Clean', active: false },
  ],
  rates: [{ garmentId: 'shirt', serviceId: 'wash', priceMinor: 1500, configured: true, available: true, version: 1 }],
};
const setup = () => {
  const props = { catalogue, onCatalogue: vi.fn(), onError: vi.fn(), onNotice: vi.fn() };
  const view = render(<RateCard {...props} />);
  return { props, view };
};
const box = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const footer = () => (document.querySelector('.counter-rate-save') as HTMLElement).textContent;

beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

describe('RateCard', () => {
  it('shows one table of active garments and services, with nothing to save yet', () => {
    setup();
    expect(box('Shirt Wash price').value).toBe('15');
    expect(box('Shirt Iron price').value).toBe('');
    expect(box('Shoes Iron price').disabled).toBe(true);
    expect(screen.queryByLabelText('Retired Wash price')).toBeNull();
    expect(screen.queryByLabelText('Shirt Dry Clean price')).toBeNull();
    expect(screen.getByText(/Removed earlier: Retired, Dry Clean\./)).toBeTruthy();
    expect(footer()).toContain('No changes');
    expect(button('Save').disabled).toBe(true);
    expect(button('Undo changes').disabled).toBe(true);
    expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(1);
  });

  it('saves prices, names, removals and a new garment and service with one Save', async () => {
    const saved = { ...catalogue, garments: catalogue.garments.slice(0, 1) };
    api.saveCounterRateCard.mockResolvedValue(saved);
    const { props } = setup();
    fireEvent.change(box('Shirt Iron price'), { target: { value: '12.50' } });
    fireEvent.change(box('Name of garment Shirt'), { target: { value: 'Formal shirt' } });
    fireEvent.click(within(box('Shoes Wash price').closest('tr') as HTMLElement).getByRole('button', { name: 'Remove' }));
    fireEvent.change(box('Name of service Wash'), { target: { value: 'Wash + Press' } });
    fireEvent.change(box('New garment'), { target: { value: 'Apron' } });
    fireEvent.click(button('Add garment'));
    // A new garment opens its picture choice.
    fireEvent.click(screen.getByLabelText('Apron', { selector: 'input[type=radio]' }));
    fireEvent.click(button('Done'));
    fireEvent.change(box('New service'), { target: { value: 'Steam press' } });
    fireEvent.click(button('Add service'));
    fireEvent.change(box('Apron Steam press price'), { target: { value: '40' } });
    expect(footer()).toContain('7 changes not saved');
    fireEvent.click(button('Save'));
    await waitFor(() => expect(props.onCatalogue).toHaveBeenCalledWith(saved));
    const changes = api.saveCounterRateCard.mock.calls[0][0];
    expect(changes.garments).toEqual([{ id: 'shirt', name: 'Formal shirt' }, { id: 'shoe', removed: true }]);
    expect(changes.services).toEqual([{ id: 'wash', name: 'Wash + Press' }]);
    expect(changes.newGarments).toEqual([{ ref: expect.stringMatching(/^new:/), name: 'Apron', picture: 'apron' }]);
    expect(changes.newServices).toEqual([{ ref: expect.stringMatching(/^new:/), name: 'Steam press' }]);
    expect(changes.prices).toEqual([
      { garmentId: 'shirt', serviceId: 'iron', priceMinor: 1250 },
      { garmentId: changes.newGarments[0].ref, serviceId: changes.newServices[0].ref, priceMinor: 4000 },
    ]);
    expect(props.onNotice).toHaveBeenCalledWith('Rate card saved. New orders use it now.');
  });

  it('changes the picture of a garment, and keeps a removed row with Keep', () => {
    setup();
    fireEvent.click(button('Picture of Shirt'));
    expect(button('Picture of Shirt').getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByLabelText('No picture'));
    expect(within(button('Picture of Shirt')).getByText('S')).toBeTruthy();
    fireEvent.click(button('Picture of Shirt'));
    expect(screen.queryByLabelText('No picture')).toBeNull();
    expect(footer()).toContain('1 change not saved');
    const shoes = () => within(box('Shoes Wash price').closest('tr') as HTMLElement);
    fireEvent.click(shoes().getByRole('button', { name: 'Remove' }));
    expect(box('Shoes Wash price').disabled).toBe(true);
    fireEvent.click(shoes().getByRole('button', { name: 'Keep' }));
    expect(box('Shoes Wash price').disabled).toBe(false);
    const iron = () => within(box('Name of service Iron').closest('th') as HTMLElement);
    fireEvent.click(iron().getByRole('button', { name: 'Remove' }));
    expect(box('Shirt Iron price').disabled).toBe(true);
    fireEvent.click(iron().getByRole('button', { name: 'Keep' }));
    expect(footer()).toContain('1 change not saved');
  });

  it('says what is wrong instead of saving, and Undo changes starts again', () => {
    setup();
    fireEvent.change(box('Shirt Wash price'), { target: { value: 'abc' } });
    expect(screen.getByRole('alert').textContent).toBe('Check the price of Shirt for Wash: type it like 150 or 12.50.');
    expect(button('Save').disabled).toBe(true);
    fireEvent.click(button('Undo changes'));
    expect(box('Shirt Wash price').value).toBe('15');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(button('Add garment').disabled).toBe(true);
    expect(button('Add service').disabled).toBe(true);
  });

  it('keeps the changes and reports the error when saving fails', async () => {
    let fail: (error: Error) => void = () => undefined;
    api.saveCounterRateCard.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    const { props } = setup();
    fireEvent.change(box('Shirt Wash price'), { target: { value: '16' } });
    fireEvent.click(button('Save'));
    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeTruthy();
    fail(new Error('A garment called Saree already exists.'));
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'A garment called Saree already exists.' })));
    expect(box('Shirt Wash price').value).toBe('16');
    expect(props.onCatalogue).not.toHaveBeenCalled();
  });

  it('starts again from a catalogue passed in from above', () => {
    const { view, props } = setup();
    fireEvent.change(box('Shirt Wash price'), { target: { value: '16' } });
    const changed = { ...catalogue, rates: [{ ...catalogue.rates[0], priceMinor: 2000 }] };
    view.rerender(<RateCard {...props} catalogue={changed} />);
    expect(box('Shirt Wash price').value).toBe('20');
  });

  it('shows a new row with no name yet by its first letter only', () => {
    setup();
    fireEvent.change(box('Name of garment Shirt'), { target: { value: '' } });
    expect(button('Picture of new garment')).toBeTruthy();
    expect(box('Name of garment new')).toBeTruthy();
    fireEvent.change(box('Name of service Wash'), { target: { value: '' } });
    expect(box('Name of service new')).toBeTruthy();
  });
});
