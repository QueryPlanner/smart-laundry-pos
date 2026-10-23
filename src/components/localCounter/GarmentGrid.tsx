import { useState } from 'react';
import { Minus } from 'lucide-react';
import type { CounterCatalogue, CounterGarment, CounterRate, CounterService } from '@/lib/localFirst/counter';

/** Shoes are billed per pair and cannot be ironed or starched. */
const isForbidden = (garment: CounterGarment, service: CounterService) =>
  garment.billingUnit === 'pair' && (service.key === 'iron' || service.key === 'wash_iron');

const isSellable = (garment: CounterGarment, service: CounterService, rate: CounterRate | undefined) =>
  !!rate?.available && !!rate.configured && !isForbidden(garment, service);

/** True when no active garment can be sold under any active service, for example before the owner has set any rate. */
const nothingIsSellable = (catalogue: CounterCatalogue, services: CounterService[]) =>
  !catalogue.garments.some(garment => garment.active && services.some(service =>
    isSellable(garment, service, catalogue.rates.find(r => r.garmentId === garment.id && r.serviceId === service.id))));

/** Whole rupees without decimals (₹30), otherwise with paise (₹12.50). */
const price = (minor: number, unit: CounterGarment['billingUnit']) =>
  `₹${minor % 100 === 0 ? minor / 100 : (minor / 100).toFixed(2)}${unit === 'pair' ? '/pair' : ''}`;

const GarmentPicture = ({ src, label }: { src: string; label: string }) => {
  const [failed, setFailed] = useState(false);
  return failed
    ? <span className="counter-garment-fallback visible" aria-hidden="true">{label.slice(0, 1)}</span>
    : <img src={src} alt="" onError={() => setFailed(true)} />;
};

interface GarmentGridProps {
  catalogue: CounterCatalogue | null;
  /** Quantity per `garmentId|serviceId`. */
  lines: Record<string, number>;
  onAdd: (garmentId: string, serviceId: string) => void;
  onQuantity: (garmentId: string, quantity: number, serviceId: string) => void;
}

/** The section tab that shows every service at once. */
const ALL = 'all';

/**
 * The garments, by section. "All" shows every active garment with the services it is sold under (for
 * example Iron, Wash only, Wash + Press, Dry Clean, Starch) as buttons along the bottom of its card, each
 * with its price. A section (one service) shows only the garments priced for it, each with that one
 * button. One tap adds one piece; a count with a minus button appears once something has been added, and
 * each section tab counts the pieces added in it. A service the garment has no price for is not shown.
 */
export const GarmentGrid = ({ catalogue, lines, onAdd, onQuantity }: GarmentGridProps) => {
  const [section, setSection] = useState(ALL);
  const active = (catalogue?.services ?? []).filter(service => service.active);
  const sections = catalogue ? active.filter(service => catalogue.garments.some(garment => garment.active
    && isSellable(garment, service, catalogue.rates.find(r => r.garmentId === garment.id && r.serviceId === service.id)))) : [];
  // A section that was removed or lost its last price falls back to every service.
  const chosen = sections.find(service => service.id === section);
  const services = chosen ? [chosen] : active;
  const added = (serviceId: string) => Object.entries(lines)
    .filter(([key]) => key.endsWith(`|${serviceId}`))
    .reduce((sum, [, quantity]) => sum + quantity, 0);
  return <>
    {catalogue && nothingIsSellable(catalogue, active) && <p className="counter-no-rates" role="status">No prices are set yet. Ask the owner to set the rate card.</p>}
    {sections.length > 1 && (
      <div className="counter-services" role="group" aria-label="Sections">
        <span className="counter-section-label">Section</span>
        <button type="button" className={chosen ? '' : 'selected'} aria-pressed={!chosen} onClick={() => setSection(ALL)}>All</button>
        {sections.map(service => {
          const count = added(service.id);
          return (
            <button type="button" key={service.id} className={chosen?.id === service.id ? 'selected' : ''} aria-pressed={chosen?.id === service.id} onClick={() => setSection(service.id)}>
              {service.name}{count > 0 && <em className="counter-section-count" aria-label={`${count} in this section`}>{count}</em>}
            </button>
          );
        })}
      </div>
    )}
    <div className="counter-garment-grid" aria-label="Garments">
      {(catalogue?.garments ?? []).filter(garment => garment.active).map(garment => {
        const offered = services.flatMap(service => {
          const rate = catalogue?.rates.find(r => r.garmentId === garment.id && r.serviceId === service.id);
          return isSellable(garment, service, rate) ? [{ service, rate: rate as CounterRate, quantity: lines[`${garment.id}|${service.id}`] || 0 }] : [];
        });
        // Inside a section, a garment that is not sold there is left out rather than greyed out.
        if (chosen && offered.length === 0) return null;
        return (
          <article className={`counter-garment ${offered.length > 0 ? '' : 'unavailable'}`} key={garment.id}>
            <div className="counter-garment-picture">
              <GarmentPicture src={`/garments/${garment.imageKey || garment.key}-transparent.png`} label={garment.nameEn} />
            </div>
            <div className="counter-garment-name"><strong>{garment.nameEn}</strong><span lang="mr">{garment.nameMr}</span></div>
            <div className="counter-service-buttons" role="group" aria-label={`${garment.nameEn} services`}>
              {offered.length === 0 && <p className="counter-garment-none">No price set</p>}
              {offered.map(({ service, rate, quantity }) => (
                <div className={`counter-service-chip ${quantity > 0 ? 'selected' : ''}`} key={service.id}>
                  {quantity > 0 && (
                    <button type="button" className="counter-chip-minus" aria-label={`Remove one ${garment.nameEn} ${service.name}`} onClick={() => onQuantity(garment.id, quantity - 1, service.id)}><Minus /></button>
                  )}
                  <button type="button" className="counter-chip-add" aria-label={`Add ${garment.nameEn} ${service.name}`} onClick={() => onAdd(garment.id, service.id)}>
                    <span>{service.name}</span>
                    <strong>{price(rate.priceMinor as number, garment.billingUnit)}</strong>
                    {quantity > 0 && <em aria-label={`${quantity} added`}>×{quantity}</em>}
                  </button>
                </div>
              ))}
            </div>
          </article>
        );
      })}
    </div>
  </>;
};
