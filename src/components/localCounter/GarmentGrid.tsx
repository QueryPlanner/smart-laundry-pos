import { Minus, Plus } from 'lucide-react';
import type { CounterCatalogue, CounterGarment, CounterRate, CounterService } from '@/lib/localFirst/counter';

/** Shoes are billed per pair and cannot be ironed. */
const isForbidden = (garment: CounterGarment, service: CounterService | undefined) =>
  garment.billingUnit === 'pair' && (service?.key === 'iron' || service?.key === 'wash_iron');

const isSellable = (garment: CounterGarment, service: CounterService | undefined, rate: CounterRate | undefined) =>
  !!rate?.available && !!rate.configured && !isForbidden(garment, service);

/** True when no active garment can be sold under any active service, for example before the owner has set any rate. */
const nothingIsSellable = (catalogue: CounterCatalogue) =>
  !catalogue.garments.some(garment => garment.active && catalogue.services.some(service =>
    service.active && isSellable(garment, service, catalogue.rates.find(r => r.garmentId === garment.id && r.serviceId === service.id))));

export const GarmentGrid = ({catalogue,serviceId,lines,onAdd,onQuantity}:{catalogue:CounterCatalogue|null;serviceId:string;lines:Record<string,number>;onAdd:(id:string)=>void;onQuantity:(id:string,n:number)=>void}) => {
  const service = catalogue?.services.find(s=>s.id===serviceId);
  return <>
  {catalogue && nothingIsSellable(catalogue) && <p className="counter-no-rates" role="status">No prices are set yet. Ask the owner to set the rate card.</p>}
  <div className="counter-garment-grid" aria-label="Garments">
    {(catalogue?.garments||[]).filter(g=>g.active).map(g=>{
      const rate=catalogue?.rates.find(r=>r.garmentId===g.id&&r.serviceId===serviceId);
      const key=`${g.id}|${serviceId}`; const quantity=lines[key]||0;
      const forbidden=isForbidden(g,service);
      const available=isSellable(g,service,rate);
      return <article className={`counter-garment ${available?'':'unavailable'}`} key={g.id}>
        <button type="button" className="counter-garment-picture" disabled={!available} aria-label={`Add ${g.nameEn}`} onClick={()=>onAdd(g.id)}>
          <GarmentPicture src={`/garments/${g.imageKey||g.key}-transparent.png`} label={g.nameEn} />
        </button>
        <div className="counter-garment-name"><strong>{g.nameEn}</strong><span lang="mr">{g.nameMr}</span></div>
        <p className="counter-garment-price">{available?`₹${(rate!.priceMinor!/100).toFixed(2)} / ${g.billingUnit==='pair'?'pair':'piece'}`:forbidden?'Ironing shoes unavailable':'Unavailable for this service'}</p>
        <div className="counter-quantity" aria-label={`${g.nameEn} quantity for ${service?.name}`}>
          <button type="button" disabled={!available||quantity===0} aria-label={`Remove one ${g.nameEn}`} onClick={()=>onQuantity(g.id,quantity-1)}><Minus/></button>
          <input aria-label={`${g.nameEn} quantity`} type="number" min="0" step="1" inputMode="numeric" disabled={!available} value={quantity} onChange={e=>onQuantity(g.id,Math.max(0,Math.floor(Number(e.target.value)||0)))}/>
          <button type="button" disabled={!available} aria-label={`Add one ${g.nameEn}`} onClick={()=>onAdd(g.id)}><Plus/></button>
        </div>
      </article>;
    })}
  </div>
  </>;
};
import { useState } from 'react';

const GarmentPicture=({src,label}:{src:string;label:string})=>{const[failed,setFailed]=useState(false);return failed?<span className="counter-garment-fallback visible" aria-hidden="true">{label.slice(0,1)}</span>:<img src={src} alt="" onError={()=>setFailed(true)}/>};
