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
    fireEvent.click(button('Add garment'));
    fireEvent.change(box('Name'), { target: { value: 'Apron' } });
    // The picture is optional, and the chosen one previews in the panel.
    fireEvent.click(screen.getByLabelText('Apron', { selector: 'input[type=radio]' }));
    expect(screen.getByText('Picture chosen')).toBeTruthy();
    fireEvent.click(button('Add to rate card'));
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
    fireEvent.click(button('Done'));
    expect(button('Picture of Shirt').getAttribute('aria-expanded')).toBe('false');
    // The picture button itself also closes an open choice.
    fireEvent.click(button('Picture of Shirt'));
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
    expect(button('Add service').disabled).toBe(true);
  });

  it('opens the Add garment panel with focus, and Escape discards only its form', () => {
    setup();
    fireEvent.change(box('Shirt Wash price'), { target: { value: '16' } });
    const opener = button('Add garment');
    fireEvent.click(opener);
    const name = box('Name');
    expect(document.activeElement).toBe(name);
    fireEvent.change(name, { target: { value: 'Leather jacket' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Add garment' })).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(box('Shirt Wash price').value).toBe('16');
    expect(footer()).toContain('1 change not saved');
  });

  it('adds a garment with no picture, and Cancel keeps the earlier draft edits', () => {
    setup();
    fireEvent.change(box('Shirt Iron price'), { target: { value: '20' } });
    fireEvent.click(button('Add garment'));
    expect(screen.getByText('No picture chosen')).toBeTruthy();
    fireEvent.change(box('Name'), { target: { value: '  Leather   jacket ' } });
    fireEvent.click(button('Cancel'));
    expect(screen.queryByRole('dialog', { name: 'Add garment' })).toBeNull();
    expect(screen.queryByLabelText('Name of garment Leather jacket')).toBeNull();
    expect(box('Shirt Iron price').value).toBe('20');

    fireEvent.click(button('Add garment'));
    fireEvent.change(box('Name'), { target: { value: '  Leather   jacket ' } });
    fireEvent.click(button('Add to rate card'));
    expect(box('Name of garment Leather jacket').value).toBe('Leather jacket');
    fireEvent.change(box('Leather jacket Wash price'), { target: { value: '99' } });
    expect(footer()).toContain('3 changes not saved');
  });

  it('refuses a blank or duplicate garment name before making a draft row', () => {
    setup();
    fireEvent.click(button('Add garment'));
    fireEvent.click(button('Add to rate card'));
    expect(screen.getByRole('alert').textContent).toBe('Give the garment a name.');
    fireEvent.change(box('Name'), { target: { value: '  shirt ' } });
    fireEvent.click(button('Add to rate card'));
    expect(screen.getByRole('alert').textContent).toBe('A garment called shirt already exists.');
    expect(screen.getAllByLabelText(/^Name of garment/)).toHaveLength(2);
    fireEvent.change(box('Name'), { target: { value: 'Scarf' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(button('Close panel'));
    expect(screen.queryByRole('dialog', { name: 'Add garment' })).toBeNull();
  });

  it('closes the panel when the backdrop is clicked', () => {
    setup();
    fireEvent.click(button('Add garment'));
    fireEvent.click(document.querySelector('.counter-side-panel-backdrop') as HTMLElement);
    expect(screen.queryByRole('dialog', { name: 'Add garment' })).toBeNull();
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
