// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { GarmentGrid } from './GarmentGrid';
import type { CounterCatalogue } from '@/lib/localFirst/counter';

const garment = (id: string, nameEn: string, extra: Partial<CounterCatalogue['garments'][number]> = {}) => ({ id, key: id, nameEn, nameMr: nameEn, category: 'c', imageKey: id, billingUnit: 'piece' as const, active: true, ...extra });
const rate = (garmentId: string, serviceId: string, priceMinor: number | null, over: Partial<CounterCatalogue['rates'][number]> = {}) => ({ garmentId, serviceId, priceMinor, configured: priceMinor !== null, available: priceMinor !== null, version: 1, ...over });
const catalogue: CounterCatalogue = {
  garments: [garment('shirt', 'Shirt'), garment('shoe', 'Shoes', { billingUnit: 'pair' }), garment('old', 'Old', { active: false }), garment('blank', 'Blank', { imageKey: '' })],
  services: [
    { id: 'iron', key: 'iron', name: 'Iron', active: true }, { id: 'wash', key: 'wash', name: 'Wash', active: true },
    { id: 'starch', key: 'wash_iron', name: 'Starch', active: true }, { id: 'gone', key: 'dry_clean', name: 'Dry Clean', active: false },
  ],
  rates: [
    rate('shirt', 'iron', 1000), rate('shirt', 'wash', 1250), rate('shirt', 'starch', 5000),
    rate('shoe', 'wash', 15000), rate('shoe', 'iron', 100), rate('shoe', 'starch', 100),
    rate('blank', 'wash', 500),
  ],
};
const setup = (lines: Record<string, number> = {}, over: Partial<CounterCatalogue> = {}) => {
  const onAdd = vi.fn(); const onQuantity = vi.fn();
  render(<GarmentGrid catalogue={{ ...catalogue, ...over }} lines={lines} onAdd={onAdd} onQuantity={onQuantity} />);
  return { onAdd, onQuantity };
};
const card = (name: string) => within(screen.getByRole('group', { name: `${name} services` }));
afterEach(cleanup);

describe('GarmentGrid', () => {
  it('shows every active garment at once, with a button and price for each active service on its card', () => {
    setup();
    expect(screen.queryByText('Old')).toBeNull();
    expect(screen.getAllByRole('group', { name: /services$/ })).toHaveLength(3);
    expect(card('Shirt').getAllByRole('button').map(button => button.textContent)).toEqual(['Iron₹10', 'Wash₹12.50', 'Starch₹50']);
    expect(card('Shirt').queryByText('Dry Clean')).toBeNull();
  });

  it('shows a pair price for shoes and cannot sell shoes ironed or starched, whatever the rate says', () => {
    setup();
    expect(card('Shoes').getByRole('button', { name: 'Add Shoes Wash' }).textContent).toBe('Wash₹150/pair');
    for (const service of ['Iron', 'Starch']) {
      const button = card('Shoes').getByRole('button', { name: `Add Shoes ${service}` }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.textContent).toBe(`${service}—`);
    }
  });

  it('marks a service that has no price as unavailable', () => {
    setup();
    const blankIron = card('Blank').getByRole('button', { name: 'Add Blank Iron' }) as HTMLButtonElement;
    expect(blankIron.disabled).toBe(true);
    expect(blankIron.textContent).toBe('Iron—');
  });

  it('adds one piece of that garment under the tapped service', () => {
    const { onAdd } = setup();
    fireEvent.click(card('Shirt').getByRole('button', { name: 'Add Shirt Starch' }));
    fireEvent.click(card('Shirt').getByRole('button', { name: 'Add Shirt Iron' }));
    expect(onAdd.mock.calls).toEqual([['shirt', 'starch'], ['shirt', 'iron']]);
  });

  it('shows the count of each service already added, with a minus button only for those', () => {
    const { onQuantity } = setup({ 'shirt|wash': 2, 'shirt|iron': 1 });
    expect(card('Shirt').getByLabelText('2 added').textContent).toBe('×2');
    expect(card('Shirt').getByLabelText('1 added').textContent).toBe('×1');
    expect(card('Shirt').queryByRole('button', { name: 'Remove one Shirt Starch' })).toBeNull();
    fireEvent.click(card('Shirt').getByRole('button', { name: 'Remove one Shirt Wash' }));
    fireEvent.click(card('Shirt').getByRole('button', { name: 'Remove one Shirt Iron' }));
    expect(onQuantity.mock.calls).toEqual([['shirt', 1, 'wash'], ['shirt', 0, 'iron']]);
  });

  it('falls back to the first letter when a picture is missing, and to the key when no image key is set', () => {
    setup();
    const pictures = document.querySelectorAll('img');
    expect(Array.from(pictures).some(img => img.getAttribute('src') === '/garments/blank-transparent.png')).toBe(true);
    fireEvent.error(pictures[0]);
    expect(document.querySelector('.counter-garment-fallback')?.textContent).toBe('S');
  });

  it('dims a garment that cannot be sold under any service', () => {
    setup({}, { rates: catalogue.rates.filter(r => r.garmentId !== 'blank') });
    expect(screen.getByRole('group', { name: 'Blank services' }).closest('article')?.className).toContain('unavailable');
    expect(screen.getByRole('group', { name: 'Shirt services' }).closest('article')?.className).not.toContain('unavailable');
  });

  it('says so when no garment can be sold under any service, and not when something can', () => {
    const unpriced: CatalogueLike = { ...catalogue, rates: catalogue.rates.map(r => ({ ...r, available: false })) };
    const view = render(<GarmentGrid catalogue={unpriced} lines={{}} onAdd={vi.fn()} onQuantity={vi.fn()} />);
    expect(screen.getByText('No prices are set yet. Ask the owner to set the rate card.')).toBeTruthy();
    view.rerender(<GarmentGrid catalogue={{ ...unpriced, rates: [] }} lines={{}} onAdd={vi.fn()} onQuantity={vi.fn()} />);
    expect(screen.getByText('No prices are set yet. Ask the owner to set the rate card.')).toBeTruthy();
    view.rerender(<GarmentGrid catalogue={catalogue} lines={{}} onAdd={vi.fn()} onQuantity={vi.fn()} />);
    expect(screen.queryByText(/No prices are set yet/)).toBeNull();
  });

  it('renders an empty grid before the catalogue loads', () => {
    render(<GarmentGrid catalogue={null} lines={{}} onAdd={vi.fn()} onQuantity={vi.fn()} />);
    expect(screen.getByLabelText('Garments').children.length).toBe(0);
    expect(screen.queryByText(/No prices are set yet/)).toBeNull();
  });
});
type CatalogueLike = CounterCatalogue;
