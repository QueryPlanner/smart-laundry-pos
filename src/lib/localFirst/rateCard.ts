import type { CounterCatalogue, CounterGarment, CounterRate, CounterRateCardChanges, CounterRateCardRowEdit, CounterService } from './counter';
import { GARMENT_PICTURES } from './garmentPictures';
import { parsePaymentAmountMinor } from './payment';

/**
 * The rate card as the administrator edits it, before Save. Every change stays here until one Save
 * sends them all together (`saveCounterRateCard`), so nothing is half saved.
 */
export interface DraftGarment {
  id: string;
  name: string;
  /** The Marathi name shown under the name on the counter; empty for none. */
  nameMr: string;
  /** A bundled picture key, or null for none (the counter shows the first letter). */
  picture: string | null;
  /** Shoes: sold by the pair and never ironed. */
  pair: boolean;
  isNew: boolean;
  removed: boolean;
}
export interface DraftService { id: string; key: string; name: string; isNew: boolean; removed: boolean }
export interface RateCardDraft {
  garments: DraftGarment[];
  services: DraftService[];
  /** The price box text for each garment and service (`cellKey`); empty or 0 means not sold. */
  prices: Record<string, string>;
}

export const cellKey = (garmentId: string, serviceId: string): string => `${garmentId}|${serviceId}`;

/** Shoes are never ironed, so those boxes cannot take a price. */
export const isLocked = (garment: Pick<DraftGarment, 'pair'>, service: Pick<DraftService, 'key'>): boolean =>
  garment.pair && (service.key === 'iron' || service.key === 'wash_iron');

/** A price as the box shows it: "150" for whole rupees, "12.50" otherwise. */
export const priceText = (minor: number): string => {
  const paise = minor % 100;
  return paise === 0 ? String(minor / 100) : `${(minor - paise) / 100}.${String(paise).padStart(2, '0')}`;
};

const tidy = (name: string) => name.split(/\s+/).filter(Boolean).join(' ');
const pictureOf = (garment: CounterGarment) => (GARMENT_PICTURES.some(picture => picture.key === garment.imageKey) ? garment.imageKey : null);
/** What a garment sells for under a service now, or null when it is not sold (no price, or 0). */
const soldFor = (rate: CounterRate | undefined): number | null =>
  rate?.configured && rate.available && rate.priceMinor !== null && rate.priceMinor > 0 ? rate.priceMinor : null;

export const draftFromCatalogue = (catalogue: CounterCatalogue): RateCardDraft => {
  const garments = catalogue.garments.filter(garment => garment.active);
  const services = catalogue.services.filter(service => service.active);
  const prices: Record<string, string> = {};
  for (const rate of catalogue.rates) {
    const minor = soldFor(rate);
    if (minor !== null) prices[cellKey(rate.garmentId, rate.serviceId)] = priceText(minor);
  }
  return {
    garments: garments.map(garment => ({ id: garment.id, name: garment.nameEn, nameMr: garment.nameMr, picture: pictureOf(garment), pair: garment.billingUnit === 'pair', isNew: false, removed: false })),
    services: services.map(service => ({ id: service.id, key: service.key, name: service.name, isNew: false, removed: false })),
    prices,
  };
};

let lastRef = 0;
/** A name for a row that has no id yet; prices refer to it until the save gives it one. */
export const newRef = (): string => `new:${++lastRef}`;

export interface RateCardPlan {
  changes: CounterRateCardChanges;
  /** How many things Save would change. */
  count: number;
  /** Why Save cannot be pressed yet, or empty. */
  problem: string;
}

const namesProblem = (rows: Array<{ name: string; removed: boolean }>, what: string): string => {
  const kept = rows.filter(row => !row.removed).map(row => tidy(row.name));
  if (kept.length === 0) return `Keep at least one ${what}.`;
  if (kept.some(name => name === '')) return `Give every ${what} a name.`;
  const seen = new Set<string>();
  for (const name of kept) {
    if (seen.has(name.toLowerCase())) return `Two ${what}s are called ${name}.`;
    seen.add(name.toLowerCase());
  }
  return '';
};

/** Compares the draft with the saved catalogue: what Save would send, how much, and what is wrong. */
export const planRateCard = (catalogue: CounterCatalogue, draft: RateCardDraft): RateCardPlan => {
  const edits = <T extends DraftGarment | DraftService>(rows: T[], original: (row: T) => { name: string; picture?: string | null; nameMr?: string }) =>
    rows.flatMap((row): CounterRateCardRowEdit[] => {
      if (row.isNew) return [];
      if (row.removed) return [{ id: row.id, removed: true }];
      const before = original(row);
      const edit: CounterRateCardRowEdit = { id: row.id };
      if (tidy(row.name) !== before.name) edit.name = tidy(row.name);
      if ('picture' in row && row.picture !== before.picture) edit.picture = row.picture ?? '';
      if ('nameMr' in row && tidy(row.nameMr) !== before.nameMr) edit.nameMr = tidy(row.nameMr);
      return Object.keys(edit).length > 1 ? [edit] : [];
    });
  const garmentById = new Map(catalogue.garments.map(garment => [garment.id, garment]));
  const serviceById = new Map(catalogue.services.map(service => [service.id, service]));
  const garments = edits(draft.garments, row => {
    const garment = garmentById.get(row.id) as CounterGarment;
    return { name: garment.nameEn, picture: pictureOf(garment), nameMr: garment.nameMr };
  });
  const services = edits(draft.services, row => ({ name: (serviceById.get(row.id) as CounterService).name }));
  const newGarments = draft.garments.filter(row => row.isNew && !row.removed)
    .map(row => ({ ref: row.id, name: tidy(row.name), ...(row.picture ? { picture: row.picture } : {}), ...(tidy(row.nameMr) ? { nameMr: tidy(row.nameMr) } : {}) }));
  const newServices = draft.services.filter(row => row.isNew && !row.removed).map(row => ({ ref: row.id, name: tidy(row.name) }));

  let problem = namesProblem(draft.garments, 'garment') || namesProblem(draft.services, 'service');
  const prices: CounterRateCardChanges['prices'] = [];
  for (const garment of draft.garments.filter(row => !row.removed)) {
    for (const service of draft.services.filter(row => !row.removed)) {
      if (isLocked(garment, service)) continue;
      const text = (draft.prices[cellKey(garment.id, service.id)] ?? '').trim();
      const typed = text === '' ? null : parsePaymentAmountMinor(text);
      if (typed === null && text !== '') {
        problem ||= `Check the price of ${tidy(garment.name)} for ${tidy(service.name)}: type it like 150 or 12.50.`;
        continue;
      }
      const before = garment.isNew || service.isNew ? null : soldFor(catalogue.rates.find(rate => rate.garmentId === garment.id && rate.serviceId === service.id));
      // 0 means "not sold", the same as an empty box.
      const minor = typed === 0 ? null : typed;
      if (minor !== before) prices.push({ garmentId: garment.id, serviceId: service.id, priceMinor: minor });
    }
  }
  const changes = { garments, services, newGarments, newServices, prices };
  return { changes, count: garments.length + services.length + newGarments.length + newServices.length + prices.length, problem };
};
