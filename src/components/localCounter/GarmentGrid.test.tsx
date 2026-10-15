// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GarmentGrid } from './GarmentGrid';
import type { CounterCatalogue } from '@/lib/localFirst/counter';

const garment = (id: string, nameEn: string, extra: Partial<CounterCatalogue['garments'][number]> = {}) => ({ id, key: id, nameEn, nameMr: nameEn, category: 'c', imageKey: id, billingUnit: 'piece' as const, active: true, ...extra });
const catalogue: CounterCatalogue = {
  garments: [garment('shirt', 'Shirt'), garment('shoe', 'Shoes', { billingUnit: 'pair' }), garment('old', 'Old', { active: false }), garment('blank', 'Blank', { imageKey: '' })],
  services: [{ id: 'wash', key: 'wash', name: 'Wash', active: true }, { id: 'iron', key: 'iron', name: 'Iron', active: true }],
  rates: [
    { garmentId: 'shirt', serviceId: 'wash', priceMinor: 1250, configured: true, available: true, version: 1 },
    { garmentId: 'shoe', serviceId: 'wash', priceMinor: 15000, configured: true, available: true, version: 1 },
    { garmentId: 'shoe', serviceId: 'iron', priceMinor: 100, configured: true, available: true, version: 1 },
    { garmentId: 'blank', serviceId: 'wash', priceMinor: 500, configured: true, available: true, version: 1 },
  ],
};
const setup = (lines: Record<string, number> = {}, serviceId = 'wash') => {
  const onAdd = vi.fn(); const onQuantity = vi.fn();
  render(<GarmentGrid catalogue={catalogue} serviceId={serviceId} lines={lines} onAdd={onAdd} onQuantity={onQuantity} />);
  return { onAdd, onQuantity };
};
afterEach(cleanup);

describe('GarmentGrid', () => {
  it('shows active garments with their fixed price and billing unit', () => {
    setup();
    expect(screen.getByText('₹12.50 / piece')).toBeTruthy();
    expect(screen.getByText('₹150.00 / pair')).toBeTruthy();
    expect(screen.queryByText('Old')).toBeNull();
  });

  it('adds with the picture and plus button and removes with minus', () => {
    const { onAdd, onQuantity } = setup({ 'shirt|wash': 2 });
    fireEvent.click(screen.getByRole('button', { name: 'Add Shirt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add one Shirt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove one Shirt' }));
    expect(onAdd).toHaveBeenCalledTimes(2);
    expect(onQuantity).toHaveBeenCalledWith('shirt', 1);
  });

  it('turns typed quantities into whole non-negative numbers', () => {
    const { onQuantity } = setup();
    const input = screen.getByLabelText('Shirt quantity');
    fireEvent.change(input, { target: { value: '3.9' } });
    fireEvent.change(input, { target: { value: '-4' } });
    fireEvent.change(input, { target: { value: 'abc' } });
    expect(onQuantity.mock.calls).toEqual([['shirt', 3], ['shirt', 0], ['shirt', 0]]);
    expect((screen.getByRole('button', { name: 'Remove one Shirt' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('blocks unavailable combinations, including ironing shoes', () => {
    setup({}, 'iron');
    expect(screen.getByText('Ironing shoes unavailable')).toBeTruthy();
    expect(screen.getAllByText('Unavailable for this service').length).toBeGreaterThan(0);
    expect((screen.getByRole('button', { name: 'Add Shoes' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Shoes quantity') as HTMLInputElement).disabled).toBe(true);
  });

  it('falls back to the first letter when a picture is missing, and to the key when no image key is set', () => {
    setup();
    const pictures = document.querySelectorAll('img');
    expect(Array.from(pictures).some(img => img.getAttribute('src') === '/garments/blank-transparent.png')).toBe(true);
    fireEvent.error(pictures[0]);
    expect(document.querySelector('.counter-garment-fallback')?.textContent).toBe('S');
  });

  it('says so when no garment can be sold under any service, and not when something can', () => {
    const unpriced: CounterCatalogue = { ...catalogue, rates: catalogue.rates.map(r => ({ ...r, available: false })) };
    const view = render(<GarmentGrid catalogue={unpriced} serviceId="wash" lines={{}} onAdd={vi.fn()} onQuantity={vi.fn()} />);
    expect(screen.getByText('No prices are set yet. Ask the owner to set the rate card.')).toBeTruthy();
    view.rerender(<GarmentGrid catalogue={{ ...unpriced, rates: [] }} serviceId="wash" lines={{}} onAdd={vi.fn()} onQuantity={vi.fn()} />);
    expect(screen.getByText('No prices are set yet. Ask the owner to set the rate card.')).toBeTruthy();
    view.rerender(<GarmentGrid catalogue={catalogue} serviceId="wash" lines={{}} onAdd={vi.fn()} onQuantity={vi.fn()} />);
    expect(screen.queryByText(/No prices are set yet/)).toBeNull();
  });

  it('still offers a garment priced under only one of the services', () => {
    const onlyIron: CounterCatalogue = { ...catalogue, rates: catalogue.rates.filter(r => r.garmentId === 'shirt').map(r => ({ ...r, serviceId: 'iron' })) };
    render(<GarmentGrid catalogue={onlyIron} serviceId="wash" lines={{}} onAdd={vi.fn()} onQuantity={vi.fn()} />);
    expect(screen.queryByText(/No prices are set yet/)).toBeNull();
  });

  it('renders an empty grid before the catalogue loads', () => {
    render(<GarmentGrid catalogue={null} serviceId="" lines={{}} onAdd={vi.fn()} onQuantity={vi.fn()} />);
    expect(screen.getByLabelText('Garments').children.length).toBe(0);
    expect(screen.queryByText(/No prices are set yet/)).toBeNull();
  });
});
