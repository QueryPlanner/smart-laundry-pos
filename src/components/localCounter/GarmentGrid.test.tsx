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

  it('shows a pair price for shoes and never offers shoes ironed or starched, whatever the rate says', () => {
    setup();
    expect(card('Shoes').getByRole('button', { name: 'Add Shoes Wash' }).textContent).toBe('Wash₹150/pair');
    for (const service of ['Iron', 'Starch']) {
      expect(card('Shoes').queryByRole('button', { name: `Add Shoes ${service}` })).toBeNull();
    }
    expect(card('Shoes').getAllByRole('button')).toHaveLength(1);
  });

  it('shows only the services a garment has a price for, leaving out the rest instead of greying them', () => {
    setup();
    expect(card('Blank').getAllByRole('button').map(button => button.textContent)).toEqual(['Wash₹5']);
    expect(card('Blank').queryByRole('button', { name: 'Add Blank Iron' })).toBeNull();
    expect(card('Blank').queryByText('—')).toBeNull();
    expect(card('Blank').queryByText('No price set')).toBeNull();
  });

  it('names the two ways to wash side by side when a garment has both', () => {
    const services = [
      { id: 'only', key: 'wash_only' as const, name: 'Wash only', active: true }, { id: 'press', key: 'wash' as const, name: 'Wash + Press', active: true },
    ];
    setup({}, { services, rates: [rate('shirt', 'only', 2000), rate('shirt', 'press', 3000)] });
    expect(card('Shirt').getAllByRole('button').map(button => button.textContent)).toEqual(['Wash only₹20', 'Wash + Press₹30']);
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

  it('leaves out a garment with no price for any service, and a price of 0 counts as no price', () => {
    setup({}, { rates: [...catalogue.rates.filter(r => r.garmentId !== 'blank' && !(r.garmentId === 'shirt' && r.serviceId === 'wash')), rate('blank', 'iron', 0), rate('blank', 'starch', null, { configured: true, available: true }), rate('shirt', 'wash', 0)] });
    expect(screen.queryByRole('group', { name: 'Blank services' })).toBeNull();
    expect(screen.queryByText('Blank')).toBeNull();
    expect(card('Shirt').getAllByRole('button').map(button => button.textContent)).toEqual(['Iron₹10', 'Starch₹50']);
    expect(screen.queryByText('No price set')).toBeNull();
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

  describe('sections', () => {
    const sections = () => within(screen.getByRole('group', { name: 'Sections' }));

    it('offers All and every service that has something priced, starting on All', () => {
      setup();
      expect(sections().getAllByRole('button').map(button => button.textContent)).toEqual(['All', 'Iron', 'Wash', 'Starch']);
      expect(sections().getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('shows only the garments of the chosen section, each with only that service', () => {
      const { onAdd } = setup();
      fireEvent.click(sections().getByRole('button', { name: 'Iron' }));
      expect(sections().getByRole('button', { name: 'Iron' }).getAttribute('aria-pressed')).toBe('true');
      expect(screen.getAllByRole('group', { name: /services$/ })).toHaveLength(1);
      expect(card('Shirt').getAllByRole('button').map(button => button.textContent)).toEqual(['Iron₹10']);
      expect(screen.queryByText('Shoes')).toBeNull();
      fireEvent.click(card('Shirt').getByRole('button', { name: 'Add Shirt Iron' }));
      expect(onAdd).toHaveBeenCalledWith('shirt', 'iron');
      fireEvent.click(sections().getByRole('button', { name: 'Wash' }));
      expect(screen.getAllByRole('group', { name: /services$/ })).toHaveLength(3);
      fireEvent.click(sections().getByRole('button', { name: 'All' }));
      expect(card('Shirt').getAllByRole('button')).toHaveLength(3);
    });

    it('counts the pieces added in each section', () => {
      setup({ 'shirt|iron': 2, 'blank|wash': 1, 'shoe|wash': 3 });
      expect(sections().getByLabelText('2 in this section').closest('button')?.textContent).toBe('Iron2');
      expect(sections().getByLabelText('4 in this section').closest('button')?.textContent).toBe('Wash4');
      expect(sections().getByRole('button', { name: 'Starch' }).textContent).toBe('Starch');
    });

    it('goes back to All when the chosen section can no longer be sold', () => {
      const onAdd = vi.fn(); const onQuantity = vi.fn();
      const view = render(<GarmentGrid catalogue={catalogue} lines={{}} onAdd={onAdd} onQuantity={onQuantity} />);
      fireEvent.click(sections().getByRole('button', { name: 'Starch' }));
      const noStarch = { ...catalogue, rates: catalogue.rates.filter(r => r.serviceId !== 'starch') };
      view.rerender(<GarmentGrid catalogue={noStarch} lines={{}} onAdd={onAdd} onQuantity={onQuantity} />);
      expect(sections().queryByRole('button', { name: 'Starch' })).toBeNull();
      expect(sections().getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('is not shown when only one service can be sold', () => {
      setup({}, { rates: [rate('shirt', 'iron', 1000)] });
      expect(screen.queryByRole('group', { name: 'Sections' })).toBeNull();
    });
  });

  it('renders an empty grid before the catalogue loads', () => {
    render(<GarmentGrid catalogue={null} lines={{}} onAdd={vi.fn()} onQuantity={vi.fn()} />);
    expect(screen.getByLabelText('Garments').children.length).toBe(0);
    expect(screen.queryByText(/No prices are set yet/)).toBeNull();
  });
});
type CatalogueLike = CounterCatalogue;
