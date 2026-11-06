import { describe, expect, it } from 'vitest';
import type { CounterCatalogue } from './counter';
import { cellKey, draftFromCatalogue, isLocked, newRef, planRateCard, priceText, type RateCardDraft } from './rateCard';

const catalogue: CounterCatalogue = {
  garments: [
    { id: 'shirt', key: 'shirt', nameEn: 'Shirt', nameMr: 'शर्ट', category: 'tops', imageKey: 'shirt', billingUnit: 'piece', active: true },
    { id: 'shoe', key: 'shoes', nameEn: 'Shoes', nameMr: '', category: 'foot', imageKey: 'shoes', billingUnit: 'pair', active: true },
    { id: 'mine', key: 'mine', nameEn: 'Mat', nameMr: '', category: 'custom', imageKey: 'mine', billingUnit: 'piece', active: true },
    { id: 'old', key: 'old', nameEn: 'Old', nameMr: '', category: 'x', imageKey: 'x', billingUnit: 'piece', active: false },
  ],
  services: [
    { id: 'wash', key: 'wash', name: 'Wash', active: true },
    { id: 'iron', key: 'iron', name: 'Iron', active: true },
    { id: 'gone', key: 'dry_clean', name: 'Dry Clean', active: false },
  ],
  rates: [
    { garmentId: 'shirt', serviceId: 'wash', priceMinor: 1500, configured: true, available: true, version: 1 },
    { garmentId: 'shirt', serviceId: 'iron', priceMinor: 1250, configured: true, available: true, version: 1 },
    { garmentId: 'shoe', serviceId: 'wash', priceMinor: 15000, configured: true, available: false, version: 1 },
    { garmentId: 'mine', serviceId: 'wash', priceMinor: null, configured: false, available: false, version: 1 },
  ],
};
const edit = (change: (draft: RateCardDraft) => void) => {
  const draft = draftFromCatalogue(catalogue);
  change(draft);
  return planRateCard(catalogue, draft);
};

describe('rate card draft', () => {
  it('shows active rows, the prices that sell, and pictures only when bundled', () => {
    const draft = draftFromCatalogue(catalogue);
    expect(draft.garments.map(g => [g.id, g.picture, g.pair])).toEqual([['shirt', 'shirt', false], ['shoe', 'shoes', true], ['mine', null, false]]);
    expect(draft.services.map(s => s.id)).toEqual(['wash', 'iron']);
    // A price that is switched off is shown as not sold.
    expect(draft.prices).toEqual({ 'shirt|wash': '15', 'shirt|iron': '12.50' });
    expect(planRateCard(catalogue, draft)).toEqual({ changes: { garments: [], services: [], newGarments: [], newServices: [], prices: [] }, count: 0, problem: '' });
  });

  it('writes prices plainly and locks ironing for shoes', () => {
    expect([priceText(0), priceText(15000), priceText(1205), priceText(99)]).toEqual(['0', '150', '12.05', '0.99']);
    expect(isLocked({ pair: true }, { key: 'iron' })).toBe(true);
    expect(isLocked({ pair: true }, { key: 'wash_iron' })).toBe(true);
    expect(isLocked({ pair: true }, { key: 'wash' })).toBe(false);
    expect(isLocked({ pair: false }, { key: 'iron' })).toBe(false);
    expect(cellKey('a', 'b')).toBe('a|b');
    expect(newRef()).not.toBe(newRef());
  });

  it('sends only what changed: a new price, a cleared price, and the same price typed differently is no change', () => {
    const plan = edit(d => { d.prices['shirt|wash'] = '15.00'; d.prices['shirt|iron'] = ' '; d.prices['mine|iron'] = '40'; d.prices['shoe|iron'] = '99'; });
    expect(plan.changes.prices).toEqual([
      { garmentId: 'shirt', serviceId: 'iron', priceMinor: null },
      { garmentId: 'mine', serviceId: 'iron', priceMinor: 4000 },
    ]);
    expect(plan.count).toBe(2);
  });

  it('sends renames tidied, picture changes and removals, and nothing for a name typed back', () => {
    const plan = edit(d => {
      d.garments[0].name = '  Formal   shirt ';
      d.garments[1].picture = null;
      d.garments[2].picture = 'apron';
      d.garments[2].name = 'Mat';
      d.services[0].removed = true;
      d.services[1].name = ' Iron ';
    });
    expect(plan.changes.garments).toEqual([{ id: 'shirt', name: 'Formal shirt' }, { id: 'shoe', picture: '' }, { id: 'mine', picture: 'apron' }]);
    expect(plan.changes.services).toEqual([{ id: 'wash', removed: true }]);
    // A removed service's prices are not sent.
    expect(plan.changes.prices).toEqual([]);
    expect(plan.count).toBe(4);
  });

  it('sends new rows by their ref with their prices, and forgets a new row removed again', () => {
    const plan = edit(d => {
      d.garments.push({ id: 'new:g', name: ' Apron ', picture: 'apron', pair: false, isNew: true, removed: false });
      d.garments.push({ id: 'new:h', name: 'Cap', picture: null, pair: false, isNew: true, removed: false });
      d.garments.push({ id: 'new:x', name: 'Oops', picture: null, pair: false, isNew: true, removed: true });
      d.services.push({ id: 'new:s', key: '', name: 'Steam', isNew: true, removed: false });
      d.prices['new:g|new:s'] = '40';
      d.prices['new:g|wash'] = '30';
      d.prices['new:x|wash'] = '30';
    });
    expect(plan.changes.newGarments).toEqual([{ ref: 'new:g', name: 'Apron', picture: 'apron' }, { ref: 'new:h', name: 'Cap' }]);
    expect(plan.changes.newServices).toEqual([{ ref: 'new:s', name: 'Steam' }]);
    expect(plan.changes.prices).toEqual([{ garmentId: 'new:g', serviceId: 'wash', priceMinor: 3000 }, { garmentId: 'new:g', serviceId: 'new:s', priceMinor: 4000 }]);
    expect(plan.count).toBe(5);
  });

  it('says what is wrong before Save can be pressed', () => {
    expect(edit(d => { d.prices['shirt|wash'] = '12,5'; }).problem).toBe('Check the price of Shirt for Wash: type it like 150 or 12.50.');
    expect(edit(d => { d.garments[0].name = '  '; }).problem).toBe('Give every garment a name.');
    expect(edit(d => { d.garments[2].name = 'shirt'; }).problem).toBe('Two garments are called shirt.');
    expect(edit(d => { d.services[1].name = 'WASH'; }).problem).toBe('Two services are called WASH.');
    expect(edit(d => { d.services.forEach(s => { s.removed = true; }); }).problem).toBe('Keep at least one service.');
    expect(edit(d => { d.garments.forEach(g => { g.removed = true; }); }).problem).toBe('Keep at least one garment.');
    // A removed row's name does not count.
    expect(edit(d => { d.garments[2].name = 'shirt'; d.garments[2].removed = true; }).problem).toBe('');
  });
});
